import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { loadProject } from "@/lib/ai/server";
import { documentText, parseFile, parsePasted, UploadTooLarge } from "@/lib/ai/parse";
import { ingestDocument } from "@/lib/ai/ingest";
import { withUsage } from "@/lib/ai/usage";
import { checkIngest, RateLimited } from "@/lib/security/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ingest does the expensive work — OCR, contextualisation, embedding — so it
// gets the longest budget the platform allows. It is offline relative to a
// query, so none of this latency ever reaches someone waiting on an answer.
export const maxDuration = 300;

/**
 * Ingest a document (multipart file) or pasted text into a project's knowledge
 * namespace: parse -> chunk -> contextualise -> embed -> upsert.
 *
 * Membership is enforced by `loadProject`. The response reports what the parser
 * actually had to do — pages OCR'd, tables recovered, chunks contextualised — so
 * an upload is explainable in the knowledge UI rather than a bare chunk count.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await checkIngest(user.uid);

    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const project = await loadProject(user.uid, projectId);

    const file = form.get("file") as File | null;
    let filename: string;
    let parsed;

    if (file) {
      filename = file.name || "upload";
      parsed = await parseFile(
        filename,
        file.type,
        Buffer.from(await file.arrayBuffer())
      );
    } else {
      filename = String(form.get("title") ?? "Pasted note");
      parsed = parsePasted(String(form.get("text") ?? ""));
    }

    if (!documentText(parsed).trim()) {
      return NextResponse.json(
        { error: "No readable text found in the document." },
        { status: 400 }
      );
    }

    // Contextualisation and vision are Claude calls, so this upload is attributed
    // to the uploader like any other spend.
    const result = await withUsage({ uid: user.uid, email: user.email, name: user.name }, () =>
      ingestDocument({
        namespace: project.ragNamespace,
        projectName: project.name,
        filename,
        parsed,
      })
    );

    if (result.chunksStored === 0) {
      return NextResponse.json({ error: "Nothing to index." }, { status: 400 });
    }

    return NextResponse.json({
      chunksStored: result.chunksStored,
      filename,
      project: project.name,
      docId: result.docId,
      docType: parsed.docType,
      contextualised: result.contextualised,
      pages: parsed.pageCount,
      parsing: result.stats,
    });
  } catch (err) {
    if (err instanceof UploadTooLarge) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    if (err instanceof RateLimited) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof Response) return err;
    console.error("ingest error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
