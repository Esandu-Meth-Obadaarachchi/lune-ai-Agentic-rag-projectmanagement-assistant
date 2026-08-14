import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase/client";
import { PROJECT_COLORS, slugStatus } from "@/lib/constants";
import type {
  AgentCard,
  Assignee,
  Chat,
  ChatMessage,
  DayPlan,
  Page,
  Presence,
  Project,
  RetrievedChunk,
  Sprint,
  Task,
  Whiteboard,
  Workspace,
  WorkspaceMember,
} from "@/lib/types";
import { slugifyNamespace } from "./tree";

/**
 * Firestore access layer. Three top-level collections keep security rules and
 * `array-contains` isolation queries simple:
 *   workspaces / projects / tasks
 * Every doc carries `memberIds` so rules can gate reads/writes by membership
 * without a cross-document get() on the hot path.
 */

function requireDb() {
  if (!db) throw new Error("Firestore is not configured.");
  return db;
}

/* ------------------------------ watchers ------------------------------ */

export function watchWorkspaces(uid: string, cb: (ws: Workspace[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "workspaces"), where("memberIds", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Workspace, "id">) }));
    rows.sort((a, b) => a.createdAt - b.createdAt);
    cb(rows);
  });
}

// NOTE: Firestore "rules are not filters" — a list query must itself be
// constrained to what the rules allow. Our rules gate on `memberIds`, so every
// listener filters by `memberIds array-contains uid` (matching the workspaces
// query) and narrows by workspace/project client-side. Filtering by
// workspaceId/projectId alone returns 403 PERMISSION_DENIED.
export function watchProjects(
  uid: string,
  workspaceId: string,
  cb: (p: Project[]) => void
): Unsubscribe {
  const q = query(collection(requireDb(), "projects"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Project, "id">) }))
        .filter((p) => p.workspaceId === workspaceId);
      rows.sort((a, b) => a.createdAt - b.createdAt);
      cb(rows);
    },
    (err) => console.error("watchProjects error", err)
  );
}

export function watchTasks(uid: string, projectId: string, cb: (t: Task[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "tasks"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Task, "id">) }))
        .filter((t) => t.projectId === projectId);
      cb(rows);
    },
    (err) => console.error("watchTasks error", err)
  );
}

/** Every project the user can see across all workspaces — powers the all-workspaces board. */
export function watchAllProjects(uid: string, cb: (p: Project[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "projects"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Project, "id">) }))),
    (err) => console.error("watchAllProjects error", err)
  );
}

/** Every task the user can see — powers the cross-project daily standup. */
export function watchAllTasks(uid: string, cb: (t: Task[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "tasks"), where("memberIds", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Task, "id">) })));
  });
}

/* ------------------------------ workspaces ------------------------------ */

export async function createWorkspace(user: User, name: string, emoji: string): Promise<string> {
  const member: WorkspaceMember = {
    uid: user.uid,
    name: user.displayName ?? "You",
    email: user.email ?? "",
    photoURL: user.photoURL,
    role: "owner",
  };
  const ref = await addDoc(collection(requireDb(), "workspaces"), {
    name,
    emoji,
    ownerId: user.uid,
    memberIds: [user.uid],
    members: [member],
    createdAt: Date.now(),
  } satisfies Omit<Workspace, "id">);
  return ref.id;
}

/* ------------------------------ projects ------------------------------ */

export async function createProject(
  workspace: Workspace,
  name: string,
  opts: { description?: string; colorIndex?: number; isInbox?: boolean } = {}
): Promise<string> {
  const color = opts.isInbox
    ? "#6b7280"
    : PROJECT_COLORS[(opts.colorIndex ?? Math.floor(Math.random() * PROJECT_COLORS.length)) % PROJECT_COLORS.length];
  const ref = await addDoc(collection(requireDb(), "projects"), {
    workspaceId: workspace.id,
    name,
    description: opts.description ?? "",
    ragNamespace: slugifyNamespace(`${workspace.name}-${name}`),
    color,
    archived: false,
    isInbox: opts.isInbox ?? false,
    createdAt: Date.now(),
    // denormalised for rules. Only full-access members (scope == null) inherit a
    // newly created project; project-scoped teammates are added explicitly.
    memberIds: fullAccessUids(workspace),
  } as Omit<Project, "id"> & { memberIds: string[] });
  return ref.id;
}

