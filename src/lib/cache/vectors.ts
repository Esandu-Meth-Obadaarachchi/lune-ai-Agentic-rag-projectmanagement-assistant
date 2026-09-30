/**
 * Caching for the two vector lookups that sit on the request path.
 *
 * Query embeddings. The same question asked twice costs a Voyage call twice, and
 * the result is deterministic. Cached, a repeat costs one map read. It also
 * makes the semantic answer cache effectively free on a repeat: the embedding it
 * needs is already in hand.
 *
 * Chunk vectors. MMR needs the dense vector of every chunk in the reranked pool.
 * Those vectors never change once written, so fetching them from Pinecone on
 * every search is pure repetition — and it is the slowest step left in
 * retrieval. A warm pool skips the round trip entirely.
 */
import { createHash } from "crypto";
import { settings } from "@/lib/ai/config";
import { cacheGet, cacheKey, cacheSet, packVector, unpackVector } from "./store";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

// ------------------------------ query embeddings ---------------------------- //

function queryKey(model: string, text: string): string {
  return cacheKey("qemb", model, digest(text));
}

export async function getQueryEmbedding(model: string, text: string): Promise<number[] | null> {
  const packed = await cacheGet(queryKey(model, text));
  return packed ? unpackVector(packed) : null;
}

export async function putQueryEmbedding(
  model: string,
  text: string,
  vector: number[]
): Promise<void> {
  await cacheSet(queryKey(model, text), packVector(vector), settings.embeddingCacheTtlSeconds);
}

// ------------------------------- chunk vectors ------------------------------ //

function chunkKey(vectorId: string): string {
  return cacheKey("cvec", digest(vectorId));
}

/** Split the requested ids into what is cached and what still has to be fetched. */
export async function getChunkVectors(
  ids: string[]
): Promise<{ found: Map<string, number[]>; missing: string[] }> {
  const found = new Map<string, number[]>();
  const missing: string[] = [];
  // One lookup per id, but the local tier answers most of them without I/O and
  // the rest overlap rather than queue.
  const packed = await Promise.all(ids.map((id) => cacheGet(chunkKey(id))));
  ids.forEach((id, i) => {
    const value = packed[i];
    if (value) found.set(id, unpackVector(value));
    else missing.push(id);
  });
  return { found, missing };
}

export async function putChunkVectors(vectors: Map<string, number[]>): Promise<void> {
  await Promise.all(
    [...vectors.entries()]
      .filter(([, vector]) => vector.length > 0)
      .map(([id, vector]) =>
        cacheSet(chunkKey(id), packVector(vector), settings.vectorCacheTtlSeconds)
      )
  );
}
