/**
 * Document parsing: pick a parser, return structure.
 *
 * The entry point for the write path. It routes on extension first and MIME
 * second — browsers lie about MIME far more often than users rename files — and
 * returns a `ParsedDocument`, an ordered list of typed elements, rather than one
 * flat string.
 *
 * Format support, and what each parser recovers:
 *
 *   pdf                 layout, headings, tables, page numbers, OCR for scans
 *   docx                heading styles, tables, lists, in document order
 *   xlsx                one section per sheet, each sheet a Markdown table
 *   pptx                one section per slide, tables, speaker notes
 *   md                  native structure: headings, fenced code, pipe tables
 *   csv / json          rendered as tables where the shape allows
 *   source code         split on top-level definitions, one element per symbol
 *   png/jpg/webp/gif    transcribed and described by Claude vision
 *   txt and anything    paragraph splitting with heuristic headings
 *   else
 *
 * Every parser is defensive: a malformed file degrades to plain text rather than
 * failing the upload. Someone who has just waited for a 30MB file to upload
 * should get a partial index, not an error.
 */
import { settings } from "./config";
import {
  type ParsedDocument,
  bump,
  emptyDocument,
  figure,
  para,
} from "./documents";
import { parseCode, parseCsv, parseJson, parseNote } from "./parsers/code";
import { parseMarkdown, parseMarkdownElements, parsePlainText } from "./parsers/markdown";
import { parseDocx, parseLegacyDoc, parsePptx, parseXlsx } from "./parsers/office";
import { parsePdf } from "./parsers/pdf";
import { captionImage, transcribeImage } from "./vision";

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "java", "sql", "yaml", "yml", "sh",
  "go", "rs", "rb", "php", "c", "cpp", "h", "hpp", "cs", "kt", "swift", "dart",
  "toml", "ini", "css", "scss", "html", "xml",
]);

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Refuse anything past this before a parser touches it: a 200MB upload is
 *  either a mistake or an attack, and either way it should not reach the vision
 *  budget. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

/** Thrown for a file that is refused outright. The route turns it into a 413. */
export class UploadTooLarge extends Error {
  constructor() {
    super(`File is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.`);
    this.name = "UploadTooLarge";
  }
}

export async function parseFile(
  filename: string,
  mime: string | undefined,
  data: Buffer
): Promise<ParsedDocument> {
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new UploadTooLarge();

  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const type = (mime ?? "").toLowerCase();

  try {
    if (ext === "pdf" || type === "application/pdf") return await parsePdf(data);
    if (ext === "docx" || type.includes("wordprocessingml")) return await parseDocx(data);
    if (ext === "doc" || type === "application/msword") return parseLegacyDoc(data);
    if (ext === "xlsx" || ext === "xlsm" || type.includes("spreadsheetml")) {
      return await parseXlsx(data);
    }
    if (ext === "pptx" || type.includes("presentationml")) return await parsePptx(data);
    if (ext in IMAGE_TYPES || type.startsWith("image/")) {
      return await parseImage(data, IMAGE_TYPES[ext] ?? "image/png");
    }
    if (ext === "md" || ext === "markdown" || type === "text/markdown") {
      return parseMarkdown(decode(data));
    }
    if (ext === "csv" || ext === "tsv" || type === "text/csv") return parseCsv(decode(data));
    if (ext === "json" || type === "application/json") return parseJson(decode(data));
    if (CODE_EXTS.has(ext)) return parseCode(decode(data), ext);
  } catch {
    // A broken file degrades; it does not fail the upload. Text is always
    // salvageable from something, and a partial index beats a rejection.
    const fallback = parsePlainText(decode(data));
    bump(fallback, "parserFallback");
    return fallback;
  }

  return parsePlainText(decode(data));
}

/** A standalone image: transcribe any text, then describe what it shows. */
async function parseImage(
  data: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
): Promise<ParsedDocument> {
  const doc = emptyDocument("image");
  doc.pageCount = 1;
  if (!settings.visionEnabled) return doc;

  // Both calls are independent, so they overlap rather than queue.
  const [transcript, caption] = await Promise.all([
    transcribeImage(data, mediaType),
    captionImage(data, mediaType),
  ]);

  if (transcript.trim()) {
    doc.elements.push(...parseMarkdownElements(transcript, 1));
    bump(doc, "ocrPages");
  }
  if (caption) {
    doc.elements.push(figure(caption, 1));
    bump(doc, "figuresCaptioned");
  }
  return doc;
}

/** A note pasted into the UI. Markdown is common enough here to assume it. */
export function parsePasted(text: string): ParsedDocument {
  const parsed = parseMarkdown(text);
  if (parsed.elements.length === 0 && text.trim()) return parseNote(text);
  parsed.docType = "note";
  return parsed;
}

function decode(data: Buffer): string {
  return data.toString("utf-8");
}

export { documentText } from "./documents";
export type { ParsedDocument } from "./documents";
export { para };
