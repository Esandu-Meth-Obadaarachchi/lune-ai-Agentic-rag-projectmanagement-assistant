import type { Task, TaskNode } from "@/lib/types";
import { taskAssignees } from "@/lib/utils";

export function slugifyNamespace(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** How siblings are ordered in the tree.
 *  `smart`  — done sinks, mine floats, manual order breaks ties (the default).
 *  `manual` — pure manual order. Required for drag to mean anything: under
 *             `smart` a dropped row would snap straight back to where the
 *             sort wants it. */
export type TreeSort = "smart" | "manual";

/**
 * Build the Project -> Task -> Subtask forest from a flat task list.
 * When `myUid` is given and the sort is `smart`, tasks the current user is
 * assigned to float to the top of each sibling group so they are easy to spot
 * in a big shared project.
 */
export function buildTree(tasks: Task[], myUid?: string, sort: TreeSort = "smart"): TaskNode[] {
  const byId = new Map<string, TaskNode>();
  tasks.forEach((t) => byId.set(t.id, { ...t, children: [], depth: 0 }));

  const roots: TaskNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const mine = (t: Task) => !!myUid && taskAssignees(t).some((a) => a.id === myUid);

  // Completed tasks sink to the bottom; among the rest, mine float to the top;
  // ties keep their manual order.
  const sortRec = (nodes: TaskNode[], depth: number) => {
    nodes.sort((a, b) => {
      if (sort === "manual") return a.order - b.order;
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const am = mine(a) ? 0 : 1;
      const bm = mine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.order - b.order;
    });
    nodes.forEach((n) => {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    });
  };
  sortRec(roots, 0);
  return roots;
}

/** Depth-first flatten, skipping the children of collapsed nodes. */
export function flattenVisible(roots: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const walk = (nodes: TaskNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!n.collapsed && n.children.length) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** id + every descendant id — used for cascade delete and move-guards. */
export function collectSubtreeIds(tasks: Task[], id: string): string[] {
  const childrenOf = new Map<string | null, Task[]>();
  tasks.forEach((t) => {
    const list = childrenOf.get(t.parentId) ?? [];
    list.push(t);
    childrenOf.set(t.parentId, list);
  });
  const ids: string[] = [];
  const walk = (cur: string) => {
    ids.push(cur);
    (childrenOf.get(cur) ?? []).forEach((c) => walk(c.id));
  };
  walk(id);
  return ids;
}

/** Direct-child progress for the "2/5" chip. */
export function childProgress(tasks: Task[], id: string): { done: number; total: number } {
  const children = tasks.filter((t) => t.parentId === id);
  return { done: children.filter((c) => c.status === "done").length, total: children.length };
}

/** Would moving `dragId` under `targetId` create a cycle? */
export function isDescendant(tasks: Task[], dragId: string, targetId: string): boolean {
  return collectSubtreeIds(tasks, dragId).includes(targetId);
}

/* ------------------------------ drag + drop ------------------------------ */

/** One step of indent in the tree, in px. Shared by the row padding and the
 *  drag projection so the depth you see is the depth you get. */
export const TREE_INDENT = 20;

export interface Projection {
  depth: number;
  parentId: string | null;
}

/** Map key standing in for "no parent". A task id can never collide with it. */
const ROOT_KEY = "__root__";

/**
 * Where a dragged row would land. Vertical position comes from dnd-kit (the
 * `over` row); horizontal drag distance chooses the depth, clamped to what the
 * neighbours allow — you can only ever nest one level deeper than the row above,
 * and never shallower than the row below (which would orphan it).
 *
 * `items` must be the flattened visible list with the active row's descendants
 * already removed, so a parent cannot be dropped inside its own subtree.
 */
export function projectDrop(
  items: TaskNode[],
  activeId: string,
  overId: string,
  dragOffsetX: number
): Projection | null {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return null;

  // The list as it would read after the move, so the neighbours we clamp
  // against are the ones the row actually lands between.
  const moved = [...items];
  moved.splice(overIndex, 0, moved.splice(activeIndex, 1)[0]);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];

  const wanted = items[activeIndex].depth + Math.round(dragOffsetX / TREE_INDENT);
  const maxDepth = prev ? prev.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(wanted, maxDepth));

  if (depth === 0 || !prev) return { depth: 0, parentId: null };
  if (depth === prev.depth) return { depth, parentId: prev.parentId };
  if (depth > prev.depth) return { depth, parentId: prev.id };
  // Dropping shallower than the row above: adopt the parent of the nearest
  // earlier row already sitting at the target depth.
  const anchor = moved
    .slice(0, overIndex)
    .reverse()
    .find((i) => i.depth === depth);
  return { depth, parentId: anchor?.parentId ?? null };
}

/**
 * Apply a projected drop and return only the tasks whose parent or order
 * actually changed, ready for `commitTaskMoves`. Siblings are renumbered in
 * steps of 1000 so a later insert between two rows has room.
 */
export function planMove(
  items: TaskNode[],
  activeId: string,
  overId: string,
  projection: Projection
): { id: string; order: number; parentId: string | null }[] {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return [];

  const moved = [...items];
  const [active] = moved.splice(activeIndex, 1);
  moved.splice(overIndex, 0, { ...active, parentId: projection.parentId });

  // Renumber every sibling group the new list implies, then keep the diffs.
  const seen = new Map<string, number>();
  const out: { id: string; order: number; parentId: string | null }[] = [];
  moved.forEach((node) => {
    const key = node.parentId ?? ROOT_KEY;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const order = index * 1000;
    const original = items.find((i) => i.id === node.id);
    if (!original) return;
    if (original.order !== order || (original.parentId ?? null) !== (node.parentId ?? null)) {
      out.push({ id: node.id, order, parentId: node.parentId ?? null });
    }
  });
  return out;
}
