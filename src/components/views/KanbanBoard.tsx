"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Trash2 } from "lucide-react";
import { projectStatuses, STATUS_COLORS, type StatusMeta } from "@/lib/constants";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { addCustomStatus, commitTaskMoves, deleteCustomStatus } from "@/lib/data/firestore";
import type { Task } from "@/lib/types";
import { TaskCard } from "@/components/task/TaskCard";
import { QuickAdd } from "@/components/task/TaskRow";
import { Button } from "@/components/ui/Button";
import { Modal, Field, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

type Columns = Record<string, string[]>;

/**
 * Pointer-first collision. closestCorners can't reliably target an EMPTY column
 * (there are no nearby cards, so a card in an adjacent column always wins).
 * pointerWithin detects the column container directly under the cursor; we fall
 * back to rect intersection, then closestCorners, for the has-cards case.
 */
const boardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length) return pointer;
  const rect = rectIntersection(args);
  if (rect.length) return rect;
  return closestCorners(args);
};

export function KanbanBoard({
  onOpenTask,
  tasks: tasksProp,
}: {
  onOpenTask: (t: Task) => void;
  /** Cross-project task set (My Tasks). Uses the built-in statuses and hides add UI. */
  tasks?: Task[];
}) {
  const ctx = useWorkspace();
  const tasks = tasksProp ?? ctx.tasks;
  const crossProject = tasksProp != null;
  const currentProject = crossProject ? null : ctx.currentProject;
  const actions = useTaskActions();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Columns = the four built-ins + this project's custom statuses, in order.
  // Cross-project (My Tasks) uses only the built-ins.
  const statuses = useMemo(() => projectStatuses(currentProject), [currentProject]);
  const statusIds = useMemo(() => statuses.map((s) => s.id), [statuses]);
  const statusKey = statusIds.join(",");
  const [adding, setAdding] = useState(false);

  // Board shows top-level tasks grouped by status. A task whose status no longer
  // exists (e.g. a just-deleted custom column) falls back into To Do so it is
  // never lost off-board.
  // A subtask whose parent is not in the set is shown as a root. Inside a
  // project the parent is always present, so this is a no-op there; across
  // projects (All my tasks) it is what stops a subtask assigned to you from
  // vanishing because its parent belongs to someone else.
  const present = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const derived = useMemo<Columns>(() => {
    const cols: Columns = {};
    statusIds.forEach((id) => (cols[id] = []));
    tasks
      .filter((t) => !t.parentId || !present.has(t.parentId))
      .sort((a, b) => a.order - b.order)
      .forEach((t) => {
        const key = cols[t.status] ? t.status : "todo";
        cols[key].push(t.id);
      });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, statusKey, present]);

  const [cols, setCols] = useState<Columns>(derived);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setCols(derived);
  }, [derived]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /** Column droppables are prefixed so they can never collide with a task id. */
  const colOf = (id: string, source: Columns = cols): string | null => {
    if (id.startsWith("col:")) return id.slice(4);
    return statusIds.find((s) => source[s]?.includes(id)) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(e.active.id));
  };

  const onDragOver = (e: DragOverEvent) => {
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const activeIdStr = String(e.active.id);
    setCols((prev) => {
      const from = colOf(activeIdStr, prev);
      const to = colOf(overId, prev);
      if (!from || !to || from === to) return prev;
      const next = { ...prev, [from]: [...prev[from]], [to]: [...prev[to]] };
      next[from] = next[from].filter((id) => id !== activeIdStr);
      const overIdx = next[to].indexOf(overId);
      next[to].splice(overIdx >= 0 ? overIdx : next[to].length, 0, activeIdStr);
      return next;
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const activeIdStr = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    dragging.current = false;
    setActiveId(null);
    if (!overId) return;

    const to = colOf(overId);
    const from = colOf(activeIdStr);
    if (!from || !to) return;

    let final: Columns = cols;
    if (from === to) {
      const oldIdx = cols[to].indexOf(activeIdStr);
      const newIdx = overId.startsWith("col:") ? cols[to].length - 1 : cols[to].indexOf(overId);
      if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
        const arr = [...cols[to]];
        arr.splice(newIdx, 0, arr.splice(oldIdx, 1)[0]);
        final = { ...cols, [to]: arr };
      }
    }
    setCols(final);

    const moves: { id: string; order: number; status: string }[] = [];
    statusIds.forEach((status) => {
      (final[status] ?? []).forEach((id, i) => {
        const t = byId.get(id);
        const order = i * 1000;
        if (t && (t.status !== status || t.order !== order)) moves.push({ id, order, status });
      });
    });
    if (moves.length) {
      void commitTaskMoves(moves).catch(() => setCols(derived));
    }
  };

  const onDragCancel = () => {
    dragging.current = false;
    setActiveId(null);
    setCols(derived);
  };

  const removeStatus = (meta: StatusMeta) => {
    if (!currentProject) return;
    const count = (cols[meta.id] ?? []).length;
    const msg = count
      ? `Delete "${meta.label}"? Its ${count} task${count === 1 ? "" : "s"} move to To Do.`
      : `Delete "${meta.label}"?`;
    if (!window.confirm(msg)) return;
    void deleteCustomStatus(currentProject, meta.id, tasks);
  };

  const active = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-4 py-4">
        {statuses.map((meta) => (
          <Column
            key={meta.id}
            meta={meta}
            ids={cols[meta.id] ?? []}
            byId={byId}
            onOpenTask={onOpenTask}
            onAdd={crossProject ? undefined : (title) => actions.add(title, { status: meta.id })}
            onDelete={meta.custom ? () => removeStatus(meta) : undefined}
          />
        ))}
        {currentProject && (
          <button
            onClick={() => setAdding(true)}
            className="mt-0.5 flex h-8 w-[200px] shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-2xs text-text-faint transition-colors hover:border-border-strong hover:text-text-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Add status
          </button>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-[272px]">
            <TaskCard task={active} dragging />
          </div>
        ) : null}
      </DragOverlay>

      {adding && currentProject && (
        <AddStatusModal
          onClose={() => setAdding(false)}
          onSave={(label, color) => {
            void addCustomStatus(currentProject, label, color);
            setAdding(false);
          }}
        />
      )}
    </DndContext>
  );
}