/** uids of workspace members with whole-workspace access (no project scope). */
export function fullAccessUids(workspace: Workspace): string[] {
  if (!workspace.members?.length) return workspace.memberIds;
  return workspace.members.filter((m) => m.scope == null).map((m) => m.uid);
}

export async function updateProject(id: string, patch: Partial<Project>) {
  await updateDoc(doc(requireDb(), "projects", id), patch);
}

/** Add a custom status column to a project (built-ins stay; this appends). */
export async function addCustomStatus(project: Project, label: string, color: string) {
  const existing = project.customStatuses ?? [];
  const id = slugStatus(label, existing);
  const next = [...existing, { id, label: label.trim(), color }];
  await updateDoc(doc(requireDb(), "projects", project.id), { customStatuses: next });
}

/** Remove a custom status. Any task still in it is moved back to To Do so no task
 *  is left stranded in a column that no longer exists. Built-ins are never passed. */
export async function deleteCustomStatus(project: Project, statusId: string, tasks: Task[]) {
  const database = requireDb();
  const stranded = tasks.filter((t) => t.projectId === project.id && t.status === statusId);
  const next = (project.customStatuses ?? []).filter((c) => c.id !== statusId);
  const batch = writeBatch(database);
  stranded.forEach((t) => batch.update(doc(database, "tasks", t.id), { status: "todo", updatedAt: Date.now() }));
  batch.update(doc(database, "projects", project.id), { customStatuses: next });
  await batch.commit();
}

/** Add a label to a project's tag palette (the set every task can pick from). */
export async function addProjectTag(id: string, tag: string) {
  await updateDoc(doc(requireDb(), "projects", id), { tags: arrayUnion(tag) });
}

/** Remove a label from a project's palette. Tasks that already use it keep it. */
export async function removeProjectTag(id: string, tag: string) {
  await updateDoc(doc(requireDb(), "projects", id), { tags: arrayRemove(tag) });
}

/**
 * Guarantee a workspace has exactly one Inbox, healing any duplicates.
 *
 * Duplicate inboxes appeared when two tabs/devices each saw "no inbox yet"
 * (before the create's snapshot arrived) and both created one. This reads the
 * live set from Firestore (not the possibly-stale in-memory snapshot), keeps the
 * oldest inbox as canonical, moves stray tasks onto it and deletes the extras.
 * An in-flight guard stops the same tab from racing itself.
 */
const inboxInFlight = new Map<string, Promise<string>>();

export async function ensureInbox(workspace: Workspace, uid: string): Promise<string> {
  const existing = inboxInFlight.get(workspace.id);
  if (existing) return existing;

  const run = (async () => {
    const database = requireDb();
    const snap = await getDocs(
      query(collection(database, "projects"), where("memberIds", "array-contains", uid))
    );
    const inboxes = snap.docs
      .filter((d) => d.data().workspaceId === workspace.id && d.data().isInbox)
      .sort((a, b) => (a.data().createdAt ?? 0) - (b.data().createdAt ?? 0));

    if (inboxes.length === 0) {
      return createProject(workspace, "Inbox", {
        isInbox: true,
        description: "Loose tasks not tied to a project",
      });
    }

    const canonical = inboxes[0];
    const dupes = inboxes.slice(1);
    if (dupes.length === 0) return canonical.id;

    // Merge: repoint every task on a duplicate inbox to the canonical one, then
    // delete the duplicate project docs.
    const dupeIds = new Set(dupes.map((d) => d.id));
    const taskSnap = await getDocs(
      query(collection(database, "tasks"), where("memberIds", "array-contains", uid))
    );
    const strays = taskSnap.docs.filter((d) => dupeIds.has(d.data().projectId));

    const batch = writeBatch(database);
    strays.forEach((t) => batch.update(t.ref, { projectId: canonical.id, updatedAt: Date.now() }));
    dupes.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return canonical.id;
  })();

  inboxInFlight.set(workspace.id, run);
  try {
    return await run;
  } finally {
    inboxInFlight.delete(workspace.id);
  }
}

