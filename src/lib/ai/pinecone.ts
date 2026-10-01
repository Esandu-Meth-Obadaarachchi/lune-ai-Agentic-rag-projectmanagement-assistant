/**
 * Pinecone vector store: hybrid records, parallel namespace fan-out.
 *
 * Each project owns a namespace (`project.ragNamespace`), so every project's
 * knowledge stays isolated inside one index. The read path merges hits across
 * several project namespaces in one search — the isolation model the app depends
 * on — which is why it talks to the client directly rather than through a
 * single-namespace vector-store wrapper.
 *
 * Three things changed from the dense-only store:
 *
 * Hybrid records  A record may carry a sparse vector alongside the dense one. A
 *                 dense-only query leaves it unset; a lexical-only query sends a
 *                 zero dense vector, which contributes nothing to the score and
 *                 leaves the ranking to the sparse side. This needs a dotproduct
 *                 index, so it is behind `HYBRID_SEARCH_ENABLED` and off by
 *                 default — on the existing cosine index everything runs
 *                 dense-only and nothing has to be reindexed.
 *
 * Deletion by prefix  Serverless indexes cannot delete by metadata filter, only
 *                 by id, which is why ids are built as `{docId}#{chunkIndex}` —
 *                 the document id becomes a prefix the list API can page
 *                 through. This is what makes a re-upload replace a document
 *                 rather than duplicate it. The old store used a random UUID per
 *                 chunk, so re-uploading a file silently doubled it.
 *
 * Values fetched late  Asking for vector values on the initial query is
 *                 expensive: the payload, not the round trip, is the cost, and a
 *                 wide candidate set means returning hundreds of 1024-float
 *                 arrays. MMR only needs vectors for the reranked pool, which is
 *                 far smaller, so they are fetched afterwards and cached.
 *
 * One behaviour worth stating: Pinecone does not guarantee matches in descending
 * score order, so every result list is sorted here before anything downstream
 * trusts the order.
 */
import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";
import { settings } from "./config";
import { getChunkVectors, putChunkVectors } from "@/lib/cache/vectors";
import type { SparseVector } from "./sparse";
import type { RetrievedChunk } from "@/lib/types";

let client: Pinecone | null = null;

function pc(): Pinecone {
  if (!client) {
    if (!process.env.PINECONE_API_KEY) throw new Error("PINECONE_API_KEY is not set.");
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return client;
}

function index() {
  return pc().index(settings.pineconeIndexName);
}

const UPSERT_BATCH = 100;
const DELETE_BATCH = 1000;

/** Everything written alongside a chunk, read back for citations. */
export interface VectorMeta extends RecordMetadata {
  text: string;
  source: string;
  project: string;
  type: string;
  uploadedAt: string;
  docId: string;
  element: string;
  section: string;
  page: number;
  chunkIndex: number;
  tokens: number;
  hash: string;
}

export interface UpsertRecord {
  id: string;
  values: number[];
  sparseValues?: SparseVector;
  metadata: VectorMeta;
}

export async function upsertChunks(namespace: string, vectors: UpsertRecord[]): Promise<void> {
  const ns = index().namespace(namespace);
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await ns.upsert(vectors.slice(i, i + UPSERT_BATCH));
  }
}

/**
 * Delete every vector whose id starts with `prefix`. Returns the count.
 *
 * Without this, shrinking a document leaves its old tail chunks in the index
 * answering questions from a section that no longer exists.
 *
 * One measured caveat: the list API lags the write path. Vectors upserted
 * seconds earlier do not appear in a listing yet, so a delete issued immediately
 * after an upsert can report zero and remove nothing. That is why `ingest.ts`
 * does not rely on this alone to clear a shrunken document — see `deleteTail`.
 */
