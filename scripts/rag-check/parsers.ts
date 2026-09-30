import * as XLSX from "xlsx";
import JSZip from "jszip";
import { parseXlsx, parsePptx } from "@/lib/ai/parsers/office";
import { chunkDocument, estimateTokens } from "@/lib/ai/chunker";
import { emptyDocument, heading, para, table, gridToMarkdown } from "@/lib/ai/documents";

function ok(l: string, c: boolean, e = "") { console.log(`${c ? "PASS" : "FAIL"}  ${l}${e ? " :: " + e : ""}`); }

(async () => {
  // xlsx
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Unit","Interval"],["RX-4471","6 months"]]), "Schedule");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Owner","Site"],["Nadeesha","Galle"]]), "Owners");
  const xlsx = await parseXlsx(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })));
  ok("xlsx: one section per sheet", xlsx.elements.filter(e => e.kind === "heading").length === 2, xlsx.elements.map(e=>e.kind).join(","));
  ok("xlsx: sheets as tables", xlsx.elements.filter(e => e.kind === "table").length === 2);
  ok("xlsx: header row preserved", xlsx.elements.find(e=>e.kind==="table")!.text.includes("Unit"));

  // pptx
  const zip = new JSZip();
  const slide = `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Q3 Results</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Revenue up 14% on Galle sites</a:t></a:r></a:p></p:txBody></p:sp>
    <a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Site</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Rev</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Galle</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>4.2M</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>
    </p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide);
  zip.file("ppt/notesSlides/notesSlide1.xml", `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><p:sp><p:txBody><a:p><a:r><a:t>The 14% is driven entirely by the new inverter fleet.</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`);
  const pptx = await parsePptx(Buffer.from(await zip.generateAsync({ type: "nodebuffer" })));
  ok("pptx: slide title as heading", pptx.elements[0]?.kind === "heading" && pptx.elements[0].text === "Q3 Results", pptx.elements.map(e=>e.kind).join(","));
  ok("pptx: table recovered", pptx.elements.some(e => e.kind === "table" && e.text.includes("Galle")));
  ok("pptx: speaker notes kept", pptx.elements.some(e => e.text.includes("inverter fleet")));
  ok("pptx: slide number as page", pptx.elements.every(e => e.page === 1));

  // chunker: oversized table splits with header repeated
  const big = emptyDocument("text");
  const rows = [["Unit","Interval","Owner","Site","Notes"]];
  for (let i = 0; i < 400; i++) rows.push([`RX-${i}`,"6 months","Nadeesha","Galle","routine service visit scheduled"]);
  big.elements.push(heading("Schedule", 1), table(gridToMarkdown(rows)));
  const tc = chunkDocument(big, "sheet.xlsx");
  ok("chunker: big table split into several", tc.length > 1, `${tc.length} chunks`);
  ok("chunker: every piece keeps the header", tc.every(c => c.text.startsWith("| Unit |")));
  ok("chunker: pieces respect the ceiling", tc.every(c => estimateTokens(c.text, true) <= 1000), String(Math.max(...tc.map(c=>estimateTokens(c.text,true)))));

  // chunker: tiny fragments merge, duplicates dropped
  const small = emptyDocument("text");
  small.elements.push(heading("A",1), para("short."), para("also short."), heading("B",1), para("Body ".repeat(60)));
  const sc = chunkDocument(small, "n.md");
  ok("chunker: tiny fragments folded together", sc.length === 2, sc.map(c=>c.text.slice(0,20)).join(" | "));

  const dup = emptyDocument("text");
  const body = "The service interval moves to six months after the firmware upgrade lands on site. ".repeat(3);
  dup.elements.push(heading("A",1), para(body), heading("B",1), para(body));
  const dc = chunkDocument(dup, "d.md");
  ok("chunker: identical repeated block indexed once", dc.length === 1, `${dc.length} chunks`);

  // chunker: no sentence boundaries at all (OCR-style wall of text)
  const wall = emptyDocument("text");
  wall.elements.push(para("word ".repeat(3000)));
  const wc = chunkDocument(wall, "ocr.pdf");
  ok("chunker: unpunctuated wall splits", wc.length > 1, `${wc.length} chunks`);
  ok("chunker: no runaway overlap", wc.every(c => estimateTokens(c.text) <= 900), String(Math.max(...wc.map(c=>estimateTokens(c.text)))));
})();
