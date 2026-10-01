import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { AssignError, proposeAssignments } from "@/lib/ai/assignment";
import { createProposal } from "@/lib/ai/proposals";
import { audit } from "@/lib/ai/audit";
import { withUsage } from "@/lib/ai/usage";
import { documentText, parseFile, UploadTooLarge } from "@/lib/ai/parse";
import { checkChat, RateLimited } from "@/lib/security/limits";
import { MAX_BRIEF_CHARS } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A brief attached to the chat: read it, split it into tasks, pick an assignee
 * for each from the project's roles and workload, and hold the result for the
 * user's approval.
 *
 * Nothing is created here. The proposal carries the exact assigned list, and
 * approving it goes through `/api/proposals/[id]` like any other held plan —
 * no model runs on approve, so what the user saw is what gets written.
 *
 * Deliberately not an agent turn: the work is one fixed pipeline (parse, one
 * model call, one proposal), and routing it through the tool loop would add
 * round trips and let the model improvise around the approval gate.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await checkChat(user.uid);
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    if (!projectId) {
      return NextResponse.json(
        { error: "Open a project first so I know whose team to assign to." },
        { status: 400 }
      );
    }

    // The file is the brief; any typed text rides along as extra instructions.
    const file = form.get("file") as File | null;
    const note = String(form.get("text") ?? "").trim();
    const fromFile = file
      ? documentText(await parseFile(file.name, file.type, Buffer.from(await file.arrayBuffer())))
      : "";
    const brief = [fromFile.trim(), note].filter(Boolean).join("\n\nExtra instructions:\n");
    if (!brief) {
      return NextResponse.json({ error: "No readable text found in that file." }, { status: 400 });
    }

    const { project, tasks } = await withUsage(
      { uid: user.uid, email: user.email, name: user.name },
      () => proposeAssignments(user.uid, projectId, brief.slice(0, MAX_BRIEF_CHARS))
    );

    const proposal = await createProposal({
      uid: user.uid,
      kind: "assign_tasks",
      payload: { tasks: [], assignments: tasks },
      projectId: project.id,
      projectName: project.name,
      summary: `Create and assign ${tasks.length} tasks in ${project.name}`,
    });
    audit(user.uid, "propose_assignments", { project: project.name, count: tasks.length }, "approval");

    const people = new Set(tasks.map((t) => t.assigneeName).filter(Boolean)).size;
    return NextResponse.json({
      answer: `I split ${file ? `**${file.name}**` : "the brief"} into ${tasks.length} task${tasks.length === 1 ? "" : "s"} for ${project.name}, spread across ${people} ${people === 1 ? "person" : "people"} by role, skills and current workload. Nothing is created until you approve it below.`,
      steps: [`read brief (${brief.length} chars)`, `proposed ${tasks.length} assigned tasks`],
      cards: [
        {
          kind: "assign_approval",
          data: {
            proposalId: proposal.id,
            project: project.name,
            count: tasks.length,
            tasks: tasks.map((t) => ({
              title: t.title,
              priority: t.priority,
              assignee: t.assigneeName,
              reason: t.reason,
            })),
          },
        },
      ],
    });
  } catch (err) {
    if (err instanceof RateLimited) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof UploadTooLarge) return NextResponse.json({ error: err.message }, { status: 413 });
    if (err instanceof AssignError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Response) return err;
    console.error("brief error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the brief" },
      { status: 500 }
    );
  }
}