function Column({
  meta,
  ids,
  byId,
  onOpenTask,
  onAdd,
  onDelete,
}: {
  meta: StatusMeta;
  ids: string[];
  byId: Map<string, Task>;
  onOpenTask: (t: Task) => void;
  /** Omitted in cross-project (My Tasks) boards where there is no target project to add to. */
  onAdd?: (title: string) => void;
  onDelete?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${meta.id}` });
  const [adding, setAdding] = useState(false);

  return (
    <div ref={setNodeRef} className="flex w-[288px] shrink-0 flex-col">
      <div className="group/col mb-2 flex items-center gap-2 px-1">
        {meta.custom ? (
          <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} />
        ) : (
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
        )}
        <span className="text-[13px] font-medium text-text">{meta.label}</span>
        <span className="mono text-2xs text-text-faint">{ids.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete status"
              className="grid h-5 w-5 place-items-center rounded text-text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger group-hover/col:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onAdd && (
            <button
              onClick={() => setAdding(true)}
              className="grid h-5 w-5 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div
        className={cn(
          "min-h-[120px] flex-1 space-y-2 rounded-lg border border-transparent p-1.5 transition-colors",
          isOver && "border-accent/25 bg-accent/[0.04]"
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <SortableCard key={id} task={t} onOpen={() => onOpenTask(t)} /> : null;
          })}
        </SortableContext>
        {adding && onAdd && (
          <div className="card p-1">
            <QuickAdd
              autoFocus
              placeholder="New card"
              onAdd={(title) => onAdd(title)}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {ids.length === 0 && !adding && (
          <div className="grid place-items-center rounded-lg border border-dashed border-border/60 py-6 text-2xs text-text-faint">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

function AddStatusModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (label: string, color: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(STATUS_COLORS[0]);

  return (
    <Modal open onClose={onClose} title="Add status" width={380}>
      <Field label="Name">
        <input
          autoFocus
          className={inputClass}
          placeholder="e.g. To be reviewed"
          value={label}
          maxLength={24}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && label.trim() && onSave(label, color)}
        />
      </Field>
      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {STATUS_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "h-7 w-7 rounded-full ring-offset-2 ring-offset-bg transition-all",
                color === c && "ring-2 ring-accent"
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => onSave(label, color)} disabled={!label.trim()}>
          Add status
        </Button>
      </div>
    </Modal>
  );
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
}
