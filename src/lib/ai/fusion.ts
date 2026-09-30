/**
 * Rank fusion and diversity selection.
 *
 * Three pure functions, no I/O, all operating on lists the retriever already
 * has.
 *
 * Reciprocal rank fusion merges the dense and lexical result lists. It works on
 * positions rather than scores, which matters here because the two scales are
 * not comparable at all: a cosine similarity lives in [0, 1] while a learned
 * sparse dot product is unbounded and routinely reads in the tens. Weighting raw
 * scores would let the lexical leg swamp the dense one; RRF only asks "how high
 * did each list rank this document", so a passage ranked first by either leg is
 * guaranteed to survive into the candidate set. That is the whole point of
 * adding lexical search.
 *
 * Maximal marginal relevance then picks the final set. A reranker sorted purely
 * by relevance will happily return five near-identical chunks from the same
 * section, which reads as five sources and is really one. MMR trades a little
 * relevance for coverage, so a summary sees the whole document rather than the
 * same paragraph five times. The lambda knob decides how much: high for a fact
 * lookup, low for a summary.
 *
 * The per-document cap expresses a kind of diversity MMR cannot: a lookup
 * answered five times over from one file has one source, and the user reading
 * the citations deserves to know that rather than seeing one filename five
 * times.
 */
import type { RetrievedChunk } from "@/lib/types";

/** The RRF constant. 60 is the value from the original paper and it is not
 *  sensitive: it damps the difference between rank 1 and rank 2 so a single list
 *  cannot dominate the fusion outright. */
const RRF_K = 60;

/** Fuse ranked lists into one, best first. Score becomes the fused RRF score. */
export function reciprocalRankFusion(
  lists: RetrievedChunk[][],
  weights?: number[]
): RetrievedChunk[] {
  const present = lists.filter((list) => list.length > 0);
  if (present.length === 0) return [];
  if (present.length === 1) return [...present[0]];

  const w = weights ?? present.map(() => 1);
  const fused = new Map<string, number>();
  const best = new Map<string, RetrievedChunk>();

  present.forEach((chunks, listIndex) => {
    chunks.forEach((chunk, rank) => {
      fused.set(chunk.id, (fused.get(chunk.id) ?? 0) + (w[listIndex] ?? 1) / (RRF_K + rank + 1));
      // Keep the copy carrying the better original score, so a debug view still
      // shows something meaningful per chunk.
      const existing = best.get(chunk.id);
      if (!existing || chunk.score > existing.score) best.set(chunk.id, chunk);
    });
  });

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...best.get(id)!, score }));
}

function normalise(vector: number[]): number[] {
  const norm = Math.hypot(...vector) || 1;
  return vector.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Greedy MMR. Returns the indices to keep, in selection order.
 *
 * At each step it picks the candidate maximising
 *
 *     lambda * similarity(query, candidate)
 *     - (1 - lambda) * max similarity(candidate, already selected)
 *
 * so a chunk that repeats what is already selected is penalised no matter how
 * relevant it is on its own.
 */
export function maximalMarginalRelevance(
  queryVector: number[],
  candidateVectors: number[][],
  k: number,
  lambda = 0.7
): number[] {
  if (candidateVectors.length === 0 || k <= 0) return [];
  const limit = Math.min(k, candidateVectors.length);

  const candidates = candidateVectors.map(normalise);
  const query = normalise(queryVector);
  const toQuery = candidates.map((c) => dot(c, query));

  const selected: number[] = [toQuery.indexOf(Math.max(...toQuery))];
  const remaining = candidates.map((_, i) => i).filter((i) => i !== selected[0]);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (const i of remaining) {
      const redundancy = Math.max(...selected.map((j) => dot(candidates[i], candidates[j])));
      const score = lambda * toQuery[i] - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    selected.push(bestIndex);
    remaining.splice(remaining.indexOf(bestIndex), 1);
  }

  return selected;
}

/** Keep at most `limit` chunks from any one source, preserving order. */
export function capPerDocument(chunks: RetrievedChunk[], limit: number): RetrievedChunk[] {
  if (limit <= 0) return chunks;
  const counts = new Map<string, number>();
  const kept: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.docId || chunk.source;
    const used = counts.get(key) ?? 0;
    if (used >= limit) continue;
    counts.set(key, used + 1);
    kept.push(chunk);
  }
  return kept;
}

/**
 * Token-overlap similarity vectors, as a stand-in when dense vectors are
 * unavailable.
 *
 * Not as good as embedding cosine at spotting paraphrase, but the failure MMR
 * exists to prevent — five near-identical chunks from one section — is a
 * near-duplicate problem, and near-duplicates overlap lexically. Better a
 * degraded diversity pass than none.
 */
export function lexicalVectors(texts: string[]): number[][] {
  const vocab = new Map<string, number>();
  const rows = texts.map((text) => {
    const tokens = new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2)
    );
    const ids = new Set<number>();
    for (const token of tokens) {
      if (!vocab.has(token)) vocab.set(token, vocab.size);
      ids.add(vocab.get(token)!);
    }
    return ids;
  });

  const width = Math.max(1, vocab.size);
  return rows.map((ids) => {
    const vector = new Array<number>(width).fill(0);
    for (const id of ids) vector[id] = 1;
    return vector;
  });
}