/**
 * Delete a workspace and everything under it (projects + tasks). Queries by
 * `memberIds` (the only rule-satisfying list filter), narrows by workspace, then
 * batch-deletes in chunks of 400 to stay under the 500-op batch limit.
 */
export async function deleteWorkspace(uid: string, workspaceId: string) {
  const database = requireDb();
  const [projSnap, taskSnap] = await Promise.all([
    getDocs(query(collection(database, "projects"), where("memberIds", "array-contains", uid))),
    getDocs(query(collection(database, "tasks"), where("memberIds", "array-contains", uid))),
  ]);

  const refs = [
    ...projSnap.docs.filter((d) => d.data().workspaceId === workspaceId).map((d) => d.ref),
    ...taskSnap.docs.filter((d) => d.data().workspaceId === workspaceId).map((d) => d.ref),
    doc(database, "workspaces", workspaceId),
  ];

  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(database);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export async function deleteProject(id: string, tasks: Task[]) {
  const batch = writeBatch(requireDb());
  tasks.filter((t) => t.projectId === id).forEach((t) => batch.delete(doc(requireDb(), "tasks", t.id)));
  batch.delete(doc(requireDb(), "projects", id));
  await batch.commit();
}

/** Delete a project + all its tasks, fetching the tasks itself (works for any project). */
export async function deleteProjectDeep(uid: string, projectId: string) {
  const database = requireDb();
  const taskSnap = await getDocs(
    query(collection(database, "tasks"), where("memberIds", "array-contains", uid))
  );
  const refs = [
    ...taskSnap.docs.filter((d) => d.data().projectId === projectId).map((d) => d.ref),
    doc(database, "projects", projectId),
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(database);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/* ------------------------------ tasks ------------------------------ */

export interface NewTaskInput {
  workspaceId: string;
  projectId: string;
  parentId?: string | null;
  title: string;
  memberIds: string[];
  createdBy: string;
  status?: Task["status"];
  priority?: Task["priority"];
  notes?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  dueEndTime?: string | null;
  order?: number;
  assignee?: { id: string; name: string; avatar?: string | null } | null;
  sprintId?: string | null;
  estimate?: number | null;
}

export async function createTask(input: NewTaskInput): Promise<string> {
  const now = Date.now();
  const task: Omit<Task, "id"> & { memberIds: string[] } = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    title: input.title,
    notes: input.notes ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? "med",
    assignees: input.assignee
      ? [{ id: input.assignee.id, name: input.assignee.name, avatar: input.assignee.avatar ?? null }]
      : [],
    assigneeId: input.assignee?.id ?? null,
    assigneeName: input.assignee?.name ?? null,
    assigneeAvatar: input.assignee?.avatar ?? null,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    dueEndTime: input.dueEndTime ?? null,
    startDate: null,
    tags: [],
    dependencies: [],
    linkedDocs: [],
    recurrence: null,
    timeEntries: [],
    googleEventId: null,
    sprintId: input.sprintId ?? null,
    estimate: input.estimate ?? null,
    completedAt: null,
    order: input.order ?? now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    memberIds: input.memberIds,
  };
  const ref = await addDoc(collection(requireDb(), "tasks"), task);
  return ref.id;
}

/**
 * Stamp `completedAt` alongside a status change. `updatedAt` moves on every
 * edit, so it cannot answer "what did this person ship last week" — that needs
 * its own timestamp. Applied here rather than at each call site because status
 * is also written by the board drag and by the agent's tools.
 */
function withCompletion(patch: Partial<Task>): Record<string, unknown> {
  if (patch.status === undefined || patch.completedAt !== undefined) return { ...patch };
  return { ...patch, completedAt: patch.status === "done" ? Date.now() : null };
}

export async function updateTask(id: string, patch: Partial<Task>) {
  await updateDoc(doc(requireDb(), "tasks", id), {
    ...withCompletion(patch),
    updatedAt: Date.now(),
  });
}

/** Delete a task and all of its descendants in one batch. */
export async function deleteTaskTree(ids: string[]) {
  const batch = writeBatch(requireDb());
  ids.forEach((id) => batch.delete(doc(requireDb(), "tasks", id)));
  await batch.commit();
}

/**
 * Put deleted tasks back, ids and all. Undo for a delete, without the
 * soft-delete plumbing (a `deletedAt` field would need every watcher, rule and
 * query in the app to learn about it). Writing back to the same document ids
 * keeps parentId links inside a restored subtree intact.
 */
export async function restoreTasks(tasks: Task[]) {
  if (!tasks.length) return;
  const database = requireDb();
  const batch = writeBatch(database);
  tasks.forEach(({ id, ...data }) => batch.set(doc(database, "tasks", id), data));
  await batch.commit();
}

/** Persist a re-ordered / re-parented set of tasks after a drag. */
export async function commitTaskMoves(moves: { id: string; order: number; parentId?: string | null; status?: Task["status"] }[]) {
  const batch = writeBatch(requireDb());
  const now = Date.now();
  moves.forEach((m) => {
    const patch: Record<string, unknown> = { order: m.order, updatedAt: now };
    if (m.parentId !== undefined) patch.parentId = m.parentId;
    if (m.status !== undefined) {
      patch.status = m.status;
      patch.completedAt = m.status === "done" ? now : null;
    }
    batch.update(doc(requireDb(), "tasks", m.id), patch);
  });
  await batch.commit();
}

/**
 * Apply a batch of assignee changes in one write. The legacy single-assignee
 * fields are kept mirroring the first entry so anything still reading
 * `assigneeId` (print view, older data, the members board grouping) stays
 * correct. Used by the members board for drag, and by its undo.
 */
export async function commitAssignments(changes: { id: string; after: Assignee[] }[]) {
  if (!changes.length) return;
  const database = requireDb();
  const batch = writeBatch(database);
  const now = Date.now();
  changes.forEach(({ id, after }) => {
    const first = after[0] ?? null;
    batch.update(doc(database, "tasks", id), {
      assignees: after,
      assigneeId: first?.id ?? null,
      assigneeName: first?.name ?? null,
      assigneeAvatar: first?.avatar ?? null,
      updatedAt: now,
    });
  });
  await batch.commit();
}

/* ------------------------------ sprints ------------------------------ */

/** Sprints of one project, newest first. */
export function watchSprints(uid: string, projectId: string, cb: (s: Sprint[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "sprints"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Sprint, "id">) }))
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      cb(rows);
    },
    (err) => console.error("watchSprints error", err)
  );
}

