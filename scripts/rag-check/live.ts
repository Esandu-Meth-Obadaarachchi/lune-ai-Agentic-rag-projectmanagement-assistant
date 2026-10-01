import "dotenv/config";
import { parseMarkdown } from "@/lib/ai/parsers/markdown";
import { ingestDocument, documentId } from "@/lib/ai/ingest";
import { agenticRetrieve, retrieveAndRerank } from "@/lib/ai/retrieval";
import { deleteByPrefix } from "@/lib/ai/pinecone";
import { embedQuery } from "@/lib/ai/voyage";

const NS = "__ragv2_smoke__";
const PROJECT = "SmokeProject";
const FILE = "galle-spec.md";

const DOC = `# Galle Rectifier Maintenance Spec

## Service intervals

The service interval moves to six months after the firmware upgrade lands.
Unit RX-4471 is the first unit scheduled to move to the longer interval.
All other units remain on the three-month cycle until further notice.

## Ownership

| Unit | Interval | Owner |
| --- | --- | --- |
| RX-4471 | 6 months | Nadeesha |
| RX-4472 | 3 months | Perera |

## Budget

The 2026 maintenance budget for the Galle site is LKR 4.2 million, approved in
the November steering meeting. It excludes the inverter replacement programme,
which is funded separately under the BMPC 2026 capital line.
`;

function ok(l: string, c: boolean, e = "") { console.log(`${c ? "PASS" : "FAIL"}  ${l}${e ? " :: " + e : ""}`); }

(async () => {
  const t0 = Date.now();
  const parsed = parseMarkdown(DOC);
  const res = await ingestDocument({ namespace: NS, projectName: PROJECT, filename: FILE, parsed });
  console.log(`ingest: ${res.chunksStored} chunks, ${res.contextualised} contextualised, ${Date.now() - t0}ms`);
  ok("ingest: chunks stored", res.chunksStored > 0);
  ok("ingest: contextual retrieval ran", res.contextualised > 0, `${res.contextualised}/${res.chunksStored}`);
  ok("ingest: deterministic docId", res.docId === documentId(PROJECT, FILE));

  // Pinecone is eventually consistent on fresh upserts.
  await new Promise(r => setTimeout(r, 6000));

  const t1 = Date.now();
  const lookup = await agenticRetrieve([NS], "what is the service interval for RX-4471", "lookup");
  console.log(`lookup: ${Date.now() - t1}ms, grade=${lookup.grade}, attempts=${lookup.attempts}`);
  console.log("  trace:", lookup.trace.join(" | "));
  ok("retrieve: found the interval", lookup.chunks.some(c => /six months/i.test(c.text)), lookup.chunks[0]?.text.slice(0,80));
  ok("retrieve: provenance carried", !!lookup.chunks[0]?.section && !!lookup.chunks[0]?.docId, `${lookup.chunks[0]?.section} / ${lookup.chunks[0]?.element}`);
  ok("retrieve: one attempt on a good query", lookup.attempts === 1 && lookup.grade === "good");

  const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
  await pause(45000);
  // The rare-token case dense retrieval is worst at.
  const code = await retrieveAndRerank([NS], "BMPC 2026", undefined, "lookup");
  ok("retrieve: rare identifier found", code.some(c => /BMPC 2026/.test(c.text)), code[0]?.text.slice(0,60));

  await pause(45000);
  // The table should survive as a table.
  const tbl = await retrieveAndRerank([NS], "who owns unit RX-4472", undefined, "lookup");
  ok("retrieve: table chunk intact", tbl.some(c => c.element === "table" && c.text.includes("| Unit |")), tbl.map(c=>c.element).join(","));

  await pause(45000);
  // Summarize profile should spread across sections.
  const sum = await retrieveAndRerank([NS], "Galle site overview", undefined, "summarize");
  const sections = new Set(sum.map(c => c.section));
  ok("retrieve: summarize covers several sections", sections.size >= 2, [...sections].join(" ; "));

  await pause(45000);
  // Query-embedding cache.
  const a = Date.now(); await embedQuery("cache probe query"); const cold = Date.now() - a;
  const b = Date.now(); await embedQuery("cache probe query"); const warm = Date.now() - b;
  ok("cache: query embedding warm path faster", warm < cold, `${cold}ms cold vs ${warm}ms warm`);

  await pause(45000);
  // Idempotency: re-ingesting must replace, not duplicate.
  const again = await ingestDocument({ namespace: NS, projectName: PROJECT, filename: FILE, parsed });
  ok("ingest: re-upload is idempotent", again.chunksStored === res.chunksStored, `${res.chunksStored} then ${again.chunksStored}`);

  const removed = await deleteByPrefix(NS, `${res.docId}#`);
  console.log(`cleanup: removed ${removed} vectors from ${NS}`);
})().catch(e => { console.error("LIVE TEST ERROR:", e); process.exit(1); });
