/**
 * Agentic hybrid retrieval.
 *
 * The pipeline, in order:
 *
 *   embed dense + lexical (in parallel)
 *     -> query every project namespace on both legs (in parallel)
 *     -> reciprocal rank fusion
 *     -> cross-encoder rerank
 *     -> maximal marginal relevance
 *     -> confidence gate -> rewrite and retry only if weak
 *
 * Two deliberate changes from the loop this replaces, both about latency.
 *
 * The old graph rewrote the query with an LLM before every single search, then
 * graded the result with a second LLM call, so a plain lookup cost two model
 * calls before generation had even started. Embeddings handle natural language
 * perfectly well, so the first attempt now uses the user's own words and the
 * rewrite is held back as the recovery path.
 *
 * The grade is replaced by the reranker's own score. A cross-encoder that has
 * read the query and the passage together is a better judge of relevance than a
 * Haiku call asking "good or weak", and it is free, because it has already run.
 * An LLM grade is spent only when the score lands in the ambiguous band, where a
 * second opinion is actually worth the few hundred milliseconds.
 *
 * The result is zero LLM calls on the common path and at most two on the
 * recovery path, against a guaranteed two before.
 */
import { settings } from "./config";
import { complete } from "./anthropic";
import { embedQuery, rerank } from "./voyage";
import { embedSparseQuery } from "./sparse";
import { adopt, fetchValues, type Hits, queryNamespaces } from "./pinecone";
import {
  capPerDocument,
  lexicalVectors,
  maximalMarginalRelevance,
  reciprocalRankFusion,
} from "./fusion";
import { getProfile, type RetrievalProfile } from "./profiles";
import type { RetrievedChunk } from "@/lib/types";

const MAX_ATTEMPTS = 2;

export interface AgenticRetrieval {
  chunks: RetrievedChunk[];
  /** The query that actually produced these chunks, after any rewrite. */
  query: string;
  attempts: number;
  grade: "good" | "weak";
  profile: string;
  /** Per-stage notes, surfaced in the UI as the agent's steps. */
  trace: string[];
}

// ------------------------------- the search pass ------------------------------ //

/** One full retrieve pass. Returns the chunks and a trace of what happened. */
export async function hybridSearch(
  namespaces: string[],
  query: string,
  profile: RetrievalProfile
): Promise<{ chunks: RetrievedChunk[]; trace: string[] }> {
  const trace: string[] = [];
  if (namespaces.length === 0) return { chunks: [], trace };

  // Both embeddings are independent network calls, so they overlap rather than
  // queue. The lexical one is allowed to come back null — a stopword-only query
  // has no lexical signal, and hybrid may be off entirely — and the search
  // carries on dense-only.
  const [denseVector, sparseVector] = await Promise.all([
    embedQuery(query),
    embedSparseQuery(query),
  ]);

  // The two legs are likewise independent. Neither asks for vector values:
  // returning a wide candidate set's worth of 1024-float arrays costs far more
  // in payload than the round trip itself. MMR only needs vectors for the
  // reranked pool, which is smaller, so they are fetched after reranking.
  const [dense, sparse] = await Promise.all([
    queryNamespaces(namespaces, { vector: denseVector, topK: profile.candidates }),
    sparseVector
      ? queryNamespaces(namespaces, { sparseVector, topK: profile.candidates })
      : Promise.resolve(null as Hits | null),
  ]);

  const lists = [dense.chunks];
  const weights = [profile.denseWeight];
  if (sparse && sparse.chunks.length > 0) {
    lists.push(sparse.chunks);
    weights.push(profile.sparseWeight);
    adopt(dense, sparse); // vectors and namespaces only; the lists stay apart
  }
  trace.push(
    `hybrid: ${dense.chunks.length} dense + ${sparse?.chunks.length ?? 0} lexical candidate(s)`
  );

  const candidates = reciprocalRankFusion(lists, weights).slice(0, profile.candidates);
  if (candidates.length === 0) return { chunks: [], trace };

  // Cross-encoder rerank: the single biggest precision lever in the pipeline.
  const poolSize = Math.max(profile.keep, Math.min(profile.mmrPool, candidates.length));
  let reranked: RetrievedChunk[];
  try {
    const ranked = await rerank(
      query,
      candidates.map((c) => c.text),
      poolSize
    );
    reranked = ranked.map(({ index, score }) => ({ ...candidates[index], score }));
    trace.push(
      reranked.length
        ? `reranked to ${reranked.length}, top score ${reranked[0].score.toFixed(2)}`
        : "rerank returned nothing"
    );
  } catch {
    // A reranker outage must not take the search with it.
    reranked = candidates.slice(0, poolSize);
    trace.push("rerank unavailable, using fusion order");
  }
  if (reranked.length === 0) return { chunks: [], trace };

  let selected = await diversify(reranked, denseVector, dense.namespaceOf, profile, trace);

  if (profile.perDocCap) {
    const before = selected.length;
    selected = capPerDocument(selected, profile.perDocCap);
    if (selected.length < before) trace.push(`capped to ${profile.perDocCap} chunk(s) per document`);
  }

  // MMR optimises for coverage, not ordering, so the final list is put back into
  // relevance order before the model reads it.
  selected.sort((a, b) => b.score - a.score);
  return { chunks: selected, trace };
}