export async function deleteByPrefix(namespace: string, prefix: string): Promise<number> {
  const ns = index().namespace(namespace);
  const ids: string[] = [];
  let paginationToken: string | undefined;
  do {
    const page = await ns.listPaginated({ prefix, paginationToken });
    ids.push(...(page.vectors ?? []).map((v) => v.id).filter((id): id is string => !!id));
    paginationToken = page.pagination?.next;
  } while (paginationToken);

  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    await ns.deleteMany(ids.slice(i, i + DELETE_BATCH));
  }
  return ids.length;
}

/**
 * One search's results, plus everything MMR needs, scoped to the request.
 *
 * The dense vectors live here rather than in a module-level cache: a process
 * global would grow without bound and leak one request's candidates into
 * another's. They are also kept off `RetrievedChunk` so a 1024-float array never
 * crosses the API boundary into the browser.
 */
export interface Hits {
  chunks: RetrievedChunk[];
  vectors: Map<string, number[]>;
  namespaceOf: Map<string, string>;
}

function emptyHits(): Hits {
  return { chunks: [], vectors: new Map(), namespaceOf: new Map() };
}

/** Combine two fan-out results into one list. Used across namespaces. */
function extend(into: Hits, other: Hits): void {
  into.chunks.push(...other.chunks);
  other.vectors.forEach((v, k) => into.vectors.set(k, v));
  other.namespaceOf.forEach((v, k) => into.namespaceOf.set(k, v));
}

/**
 * Take another leg's vectors and namespace map without touching `chunks`.
 *
 * The two legs stay separate lists all the way into rank fusion — fusing a list
 * with itself appended would double-count every dense hit — but MMR still needs
 * the vectors and the namespace map from both.
 */
export function adopt(into: Hits, other: Hits): void {
  other.vectors.forEach((v, k) => into.vectors.set(k, v));
  other.namespaceOf.forEach((v, k) => into.namespaceOf.set(k, v));
}

function toChunks(matches: unknown[]): RetrievedChunk[] {
  const chunks = (matches as {
    id: string;
    score?: number;
    metadata?: Partial<VectorMeta>;
  }[]).map((match) => {
    const meta = match.metadata ?? {};
    return {
      id: match.id,
      score: match.score ?? 0,
      text: String(meta.text ?? ""),
      source: String(meta.source ?? "unknown"),
      project: meta.project ? String(meta.project) : undefined,
      section: String(meta.section ?? ""),
      page: Number(meta.page ?? 0) || 0,
      element: String(meta.element ?? ""),
      docId: meta.docId ? String(meta.docId) : undefined,
    } satisfies RetrievedChunk;
  });
  // Sorted here, not trusted from the API. See the module comment.
  return chunks.sort((a, b) => b.score - a.score);
}

let zeroVector: number[] | null = null;
/** The dense half of a lexical-only query. Cached: it never changes, and
 *  rebuilding a 1024-float array per query is pure waste. */
function zeros(): number[] {
  if (!zeroVector) zeroVector = new Array<number>(settings.embedDim).fill(0);
  return zeroVector;
}

/** One namespace, one leg of the search. Dense, lexical, or both together. */
export async function queryNamespace(
  namespace: string,
  options: {
    vector?: number[];
    sparseVector?: SparseVector | null;
    topK?: number;
    includeValues?: boolean;
  }
): Promise<Hits> {
  const { vector, sparseVector, topK = 10, includeValues = false } = options;
  if (!vector && !sparseVector) return emptyHits();

  const request: {
    topK: number;
    includeMetadata: boolean;
    includeValues: boolean;
    vector: number[];
    sparseVector?: SparseVector;
  } = {
    topK,
    includeMetadata: true,
    includeValues,
    // A dotproduct index always wants a dense vector. Zeros contribute nothing
    // to the score, so this is a lexical-only query in practice.
    vector: vector ?? zeros(),
  };
  if (sparseVector) request.sparseVector = sparseVector;

  const result = await index().namespace(namespace).query(request);
  const matches = result.matches ?? [];
  const hits: Hits = {
    chunks: toChunks(matches),
    vectors: new Map(),
    namespaceOf: new Map(matches.map((m) => [m.id, namespace])),
  };
  if (includeValues) {
    for (const match of matches) {
      if (match.values?.length) hits.vectors.set(match.id, match.values);
    }
  }
  return hits;
}

