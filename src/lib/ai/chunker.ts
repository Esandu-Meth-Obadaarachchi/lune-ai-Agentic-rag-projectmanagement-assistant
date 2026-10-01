/**
 * Structure-aware chunking.
 *
 * The old chunker was a 1000-character sliding window with 200 characters of
 * overlap. It had no idea what it was cutting. A table lost its header row
 * halfway down and became a list of numbers with no columns. A function was cut
 * mid-body. A paragraph three sections deep carried no clue which section it
 * came from, so a chunk reading "the interval moves to six months" matched
 * nothing, because the sentence naming the subject sat in a heading two elements
 * earlier.
 *
 * This chunker works on the parser's element tree instead:
 *
 * Sections    Headings open sections and a chunk never crosses a section
 *             boundary. Two adjacent sections are two different subjects, and
 *             merging them dilutes both embeddings.
 *
 * Breadcrumbs Every chunk is embedded with its heading path prepended
 *             ("spec.pdf > Data pipeline > Charts"), so the section context is
 *             in the vector, not just in the metadata. This is the cheapest
 *             recall win available and it costs nothing at query time.
 *
 * Atomicity   Tables, code blocks and figure captions are emitted whole. A table
 *             too large for one chunk is split by rows with its header repeated,
 *             so every piece still reads as a table. Code splits on blank lines,
 *             never mid-statement.
 *
 * Sizing      A token budget rather than characters, because a table of numbers
 *             and a paragraph of prose have wildly different tokens per
 *             character. Small trailing chunks are folded back into their
 *             neighbour so the index never fills with six-word fragments.
 *
 * Overlap     Applied within a section only. Overlapping across a heading
 *             boundary duplicates content into a chunk about a different
 *             subject.
 */
import { createHash } from "crypto";
import { settings } from "./config";
import type { DocElement, ParsedDocument } from "./documents";

// Sizing is in tokens. Counting them exactly would mean a network round trip per
// chunk, which is absurd for a budget that only has to be approximately right,
// so this estimates: English prose runs about 4 characters per token, code and
// tables denser at about 3.
const PROSE_CHARS_PER_TOKEN = 4;
const DENSE_CHARS_PER_TOKEN = 3;

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/;

/** Below this a text chunk with nowhere to merge is page furniture, not content. */
const HARD_FLOOR_TOKENS = 14;

export function estimateTokens(text: string, dense = false): number {
  return Math.ceil(text.length / (dense ? DENSE_CHARS_PER_TOKEN : PROSE_CHARS_PER_TOKEN)) + 1;
}

/**
 * One indexable unit.
 *
 * `text` is what the model reads and the UI shows. `embedText` is what the
 * vector is built from — the same content plus its breadcrumb and, when
 * contextualisation is on, a generated sentence situating it in the document.
 * Keeping them apart means retrieval context never leaks into a quoted answer,
 * and deriving the second from the first means the two cannot drift.
 */
export interface Chunk {
  text: string;
  breadcrumb: string;
  /** Filled in by `contextualize()`; empty otherwise. */
  context: string;
  sectionPath: string[];
  kind: string;
  page?: number;
  index: number;
  tokens: number;
}

export function embedText(chunk: Chunk): string {
  const body = chunk.breadcrumb ? `${chunk.breadcrumb}\n\n${chunk.text}` : chunk.text;
  return chunk.context ? `${body}\n\nContext: ${chunk.context}` : body;
}

export function sectionOf(chunk: Chunk): string {
  return chunk.sectionPath.join(" > ");
}

export function contentHash(chunk: Chunk): string {
  return createHash("sha256").update(chunk.text).digest("hex").slice(0, 16);
}

// ------------------------------- table splitting ------------------------------ //

/**
 * Split an oversized Markdown table by rows, repeating the header each time.
 *
 * A table fragment without its header is unreadable — "| 99.4 | 2 |" answers
 * nothing — so the two header lines are carried into every piece.
 */
function splitTable(markdown: string, maxTokens: number): string[] {
  const lines = markdown.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return [markdown];
  const [header, rule, ...rows] = lines;
  const headTokens = estimateTokens(`${header}${rule}`, true);

  const parts: string[] = [];
  let current: string[] = [];
  let running = headTokens;
  for (const row of rows) {
    const cost = estimateTokens(row, true);
    if (current.length && running + cost > maxTokens) {
      parts.push([header, rule, ...current].join("\n"));
      current = [];
      running = headTokens;
    }
    current.push(row);
    running += cost;
  }
  if (current.length) parts.push([header, rule, ...current].join("\n"));
  return parts.length ? parts : [markdown];
}

