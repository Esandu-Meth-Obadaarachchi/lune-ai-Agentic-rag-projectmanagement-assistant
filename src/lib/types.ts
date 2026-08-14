/**
 * Core domain model. Mirrors second-brain-app-spec.md §3.
 *
 *   Workspace (per business) -> Project (shares a RAG namespace)
 *     -> Task -> Subtask (recursive via parentId)
 *
 * Knowledge (RAG docs) and Execution (tasks) share the same project, so a task
 * can pull context from its project's knowledge base.
 */

/**
 * The four built-in statuses are always present. A project may add its own on top
 * (e.g. "to-be-reviewed"), so the stored value is any string — the `(string & {})`
 * keeps autocomplete for the built-ins while allowing custom ids. Only "done" ever
 * counts as complete (overdue / standup / done-lines all key off it).
 */
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | (string & {});
export type TaskPriority = "low" | "med" | "high" | "urgent";

/** A project-defined status column added on top of the four built-ins. */
export interface CustomStatus {
  /** Stable slug used as Task.status, e.g. "to-be-reviewed". */
  id: string;
  label: string;
  /** Raw hex, e.g. "#22d3ee" — custom statuses are not tied to a Tailwind token. */
  color: string;
}
export type MemberRole = "owner" | "admin" | "member" | "client-viewer";

export interface WorkspaceMember {
  uid: string;
  name: string;
  email: string;
  photoURL?: string | null;
  role: MemberRole;
  /**
   * Project scope. `null`/absent => access to the whole workspace (and any
   * project added later). An array => access limited to exactly these project
   * ids. The owner is always full-access.
   */
  scope?: string[] | null;
}

/** A pending share invitation, keyed by the invitee's email. Server-managed. */
export interface Invite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceEmoji: string;
  /** lower-cased invitee email. */
  email: string;
  role: MemberRole;
  /** null => whole workspace; array => specific project ids. */
  scope: string[] | null;
  invitedByUid: string;
  invitedByName: string;
  createdAt: number;
  status: "pending" | "accepted" | "declined";
}

export interface Workspace {
  id: string;
  name: string;
  emoji: string;
  ownerId: string;
  /** uids with any access — used for Firestore `array-contains` isolation queries. */
  memberIds: string[];
  members: WorkspaceMember[];
  createdAt: number;
}

/**
 * A member's working profile on a specific project. Set by an admin/owner on the
 * project's Team tab and used by the AI to assign work. Lives on the project (not
 * the workspace) because the same person can be, say, backend on one project and
 * full stack on another. `uid` must be one of the project's members.
 */
export interface ProjectMember {
  uid: string;
  name: string;
  /** e.g. "Backend", "DevOps", "Full stack". Free text; presets in constants.ts. */
  role?: string;
  /** Tech stack / skills, e.g. ["Node", "PostgreSQL", "Docker"]. */
  skills?: string[];
  /** Anything else the AI should weigh — availability, focus, seniority. */
  notes?: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  /** Pinecone namespace holding this project's knowledge docs. */
  ragNamespace: string;
  color: string;
  archived?: boolean;
  /** The per-workspace catch-all for tasks not tied to a real project. */
  isInbox?: boolean;
  createdAt: number;
  /** Denormalised access list — full-access members + members scoped to this project. */
  memberIds?: string[];
  /** The project's custom tag palette — the labels its tasks can be tagged with. */
  tags?: string[];
  /** Per-project member roles/skills, used by AI task assignment. Admin-managed. */
  team?: ProjectMember[];
  /** Extra status columns beyond the four built-ins (To Do / In Progress / Blocked / Done). */
  customStatuses?: CustomStatus[];
}

export interface LinkedDoc {
  id: string;
  title: string;
  source: string;
  score?: number;
}

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export interface Recurrence {
  freq: RecurrenceFreq;
  /** every N units (1 = every day/week/month). */
  interval: number;
}

export interface TimeEntry {
  id: string;
  /** epoch ms when the timer started. */
  start: number;
  /** epoch ms when it stopped; null while running. */
  end: number | null;
  /** cached duration in seconds once stopped (also used for manual entries). */
  seconds: number;
  note?: string;
}

