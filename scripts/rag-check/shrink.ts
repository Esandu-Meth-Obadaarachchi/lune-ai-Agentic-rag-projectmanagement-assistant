import { Pinecone } from "@pinecone-database/pinecone";
import { parseMarkdown } from "@/lib/ai/parsers/markdown";
import { ingestDocument } from "@/lib/ai/ingest";
import { deleteByPrefix } from "@/lib/ai/pinecone";

const NS = "__ragv2_shrink__";
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const idx = pc.index(process.env.PINECONE_INDEX_NAME || "second-brain");
const count = async () => (await idx.describeIndexStats()).namespaces?.[NS]?.recordCount ?? 0;

const section = (n: number) => `## Section ${n}\n\n${`Body sentence about topic ${n} with enough words to make a real chunk of prose. `.repeat(12)}\n`;
const BIG = `# Doc\n\n` + [1,2,3,4,5,6].map(section).join("\n");
const SMALL = `# Doc\n\n` + [1,2].map(section).join("\n");

(async () => {
  const a = await ingestDocument({ namespace: NS, projectName: "Shrink", filename: "d.md", parsed: parseMarkdown(BIG) });
  console.log("big ingest:", a.chunksStored, "chunks");
  await new Promise(r => setTimeout(r, 8000));
  console.log("index count after big:", await count());

  // Re-upload immediately — the case where the list API has not caught up.
  const b = await ingestDocument({ namespace: NS, projectName: "Shrink", filename: "d.md", parsed: parseMarkdown(SMALL) });
  console.log("small ingest:", b.chunksStored, "chunks");
  await new Promise(r => setTimeout(r, 8000));
  const after = await count();
  console.log("index count after small:", after);
  console.log(after === b.chunksStored ? `PASS  shrink leaves no stale tail (${after} == ${b.chunksStored})` : `FAIL  stale tail remains (${after} != ${b.chunksStored})`);

  await deleteByPrefix(NS, a.docId);
  await new Promise(r => setTimeout(r, 4000));
  console.log("cleanup, remaining:", await count());
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
