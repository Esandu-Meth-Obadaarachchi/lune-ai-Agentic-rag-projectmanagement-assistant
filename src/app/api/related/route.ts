import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { loadProject } from "@/lib/ai/server";
import { retrieveAndRerank } from "@/lib/ai/retrieval";
import type { RetrievedChunk } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Smart linking: given a task's project and a query, return related knowledge.
 *
 * This runs beside the task drawer while the user is reading, so it uses the
 * "related" profile — no query rewrite, no grading, one chunk per document. It
 * has to be fast, and it has to show three different documents rather than three
 * paragraphs of one.
 *
 * Best-effort by design: a failure here returns an empty list rather than an
 * error, because a missing suggestion panel is a non-event and a red banner
 * beside a task is not.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { projectId, query } = (await req.json()) as { projectId?: string; query?: string };
    if (!projectId || !query) {
      return NextResponse.json({ error: "projectId and query are required" }, { status: 400 });
    }
    const project = await loadProject(user.uid, projectId);

    let chunks: RetrievedChunk[];
    try {
      chunks = await retrieveAndRerank([project.ragNamespace], query, undefined, "related");
    } catch {
      chunks = [];
    }
    return NextResponse.json({ chunks });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("related error", err);
    return NextResponse.json({ chunks: [] });
  }
}
