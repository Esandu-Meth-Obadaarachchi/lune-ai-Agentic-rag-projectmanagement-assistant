/**
 * Layout-aware PDF parsing.
 *
 * `pdf-parse` returns one flat string. Everything that makes a PDF useful to
 * retrieval — which line was a heading, which block was a table, what page a
 * fact came from — is thrown away before the chunker ever sees it, and no amount
 * of clever chunking downstream can recover it.
 *
 * This reads the text layer with positions instead. Every glyph run comes back
 * with its coordinates and its font size, which is enough to reconstruct the
 * things that matter:
 *
 * Lines        Runs are grouped by their baseline, then ordered left to right,
 *              so a two-column page does not interleave into nonsense.
 * Headings     A line set noticeably larger than the page's body text, short,
 *              and not ending in a full stop, is a heading. Its size relative to
 *              the other heading sizes in the document gives it a level, so the
 *              heading tree — and therefore every chunk's breadcrumb — comes out
 *              of typography rather than guesswork.
 * Tables       A run of consecutive lines whose text starts at the same handful
 *              of x positions is a table. The columns are recovered from those
 *              positions and the whole thing is emitted as a Markdown table, so
 *              the chunker can keep it intact and repeat its header when it has
 *              to split it.
 * Furniture    A line that appears at the same height on most pages is a running
 *              header or footer. Indexing it once per page fills the index with
 *              the document's own title answering every question.
 * Scans        A page whose text layer is empty or near-empty is a scan. Those
 *              pages are collected and sent to Claude for transcription, which
 *              is the only way to read them at all.
 *
 * None of this needs a native dependency or a rendering canvas: positions come
 * from the text layer, and the scanned pages go to the model as PDF rather than
 * as rasterised images. See `vision.ts` for why that matters.
 */
import { getDocumentProxy } from "unpdf";
import { settings } from "../config";
import {
  type DocElement,
  type ParsedDocument,
  bump,
  emptyDocument,
  gridToMarkdown,
  heading,
  para,
  table,
} from "../documents";
import { transcribePdfPages } from "../vision";
import { parseMarkdownElements } from "./markdown";

/** One glyph run, reduced to what the layout reconstruction needs. */
interface Run {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

/** One reconstructed line of text. */
interface Line {
  runs: Run[];
  text: string;
  y: number;
  size: number;
}

/** Below this many characters a page's text layer is treated as absent. A scan
 *  often carries a stray watermark or a page number, so "empty" is not zero. */
const SCANNED_PAGE_MAX_CHARS = 40;

/** A run further right than this many multiples of a space is a column break. */
const COLUMN_GAP_RATIO = 1.8;

/** How close two x positions must be to count as the same column, as a fraction
 *  of the body font size. */
const COLUMN_TOLERANCE = 1.2;

export async function parsePdf(data: Buffer): Promise<ParsedDocument> {
  const doc = emptyDocument("pdf");
  const bytes = new Uint8Array(data);

  const pdf = await getDocumentProxy(bytes);
  doc.pageCount = pdf.numPages;

  // Pass one: pull the positioned text out of every page.
  const pages: Line[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(await readPage(pdf, n));
  }

  const bodySize = medianSize(pages.flat());
  const furniture = findFurniture(pages);

  // Pages with nothing readable are scans. They go to the model together.
  const scanned = pages
    .map((lines, i) => ({ page: i + 1, chars: lines.reduce((n, l) => n + l.text.length, 0) }))
    .filter(({ chars }) => chars < SCANNED_PAGE_MAX_CHARS)
    .map(({ page }) => page);

  const transcripts =
    scanned.length > 0 && settings.visionEnabled
      ? await transcribePdfPages(bytes, scanned)
      : new Map<number, string>();

  // Pass two: turn each page's lines into elements.
  const headingSizes = collectHeadingSizes(pages, bodySize, furniture);
  for (let i = 0; i < pages.length; i++) {
    const page = i + 1;
    const transcript = transcripts.get(page);
    if (transcript) {
      doc.elements.push(...parseMarkdownElements(transcript, page));
      bump(doc, "ocrPages");
      continue;
    }
    const lines = pages[i].filter((line) => !furniture.has(furnitureKey(line)));
    doc.elements.push(...pageElements(lines, page, bodySize, headingSizes, doc));
  }

  if (scanned.length > transcripts.size) {
    bump(doc, "unreadablePages", scanned.length - transcripts.size);
  }
  return doc;
}

// ------------------------------- reading a page ------------------------------ //

async function readPage(pdf: { getPage: (n: number) => Promise<unknown> }, n: number): Promise<Line[]> {
  const page = (await pdf.getPage(n)) as {
    getTextContent: () => Promise<{ items: unknown[] }>;
  };
  const content = await page.getTextContent();

  const runs: Run[] = [];
  for (const raw of content.items) {
    const item = raw as {
      str?: string;
      width?: number;
      height?: number;
      transform?: number[];
    };
    const text = item.str ?? "";
    if (!text.trim() || !item.transform) continue;
    runs.push({
      text,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
      // transform[0] is the horizontal scale, which is the rendered font size.
      // `height` is zero on some producers, so it is only the fallback.
      size: Math.abs(item.transform[0]) || item.height || 10,
    });
  }
  return groupIntoLines(runs);
}

/**
 * Group runs into lines by baseline.
 *
 * The tolerance scales with the font size rather than being a constant: a 24pt
 * heading's runs sit further apart vertically than a 9pt footnote's, and one
 * fixed threshold either splits the heading or merges the footnotes.
 */
function groupIntoLines(runs: Run[]): Line[] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Line[] = [];
  let current: Run[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i];
    const reference = current[current.length - 1];
    if (Math.abs(run.y - reference.y) <= Math.max(2, reference.size * 0.5)) {
      current.push(run);
    } else {
      lines.push(makeLine(current));
      current = [run];
    }
  }
  lines.push(makeLine(current));
  return lines;
}