/** Apply MMR over the reranked pool, on real vectors where possible. */
async function diversify(
  reranked: RetrievedChunk[],
  queryVector: number[],
  namespaceOf: Map<string, string>,
  profile: RetrievalProfile,
  trace: string[]
): Promise<RetrievedChunk[]> {
  if (reranked.length <= profile.keep) return reranked.slice(0, profile.keep);

  const vectors = await fetchValues(
    reranked.map((c) => c.id),
    namespaceOf
  );
  const usable = reranked.filter((c) => vectors.get(c.id)?.length);

  if (usable.length > profile.keep) {
    const picked = maximalMarginalRelevance(
      queryVector,
      usable.map((c) => vectors.get(c.id)!),
      profile.keep,
      profile.lambda
    );
    trace.push(`MMR kept ${profile.keep} of ${usable.length} (lambda ${profile.lambda})`);
    return picked.map((i) => usable[i]);
  }

  // No vectors came back. Rather than dropping diversity entirely, run MMR on
  // lexical overlap, using the top-ranked chunk as the relevance anchor.
  const matrix = lexicalVectors(reranked.map((c) => c.text));
  const picked = maximalMarginalRelevance(matrix[0], matrix, profile.keep, profile.lambda);
  trace.push(`MMR kept ${profile.keep} of ${reranked.length} (lexical fallback)`);
  return picked.map((i) => reranked[i]);
}

// ------------------------------- helper LLM calls ----------------------------- //

