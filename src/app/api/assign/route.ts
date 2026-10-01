import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { AssignError, proposeAssignments } from "@/lib/ai/assignment";
import { withUsage } from "@/lib/ai/usage";
import { documentText, parseFile } from "@/lib/ai/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turn a brief (uploaded doc or pasted text) into a proposed, assigned task list.
 *
 * The AI weighs each project member's role, skills and *current open-task load*
 * so work spreads instead of piling on one person. It returns proposals only —
 * nothing is written. The client shows them for review and creates the approved
 * ones through the normal data layer. Admins/owners only. The logic lives in
 * `lib/ai/assignment.ts`, shared with the chat's brief attachment.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Accept a file (multipart) or pasted text (multipart field). Either way the
    // client sends FormData so one handler covers both.
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const file = form.get("file") as File | null;
    const brief = file
      ? documentText(await parseFile(file.name, file.type, Buffer.from(await file.arrayBuffer())))
      : String(form.get("text") ?? "");

    const { project, tasks } = await withUsage(
      { uid: user.uid, email: user.email, name: user.name },
      () => proposeAssignments(user.uid, projectId, brief)
    );
    return NextResponse.json({ project: project.name, tasks });
  } catch (err) {
    if (err instanceof AssignError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Response) return err;
    console.error("assign error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assignment failed" },
      { status: 500 }
    );
  }
}
