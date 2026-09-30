/**
 * Contextual retrieval: give every chunk a sentence explaining where it sits.
 *
 * A chunk pulled out of a document loses the context that made it meaningful.
 * "The interval moves to six months after the firmware upgrade" is unsearchable
 * on its own — nothing in it says rectifiers, Galle, or 2026. Anthropic's
 * contextual retrieval fixes this by asking the model, once per chunk, to write
 * one or two sentences situating that chunk in its document, and prepending them
 * to the text that gets embedded.
 *
 * The obvious objection is cost: sending the whole document with every chunk is
 * quadratic. Prompt caching removes it. The document goes in a cached system
 * block, so the first chunk pays to write the cache and every chunk after it
 * reads the cache at a tenth of the input price. A fifty-page document costs
 * cents.
 *
 * One caveat worth knowing: a model will not cache a prefix below its minimum
 * cacheable length, so a short document pays full input price per chunk. That is
 * fine — a short document has few chunks — but it means the cache counters read
 * zero on small files, and that is expected rather than a misconfiguration.
 *
 * This runs at ingest, never at query time, and only on documents that fit the
 * configured budget. Failure is soft: an un-contextualised chunk is still
 * indexed, just with its breadcrumb alone.
 */
import { settings } from "./config";
import { anthropic } from "./anthropic";
import { recordUsage } from "./usage";
import type { Chunk } from "./chunker";
import { mapWithConcurrency } from "./vision";

const SYSTEM_INTRO =
  "You situate excerpts inside the document they came from, for a search index.";

const INSTRUCTION = `Here is a chunk from that document:

<chunk>
{chunk}
</chunk>

Write one or two short sentences naming what this chunk is about and where it sits in the document — the subject, the section, the entities, the time period. Write it so someone searching would find this chunk by it.

Answer with the context sentences only. No preamble, no quotes, no "This chunk".`;

async function contextFor(document: string, chunk: string): Promise<string> {
  try {
    const message = await anthropic().messages.create({
      model: settings.contextModel,
      max_tokens: 150,
      system: [
        { type: "text", text: SYSTEM_INTRO },
        {
          // The document is identical for every chunk of this file, so it is the
          // cache prefix. Everything that varies goes in the user turn, after
          // the breakpoint, or nothing would ever hit.
          type: "text",
          text: `<document>\n${document}\n</document>`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: INSTRUCTION.replace("{chunk}", chunk) }],
    });
    recordUsage(settings.contextModel, message.usage);
    return message.content
      .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch {
    // An uncontextualised chunk is still a usable chunk.
    return "";
  }
}

/**
 * Attach generated context to each chunk. Returns how many were written.
 *
 * Mutates in place. `text` is deliberately untouched: the context is a retrieval
 * aid, and quoting it back to the user as if it were in their document would be
 * putting words in the document's mouth. Only the embedded text sees it.
 */
export async function contextualize(chunks: Chunk[], documentText: string): Promise<number> {
  if (!settings.contextualRetrievalEnabled || chunks.length === 0) return 0;
  if (documentText.length > settings.contextMaxDocumentChars) return 0;
  if (chunks.length > settings.contextMaxChunks) return 0;

  // The first call writes the cache; the rest read it. Sending one on its own
  // first avoids a thundering herd of parallel misses on the same prefix.
  const first = await contextFor(documentText, chunks[0].text);
  const rest =
    chunks.length > 1
      ? await mapWithConcurrency(chunks.slice(1), settings.contextConcurrency, (chunk) =>
          contextFor(documentText, chunk.text)
        )
      : [];

  let written = 0;
  [first, ...rest].forEach((context, i) => {
    if (!context) return;
    chunks[i].context = context;
    written++;
  });
  return written;
}