/** One person assigned to a task. Tasks can have several. */
export interface Assignee {
  id: string;
  name: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  /** null => top-level task; otherwise the parent task's id (recursive subtasks). */
  parentId: string | null;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** All assignees. The legacy single-assignee fields below mirror the first
   *  entry so older reads keep working; use taskAssignees(task) to read this. */
  assignees?: Assignee[];
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeAvatar?: string | null;
  /** ISO date string (yyyy-mm-dd) or null. */
  dueDate?: string | null;
  /** Optional start time of day (HH:MM, 24h). null => all-day. */
  dueTime?: string | null;
  /** Optional end time (HH:MM, 24h). Only meaningful with dueTime; defaults to +1h. */
  dueEndTime?: string | null;
  startDate?: string | null;
  tags: string[];
  /** Task ids this task depends on. */
  dependencies: string[];
  linkedDocs: LinkedDoc[];
  /**
   * Denormalised access list, mirroring the task's project. Written on every
   * create and re-derived on move; `firestore.rules` gates every read and write
   * on it. Optional only because the type predates the field — in practice
   * every stored task has one.
   */
  memberIds?: string[];
  /** Fractional-ish integer used to order siblings within a status column / level. */
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  collapsed?: boolean;
  /** Repeat rule; when done, the next occurrence is spawned. */
  recurrence?: Recurrence | null;
  /** Time tracking log. */
  timeEntries?: TimeEntry[];
  /** Linked Google Calendar event id (when calendar sync is on). */
  googleEventId?: string | null;
  /** The sprint this task is committed to. null/absent => it sits in the backlog. */
  sprintId?: string | null;
  /** Story points. Drives sprint commitment, burndown and velocity. */
  estimate?: number | null;
  /** When the task first moved to done. Set by the data layer, never by hand —
   *  `updatedAt` moves on every edit, so it cannot answer "what shipped last
   *  week". Absent on tasks completed before this field existed. */
  completedAt?: number | null;
}

/** Sprint lifecycle. Exactly one sprint per project is ever `active`. */
export type SprintStatus = "planned" | "active" | "completed";

/**
 * A time-boxed block of work inside one project. Tasks join a sprint through
 * `Task.sprintId`; anything open without one is the backlog.
 */
export interface Sprint {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  /** What the sprint is for, in a sentence. Shown at the top of the board. */
  goal?: string;
  /** yyyy-mm-dd */
  startDate: string;
  /** yyyy-mm-dd, inclusive. */
  endDate: string;
  status: SprintStatus;
  createdAt: number;
  /** Set when the sprint is closed. Velocity reads completed sprints only. */
  completedAt?: number | null;
  /** Points committed at the moment the sprint started. Frozen on purpose:
   *  scope added mid-sprint must not quietly rewrite what was promised. */
  committedPoints?: number | null;
  memberIds: string[];
}

/** One day of a sprint burndown. Derived, never stored. */
export interface BurndownPoint {
  date: string;
  /** Points still open at the end of this day. */
  remaining: number;
  /** The straight line from committed to zero across the sprint. */
  ideal: number;
  /** False for days after today, so the chart stops the real line at today. */
  actual: boolean;
}

/** Task augmented with its resolved children — built client-side from a flat list. */
export interface TaskNode extends Task {
  children: TaskNode[];
  depth: number;
}

/**
 * A per-user daily planner note ("small notebook"). One doc per user per day,
 * keyed `${uid}_${date}`. Not tied to any workspace — it is your personal
 * schedule for the day, synced across devices.
 */
export interface DayPlan {
  id: string;
  uid: string;
  /** yyyy-mm-dd */
  date: string;
  content: string;
  updatedAt: number;
  memberIds: string[];
}

/**
 * A per-project Excalidraw whiteboard. The scene (elements + files) is stored as
 * a JSON string because Excalidraw elements contain nested arrays (point lists)
 * which Firestore does not allow as native fields. One doc per project.
 */
