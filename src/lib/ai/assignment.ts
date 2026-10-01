/**
 * Turn a brief into an assigned task list, and later into real tasks.
 *
 * Shared by the Team tab's "Assign work with AI" modal (`/api/assign`) and the
 * chat's brief attachment (`/api/chat/brief`), so both weigh the team the same
 * way: role, skills and current open-task load.
 *
 * `proposeAssignments` writes nothing. `createAssignedTasks` is what an approved
 * proposal runs — plain code on the stored list, no model.
 */
import { adminDb } from "@/lib/firebase/admin";
import { loadProject, loadWorkspace } from "./server";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { recordUsage } from "./usage";
import { baseTaskDoc } from "./tools";
import type { AssignedTask } from "./proposals";
import { MAX_BRIEF_CHARS } from "@/lib/constants";
import type Anthropic from "@anthropic-ai/sdk";
import type { Project, Task, TaskPriority } from "@/lib/types";

const PRIORITIES: TaskPriority[] = ["low", "med", "high", "urgent"];
const MAX_TASKS = 25;

export type Proposed = AssignedTask;

export class AssignError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Split a brief into tasks and pick an assignee for each. Admins/owners only.
 * Throws `AssignError` with the status the caller should return.
 */
export async function proposeAssignments(
  uid: string,
  projectId: string,
  briefText: string
): Promise<{ project: Project; tasks: Proposed[] }> {
  // Membership is enforced here; then we require an admin/owner role to assign.
  const project = await loadProject(uid, projectId);
  const { ws } = await loadWorkspace(uid, project.workspaceId);
  const callerRole = ws.members.find((m) => m.uid === uid)?.role;
  if (callerRole !== "owner" && callerRole !== "admin") {
    throw new AssignError("Only an admin or owner can assign work.", 403);
  }

  const brief = briefText.trim().slice(0, MAX_BRIEF_CHARS);
  if (!brief) throw new AssignError("No readable brief text found.", 400);

  // Candidate members = workspace members who can access this project.
  const accessible = ws.members.filter(
    (m) => !project.memberIds || project.memberIds.includes(m.uid)
  );
  if (accessible.length === 0) {
    throw new AssignError("No members on this project to assign to.", 400);
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
      photo: m.photoURL ?? null,
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

Rules: assigneeUid MUST be one of the listed uids. Keep titles under 80 characters. Produce at most ${MAX_TASKS} tasks.`;

  const resp = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    // 25 tasks with notes and reasons runs past 2500 tokens and truncates the
    // JSON, which parses as nothing.
    max_tokens: 4500,
    messages: [{ role: "user", content: prompt }],
  });
  recordUsage(CLAUDE_MODEL, resp.usage);
  const raw = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const tasks = normalise(raw, roster);
  if (tasks.length === 0) {
    throw new AssignError("The AI did not return any tasks. Try a clearer brief.", 422);
  }
  return { project, tasks };
}

/** Parse the model's JSON (tolerating code fences) and clamp every field to a
 *  known member + valid priority. Anything unresolved falls back to the lightest
 *  loaded member so a task is never assigned to a stranger. */
function normalise(
  raw: string,
  roster: { uid: string; name: string; photo: string | null; openTasks: number }[]
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
    .slice(0, MAX_TASKS)
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
        assigneePhoto: wanted?.photo ?? null,
        reason: String(o.reason ?? "").trim().slice(0, 200),
      };
    })
    .filter((t): t is Proposed => t !== null);
}

/** Write an approved assignment list as real tasks. */
export async function createAssignedTasks(options: {
  uid: string;
  userName: string;
  project: Project;
  workspaceMemberIds: string[];
  assignments: AssignedTask[];
}): Promise<{ count: number; summary: Record<string, unknown>[] }> {
  const { uid, userName, project, workspaceMemberIds, assignments } = options;
  const target = {
    id: project.id,
    name: project.name,
    ragNamespace: project.ragNamespace,
    workspaceId: project.workspaceId,
    // Same access list the Team tab gives a task it creates.
    memberIds: project.memberIds ?? workspaceMemberIds,
  };
  let order = Date.now();
  const summary: Record<string, unknown>[] = [];

  for (const a of assignments) {
    const base = baseTaskDoc({ uid, userName }, target, {
      title: a.title,
      parentId: null,
      priority: a.priority,
      order: order++,
    });
    // baseTaskDoc assigns to the author; this overrides it with the pick, or
    // clears it when the model left the task unassigned.
    const name = a.assigneeName ?? "Member";
    const doc = {
      ...base,
      notes: a.notes,
      assignees: a.assigneeUid
        ? [{ id: a.assigneeUid, name, avatar: a.assigneePhoto ?? null }]
        : [],
      assigneeId: a.assigneeUid,
      assigneeName: a.assigneeUid ? name : null,
      assigneeAvatar: a.assigneeUid ? a.assigneePhoto ?? null : null,
    };
    const ref = await adminDb().collection("tasks").add(doc);
    summary.push({
      id: ref.id,
      title: doc.title,
      status: doc.status,
      priority: doc.priority,
      due: doc.dueDate,
      project: project.name,
      assignee: a.assigneeName,
      parent: null,
    });
  }
  return { count: summary.length, summary };
}