function makeLine(runs: Run[]): Line {
  const ordered = [...runs].sort((a, b) => a.x - b.x);
  return {
    runs: ordered,
    // Runs inside one word arrive separately (kerning, ligatures), so they are
    // only separated by a space when there is a real gap between them.
    text: ordered
      .map((run, i) => {
        if (i === 0) return run.text;
        const previous = ordered[i - 1];
        const gap = run.x - (previous.x + previous.width);
        return (gap > previous.size * 0.2 ? " " : "") + run.text;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim(),
    y: ordered[0].y,
    size: Math.max(...ordered.map((r) => r.size)),
  };
}

// ------------------------------- page furniture ------------------------------ //

function furnitureKey(line: Line): string {
  // Rounded y so the same header at a one-point offset still matches, and the
  // text itself so a page number ("3", "4") is not treated as repeated.
  return `${Math.round(line.y / 6)}:${line.text.replace(/\d+/g, "#")}`;
}

/**
 * Lines that repeat at the same height across most pages. A running header is
 * indexed once per page otherwise, and a 200-page spec then has 200 chunks whose
 * strongest signal is the document's own title.
 */
function findFurniture(pages: Line[][]): Set<string> {
  if (pages.length < 4) return new Set();
  const counts = new Map<string, number>();
  for (const lines of pages) {
    // Only the top and bottom of a page can be furniture; a repeated line in the
    // middle is a real repeated heading.
    const candidates = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of new Set(candidates)) {
      if (!line.text) continue;
      const key = furnitureKey(line);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(pages.length * 0.5));
  return new Set([...counts.entries()].filter(([, n]) => n >= threshold).map(([key]) => key));
}

// --------------------------------- typography -------------------------------- //

/** The document's body font size, weighted by how much text is set in it. */
function medianSize(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    for (const run of line.runs) {
      const size = Math.round(run.size * 2) / 2;
      weights.set(size, (weights.get(size) ?? 0) + run.text.length);
    }
  }
  if (weights.size === 0) return 10;
  // The most-set size is the body text. A mean would be dragged upward by a few
  // very large headings on a title page.
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function isHeadingLine(line: Line, bodySize: number): boolean {
  return (
    line.text.length > 0 &&
    line.text.length <= 120 &&
    line.size >= bodySize * 1.12 &&
    !/[.;:,]$/.test(line.text) &&
    line.runs.length <= 6
  );
}

/** The distinct heading sizes in the document, largest first. A line's position
 *  in this list is its heading level, so an H1 is an H1 because nothing in the
 *  document is set larger — not because of a hardcoded point size. */
function collectHeadingSizes(pages: Line[][], bodySize: number, furniture: Set<string>): number[] {
  const sizes = new Set<number>();
  for (const lines of pages) {
    for (const line of lines) {
      if (furniture.has(furnitureKey(line))) continue;
      if (isHeadingLine(line, bodySize)) sizes.add(Math.round(line.size * 2) / 2);
    }
  }
  return [...sizes].sort((a, b) => b - a).slice(0, 6);
}

// ---------------------------------- tables ----------------------------------- //

/** The x positions at which this line's cells start, or null when the line has
 *  no column structure at all. */
function columnStarts(line: Line, bodySize: number): number[] | null {
  if (line.runs.length < 2) return null;
  const starts: number[] = [line.runs[0].x];
  for (let i = 1; i < line.runs.length; i++) {
    const previous = line.runs[i - 1];
    const gap = line.runs[i].x - (previous.x + previous.width);
    if (gap > previous.size * COLUMN_GAP_RATIO) starts.push(line.runs[i].x);
  }
  return starts.length >= 2 ? starts : null;
}

function sameColumns(a: number[], b: number[], tolerance: number): boolean {
  // Not an exact match: a row with an empty cell has fewer starts than the
  // header, and demanding equality would break the table at that row. Every
  // start in the shorter list has to line up with one in the longer.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length > 2) return false;
  return shorter.every((x) => longer.some((y) => Math.abs(x - y) <= tolerance));
}

/** Split a line's runs into cells at the given column positions. */
function toCells(line: Line, columns: number[], tolerance: number): string[] {
  const cells = columns.map(() => "");
  for (const run of line.runs) {
    // Nearest column at or left of the run's start: text is left-aligned within
    // its cell far more often than not.
    let index = 0;
    for (let c = 0; c < columns.length; c++) {
      if (run.x >= columns[c] - tolerance) index = c;
    }
    cells[index] = cells[index] ? `${cells[index]} ${run.text}` : run.text;
  }
  return cells.map((c) => c.replace(/\s+/g, " ").trim());
}

// ------------------------------ page -> elements ----------------------------- //

function pageElements(
  lines: Line[],
  page: number,
  bodySize: number,
  headingSizes: number[],
  doc: ParsedDocument
): DocElement[] {
  const elements: DocElement[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph = [];
    if (text) elements.push(para(text, page));
  };

  const tolerance = bodySize * COLUMN_TOLERANCE;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text) continue;

    if (isHeadingLine(line, bodySize)) {
      flush();
      const rounded = Math.round(line.size * 2) / 2;
      const level = Math.max(1, headingSizes.indexOf(rounded) + 1);
      elements.push(heading(line.text, level, page));
      continue;
    }

    // A table: this line and at least one after it share a column structure.
    const columns = columnStarts(line, bodySize);
    if (columns) {
      const rows: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const nextColumns = next.text ? columnStarts(next, bodySize) : null;
        if (!nextColumns || !sameColumns(columns, nextColumns, tolerance)) break;
        rows.push(next);
        j++;
      }
      if (rows.length >= 2) {
        flush();
        // The union of every row's starts, so a column only some rows fill is
        // still a column rather than being folded into its neighbour.
        const merged = mergeColumns(rows, bodySize, tolerance);
        const grid = rows.map((row) => toCells(row, merged, tolerance));
        const markdown = gridToMarkdown(grid);
        if (markdown) {
          elements.push(table(markdown, page));
          bump(doc, "tablesRecovered");
        }
        i = j - 1;
        continue;
      }
    }

    paragraph.push(line.text);
    // A line ending in a full stop closes the paragraph; a wrapped line does not.
    // Without this every page becomes one enormous paragraph and the sentence
    // splitter has to undo the parser's work.
    if (/[.!?]["')\]]?$/.test(line.text)) flush();
  }

  flush();
  return elements;
}

function mergeColumns(rows: Line[], bodySize: number, tolerance: number): number[] {
  const all = rows.flatMap((row) => columnStarts(row, bodySize) ?? []);
  const sorted = [...all].sort((a, b) => a - b);
  const merged: number[] = [];
  for (const x of sorted) {
    if (merged.length === 0 || x - merged[merged.length - 1] > tolerance) merged.push(x);
  }
  return merged;
}