export interface Whiteboard {
  id: string;
  projectId: string;
  /** JSON.stringify({ elements, files }). */
  scene: string;
  memberIds: string[];
  updatedAt: number;
}

/**
 * A Notion-style document. Pages nest into a tree (parentId) and belong either
 * to a project (projectId set) or to the workspace at large (projectId null).
 * `content` is the serialised BlockNote document (JSON string of blocks).
 */
export interface Page {
  id: string;
  workspaceId: string;
  /** null => a workspace-level page (wiki); otherwise scoped to a project. */
  projectId: string | null;
  /** null => top-level page; otherwise the parent page id (page tree). */
  parentId: string | null;
  title: string;
  /** Optional emoji icon. */
  icon?: string;
  /** Serialised BlockNote blocks (JSON). Empty string => empty doc. */
  content: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  memberIds: string[];
}

/**
 * Live presence on a task: one doc per (task, user), refreshed by a heartbeat and
 * deleted on close. Anything older than PRESENCE_TTL_MS is treated as gone, so a
 * crashed tab cannot leave a ghost behind.
 */
export interface Presence {
  id: string;
  taskId: string;
  uid: string;
  name: string;
  photoURL?: string | null;
  updatedAt: number;
  memberIds: string[];
}

/**
 * One entry on a task's timeline. Comments and system events share a collection
 * so the drawer renders a single chronological thread rather than the two
 * separate tabs Jira makes you switch between.
 */
export type TimelineKind = "comment" | "event";

/** What a system event recorded. Kept coarse on purpose — a line per field edit
 *  would bury the conversation. */
export type EventVerb =
  | "created"
  | "status"
  | "assigned"
  | "unassigned"
  | "due"
  | "sprint"
  | "estimate"
  | "moved";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  taskId: string;
  workspaceId: string;
  projectId: string;
  /** Author for a comment; the actor for an event. */
  uid: string;
  name: string;
  photoURL?: string | null;
  /** Comment body, with mentions stored as @[Name](uid). */
  body?: string;
  /** uids mentioned in the body, denormalised so notifications need no parse. */
  mentions?: string[];
  /** Event only. */
  verb?: EventVerb;
  /** Event only: human-readable before/after, already resolved to labels. */
  from?: string | null;
  to?: string | null;
  createdAt: number;
  /** Set when a comment has been edited. */
  editedAt?: number | null;
  memberIds: string[];
}

/**
 * Something that happened to a user and is worth telling them about. One doc
 * per recipient per event, so the unread count is a plain query and marking one
 * read never touches anyone else's.
 */
export type NotificationKind = "assigned" | "mentioned" | "due_soon" | "comment";

export interface Notification {
  id: string;
  /** Recipient. Also the only entry in memberIds — these are strictly personal. */
  uid: string;
  kind: NotificationKind;
  /** Who caused it. */
  actorName: string;
  actorPhoto?: string | null;
  taskId: string;
  taskTitle: string;
  workspaceId: string;
  projectId: string;
  /** Short context line, e.g. the comment excerpt. */
  detail?: string;
  read: boolean;
  createdAt: number;
  memberIds: string[];
}

/** Retrieval + chat wire types (RAG). */
export interface RetrievedChunk {
  id: string;
  score: number;
  text: string;
  source: string;
  project?: string;
}

export type AgentCardKind = "created_task" | "updated_task" | "task_list" | "sources" | "digest";

export interface AgentCard {
  kind: AgentCardKind;
  // deliberately loose — each card renderer narrows this
  data: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: string[];
  sources?: RetrievedChunk[];
  cards?: AgentCard[];
  createdAt: number;
  pending?: boolean;
}

/**
 * A saved agent conversation. Personal to one user (`memberIds` is always the
 * single owner uid) and scoped to a workspace. The turns live in the
 * `chatMessages` collection, keyed by `chatId`.
 */
export interface Chat {
  id: string;
  uid: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  memberIds: string[];
}

export interface StandupDigest {
  overdue: Task[];
  dueToday: Task[];
  blocked: Task[];
  suggested: Task[];
  generatedAt: number;
}
