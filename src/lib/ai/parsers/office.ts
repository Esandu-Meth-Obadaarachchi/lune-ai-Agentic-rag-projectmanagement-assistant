/**
 * Word, Excel and PowerPoint.
 *
 * All three are zip archives of XML, and all three carry the structure this
 * pipeline wants — Word has heading styles, Excel has sheets and cells,
 * PowerPoint has slides and placeholders. The previous parser called
 * `mammoth.extractRawText` on .docx and ignored the other two entirely, which
 * threw away every one of those signals and silently refused half the files
 * people actually upload.
 *
 * Word goes through mammoth's HTML conversion rather than its raw-text one. The
 * HTML is a lossy rendering of a .docx in general, but the parts it keeps are
 * exactly the parts that matter here: `Heading 1` becomes `<h1>`, a table
 * becomes `<table>`, a list becomes `<li>`. Parsing that back out is far more
 * reliable than inferring structure from a flat string, and it costs one pass.
 *
 * Excel becomes one section per sheet, each sheet a Markdown table. A sheet is
 * a table; rendering it as one means the chunker can split it by rows with the
 * header repeated, which is the difference between a retrievable figure and a
 * column of bare numbers.
 *
 * PowerPoint becomes one section per slide, with the title as the heading and
 * the speaker notes kept — the notes are often where the actual argument is,
 * and every pipeline that drops them loses the best content in the deck.
 */
import JSZip from "jszip";
import {
  type DocElement,
  type ParsedDocument,
  bump,
  code,
  emptyDocument,
  gridToMarkdown,
  heading,
  listItem,
  para,
  table,
} from "../documents";

// ----------------------------------- docx ----------------------------------- //

export async function parseDocx(data: Buffer): Promise<ParsedDocument> {
  const doc = emptyDocument("docx");
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: data });
  doc.elements = htmlToElements(html, doc);
  doc.pageCount = 1;
  if (doc.elements.length === 0) {
    const { value } = await mammoth.extractRawText({ buffer: data });
    if (value.trim()) doc.elements.push(para(value));
  }
  return doc;
}

/**
 * Walk mammoth's HTML and emit elements.
 *
 * A regex-driven tag walk rather than a DOM: mammoth's output is a small, known
 * subset — headings, paragraphs, lists, tables, emphasis — and pulling a DOM
 * implementation into a serverless function to read six tag names is not worth
 * the cold start.
 */