export async function createSprint(
  project: Project,
  input: { name: string; goal?: string; startDate: string; endDate: string }
): Promise<string> {
  const ref = await addDoc(collection(requireDb(), "sprints"), {
    workspaceId: project.workspaceId,
    projectId: project.id,
    name: input.name.trim(),
    goal: input.goal?.trim() ?? "",
    startDate: input.startDate,
    endDate: input.endDate,
    status: "planned",
    createdAt: Date.now(),
    completedAt: null,
    committedPoints: null,
    memberIds: project.memberIds ?? [],
  } satisfies Omit<Sprint, "id">);
  return ref.id;
}

export async function updateSprint(id: string, patch: Partial<Sprint>) {
  await updateDoc(doc(requireDb(), "sprints", id), patch);
}

/**
 * Start a sprint. Only one sprint per project runs at a time, so any other
 * active sprint is closed first. The committed point total is frozen here: work
 * added later must not rewrite what the team promised at planning.
 */
export async function startSprint(sprint: Sprint, tasks: Task[], siblings: Sprint[]) {
  const database = requireDb();
  const batch = writeBatch(database);
  const committed = tasks
    .filter((t) => t.sprintId === sprint.id)
    .reduce((sum, t) => sum + (t.estimate ?? 0), 0);
  siblings
    .filter((s) => s.id !== sprint.id && s.status === "active")
    .forEach((s) =>
      batch.update(doc(database, "sprints", s.id), { status: "completed", completedAt: Date.now() })
    );
  batch.update(doc(database, "sprints", sprint.id), { status: "active", committedPoints: committed });
  await batch.commit();
}

