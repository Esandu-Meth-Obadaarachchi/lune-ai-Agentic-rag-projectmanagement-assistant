/**
 * The intermediate representation every parser produces.
 *
 * The old pipeline flattened a document to one string and threw the layout away,
 * so a heading, a table row and a paragraph all looked identical to the chunker.
 * That is the single biggest quality loss in a RAG system: without structure you
 * cannot keep a table intact, you cannot tell a chunk which section it came
 * from, and you cannot cite a page.
 *
 * Every parser now returns an ordered list of `DocElement` instead. Each element
 * knows what it is, where it came from and how deep it sits in the document's
 * heading tree. The chunker reads that structure rather than guessing at it from
 * newline patterns, and the retrieved chunk carries it back to the UI as a
 * citation.
 */

/**
 * What an element *is*. The chunker treats these differently:
 *   heading  -> opens a section, never chunked on its own
 *   table    -> atomic, never split mid-table
 *   code     -> atomic where possible, split on blank lines
 *   figure   -> a vision caption standing in for an image
 *   caption  -> the document's own caption text near a figure or table
 */
export type ElementKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "code"
  | "figure"
  | "caption";

/** One logically distinct piece of a document, in reading order. */
export interface DocElement {
  kind: ElementKind;
  text: string;
  /** Heading depth 1..6; 0 for everything else. */
  level: number;
  /** 1-indexed source page / slide / sheet, when the format has one. */
  page?: number;
}

/** A parsed file: its elements plus what the parser had to do to read it. */
export interface ParsedDocument {
  elements: DocElement[];
  /** pdf | docx | xlsx | pptx | markdown | code | text | image | note */
  docType: string;
  pageCount: number;
  /** Provenance for the ingest UI: how many pages needed OCR, how many figures
   *  were captioned, how many tables were recovered. */
  stats: Record<string, number>;
}

export function emptyDocument(docType: string): ParsedDocument {
  return { elements: [], docType, pageCount: 0, stats: {} };
}

export function bump(doc: ParsedDocument, key: string, by = 1): void {
  doc.stats[key] = (doc.stats[key] ?? 0) + by;
}

/** Flattened plain text. Only for callers that genuinely want a blob — the
 *  contextualiser needs the whole document, and the empty-upload check reads it. */
export function documentText(doc: ParsedDocument): string {
  return doc.elements
    .map((e) => e.text)
    .filter((t) => t.trim())
    .join("\n\n");
}

// ------------------------------- constructors ------------------------------- //

export function heading(text: string, level: number, page?: number): DocElement {
  return { kind: "heading", text: text.trim(), level: Math.max(1, Math.min(level, 6)), page };
}

export function para(text: string, page?: number): DocElement {
  return { kind: "paragraph", text: text.trim(), level: 0, page };
}

export function listItem(text: string, page?: number): DocElement {
  return { kind: "list", text: text.trim(), level: 0, page };
}

export function table(markdown: string, page?: number): DocElement {
  return { kind: "table", text: markdown.trim(), level: 0, page };
}

export function code(text: string, page?: number): DocElement {
  return { kind: "code", text: text.replace(/\s+$/, ""), level: 0, page };
}

export function figure(caption: string, page?: number): DocElement {
  return { kind: "figure", text: caption.trim(), level: 0, page };
}

/** Render a grid of cells as a GitHub-flavoured Markdown table.
 *
 *  Shared by every parser that recovers tabular data, so a spreadsheet, a Word
 *  table and a PDF table all reach the chunker in one shape — which is what lets
 *  the chunker split any of them by rows with the header repeated. */
export function gridToMarkdown(rows: string[][]): string {
  const clean = rows
    .map((row) => row.map((cell) => (cell ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (clean.length === 0) return "";

  const width = Math.max(...clean.map((row) => row.length));
  const padded = clean.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const [header, ...body] = padded;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}