/** Split code on blank lines, the only boundary that is safe without a parser. */
function splitCode(text: string, maxTokens: number): string[] {
  const blocks = text.split(/\n\s*\n/);
  const parts: string[] = [];
  let current: string[] = [];
  let running = 0;
  for (const block of blocks) {
    const cost = estimateTokens(block, true);
    if (current.length && running + cost > maxTokens) {
      parts.push(current.join("\n\n"));
      current = [];
      running = 0;
    }
    current.push(block);
    running += cost;
  }
  if (current.length) parts.push(current.join("\n\n"));
  return parts.length ? parts : [text];
}

/**
 * Break a single oversized sentence on whitespace.
 *
 * Not every paragraph has sentence boundaries. OCR output, a minified file, a
 * table flattened to one line, or prose written without full stops all arrive as
 * one enormous "sentence". Without this the sentence splitter cannot place a
 * boundary inside it, and it is carried into the overlap of every chunk that
 * follows — which in practice means several copies of the same wall of text.
 */
function hardSplit(sentence: string, maxTokens: number): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const parts: string[] = [];
  let current: string[] = [];
  let running = 0;
  for (const word of words) {
    const cost = estimateTokens(word);
    if (current.length && running + cost > maxTokens) {
      parts.push(current.join(" "));
      current = [];
      running = 0;
    }
    current.push(word);
    running += cost;
  }
  if (current.length) parts.push(current.join(" "));
  return parts;
}

/** Split prose on sentence boundaries, carrying a sentence or two of overlap. */
function splitProse(text: string, maxTokens: number, overlapTokens: number): string[] {
  const sentences: string[] = [];
  for (const sentence of text.split(SENTENCE_BOUNDARY)) {
    if (estimateTokens(sentence) > maxTokens) sentences.push(...hardSplit(sentence, maxTokens));
    else sentences.push(sentence);
  }

  const parts: string[] = [];
  let current: string[] = [];
  let running = 0;
  for (const sentence of sentences) {
    const cost = estimateTokens(sentence);
    if (current.length && running + cost > maxTokens) {
      parts.push(current.join(" "));
      // Carry the tail of this chunk into the next so a fact spanning the
      // boundary stays retrievable from either side. The carry stops at the
      // overlap budget rather than at the first element, so one long sentence
      // cannot become the whole of the next chunk's overlap.
      const tail: string[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const previousCost = estimateTokens(current[i]);
        if (carried + previousCost > overlapTokens && tail.length) break;
        carried += previousCost;
        tail.unshift(current[i]);
        if (carried >= overlapTokens) break;
      }
      if (carried > overlapTokens) {
        current = [];
        running = 0;
      } else {
        current = tail;
        running = carried;
      }
    }
    current.push(sentence);
    running += cost;
  }
  if (current.length) parts.push(current.join(" "));
  return parts.filter((p) => p.trim());
}

// --------------------------------- the chunker -------------------------------- //