/**
 * Close a sprint and decide what happens to work left open in it.
 * `backlog` clears the sprint so the task returns to the backlog; a sprint id
 * rolls it into that sprint. Completed tasks always stay attached, otherwise
 * the velocity history would rewrite itself every time a sprint closed.
 */
export async function completeSprint(sprintId: string, tasks: Task[], carryTo: string | "backlog") {
  const database = requireDb();
  const batch = writeBatch(database);
  const now = Date.now();
  tasks
    .filter((t) => t.sprintId === sprintId && t.status !== "done")
    .forEach((t) =>
      batch.update(doc(database, "tasks", t.id), {
        sprintId: carryTo === "backlog" ? null : carryTo,
        updatedAt: now,
      })
    );
  batch.update(doc(database, "sprints", sprintId), { status: "completed", completedAt: now });
  await batch.commit();
}

/** Delete a sprint. Its tasks return to the backlog rather than disappearing. */
export async function deleteSprint(sprintId: string, tasks: Task[]) {
  const database = requireDb();
  const batch = writeBatch(database);
  const now = Date.now();
  tasks
    .filter((t) => t.sprintId === sprintId)
    .forEach((t) => batch.update(doc(database, "tasks", t.id), { sprintId: null, updatedAt: now }));
  batch.delete(doc(database, "sprints", sprintId));
  await batch.commit();
}

/** Move tasks into a sprint, or out to the backlog when `sprintId` is null. */
export async function assignTasksToSprint(taskIds: string[], sprintId: string | null) {
  if (!taskIds.length) return;
  const database = requireDb();
  const batch = writeBatch(database);
  const now = Date.now();
  taskIds.forEach((id) => batch.update(doc(database, "tasks", id), { sprintId, updatedAt: now }));
  await batch.commit();
}

/* ------------------------------ pages ------------------------------ */

/** Every page the user can see in a workspace (metadata + content). */
export function watchPages(uid: string, workspaceId: string, cb: (p: Page[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "pages"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Page, "id">) }))
        .filter((p) => p.workspaceId === workspaceId);
      rows.sort((a, b) => a.order - b.order);
      cb(rows);
    },
    (err) => console.error("watchPages error", err)
  );
}

/** Live-watch a single page (for the editor). */
export function watchPage(id: string, cb: (page: Page | null) => void): Unsubscribe {
  return onSnapshot(
    doc(requireDb(), "pages", id),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Page, "id">) }) : null),
    (err) => {
      console.error("watchPage error", err);
      cb(null);
    }
  );
}

export async function createPage(
  workspace: Workspace,
  opts: { projectId?: string | null; parentId?: string | null; title?: string; memberIds?: string[] } = {}
): Promise<string> {
  const now = Date.now();
  const page: Omit<Page, "id"> = {
    workspaceId: workspace.id,
    projectId: opts.projectId ?? null,
    parentId: opts.parentId ?? null,
    title: opts.title ?? "Untitled",
    icon: "",
    content: "",
    order: now,
    createdAt: now,
    updatedAt: now,
    createdBy: workspace.ownerId,
    // Project pages inherit the project's members; workspace pages the whole ws.
    memberIds: opts.memberIds ?? workspace.memberIds,
  };
  const ref = await addDoc(collection(requireDb(), "pages"), page);
  return ref.id;
}

export async function updatePage(id: string, patch: Partial<Page>) {
  await updateDoc(doc(requireDb(), "pages", id), { ...patch, updatedAt: Date.now() });
}

