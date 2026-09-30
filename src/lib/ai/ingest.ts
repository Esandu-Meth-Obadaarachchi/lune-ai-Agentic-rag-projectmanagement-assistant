/**
 * Ingestion: parse -> chunk -> contextualise -> embed -> upsert.
 *
 * The write path. It is offline and asynchronous relative to a query, which is
 * what makes the expensive steps affordable: OCR, figure captioning and
 * per-chunk contextualisation all happen here, where nobody is waiting, and the
 * query path inherits the quality for free.
 *
 * Two properties this pipeline guarantees that the old one did not:
 *
 * Idempotency  Vector ids are derived from the project, the filename and the
 *              chunk index, so re-uploading a file replaces its chunks instead
 *              of adding a second copy of every one. The old pipeline used a
 *              random UUID per chunk, which meant every re-upload silently
 *              doubled the document in the index — and a doubled document wins
 *              every search against itself. The previous version's vectors are
 *              deleted by id prefix before the new ones land, so a document that
 *              shrinks does not leave its old tail behind answering questions
 *              from a deleted section.
 *
 * Provenance   Every vector carries its section path, page number, element kind
 *              and content hash, so a retrieved chunk can say where it came from
 *              and the UI can cite the page.
 */
import { createHash } from "crypto";
import { settings } from "./config";
import { chunkDocument, contentHash, embedText, sectionOf } from "./chunker";
import { contextualize } from "./contextualize";
import { documentText, type ParsedDocument } from "./documents";
import { embedDocuments } from "./voyage";
import { embedSparseDocuments } from "./sparse";
import {
  deleteByPrefix,
  deleteTail,
  upsertChunks,
  type UpsertRecord,
  type VectorMeta,
} from "./pinecone";

/** Pinecone caps record metadata at 40KB. Chunk text is the only unbounded
 *  field, and a chunk this long is a parser failure rather than a real passage. */
const MAX_METADATA_TEXT = 12_000;

export interface IngestResult {
  chunksStored: number;
  docId: string;
  contextualised: number;
  stats: Record<string, number>;
}

/** Stable per (project, file). Re-uploading the same name replaces the old one. */
export function documentId(projectName: string, filename: string): string {
  return createHash("sha256").update(`${projectName}::${filename}`).digest("hex").slice(0, 24);
}

export async function ingestDocument(options: {
  namespace: string;
  projectName: string;
  filename: string;
  parsed: ParsedDocument;
}): Promise<IngestResult> {
  const { namespace, projectName, filename, parsed } = options;
  const docId = documentId(projectName, filename);
  const chunks = chunkDocument(parsed, filename);

  if (chunks.length === 0) {
    return { chunksStored: 0, docId, contextualised: 0, stats: parsed.stats };
  }

  const contextualised = await contextualize(chunks, documentText(parsed));

  // The vectors are built from the embed text (breadcrumb + context + content);
  // the metadata carries the raw text, which is what the model and the UI read.
  // Dense and lexical embeddings are independent services, so they overlap.
  const texts = chunks.map(embedText);
  const [dense, sparse] = await Promise.all([
    embedDocuments(texts),
    embedSparseDocuments(texts),
  ]);
  const uploadedAt = new Date().toISOString();

  const vectors: UpsertRecord[] = chunks.map((chunk, i) => {
    const sparseVector = sparse[i];
    return {
      id: `${docId}#${chunk.index}`,
      values: dense[i],
      ...(sparseVector && sparseVector.indices.length > 0
        ? { sparseValues: sparseVector }
        : {}),
      metadata: {
        text: chunk.text.slice(0, MAX_METADATA_TEXT),
        source: filename,
        project: projectName,
        docId,
        type: parsed.docType,
        element: chunk.kind,
        section: sectionOf(chunk),
        page: chunk.page ?? 0,
        chunkIndex: chunk.index,
        tokens: chunk.tokens,
        hash: contentHash(chunk),
        uploadedAt,
      } satisfies VectorMeta,
    };
  });

  // Clear the previous version first.
  try {
    await deleteByPrefix(namespace, `${docId}#`);
  } catch {
    /* a first upload has nothing to delete */
  }

  await upsertChunks(namespace, vectors);

  // Belt and braces for the shrinking case. The prefix delete above misses
  // vectors the list API has not caught up with yet, which is exactly the
  // situation when a document is re-uploaded soon after the last time. This
  // removes the old tail by id, which is immediately consistent.
  await deleteTail(namespace, docId, vectors.length);

  return {
    chunksStored: vectors.length,
    docId,
    contextualised,
    stats: parsed.stats,
  };
}

/** Remove a document from a project's index entirely. */
export async function removeDocument(
  namespace: string,
  projectName: string,
  filename: string
): Promise<number> {
  return deleteByPrefix(namespace, `${documentId(projectName, filename)}#`);
}

export { settings as ingestSettings };
