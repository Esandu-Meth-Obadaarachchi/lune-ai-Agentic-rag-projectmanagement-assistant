import { dueState } from "@/lib/date";
import type { Task, TaskPriority } from "@/lib/types";
import { taskAssignees } from "@/lib/utils";

/**
 * View filters, shared by every task surface so a project reads the same way
 * whichever tab you are on.
 *
 * Filtering a tree is not the same as filtering a list: hiding a parent that
 * does not match would hide matching children with it. `applyFilter` keeps the
 * ancestors of any match so the hierarchy still resolves, and marks them so a
 * view can dim them if it wants.
 */

export type DueWindow = "any" | "overdue" | "today" | "week" | "none";

export interface TaskFilter {
  /** uids; empty means anyone. "unassigned" is a valid entry. */
  assignees: string[];
  priorities: TaskPriority[];
  tags: string[];
  due: DueWindow;
  /** Hide completed work. On by default in views where done is noise. */
  hideDone: boolean;
  /** Free text over the title. */
  text: string;
}

export const EMPTY_FILTER: TaskFilter = {
  assignees: [],
  priorities: [],
  tags: [],
  due: "any",
  hideDone: false,
  text: "",
};

export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.assignees.length > 0 ||
    f.priorities.length > 0 ||
    f.tags.length > 0 ||
    f.due !== "any" ||
    f.hideDone ||
    f.text.trim().length > 0
  );
}

export function activeFilterCount(f: TaskFilter): number {
  return (
    f.assignees.length +
    f.priorities.length +
    f.tags.length +
    (f.due !== "any" ? 1 : 0) +
    (f.hideDone ? 1 : 0) +
    (f.text.trim() ? 1 : 0)
  );
}

function withinDue(t: Task, window: DueWindow): boolean {
  if (window === "any") return true;
  if (window === "none") return !t.dueDate;
  if (!t.dueDate) return false;
  const state = dueState(t.dueDate, t.status);
  if (window === "overdue") return state === "overdue";
  if (window === "today") return state === "today";
  // "week": anything due from now to seven days out, overdue included.
  const days = Math.ceil((new Date(t.dueDate).getTime() - Date.now()) / 86_400_000);
  return days <= 7;
}

/** Does this task match on its own merits, ignoring its family? */
export function matches(t: Task, f: TaskFilter): boolean {
  if (f.hideDone && t.status === "done") return false;

  if (f.text.trim()) {
    const q = f.text.trim().toLowerCase();
    if (!t.title.toLowerCase().includes(q) && !(t.notes ?? "").toLowerCase().includes(q)) {
      return false;
    }
  }

  if (f.assignees.length) {
    const owners = taskAssignees(t);
    const wantsUnassigned = f.assignees.includes("unassigned");
    const hit =
      (wantsUnassigned && owners.length === 0) ||
      owners.some((a) => f.assignees.includes(a.id));
    if (!hit) return false;
  }

  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.tags.length && !t.tags.some((tag) => f.tags.includes(tag))) return false;
  if (!withinDue(t, f.due)) return false;

  return true;
}

/**
 * Filter a task set while keeping hierarchies intact: a task survives if it
 * matches, or if any descendant matches (so the parent chain still renders).
 */
export function applyFilter(tasks: Task[], f: TaskFilter): Task[] {
  if (!isFilterActive(f)) return tasks;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const keep = new Set<string>();

  tasks.forEach((t) => {
    if (!matches(t, f)) return;
    keep.add(t.id);
    // Walk up, so the ancestors of a match are not filtered out from under it.
    let cur = t.parentId ? byId.get(t.parentId) : null;
    let guard = 0;
    while (cur && !keep.has(cur.id) && guard++ < 100) {
      keep.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
  });

  return tasks.filter((t) => keep.has(t.id));
}