/** Delete a page and all of its descendant pages. */
export async function deletePageTree(uid: string, pageId: string) {
  const database = requireDb();
  const snap = await getDocs(query(collection(database, "pages"), where("memberIds", "array-contains", uid)));
  const all = snap.docs.map((d) => ({ id: d.id, parentId: d.get("parentId") as string | null, ref: d.ref }));
  const ids = new Set<string>();
  const walk = (pid: string) => {
    ids.add(pid);
    all.filter((p) => p.parentId === pid).forEach((c) => walk(c.id));
  };
  walk(pageId);
  const refs = all.filter((p) => ids.has(p.id)).map((p) => p.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(database);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/* ------------------------------ day planner ------------------------------ */

/** Live-watch the user's notebook for a given day (yyyy-mm-dd). */
export function watchDayPlan(uid: string, date: string, cb: (content: string) => void): Unsubscribe {
  const ref = doc(requireDb(), "dayPlans", `${uid}_${date}`);
  return onSnapshot(
    ref,
    (snap) => cb(((snap.data() as DayPlan | undefined)?.content) ?? ""),
    (err) => console.error("watchDayPlan error", err)
  );
}

/** Upsert the user's notebook for a given day. */
export async function saveDayPlan(uid: string, date: string, content: string) {
  const ref = doc(requireDb(), "dayPlans", `${uid}_${date}`);
  await setDoc(ref, {
    uid,
    date,
    content,
    updatedAt: Date.now(),
    memberIds: [uid],
  } satisfies Omit<DayPlan, "id">);
}

/* ------------------------------ whiteboard ------------------------------ */

/** Live-watch a project's whiteboard scene (JSON string, or null if empty). */
export function watchWhiteboard(projectId: string, cb: (scene: string | null) => void): Unsubscribe {
  const ref = doc(requireDb(), "whiteboards", projectId);
  return onSnapshot(
    ref,
    (snap) => cb(((snap.data() as Whiteboard | undefined)?.scene) ?? null),
    (err) => {
      // Never leave the canvas hanging on a read error — fall back to empty.
      console.error("watchWhiteboard error", err);
      cb(null);
    }
  );
}

/** Upsert a project's whiteboard scene. */
export async function saveWhiteboard(projectId: string, memberIds: string[], scene: string) {
  const ref = doc(requireDb(), "whiteboards", projectId);
  await setDoc(ref, {
    projectId,
    scene,
    memberIds,
    updatedAt: Date.now(),
  } satisfies Omit<Whiteboard, "id">);
}

/* ------------------------------ first-run seed ------------------------------ */

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Seed a brand-new user with a single sandbox workspace ("Test it out") holding
 * two demo projects, so the switcher, board and standup have something to show
 * without cluttering the account. Runs once (guarded by an empty-workspace check
 * upstream). Everything is written in a single batch.
 */
export async function seedNewUser(user: User): Promise<string> {
  const database = requireDb();
  const batch = writeBatch(database);
  const now = Date.now();
  const member: WorkspaceMember = {
    uid: user.uid,
    name: user.displayName ?? "You",
    email: user.email ?? "",
    photoURL: user.photoURL,
    role: "owner",
  };
  const base = { memberIds: [user.uid], members: [member], ownerId: user.uid };

  const ws = (name: string, emoji: string, createdAt: number) => {
    const ref = doc(collection(database, "workspaces"));
    batch.set(ref, { name, emoji, createdAt, ...base } satisfies Omit<Workspace, "id">);
    return ref;
  };
  const proj = (
    wsRef: { id: string },
    name: string,
    description: string,
    color: string,
    wsName: string,
    isInbox = false
  ) => {
    const ref = doc(collection(database, "projects"));
    batch.set(ref, {
      workspaceId: wsRef.id,
      name,
      description,
      ragNamespace: slugifyNamespace(`${wsName}-${name}`),
      color,
      archived: false,
      isInbox,
      createdAt: now,
      memberIds: [user.uid],
    });
    return ref;
  };
  let orderSeed = now;
  const task = (
    wsRef: { id: string },
    projRef: { id: string },
    title: string,
    opts: Partial<Task> & { parentRef?: { id: string } } = {}
  ) => {
    const ref = doc(collection(database, "tasks"));
    const { parentRef, ...rest } = opts;
    batch.set(ref, {
      workspaceId: wsRef.id,
      projectId: projRef.id,
      parentId: parentRef?.id ?? null,
      title,
      notes: "",
      status: "todo",
      priority: "med",
      assigneeId: user.uid,
      assigneeName: member.name,
      assigneeAvatar: member.photoURL,
      dueDate: null,
      startDate: null,
      tags: [],
      dependencies: [],
      linkedDocs: [],
      order: orderSeed++,
      createdAt: now,
      updatedAt: now,
      createdBy: user.uid,
      memberIds: [user.uid],
      ...rest,
    });
    return ref;
  };

  // --- Test it out (single sandbox workspace) ---
  const sandbox = ws("Test it out workspace", "🧪", now);
  proj(sandbox, "Inbox", "Loose tasks not tied to a project", "#6b7280", "Test it out workspace", true);

  // Project 1 — a guided tour of the features.
  const gettingStarted = proj(sandbox, "Getting started", "A quick tour — delete this whenever you like", "#f5c518", "Test it out workspace");
  task(sandbox, gettingStarted, "Create your first task", { status: "todo", priority: "high", dueDate: isoOffset(0), tags: ["start-here"] });
  task(sandbox, gettingStarted, "Try the Board, Members and Calendar views", { status: "todo", priority: "med" });
  task(sandbox, gettingStarted, "Upload a document in Knowledge", { status: "todo", priority: "med", dueDate: isoOffset(2), tags: ["start-here"] });
  task(sandbox, gettingStarted, "Ask the brain a question", { status: "in_progress", priority: "med" });

  // Project 2 — a realistic little task tree so the views have shape.
  const demo = proj(sandbox, "Demo project", "Sample tasks so the board has something to show", "#60a5fa", "Test it out workspace");
  const launch = task(sandbox, demo, "Plan the launch", { status: "in_progress", priority: "high", dueDate: isoOffset(3), tags: ["milestone"] });
  task(sandbox, demo, "Write the brief", { parentRef: launch, status: "done", priority: "med" });
  task(sandbox, demo, "Design the landing page", { parentRef: launch, status: "in_progress", priority: "high", dueDate: isoOffset(0) });
  task(sandbox, demo, "Set up analytics", { parentRef: launch, status: "todo", priority: "med", dueDate: isoOffset(4) });
  task(sandbox, demo, "Fix the sign-up bug", { status: "blocked", priority: "urgent", dueDate: isoOffset(-1), tags: ["bug"] });
  task(sandbox, demo, "Draft the release notes", { status: "todo", priority: "low", dueDate: isoOffset(5), tags: ["docs"] });

  await batch.commit();
  return sandbox.id;
}

/* ------------------------------ presence ------------------------------ */

/** Presence older than this is considered stale (a closed or crashed tab). */
export const PRESENCE_TTL_MS = 45_000;

const presenceId = (taskId: string, uid: string) => `${taskId}_${uid}`;

/** Announce (or heartbeat) that this user is viewing a task. */
export async function setPresence(
  taskId: string,
  user: { uid: string; name: string; photoURL?: string | null },
  memberIds: string[]
) {
  await setDoc(doc(requireDb(), "presence", presenceId(taskId, user.uid)), {
    taskId,
    uid: user.uid,
    name: user.name,
    photoURL: user.photoURL ?? null,
    memberIds,
    updatedAt: Date.now(),
  });
}

export async function clearPresence(taskId: string, uid: string) {
  await deleteDoc(doc(requireDb(), "presence", presenceId(taskId, uid))).catch(() => {});
}

/** Who else is on this task. Query is memberIds-constrained (rules are not
 *  filters), then narrowed to the task and to fresh heartbeats. */
export function watchPresence(uid: string, taskId: string, cb: (p: Presence[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "presence"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      cb(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Presence, "id">) }))
          .filter((p) => p.taskId === taskId && now - p.updatedAt < PRESENCE_TTL_MS)
      );
    },
    (err) => console.error("watchPresence error", err)
  );
}

