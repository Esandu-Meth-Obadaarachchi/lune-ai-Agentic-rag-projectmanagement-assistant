"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDownUp, ListTree } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { commitTaskMoves } from "@/lib/data/firestore";
import {
  TREE_INDENT,
  buildTree,
  collectSubtreeIds,
  flattenVisible,
  planMove,
  projectDrop,
  type Projection,
  type TreeSort,
} from "@/lib/data/tree";
import type { Task, TaskNode } from "@/lib/types";
import { QuickAdd, TaskRow } from "@/components/task/TaskRow";
import { cn } from "@/lib/utils";

const SORT_KEY = "sb-tree-sort";

export function TreeView({
  onOpenTask,
  selectedId,
  tasks: tasksProp,
}: {
  onOpenTask: (t: Task) => void;
  selectedId?: string;
  /** Cross-project task set (My Tasks). When given, creation affordances are hidden. */
  tasks?: Task[];
}) {
  const { user } = useAuth();
  const ctx = useWorkspace();
  const tasks = tasksProp ?? ctx.tasks;
  const crossProject = tasksProp != null;
  const actions = useTaskActions();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null>(null);

  // Reordering only makes sense against manual order, so the sort mode gates
  // dragging. Cross-project views are never reorderable: `order` is scoped to a
  // project and renumbering across several would corrupt all of them.
  const [sort, setSort] = useState<TreeSort>("smart");
  useEffect(() => {
    const saved = localStorage.getItem(SORT_KEY) as TreeSort | null;
    if (saved === "manual" || saved === "smart") setSort(saved);
  }, []);
  const changeSort = (s: TreeSort) => {
    setSort(s);
    localStorage.setItem(SORT_KEY, s);
  };
  const reorderable = !crossProject && sort === "manual";

  const roots = useMemo(() => {
    const tree = buildTree(tasks, user?.uid, sort);
    const annotate = (nodes: TaskNode[]) =>
      nodes.forEach((n) => {
        n.collapsed = collapsed.has(n.id);
        annotate(n.children);
      });
    annotate(tree);
    return tree;
  }, [tasks, collapsed, user?.uid, sort]);

  const visible = useMemo(() => flattenVisible(roots), [roots]);

  /* ------------------------------ drag state ------------------------------ */

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  // A row cannot be dropped inside its own subtree, so its descendants leave the
  // droppable list for the duration of the drag.
  const dragItems = useMemo(() => {
    if (!activeId) return visible;
    const hidden = new Set(collectSubtreeIds(tasks, activeId));
    hidden.delete(activeId);
    return visible.filter((n) => !hidden.has(n.id));
  }, [visible, activeId, tasks]);

  const projection: Projection | null = useMemo(
    () => (activeId && overId ? projectDrop(dragItems, activeId, overId, offsetX) : null),
    [dragItems, activeId, overId, offsetX]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setOverId(String(e.active.id));
    setOffsetX(0);
  };

  const onDragMove = (e: DragMoveEvent) => {
    setOffsetX(e.delta.x);
    if (e.over) setOverId(String(e.over.id));
  };

  const reset = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const proj = projection;
    reset();
    if (!over || !proj) return;
    const moves = planMove(dragItems, active, over, proj);
    if (moves.length) void commitTaskMoves(moves);
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expand = (id: string) =>
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const activeNode = activeId ? visible.find((n) => n.id === activeId) : null;

  const rows = (
    <div className="space-y-px">
      {dragItems.map((node) => (
        <div key={node.id}>
          <TaskRow
            node={node}
            actions={actions}
            collapsed={collapsed.has(node.id)}
            selected={node.id === selectedId}
            draggable={reorderable}
            dragging={node.id === activeId}
            dropDepth={node.id === activeId ? projection?.depth : undefined}
            onToggleCollapse={() => toggle(node.id)}
            onOpen={() => onOpenTask(node)}
            onAddSubtask={
              crossProject
                ? undefined
                : () => {
                    expand(node.id);
                    setAddingUnder(node.id);
                  }
            }
          />
          {addingUnder === node.id && (
            <QuickAdd
              depth={node.depth + 1}
              autoFocus
              placeholder="Add subtask"
              onAdd={(title) => actions.addSubtask(node.id, title)}
              onCancel={() => setAddingUnder(null)}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      {!crossProject && tasks.length > 0 && (
        <div className="mb-2 flex items-center justify-end gap-1 px-1">
          <button
            onClick={() => changeSort(sort === "manual" ? "smart" : "manual")}
            title={
              sort === "manual"
                ? "Manual order. Drag rows to reorder or re-nest."
                : "Sorted by status and assignment. Switch to manual to drag."
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-medium transition-colors",
              sort === "manual"
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text"
            )}
          >
            <ArrowDownUp className="h-3 w-3" />
            {sort === "manual" ? "Manual order" : "Smart order"}
          </button>
        </div>
      )}

      {reorderable ? (
        <DndContext
          sensors={sensors}
          // No axis modifier: modifiers rewrite the reported delta, and the
          // horizontal component of that delta is what chooses nesting depth.
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={reset}
        >
          <SortableContext items={dragItems.map((n) => n.id)} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeNode ? (
              <div className="rounded-md border border-accent/30 bg-surface shadow-pop">
                <div className="truncate px-3 py-1.5 text-[13.5px] text-text">{activeNode.title}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        rows
      )}

      {tasks.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-text-muted">
            <ListTree className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-text">
              {crossProject ? "Nothing assigned to you" : "No tasks yet"}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {crossProject
                ? "Tasks assigned to you across all projects will show here."
                : "Add your first task below, or ask the brain to break down a goal."}
            </div>
          </div>
        </div>
      ) : null}

      {!crossProject && (
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <QuickAdd placeholder="Add task" onAdd={(title) => actions.add(title)} />
        </div>
      )}
    </div>
  );
}