/** Reformulate a query that retrieved poorly. Only ever on the recovery path. */
export async function rewriteQuery(raw: string, previous?: string): Promise<string> {
  const prompt = previous
    ? `The search query "${previous}" returned weak results for this question:\n"${raw}"\n\nWrite ONE different, more effective search query. Use the key entities, names and identifiers. Return only the query, no preamble.`
    : `Turn this into ONE concise search query optimised for document retrieval. Keep the key entities, names and identifiers. Return only the query, no preamble.\n\nQuestion: ${raw}`;
  const out = await complete(prompt, { maxTokens: 80 });
  return out.replace(/^["']|["']$/g, "").trim() || raw;
}

/** Ask the fast model whether these passages answer the question. */
export async function gradeChunks(
  question: string,
  chunks: RetrievedChunk[]
): Promise<"good" | "weak"> {
  if (chunks.length === 0) return "weak";
  const context = chunks.map((c, i) => `[${i + 1}] ${c.text.slice(0, 500)}`).join("\n\n");
  const verdict = await complete(
    `Question: ${question}\n\nRetrieved passages:\n${context}\n\nDo these passages contain enough information to answer the question? Reply with exactly one word: "good" or "weak".`,
    { maxTokens: 5 }
  );
  return /good/i.test(verdict) ? "good" : "weak";
}

/** Groundedness self-check: is every claim in the answer supported by a source? */
export async function checkGrounded(
  answer: string,
  chunks: RetrievedChunk[]
): Promise<boolean> {
  if (chunks.length === 0) return true;
  const context = chunks.map((c, i) => `[${i + 1}] ${c.text.slice(0, 500)}`).join("\n\n");
  const verdict = await complete(
    `Sources:\n${context}\n\nAnswer:\n${answer}\n\nIs every factual claim in the answer supported by the sources above? Reply with exactly one word: "yes" or "no".`,
    { maxTokens: 5 }
  );
  return /yes/i.test(verdict);
}

/**
 * Decide whether a result is good enough, as cheaply as it can be decided.
 *
 * The reranker has already scored every passage against the query, so its top
 * score answers the question for free in the clear cases. Only the middle band
 * is worth an LLM call.
 */
async function assess(
  question: string,
  chunks: RetrievedChunk[],
  profile: RetrievalProfile
): Promise<{ grade: "good" | "weak"; note: string }> {
  if (chunks.length === 0) return { grade: "weak", note: "no candidates" };
  const top = chunks[0].score;
  if (top >= settings.rerankConfidentScore) {
    return { grade: "good", note: `confident on rerank score ${top.toFixed(2)}` };
  }
  if (top < settings.rerankWeakScore) {
    return { grade: "weak", note: `weak rerank score ${top.toFixed(2)}` };
  }
  if (!profile.grade) {
    return { grade: "good", note: `score ${top.toFixed(2)}, grading off for this profile` };
  }
  const grade = await gradeChunks(question, chunks);
  return { grade, note: `graded ${grade} on borderline score ${top.toFixed(2)}` };
}

// ------------------------------- the retrieval loop --------------------------- //

/** Retrieve with the confidence gate and, if needed, one rewrite and retry. */
export async function agenticRetrieve(
  namespaces: string[],
  question: string,
  profileName = "lookup"
): Promise<AgenticRetrieval> {
  const profile = getProfile(profileName);
  if (namespaces.length === 0) {
    return {
      chunks: [],
      query: question,
      attempts: 0,
      grade: "weak",
      profile: profile.name,
      trace: [],
    };
  }

  let query = question;
  let best: RetrievedChunk[] = [];
  const trace: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { chunks, trace: passTrace } = await hybridSearch(namespaces, query, profile);
    trace.push(...passTrace);
    if (chunks.length && (best.length === 0 || chunks[0].score > best[0].score)) best = chunks;

    const { grade, note } = await assess(question, chunks, profile);
    trace.push(note);

    if (grade === "good" || attempt === MAX_ATTEMPTS || !profile.rewrite) {
      return {
        chunks: chunks.length ? chunks : best,
        query,
        attempts: attempt,
        grade,
        profile: profile.name,
        trace,
      };
    }

    query = await rewriteQuery(question, query);
    trace.push(`retrying as "${query}"`);
  }

  return {
    chunks: best,
    query,
    attempts: MAX_ATTEMPTS,
    grade: "weak",
    profile: profile.name,
    trace,
  };
}

/**
 * One pass, no grading or retry. For callers that need an answer now.
 *
 * `keep` defaults to undefined rather than a number on purpose: any concrete
 * default here silently overrides whatever the named profile asked for, which is
 * how the related profile ends up returning five chunks when it wanted three.
 */
export async function retrieveAndRerank(
  namespaces: string[],
  query: string,
  keep?: number,
  profileName = "lookup"
): Promise<RetrievedChunk[]> {
  const base = getProfile(profileName);
  const profile = keep !== undefined && keep !== base.keep ? { ...base, keep } : base;
  const { chunks } = await hybridSearch(namespaces, query, profile);
  return chunks;
}