/**
 * Query several project namespaces at once and merge by score.
 *
 * Namespaces are independent round trips, so a user with five projects should
 * not wait five times as long as a user with one.
 */
export async function queryNamespaces(
  namespaces: string[],
  options: {
    vector?: number[];
    sparseVector?: SparseVector | null;
    topK?: number;
    includeValues?: boolean;
  }
): Promise<Hits> {
  const unique = [...new Set(namespaces)].filter(Boolean);
  if (unique.length === 0) return emptyHits();

  const topK = options.topK ?? 20;
  const perNamespace = Math.max(3, Math.ceil(topK / unique.length) + 2);

  const results = await Promise.all(
    unique.map((namespace) =>
      queryNamespace(namespace, { ...options, topK: perNamespace }).catch(() => emptyHits())
    )
  );

  const merged = emptyHits();
  for (const result of results) extend(merged, result);
  merged.chunks.sort((a, b) => b.score - a.score);
  merged.chunks = merged.chunks.slice(0, topK);
  return merged;
}

/**
 * Dense vectors for the reranked pool, cache first.
 *
 * A chunk's vector never changes once written, so this is the most cacheable
 * call in the system and the slowest one left in retrieval. A warm pool skips
 * Pinecone entirely. MMR degrades to a lexical fallback if this fails, so it is
 * never allowed to throw.
 */
export async function fetchValues(
  ids: string[],
  namespaceOf: Map<string, string>
): Promise<Map<string, number[]>> {
  const { found, missing } = await getChunkVectors(ids);
  if (missing.length === 0) return found;

  const byNamespace = new Map<string, string[]>();
  for (const id of missing) {
    const namespace = namespaceOf.get(id);
    if (!namespace) continue;
    byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), id]);
  }

  const fresh = new Map<string, number[]>();
  await Promise.all(
    [...byNamespace.entries()].map(async ([namespace, batch]) => {
      try {
        const fetched = await index().namespace(namespace).fetch(batch);
        for (const [id, record] of Object.entries(fetched.records ?? {})) {
          const values = record.values ?? [];
          if (values.length) {
            found.set(id, values);
            fresh.set(id, values);
          }
        }
      } catch {
        /* a missing namespace is not an error; MMR falls back */
      }
    })
  );

  void putChunkVectors(fresh);
  return found;
}

/**
 * Delete the chunk ids a document no longer has, by id rather than by listing.
 *
 * The complement to `deleteByPrefix`, and the reason a re-upload is reliably
 * idempotent rather than mostly idempotent.
 *
 * Chunk ids are `{docId}#{index}` with index counting from zero, so a document
 * that shrinks from forty chunks to twelve leaves exactly `#12` upward behind.
 * Deleting those by name needs no listing, which matters because the list API
 * lags the write path: a document re-uploaded moments after the last one would
 * have its stale tail missed entirely by a prefix delete. Deleting by id is
 * immediately consistent, and asking Pinecone to remove ids that do not exist is
 * free and not an error.
 *
 * The lookahead is bounded because the alternative is unbounded: a document that
 * once had 10,000 chunks would otherwise cost 10,000 ids to clean up. Anything
 * past the window is caught by the prefix delete on the next upload.
 */
const TAIL_LOOKAHEAD = 250;

export async function deleteTail(
  namespace: string,
  docId: string,
  liveChunkCount: number
): Promise<void> {
  const ids = Array.from(
    { length: TAIL_LOOKAHEAD },
    (_, i) => `${docId}#${liveChunkCount + i}`
  );
  try {
    await index().namespace(namespace).deleteMany(ids);
  } catch {
    /* nothing to remove, or a namespace that does not exist yet */
  }
}
