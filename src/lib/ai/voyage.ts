/**
 * Voyage AI embeddings + cross-encoder reranking.
 *
 * Claude has no embedding model, so retrieval runs on Voyage: voyage-3.5
 * (1024-dim) for the first-stage search and rerank-2.5 for precise ranking.
 * Generation runs on Claude.
 *
 * Two things this layer adds beyond the HTTP calls.
 *
 * Query embeddings go through the cache. They are deterministic and small, and
 * the same question comes back often enough that caching removes a whole network
 * call from the repeat path. It also hands the semantic answer cache the vector
 * it needs for free.
 *
 * Both calls retry on the errors that are worth retrying. A 429 or a 5xx from an
 * embedding provider is routine under load and transient by definition; failing
 * the user's whole question over one is the wrong trade when the retry costs
 * a few hundred milliseconds.
 */
import { settings } from "./config";
import { getQueryEmbedding, putQueryEmbedding } from "@/lib/cache/vectors";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";

export const EMBED_MODEL = settings.voyageEmbedModel;
export const EMBED_DIM = settings.embedDim;
export const RERANK_MODEL = settings.voyageRerankModel;

type InputType = "document" | "query";

function apiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set.");
  return key;
}

/**
 * POST with a bounded retry on transient failures.
 *
 * The backoff is deliberately generous on a 429. Voyage's free tier allows three
 * requests a minute, and one agent turn can make four calls (a query embedding
 * and a rerank, twice if retrieval takes the recovery path), so a rate limit
 * here is routine rather than exceptional — and a backoff measured in
 * milliseconds simply burns the retries before the window reopens. The server's
 * own `Retry-After` is honoured when it sends one, since it knows the window
 * better than any constant can.
 */
const RETRY_ATTEMPTS = 4;
const MAX_BACKOFF_MS = 20_000;

async function post(url: string, body: unknown, label: string): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return res.json();

    lastError = await res.text().catch(() => "");
    // A 4xx other than rate limiting is a request the retry would repeat
    // verbatim, so it fails now rather than three times more slowly.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`${label} failed (${res.status}): ${lastError}`);
    }
    if (attempt === RETRY_ATTEMPTS - 1) break;

    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
      : Math.min(res.status === 429 ? 2000 * 2 ** attempt : 400 * 2 ** attempt, MAX_BACKOFF_MS);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  throw new Error(`${label} failed after retries: ${lastError}`);
}

async function embed(input: string[], inputType: InputType): Promise<number[][]> {
  const json = (await post(
    VOYAGE_URL,
    { input, model: EMBED_MODEL, input_type: inputType, output_dimension: EMBED_DIM },
    "Voyage embedding"
  )) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed a batch of chunks for ingestion. Batched to respect the API's limits. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const BATCH = 96;
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH));
  // Batches are independent requests, so they overlap rather than queue — a
  // 500-chunk document is six round trips in the time of about two.
  const results = await Promise.all(batches.map((batch) => embed(batch, "document")));
  return results.flat();
}

/** Embed a single search query, through the cache. */
export async function embedQuery(text: string): Promise<number[]> {
  const cached = await getQueryEmbedding(EMBED_MODEL, text);
  if (cached) return cached;
  const [vector] = await embed([text], "query");
  // Not awaited: the caller is on the critical path and a cache write that has
  // not landed yet only costs the next request a miss.
  void putQueryEmbedding(EMBED_MODEL, text, vector);
  return vector;
}

export interface RerankHit {
  /** Index into the documents array passed in. */
  index: number;
  /** Relevance score in [0, 1]; higher is more relevant. */
  score: number;
}

/**
 * Cross-encoder reranking — the single biggest precision lever in the pipeline.
 *
 * The embedding search is a bi-encoder: it compares two vectors that were built
 * independently, so it can tell that a passage is about the same topic but not
 * whether it answers the question. A cross-encoder reads the query and the
 * passage together, which is what lets it separate "mentions rectifiers" from
 * "says what the rectifier interval is".
 */
export async function rerank(
  query: string,
  documents: string[],
  topK?: number
): Promise<RerankHit[]> {
  if (documents.length === 0) return [];
  const json = (await post(
    VOYAGE_RERANK_URL,
    {
      query,
      documents,
      model: RERANK_MODEL,
      top_k: Math.min(topK ?? documents.length, documents.length),
    },
    "Voyage rerank"
  )) as { data: { index: number; relevance_score: number }[] };
  return json.data
    .map((d) => ({ index: d.index, score: d.relevance_score }))
    .sort((a, b) => b.score - a.score);
}