function htmlToElements(html: string, doc: ParsedDocument): DocElement[] {
  const elements: DocElement[] = [];
  const blocks = html.match(/<(h[1-6]|p|ul|ol|table)\b[\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const tag = /^<(\w+)/.exec(block)?.[1].toLowerCase() ?? "";

    if (/^h[1-6]$/.test(tag)) {
      const text = stripTags(block);
      if (text) elements.push(heading(text, Number(tag[1])));
      continue;
    }

    if (tag === "table") {
      const rows = [...block.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((match) =>
        [...match[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) =>
          stripTags(cell[1])
        )
      );
      const markdown = gridToMarkdown(rows);
      if (markdown) {
        elements.push(table(markdown));
        bump(doc, "tablesRecovered");
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((match) => stripTags(match[1]))
        .filter(Boolean)
        .map((text, i) => (tag === "ol" ? `${i + 1}. ${text}` : `- ${text}`));
      if (items.length) elements.push(listItem(items.join("\n")));
      continue;
    }

    const text = stripTags(block);
    if (text) elements.push(para(text));
  }

  return elements;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

// ----------------------------------- xlsx ----------------------------------- //

/** Rows past this in one sheet are dropped. A 50,000-row export is a database,
 *  not a document, and indexing it whole buries every real answer. */
const MAX_SHEET_ROWS = 2000;

export async function parseXlsx(data: Buffer): Promise<ParsedDocument> {
  const doc = emptyDocument("xlsx");
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "buffer", cellDates: true });

  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const trimmed = rows
      .slice(0, MAX_SHEET_ROWS)
      .map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
    if (trimmed.length === 0) continue;

    // One section per sheet: two sheets are two subjects, and a chunk that spans
    // both is about neither.
    doc.elements.push(heading(name, 1));
    const markdown = gridToMarkdown(trimmed);
    if (markdown) {
      doc.elements.push(table(markdown));
      bump(doc, "sheets");
    }
    if (rows.length > MAX_SHEET_ROWS) {
      doc.elements.push(para(`(${rows.length - MAX_SHEET_ROWS} further rows not indexed.)`));
      bump(doc, "rowsTruncated", rows.length - MAX_SHEET_ROWS);
    }
  }

  doc.pageCount = book.SheetNames.length;
  return doc;
}

// ----------------------------------- pptx ----------------------------------- //

export async function parsePptx(data: Buffer): Promise<ParsedDocument> {
  const doc = emptyDocument("pptx");
  const zip = await JSZip.loadAsync(data);

  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  for (const path of slidePaths) {
    const number = slideNumber(path);
    const xml = await zip.files[path].async("string");
    const shapes = extractShapes(xml);
    if (shapes.length === 0) continue;

    // The first shape on a slide is its title often enough to be the right
    // default, and a slide with no heading loses its place in the deck.
    const [title, ...rest] = shapes;
    doc.elements.push(heading(title || `Slide ${number}`, 1, number));
    for (const shape of rest) {
      if (shape.trim()) doc.elements.push(para(shape, number));
    }

    const tables = extractTables(xml);
    for (const grid of tables) {
      const markdown = gridToMarkdown(grid);
      if (markdown) {
        doc.elements.push(table(markdown, number));
        bump(doc, "tablesRecovered");
      }
    }

    // Speaker notes: usually where the argument behind the slide actually lives.
    const notesPath = `ppt/notesSlides/notesSlide${number}.xml`;
    const notesFile = zip.files[notesPath];
    if (notesFile) {
      const notes = extractShapes(await notesFile.async("string")).join("\n").trim();
      // The notes pane repeats the slide number as its own shape; a note that is
      // only that is not a note.
      if (notes && notes.replace(/\d+/g, "").trim().length > 3) {
        doc.elements.push(para(`Speaker notes: ${notes}`, number));
        bump(doc, "notes");
      }
    }
  }

  doc.pageCount = slidePaths.length;
  return doc;
}

function slideNumber(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** The text of each shape on a slide, in document order. Runs inside one shape
 *  are joined; paragraphs within a shape are separated by newlines. */
function extractShapes(xml: string): string[] {
  const shapes: string[] = [];
  for (const match of xml.matchAll(/<p:txBody>([\s\S]*?)<\/p:txBody>/g)) {
    const paragraphs = [...match[1].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) =>
      [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((t) => decodeEntities(t[1]))
        .join("")
        .trim()
    );
    const text = paragraphs.filter(Boolean).join("\n").trim();
    if (text) shapes.push(text);
  }
  return shapes;
}

function extractTables(xml: string): string[][][] {
  const tables: string[][][] = [];
  for (const match of xml.matchAll(/<a:tbl>([\s\S]*?)<\/a:tbl>/g)) {
    const rows = [...match[1].matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((row) =>
      [...row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((cell) =>
        [...cell[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((t) => decodeEntities(t[1]))
          .join("")
          .trim()
      )
    );
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

// ----------------------------------- .doc ----------------------------------- //

/** Legacy binary .doc. There is no pure-JS reader worth its weight, so the
 *  readable strings are salvaged rather than failing the upload outright. */
export function parseLegacyDoc(data: Buffer): ParsedDocument {
  const doc = emptyDocument("doc");
  const text = data
    .toString("latin1")
    .replace(/[^\x20-\x7e\n]/g, " ")
    .replace(/\s{3,}/g, "\n\n");
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 40 && /[a-z]{3}/.test(b));
  for (const block of blocks) doc.elements.push(para(block));
  if (doc.elements.length === 0) doc.elements.push(code(text.slice(0, 4000)));
  doc.pageCount = 1;
  bump(doc, "legacySalvage");
  return doc;
}
