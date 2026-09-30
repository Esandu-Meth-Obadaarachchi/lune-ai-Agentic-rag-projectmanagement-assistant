import { NextResponse } from "next/server";
import { adminDb, requireUser } from "@/lib/firebase/admin";
import { loadProject, loadWorkspace } from "@/lib/ai/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/ai/anthropic";
import { recordUsage, withUsage } from "@/lib/ai/usage";
import { documentText, parseFile } from "@/lib/ai/parse";
import { MAX_BRIEF_CHARS } from "@/lib/constants";
import type Anthropic from "@anthropic-ai/sdk";
import type { Task, TaskPriority } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turn a brief (uploaded doc or pasted text) into a proposed, assigned task list.
 *
 * The AI weighs each project member's role, skills and *current open-task load*
 * so work spreads instead of piling on one person. It returns proposals only —
 * nothing is written. The client shows them for review and creates the approved
 * ones through the normal data layer. Admins/owners only.
 */

const PRIORITIES: TaskPriority[] = ["low", "med", "high", "urgent"];

interface Proposed {
  title: string;
  notes: string;
  priority: TaskPriority;
  assigneeUid: string | null;
  assigneeName: string | null;
  reason: string;
}

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

    // Membership is enforced here; then we require an admin/owner role to assign.
    const project = await loadProject(user.uid, projectId);
    const { ws } = await loadWorkspace(user.uid, project.workspaceId);
    const callerRole = ws.members.find((m) => m.uid === user.uid)?.role;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return NextResponse.json({ error: "Only an admin or owner can assign work." }, { status: 403 });
    }

    // Extract the brief text.
    const file = form.get("file") as File | null;
    let brief: string;
    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      brief = documentText(await parseFile(file.name, file.type, buffer));
    } else {
      brief = String(form.get("text") ?? "");
    }
    brief = brief.trim().slice(0, MAX_BRIEF_CHARS);
    if (!brief) return NextResponse.json({ error: "No readable brief text found." }, { status: 400 });

    // Candidate members = workspace members who can access this project.
    const accessible = ws.members.filter(
      (m) => !project.memberIds || project.memberIds.includes(m.uid)
    );
    if (accessible.length === 0) {
      return NextResponse.json({ error: "No members on this project to assign to." }, { status: 400 });
    }

    // Current open-task load per member (status != done, this project).
    const taskSnap = await adminDb().collection("tasks").where("projectId", "==", projectId).get();
    const openLoad = new Map<string, number>();
    taskSnap.docs.forEach((d) => {
      const t = d.data() as Task;
      if (t.status === "done") return;
      const id = t.assigneeId ?? null;
      if (id) openLoad.set(id, (openLoad.get(id) ?? 0) + 1);
    });

    // Merge role/skills from project.team onto each accessible member.
    const team = project.team ?? [];
    const roster = accessible.map((m) => {
      const profile = team.find((p) => p.uid === m.uid);
      return {
        uid: m.uid,
        name: m.name,
        role: profile?.role ?? "unspecified",
        skills: profile?.skills ?? [],
        notes: profile?.notes ?? "",
        openTasks: openLoad.get(m.uid) ?? 0,
      };
    });

    const rosterText = roster
      .map(
        (m) =>
          `- uid: ${m.uid} | ${m.name} | role: ${m.role} | skills: ${m.skills.join(", ") || "none listed"} | open tasks: ${m.openTasks}${m.notes ? ` | notes: ${m.notes}` : ""}`
      )
      .join("\n");

    const prompt = `You are assigning work on the project "${project.name}".

TEAM (assign only to these uids):
${rosterText}

BRIEF:
${brief}

Break the brief into concrete, independently-actionable tasks. For each task pick the single best member by role and skills, and balance workload — when skills are comparable, prefer the member with fewer open tasks. Do not overload one person.

Return ONLY a JSON array, no prose, no code fences. Each item:
{"title": "short imperative title", "notes": "one or two sentences of detail", "priority": "low|med|high|urgent", "assigneeUid": "<one uid from the team above>", "reason": "short why this person"}

Rules: assigneeUid MUST be one of the listed uids. Keep titles under 80 characters. Produce at most 25 tasks.`;

    const resp = await withUsage(
      { uid: user.uid, email: user.email, name: user.name },
      async () => {
        const r = await anthropic().messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2500,
          messages: [{ role: "user", content: prompt }],
        });
        recordUsage(CLAUDE_MODEL, r.usage);
        return r;
      }
    );
    const raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const tasks = normalise(raw, roster);
    if (tasks.length === 0) {
      return NextResponse.json({ error: "The AI did not return any tasks. Try a clearer brief." }, { status: 422 });
    }

    return NextResponse.json({ project: project.name, tasks });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("assign error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assignment failed" },
      { status: 500 }
    );
  }
}

/** Parse the model's JSON (tolerating code fences) and clamp every field to a
 *  known member + valid priority. Anything unresolved falls back to the lightest
 *  loaded member so a task is never assigned to a stranger. */
function normalise(
  raw: string,
  roster: { uid: string; name: string; openTasks: number }[]
): Proposed[] {
  const json = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    const start = json.indexOf("[");
    const end = json.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    try {
      parsed = JSON.parse(json.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const byUid = new Map(roster.map((m) => [m.uid, m]));
  const lightest = [...roster].sort((a, b) => a.openTasks - b.openTasks)[0] ?? null;

  return parsed
    .slice(0, 25)
    .map((item): Proposed | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const title = String(o.title ?? "").trim().slice(0, 120);
      if (!title) return null;
      const priority = PRIORITIES.includes(o.priority as TaskPriority)
        ? (o.priority as TaskPriority)
        : "med";
      const wanted = byUid.get(String(o.assigneeUid ?? "")) ?? lightest;
      return {
        title,
        notes: String(o.notes ?? "").trim().slice(0, 500),
        priority,
        assigneeUid: wanted?.uid ?? null,
        assigneeName: wanted?.name ?? null,
        reason: String(o.reason ?? "").trim().slice(0, 200),
      };
    })
    .filter((t): t is Proposed => t !== null);
}