/* ---------------------------- agent chat history --------------------------- */

/**
 * Live list of ALL a user's saved chats, across every workspace. Chat history is
 * global — the user can reopen any past conversation from any workspace. Single-
 * field `array-contains` query (no composite index), sorted in JS.
 */
export function watchChats(uid: string, cb: (c: Chat[]) => void): Unsubscribe {
  const q = query(collection(requireDb(), "chats"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Chat, "id">) }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    },
    (err) => console.error("watchChats error", err)
  );
}

/** Create a new chat, titled from its first message. Returns the new id. */
export async function createChat(uid: string, workspaceId: string, title: string): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(requireDb(), "chats"), {
    uid,
    workspaceId,
    title: title.trim().slice(0, 80) || "New chat",
    createdAt: now,
    updatedAt: now,
    memberIds: [uid],
  } as Omit<Chat, "id">);
  return ref.id;
}

/** Bump a chat's updatedAt (so it sorts to the top), optionally retitling it. */
export async function touchChat(chatId: string, patch: { title?: string } = {}): Promise<void> {
  await updateDoc(doc(requireDb(), "chats", chatId), { updatedAt: Date.now(), ...patch });
}

/** Delete a chat and all of its messages in one batch. Queries by memberIds (the
 *  only rule-satisfying list filter) and narrows to the chat in JS — a chatId-only
 *  query is rejected by the rules (rules are not filters). */
