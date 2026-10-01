/**
 * Source code, CSV and JSON.
 *
 * Code is split on top-level definitions rather than on size. A function cut in
 * half is two chunks that each answer nothing: the half with the signature has
 * no body, and the half with the body has no name, so neither matches a search
 * for what the function does. Splitting on the definition boundary means every
 * chunk is a whole symbol, and the symbol's name becomes its heading, so the
 * breadcrumb reads `api.ts > export function loadUserScope`.
 *
 * CSV and JSON become tables where the shape allows. A CSV rendered as a table
 * keeps its header row attached to every row the chunker emits, which is the
 * difference between a retrievable figure and a column of bare numbers. An array
 * of flat objects is the same data in a different syntax, so it gets the same
 * treatment; anything more nested stays as formatted JSON in a code block.
 */
import {
  type DocElement,
  type ParsedDocument,
  code,
  emptyDocument,
  gridToMarkdown,
  heading,
  para,
  table,
} from "../documents";

/** Lines that open a top-level definition across the languages this app sees. */
const DEFINITION =
  /^(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+|async\s+|abstract\s+|final\s+)*(?:function|class|interface|type|enum|struct|const|let|var|def|func|impl|trait|module|namespace)\b/;
/** A decorator or comment directly above a definition belongs to it. */
const ATTACHES_FORWARD = /^(?:@|#\[|\/\/|\/\*|\*|#\s)/;

export function parseCode(text: string, language: string): ParsedDocument {
  const doc = emptyDocument("code");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let current: string[] = [];
  let currentName = "";
  const flush = () => {
    const body = current.join("\n").trim();
    current = [];
    if (!body) return;
    if (currentName) doc.elements.push(heading(currentName, 2));
    doc.elements.push(code(body));
    currentName = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A definition at column zero starts a new symbol — but only if something
    // has already been collected, so a file's first definition does not emit an
    // empty chunk before it.
    if (DEFINITION.test(line) && current.some((l) => l.trim())) {
      // Pull any decorator or doc comment immediately above into the new symbol
      // rather than leaving it stranded at the end of the previous one.
      const carried: string[] = [];
      while (current.length && ATTACHES_FORWARD.test(current[current.length - 1].trim())) {
        carried.unshift(current.pop()!);
      }
      flush();
      current = carried;
    }
    if (DEFINITION.test(line) && !currentName) currentName = symbolName(line);
    current.push(line);
  }
  flush();

  if (doc.elements.length === 0 && text.trim()) doc.elements.push(code(text));
  doc.pageCount = 1;
  doc.stats.symbols = doc.elements.filter((e) => e.kind === "heading").length;
  doc.docType = language === "md" ? "markdown" : "code";
  return doc;
}

function symbolName(line: string): string {
  return line.trim().replace(/\s*[{(=:].*$/, "").slice(0, 100);
}

/**
 * CSV to a Markdown table. Quoted fields with embedded commas and newlines are
 * handled, because a spreadsheet exported to CSV is full of them and a naive
 * split on "," turns one row into several broken ones.
 */
export function parseCsv(text: string): ParsedDocument {
  const doc = emptyDocument("text");
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    doc.pageCount = 1;
    return doc;
  }
  doc.elements.push(table(gridToMarkdown(rows)));
  doc.pageCount = 1;
  doc.stats.tables = 1;
  doc.stats.rows = rows.length;
  return doc;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const clean = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * JSON. An array of flat objects is tabular data in another syntax, so it is
 * rendered as a table; an object of scalars is a two-column table of its own.
 * Anything deeper stays as formatted JSON, which at least keeps its indentation
 * and therefore its shape.
 */
export function parseJson(text: string): ParsedDocument {
  const doc = emptyDocument("text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    doc.elements.push(code(text));
    doc.pageCount = 1;
    return doc;
  }

  const elements: DocElement[] = [];
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isFlatObject)) {
    const columns = [...new Set(parsed.flatMap((row) => Object.keys(row as object)))];
    const rows = [
      columns,
      ...parsed.map((row) => columns.map((c) => scalar((row as Record<string, unknown>)[c]))),
    ];
    elements.push(table(gridToMarkdown(rows)));
    doc.stats.tables = 1;
  } else if (isFlatObject(parsed)) {
    const rows = [
      ["key", "value"],
      ...Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, scalar(v)]),
    ];
    elements.push(table(gridToMarkdown(rows)));
    doc.stats.tables = 1;
  } else {
    elements.push(code(JSON.stringify(parsed, null, 2)));
  }

  doc.elements = elements;
  doc.pageCount = 1;
  return doc;
}

function isFlatObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v === null || typeof v !== "object")
  );
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** A note pasted into the UI, when it clearly is not Markdown. */
export function parseNote(text: string): ParsedDocument {
  const doc = emptyDocument("note");
  doc.elements.push(para(text.trim()));
  doc.pageCount = 1;
  return doc;
}
