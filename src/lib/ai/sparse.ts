/**
 * Sparse (lexical) embeddings, via Pinecone's inference API.
 *
 * Dense retrieval fails in a specific, predictable way: rare tokens. "RX-4471",
 * "BMPC 2026", "kWh/kWp", a person's surname, a ticket id — none of these have a
 * meaningful position in embedding space, so a bi-encoder happily returns three
 * paragraphs about rectifiers in general and misses the one naming the unit. A
 * lexical index catches exactly those, and misses the paraphrases dense catches.
 * Running both and fusing is why hybrid beats either alone on a corpus of work
 * documents full of names, codes and acronyms.
 *
 * `pinecone-sparse-english-v0` is a learned sparse model rather than plain BM25,
 * so it also expands terms (a query for "faults" matches "alarm") without
 * needing a corpus-wide IDF table fitted and persisted somewhere. It is served
 * by the same API as the index, which keeps it to one extra call and no extra
 * dependency.
 *
 * Document and query vectors are asymmetric — `input_type` decides which — the
 * same split the dense embedder makes.
 *
 * Hybrid records need a `dotproduct` index, which is a property of the index and
 * cannot be changed in place. `HYBRID_SEARCH_ENABLED` is therefore off by
 * default: on the existing cosine index the lexical leg is skipped entirely and
 * everything runs dense-only, exactly as before. Create a dotproduct index and
 * turn the flag on to get the lexical half.
 */
import { Pinecone } from "@pinecone-database/pinecone";
import { settings } from "./config";

export interface SparseVector {
  indices: number[];
  values: number[];
}

/** The inference API caps a batch; a large ingest still needs splitting. */
const BATCH = 96;

let client: Pinecone | null = null;

function pc(): Pinecone {
  if (!client) {
    if (!process.env.PINECONE_API_KEY) throw new Error("PINECONE_API_KEY is not set.");
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return client;
}

export function hybridEnabled(): boolean {
  return settings.hybridSearchEnabled;
}

async function embed(texts: string[], inputType: "passage" | "query"): Promise<SparseVector[]> {
  const out: SparseVector[] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const response = (await pc().inference.embed(settings.pineconeSparseModel, batch, {
      inputType,
      truncate: "END",
    })) as unknown as {
      data: { sparseIndices?: number[]; sparseValues?: number[] }[];
    };
    out.push(
      ...response.data.map((item) => ({
        indices: item.sparseIndices ?? [],
        values: item.sparseValues ?? [],
      }))
    );
  }
  return out;
}

export async function embedSparseDocuments(texts: string[]): Promise<SparseVector[]> {
  if (!hybridEnabled() || texts.length === 0) return [];
  try {
    return await embed(texts, "passage");
  } catch {
    // A sparse-side outage degrades this document to dense-only rather than
    // failing the whole upload.
    return [];
  }
}

/**
 * The sparse vector for a query, or null when the lexical side has nothing to
 * say. A query of pure stopwords produces an empty vector, and sending an empty
 * sparse vector to Pinecone is an error rather than an empty result, so the
 * caller skips the lexical leg entirely.
 */
export async function embedSparseQuery(text: string): Promise<SparseVector | null> {
  if (!hybridEnabled()) return null;
  try {
    const [vector] = await embed([text], "query");
    return vector && vector.indices.length > 0 ? vector : null;
  } catch {
    // The dense leg alone still answers.
    return null;
  }
}