export async function deleteChat(uid: string, chatId: string): Promise<void> {
  const database = requireDb();
  const msgs = await getDocs(
    query(collection(database, "chatMessages"), where("memberIds", "array-contains", uid))
  );
  const batch = writeBatch(database);
  msgs.docs.filter((d) => d.get("chatId") === chatId).forEach((d) => batch.delete(d.ref));
  batch.delete(doc(database, "chats", chatId));
  await batch.commit();
}

/**
 * Persist one turn. Cards are serialised to JSON (their `data` is loosely typed
 * and may nest arrays, which Firestore rejects as native fields — the same
 * trick whiteboards use for Excalidraw scenes).
 */
export async function addChatMessage(chatId: string, uid: string, msg: ChatMessage): Promise<void> {
  await addDoc(collection(requireDb(), "chatMessages"), {
    chatId,
    uid,
    role: msg.role,
    content: msg.content,
    steps: msg.steps ?? [],
    sources: msg.sources ?? [],
    cardsJson: msg.cards ? JSON.stringify(msg.cards) : "",
    createdAt: msg.createdAt,
    memberIds: [uid],
  });
}

/** Load a chat's turns in order. Queries by memberIds (the only rule-satisfying
 *  list filter), then narrows to this chat and sorts in JS. A chatId-only query is
 *  rejected by the rules (rules are not filters), which is what left chats blank. */
export async function loadChatMessages(uid: string, chatId: string): Promise<ChatMessage[]> {
  const snap = await getDocs(
    query(collection(requireDb(), "chatMessages"), where("memberIds", "array-contains", uid))
  );
  return snap.docs
    .filter((d) => d.get("chatId") === chatId)
    .map((d) => {
      const data = d.data() as {
        role: "user" | "assistant";
        content: string;
        steps?: string[];
        sources?: RetrievedChunk[];
        cardsJson?: string;
        createdAt: number;
      };
      return {
        id: d.id,
        role: data.role,
        content: data.content,
        steps: data.steps,
        sources: data.sources,
        cards: data.cardsJson ? (JSON.parse(data.cardsJson) as AgentCard[]) : undefined,
        createdAt: data.createdAt,
      } satisfies ChatMessage;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}