export function chunkDocument(parsed: ParsedDocument, source: string): Chunk[] {
  const target = settings.chunkTargetTokens;
  const ceiling = settings.chunkMaxTokens;
  const overlap = settings.chunkOverlapTokens;
  const floor = settings.chunkMinTokens;

  const chunks: Chunk[] = [];
  /** The open heading stack: (level, title). */
  const stack: [number, string][] = [];
  /** Prose pending inside the current section. */
  let buffer: DocElement[] = [];

  const path = () => stack.map(([, title]) => title);
  const breadcrumb = () => [source, ...path()].join(" > ");

  const emit = (text: string, kind: string, page: number | undefined, dense = false) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    chunks.push({
      text: trimmed,
      breadcrumb: breadcrumb(),
      context: "",
      sectionPath: path(),
      kind,
      page,
      index: chunks.length,
      tokens: estimateTokens(trimmed, dense),
    });
  };

  const flushProse = () => {
    if (buffer.length === 0) return;
    const text = buffer
      .map((e) => e.text)
      .filter((t) => t.trim())
      .join("\n\n");
    const page = buffer.find((e) => e.page)?.page;
    buffer = [];
    if (!text.trim()) return;
    if (estimateTokens(text) <= ceiling) {
      emit(text, "text", page);
      return;
    }
    for (const part of splitProse(text, target, overlap)) emit(part, "text", page);
  };

  for (const element of parsed.elements) {
    if (element.kind === "heading") {
      flushProse();
      const level = element.level || 1;
      while (stack.length && stack[stack.length - 1][0] >= level) stack.pop();
      stack.push([level, element.text]);
      continue;
    }

    if (element.kind === "table") {
      flushProse();
      for (const part of splitTable(element.text, ceiling)) emit(part, "table", element.page, true);
      continue;
    }

    if (element.kind === "code") {
      flushProse();
      if (estimateTokens(element.text, true) <= ceiling) {
        emit(element.text, "code", element.page, true);
      } else {
        for (const part of splitCode(element.text, target)) emit(part, "code", element.page, true);
      }
      continue;
    }

    if (element.kind === "figure") {
      flushProse();
      emit(element.text, "figure", element.page);
      continue;
    }

    buffer.push(element);
  }

  flushProse();
  return dropDuplicates(mergeSmall(chunks, floor));
}

/**
 * Fold undersized text chunks into their neighbour in the same section.
 *
 * A heading followed by one short line produces a chunk with almost no signal;
 * on its own it is noise in the index and it crowds out a real result. Tables,
 * code and figures are left alone — a two-row table is still a whole table.
 */
function mergeSmall(chunks: Chunk[], floor: number): Chunk[] {
  const merged: Chunk[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    const mergeable =
      previous &&
      chunk.kind === "text" &&
      previous.kind === "text" &&
      chunk.tokens < floor &&
      samePath(previous.sectionPath, chunk.sectionPath);
    if (mergeable) {
      previous.text = `${previous.text}\n\n${chunk.text}`;
      previous.tokens += chunk.tokens;
    } else {
      merged.push({ ...chunk });
    }
  }

  // A fragment stranded after a table cannot merge backwards without corrupting
  // the table, so it merges into the next text chunk of the same section. What
  // is left below the hard floor is page furniture — a footer, a stray caption —
  // and indexing it only crowds out real results.
  //
  // With one exception: a chunk that is the only thing in its section is never
  // furniture, however short. A heading with a single line under it is a real
  // fact — "Interval: six months" is eleven characters and the whole point of
  // the document — and dropping it loses the section entirely.
  const sectionCounts = new Map<string, number>();
  for (const chunk of merged) {
    const key = chunk.sectionPath.join("\u0000");
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }

  const out: Chunk[] = [];
  for (let i = 0; i < merged.length; i++) {
    const chunk = merged[i];
    if (chunk.kind === "text" && chunk.tokens < floor) {
      const nextIndex = merged.findIndex(
        (c, j) => j > i && c.kind === "text" && samePath(c.sectionPath, chunk.sectionPath)
      );
      if (nextIndex >= 0) {
        merged[nextIndex].text = `${chunk.text}\n\n${merged[nextIndex].text}`;
        merged[nextIndex].tokens += chunk.tokens;
        continue;
      }
      const aloneInSection = sectionCounts.get(chunk.sectionPath.join("\u0000")) === 1;
      if (chunk.tokens < HARD_FLOOR_TOKENS && merged.length > 1 && !aloneInSection) continue;
    }
    out.push(chunk);
  }

  const final = out.length ? out : merged.slice(0, 1);
  final.forEach((chunk, i) => {
    chunk.index = i;
  });
  return final;
}

/**
 * Drop chunks whose text is byte-identical to one already kept.
 *
 * Repeated boilerplate — a legal footer on every section, a definition block
 * pasted into four appendices — otherwise occupies four slots in a top-5 result
 * set with one passage's worth of information. The parser removes running
 * headers it can detect positionally; this catches the rest, whatever format
 * they came from.
 */
function dropDuplicates(chunks: Chunk[]): Chunk[] {
  const seen = new Set<string>();
  const out: Chunk[] = [];
  for (const chunk of chunks) {
    const key = contentHash(chunk);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  out.forEach((chunk, i) => {
    chunk.index = i;
  });
  return out;
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}
