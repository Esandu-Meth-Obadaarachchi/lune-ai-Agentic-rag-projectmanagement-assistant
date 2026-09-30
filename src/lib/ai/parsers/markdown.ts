/**
 * Markdown and plain text.
 *
 * Markdown already carries the structure every other parser has to reconstruct —
 * headings, fenced code, pipe tables, lists — so this is mostly a matter of not
 * throwing it away. It doubles as the parser for vision output, because the OCR
 * prompt asks Claude to transcribe a page as Markdown, which means a scanned
 * table comes back through exactly the same path as a native one.
 *
 * Plain text has no structure to read, so headings are inferred: a short line
 * with no terminal punctuation, followed by a blank line, is almost always a
 * heading and almost never a sentence. Getting this slightly wrong is cheap —
 * the worst case is a section boundary in a place a human would not have put one
 * — and getting it right rescues the breadcrumbs on the large number of uploads
 * that are someone's notes pasted into a .txt file.
 */
import {
  type DocElement,
  type ParsedDocument,
  code,
  emptyDocument,
  heading,
  listItem,
  para,
  table,
} from "../documents";

const FENCE = /^\s*(?:```|~~~)/;
const ATX_HEADING = /^(#{1,6})\s+(.*)$/;
const SETEXT_UNDERLINE = /^\s*(=+|-{2,})\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/**
 * Parse Markdown into elements. Exported separately from `parseMarkdown` so the
 * vision path can fold a transcribed page into a document that already has other
 * pages in it, carrying the right page number.
 */
export function parseMarkdownElements(text: string, page?: number): DocElement[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const elements: DocElement[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join(" ").trim();
    paragraph = [];
    if (joined) elements.push(para(joined, page));
  };
  const flushList = () => {
    const joined = list.join("\n").trim();
    list = [];
    // A list is emitted as one element rather than one per bullet: the items of
    // a list are a single thought, and splitting them makes every bullet an
    // isolated fragment in the index.
    if (joined) elements.push(listItem(joined, page));
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code — consumed whole, including any blank lines inside it.
    if (FENCE.test(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      if (body.length) elements.push(code(body.join("\n"), page));
      continue;
    }

    const atx = ATX_HEADING.exec(line);
    if (atx) {
      flush();
      if (atx[2].trim()) elements.push(heading(atx[2], atx[1].length, page));
      continue;
    }

    // Setext heading: a line of text underlined with === or ---.
    if (
      SETEXT_UNDERLINE.test(line) &&
      paragraph.length === 1 &&
      paragraph[0].trim() &&
      list.length === 0
    ) {
      const title = paragraph[0].trim();
      paragraph = [];
      elements.push(heading(title, line.includes("=") ? 1 : 2, page));
      continue;
    }

    // Pipe table — a header row, a rule, then rows. Without the rule it is just
    // prose that happens to contain pipes.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++].trim());
      i--;
      elements.push(table(rows.join("\n"), page));
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      list.push(line.replace(/\s+$/, ""));
      continue;
    }

    // A continuation line inside a list item stays with the item.
    if (list.length > 0 && /^\s{2,}\S/.test(line)) {
      list.push(line.replace(/\s+$/, ""));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flush();
  return elements;
}

export function parseMarkdown(text: string): ParsedDocument {
  const doc = emptyDocument("markdown");
  doc.elements = parseMarkdownElements(text);
  doc.pageCount = 1;
  const tables = doc.elements.filter((e) => e.kind === "table").length;
  if (tables) doc.stats.tables = tables;
  return doc;
}

/**
 * Plain text, with headings inferred from shape.
 *
 * The rule is conservative on purpose: a candidate has to be short, free of
 * terminal punctuation, and followed by a blank line. Title Case or ALL CAPS
 * raises confidence but is not required, because plenty of real notes use
 * sentence case for their headings.
 */
export function parsePlainText(text: string): ParsedDocument {
  const doc = emptyDocument("text");
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 1 && looksLikeHeading(lines[0])) {
      doc.elements.push(heading(lines[0], /^[A-Z0-9\s\-_.]+$/.test(lines[0]) ? 1 : 2));
      continue;
    }
    if (lines.every((l) => LIST_ITEM.test(l))) {
      doc.elements.push(listItem(block));
      continue;
    }
    doc.elements.push(para(block.replace(/\n/g, " ")));
  }

  doc.pageCount = 1;
  return doc;
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 80 &&
    trimmed.split(/\s+/).length <= 12 &&
    !/[.!?,;:]$/.test(trimmed) &&
    !LIST_ITEM.test(trimmed)
  );
}
