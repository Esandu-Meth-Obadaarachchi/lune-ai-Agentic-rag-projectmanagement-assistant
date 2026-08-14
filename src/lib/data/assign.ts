import type { Assignee, Task } from "@/lib/types";
import { taskAssignees } from "@/lib/utils";
import { collectSubtreeIds } from "./tree";

/**
 * Assignment moves, worked out as pure data so the members board can preview,
 * commit and undo them without re-deriving the rules each time.
 *
 * Two behaviours the old board got wrong:
 *
 * 1. It replaced the whole assignee list with one person, so a task with three
 *    people silently lost two of them. A drag means "this moved from A to B",
 *    which is a swap of one entry, not a reset.
 * 2. It only ever touched the dragged task. Subtasks are not shown on this
 *    board, so reassigning a parent left its children owned by someone who no
 *    longer has the parent — invisibly. Subtasks that were following the parent
 *    (same assignee) now move with it; subtasks deliberately given to someone
 *    else stay where they are.
 */

export interface AssignChange {
  id: string;
  title: string;
  before: Assignee[];
  after: Assignee[];
  /** True for the dragged task, false for a subtask carried along with it. */
  root: boolean;
}

/** Swap `fromUid` for `to` in a list, preserving everyone else and the order. */
function swap(list: Assignee[], fromUid: string | null, to: Assignee | null): Assignee[] {
  const kept = fromUid ? list.filter((a) => a.id !== fromUid) : [...list];
  if (!to) return kept;
  if (kept.some((a) => a.id === to.id)) return kept;
  // Slot the new person where the old one sat, so the primary assignee (which
  // the legacy assigneeId mirrors) does not jump around unnecessarily.
  const at = fromUid ? list.findIndex((a) => a.id === fromUid) : kept.length;
  const out = [...kept];
  out.splice(at < 0 ? kept.length : at, 0, to);
  return out;
}

function sameIds(a: Assignee[], b: Assignee[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id);
}

/**
 * Plan a reassignment of `taskId` from `fromUid` to `to`.
 *
 * `fromUid` null means the task was unassigned; `to` null means it is being
 * moved to the Unassigned column, which removes `fromUid` and leaves any other
 * assignees in place.
 */
export function planReassign(
  tasks: Task[],
  taskId: string,
  fromUid: string | null,
  to: Assignee | null
): AssignChange[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const root = byId.get(taskId);
  if (!root) return [];

  const changes: AssignChange[] = [];
  const add = (t: Task, isRoot: boolean) => {
    const before = taskAssignees(t);
    const after = swap(before, fromUid, to);
    if (!sameIds(before, after)) {
      changes.push({ id: t.id, title: t.title, before, after, root: isRoot });
    }
  };

  add(root, true);

  // Descendants that carried the same owner follow the parent.
  collectSubtreeIds(tasks, taskId)
    .filter((id) => id !== taskId)
    .forEach((id) => {
      const child = byId.get(id);
      if (!child) return;
      const owners = taskAssignees(child);
      const follows = fromUid
        ? owners.some((a) => a.id === fromUid)
        : owners.length === 0; // an unassigned parent carries its unassigned children
      if (follows) add(child, false);
    });

  return changes;
}

/** The reverse of a planned move, for undo. */
export function invertChanges(changes: AssignChange[]): AssignChange[] {
  return changes.map((c) => ({ ...c, before: c.after, after: c.before }));
}

/** How many subtasks a plan carries along, for the confirmation message. */
export function carriedCount(changes: AssignChange[]): number {
  return changes.filter((c) => !c.root).length;
}
