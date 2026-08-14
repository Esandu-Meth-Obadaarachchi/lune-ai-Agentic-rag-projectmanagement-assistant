"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CornerDownRight } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { commitAssignments } from "@/lib/data/firestore";
import { carriedCount, invertChanges, planReassign } from "@/lib/data/assign";
import { childProgress } from "@/lib/data/tree";
import { useToast } from "@/lib/ui/ToastContext";
import type { Assignee, Task, WorkspaceMember } from "@/lib/types";
import { TaskCard } from "@/components/task/TaskCard";
import { Avatar, AvatarEmpty } from "@/components/ui/Avatar";
import { cn, taskAssignees } from "@/lib/utils";

const UNASSIGNED = "unassigned";
type Columns = Record<string, string[]>;

/** Cards carry a column-qualified id, because one task can sit in several
 *  columns at once when it has co-assignees. */
const cardId = (col: string, task: string) => `${col}|${task}`;
const parseCard = (id: string) => {
  const at = id.indexOf("|");
  return at < 0 ? null : { col: id.slice(0, at), task: id.slice(at + 1) };
};

const boardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length) return pointer;
  const rect = rectIntersection(args);
  if (rect.length) return rect;
  return closestCorners(args);
};

/**
 * Kanban grouped by person: one column per project member plus Unassigned.
 * Dragging a card between columns moves that task from one person to the other,
 * keeping any co-assignees and carrying subtasks that were following the same
 * owner. See `lib/data/assign.ts` for the rules.
 */
export function MemberBoard({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const { tasks, currentProject, currentWorkspace } = useWorkspace();
  const toast = useToast();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const members: WorkspaceMember[] = useMemo(() => {
    const all = currentWorkspace?.members ?? [];
    return all.filter((m) => !currentProject?.memberIds || currentProject.memberIds.includes(m.uid));
  }, [currentWorkspace, currentProject]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const columnIds = useMemo(() => [...members.map((m) => m.uid), UNASSIGNED], [members]);
  const columnsKey = columnIds.join(",");

  const cols = useMemo<Columns>(() => {
    const out: Columns = {};
    columnIds.forEach((id) => (out[id] = []));
    tasks
      .filter((t) => !t.parentId)
      .sort((a, b) => a.order - b.order)
      .forEach((t) => {
        const owners = taskAssignees(t).filter((a) => out[a.id]);
        if (owners.length === 0) out[UNASSIGNED].push(t.id);
        else owners.forEach((a) => out[a.id].push(t.id));
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, columnsKey]);

  const [active, setActive] = useState<{ col: string; task: string } | null>(null);

  // Touch needs a short press before dragging, otherwise a scroll gesture on a
  // phone starts a drag instead of scrolling the board.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const onDragStart = (e: DragStartEvent) => setActive(parseCard(String(e.active.id)));

  const onDragEnd = (e: DragEndEvent) => {
    const from = parseCard(String(e.active.id));
    setActive(null);
    if (!from || !e.over) return;

    const overId = String(e.over.id);
    const to = overId.startsWith("col:") ? overId.slice(4) : parseCard(overId)?.col;
    if (!to || to === from.col) return;

    const task = byId.get(from.task);
    if (!task) return;

    const target: Assignee | null =
      to === UNASSIGNED
        ? null
        : (() => {
            const m = memberById.get(to);
            return m ? { id: m.uid, name: m.name, avatar: m.photoURL } : null;
          })();
    if (to !== UNASSIGNED && !target) return;

    const changes = planReassign(tasks, from.task, from.col === UNASSIGNED ? null : from.col, target);
    if (!changes.length) return;

    const carried = carriedCount(changes);
    const where = target ? target.name : "Unassigned";
    void toast
      .report(commitAssignments(changes), { failure: "Could not reassign." })
      .then((ok) => {
        if (ok === undefined) return;
        toast.ok(
          carried > 0
            ? `Moved to ${where}, with ${carried} subtask${carried === 1 ? "" : "s"}.`
            : `Moved to ${where}.`,
          {
            label: "Undo",
            run: () =>
              toast.report(commitAssignments(invertChanges(changes)), {
                failure: "Could not undo.",
              }),
          }
        );
      });
  };

  const activeTask = active ? byId.get(active.task) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-3 py-4 sm:snap-none sm:px-4">
        {members.map((m) => (
          <Column
            key={m.uid}
            colId={m.uid}
            member={m}
            ids={cols[m.uid] ?? []}
            byId={byId}
            tasks={tasks}
            onOpenTask={onOpenTask}
          />
        ))}
        <Column
          colId={UNASSIGNED}
          member={null}
          ids={cols[UNASSIGNED] ?? []}
          byId={byId}
          tasks={tasks}
          onOpenTask={onOpenTask}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[272px]">
            <TaskCard task={activeTask} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  colId,
  member,
  ids,
  byId,
  tasks,
  onOpenTask,
}: {
  colId: string;
  member: WorkspaceMember | null;
  ids: string[];
  byId: Map<string, Task>;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${colId}` });
  const open = ids.filter((id) => byId.get(id)?.status !== "done").length;

  return (
    <div
      ref={setNodeRef}
      className="flex w-[86vw] shrink-0 snap-start flex-col sm:w-[288px] sm:snap-align-none"
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        {member ? (
          <Avatar name={member.name} src={member.photoURL} size={20} />
        ) : (
          <AvatarEmpty size={20} />
        )}
        <span className="truncate text-[13px] font-medium text-text">
          {member?.name ?? "Unassigned"}
        </span>
        <span className="mono text-2xs text-text-faint" title={`${open} open of ${ids.length}`}>
          {open}
          {ids.length !== open && <span className="text-text-faint/60">/{ids.length}</span>}
        </span>
        {member?.role && (
          <span className="ml-auto rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs capitalize text-text-muted">
            {member.role}
          </span>
        )}
      </div>
      <div
        className={cn(
          "min-h-[120px] flex-1 space-y-2 rounded-lg border border-transparent p-1.5 transition-colors",
          isOver && "border-accent/25 bg-accent/[0.04]"
        )}
      >
        <SortableContext
          items={ids.map((id) => cardId(colId, id))}
          strategy={verticalListSortingStrategy}
        >
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? (
              <SortableCard
                key={cardId(colId, id)}
                sortId={cardId(colId, id)}
                task={t}
                tasks={tasks}
                onOpen={() => onOpenTask(t)}
              />
            ) : null;
          })}
        </SortableContext>
        {ids.length === 0 && (
          <div className="grid place-items-center rounded-lg border border-dashed border-border/60 py-6 text-2xs text-text-faint">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

function SortableCard({
  sortId,
  task,
  tasks,
  onOpen,
}: {
  sortId: string;
  task: Task;
  tasks: Task[];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortId,
  });
  const { total } = childProgress(tasks, task.id);
  const others = taskAssignees(task).length - 1;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className="touch-none"
    >
      <TaskCard task={task} onOpen={onOpen} />
      {(total > 0 || others > 0) && (
        <div className="mt-1 flex items-center gap-2 px-1 text-2xs text-text-faint">
          {total > 0 && (
            <span className="inline-flex items-center gap-1" title={`${total} subtask${total === 1 ? "" : "s"} follow this owner`}>
              <CornerDownRight className="h-3 w-3" />
              {total}
            </span>
          )}
          {others > 0 && <span title="Also assigned to others">+{others} more</span>}
        </div>
      )}
    </div>
  );
}
