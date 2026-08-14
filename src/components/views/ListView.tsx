"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PRIORITY_ORDER, projectStatuses, type StatusMeta } from "@/lib/constants";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import type { Task } from "@/lib/types";
import { StatusControl } from "@/components/ui/StatusControl";
import { TagChip } from "@/components/ui/TagChip";
import { AssigneePicker, DuePicker, PrioritySelect } from "@/components/task/Pickers";
import { QuickAdd } from "@/components/task/TaskRow";
import { cn, taskAssignees } from "@/lib/utils";

type Actions = ReturnType<typeof useTaskActions>;

/** Priority, then earliest due date. Assignment is layered on top in the view. */
function sortTasks(a: Task, b: Task): number {
  const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  if (p !== 0) return p;
  return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
}

export function ListView({
  onOpenTask,
  tasks: tasksProp,
  crossProject = false,
}: {
  onOpenTask: (t: Task) => void;
  /** Task set to render. Defaults to the current project's tasks. */
  tasks?: Task[];
  /** True when the set spans projects; uses the built-in statuses and hides
   *  add rows. Separate from `tasks` so filtering keeps them. */
  crossProject?: boolean;
}) {
  const { user } = useAuth();
  const ctx = useWorkspace();
  const tasks = tasksProp ?? ctx.tasks;
  const actions = useTaskActions();
  const statuses = useMemo(
    () => projectStatuses(crossProject ? null : ctx.currentProject),
    [ctx.currentProject, crossProject]
  );

  // Tasks I am assigned to float to the top of each status group; ties fall back
  // to the usual priority-then-due order.
  const sortMineFirst = useMemo(() => {
    const mine = (t: Task) => taskAssignees(t).some((x) => x.id === user?.uid);
    return (a: Task, b: Task) => {
      const am = mine(a) ? 0 : 1;
      const bm = mine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return sortTasks(a, b);
    };
  }, [user?.uid]);

  // Subtasks are nested under their parent, never floated as their own status
  // row. So we group only top-level tasks by status; children render indented
  // beneath each parent regardless of their own status.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Task[]>();
    tasks.forEach((t) => {
      if (!t.parentId) return;
      const arr = m.get(t.parentId) ?? [];
      arr.push(t);
      m.set(t.parentId, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    return m;
  }, [tasks]);

  // Same orphan promotion as the board: across projects a subtask assigned to
  // you must still appear even when its parent is not in the set.
  const present = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const groups = useMemo(() => {
    const g: Record<string, Task[]> = {};
    statuses.forEach((s) => (g[s.id] = []));
    tasks
      .filter((t) => !t.parentId || !present.has(t.parentId))
      .forEach((t) => (g[t.status] ?? g.todo).push(t));
    Object.values(g).forEach((arr) => arr.sort(sortMineFirst));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, present, sortMineFirst, statuses.map((s) => s.id).join(",")]);

  return (
    <div className="mx-auto max-w-4xl px-2 py-4 sm:px-4">
      {statuses.map((meta) => {
        const status = meta.id;
        const rows = groups[status] ?? [];
        return (
          <StatusGroup
            key={status}
            meta={meta}
            rows={rows}
            actions={actions}
            crossProject={crossProject}
            onOpenTask={onOpenTask}
            childrenByParent={childrenByParent}
          />
        );
      })}
    </div>
  );
}

/**
 * One status section. The `+` in the header opens a composer at the top of the
 * group, so adding to a long list does not mean scrolling past every row to
 * reach the inline add at the bottom. Mirrors the Board's column header.
 */
function StatusGroup({
  meta,
  rows,
  actions,
  crossProject,
  onOpenTask,
  childrenByParent,
}: {
  meta: StatusMeta;
  rows: Task[];
  actions: Actions;
  crossProject: boolean;
  onOpenTask: (t: Task) => void;
  childrenByParent: Map<string, Task[]>;
}) {
  const [addingTop, setAddingTop] = useState(false);
  const status = meta.id;

  return (
    <section className="mb-5">
      <div className="group/head mb-1 flex items-center gap-2 px-2">
        {meta.custom ? (
          <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} />
        ) : (
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
        )}
        <span className="text-[13px] font-semibold text-text">{meta.label}</span>
        <span className="mono text-2xs text-text-faint">{rows.length}</span>
        {!crossProject && (
          <button
            onClick={() => setAddingTop(true)}
            title={`Add to ${meta.label}`}
            className="grid h-5 w-5 place-items-center rounded text-text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-text focus-visible:opacity-100 group-hover/head:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {addingTop && !crossProject && (
          <div className="border-b border-border/60 px-2">
            <QuickAdd
              autoFocus
              placeholder={`Add task to ${meta.label}`}
              onAdd={(title) => actions.add(title, { status })}
              onCancel={() => setAddingTop(false)}
            />
          </div>
        )}
        {rows.map((t, i) => (
          <Row
            key={t.id}
            task={t}
            depth={0}
            first={i === 0 && !addingTop}
            actions={actions}
            onOpenTask={onOpenTask}
            childrenByParent={childrenByParent}
          />
        ))}
        {rows.length === 0 && crossProject && (
          <div className="px-3 py-2 text-2xs text-text-faint">Nothing here</div>
        )}
        {!crossProject && (
          <div className={cn("px-2", rows.length > 0 && "border-t border-border/60")}>
            <QuickAdd
              placeholder={`Add task to ${meta.label}`}
              onAdd={(title) => actions.add(title, { status })}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Row({
  task,
  depth,
  first,
  actions,
  onOpenTask,
  childrenByParent,
}: {
  task: Task;
  depth: number;
  first: boolean;
  actions: Actions;
  onOpenTask: (t: Task) => void;
  childrenByParent: Map<string, Task[]>;
}) {
  const kids = childrenByParent.get(task.id) ?? [];
  const isSub = depth > 0;
  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2.5 pr-3 transition-colors hover:bg-surface-2",
          !first && "border-t border-border/60",
          isSub && "bg-surface/40"
        )}
        style={{ paddingLeft: 12 + depth * 22 }}
      >
        {isSub && <span className="text-text-faint">↳</span>}
        <StatusControl status={task.status} onChange={(s) => actions.setStatus(task.id, s)} />
        <button
          onClick={() => onOpenTask(task)}
          className={cn(
            "flex-1 truncate py-2.5 text-left",
            isSub ? "text-[13px]" : "text-[13.5px]",
            task.status === "done" ? "text-text-faint line-through" : "text-text"
          )}
        >
          {task.title}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {task.tags.slice(0, 2).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          <DuePicker
            value={task.dueDate}
            time={task.dueTime}
            endTime={task.dueEndTime}
            status={task.status}
            onChange={(d) => actions.setDue(task.id, d)}
            onTimeChange={(tm) => actions.setDueTime(task.id, tm)}
            onEndTimeChange={(tm) => actions.setDueEndTime(task.id, tm)}
          />
          <PrioritySelect value={task.priority} onChange={(p) => actions.setPriority(task.id, p)} />
          <AssigneePicker
            value={taskAssignees(task)}
            onChange={(a) => actions.setAssignees(task.id, a)}
            size={20}
          />
        </div>
      </div>
      {kids.map((k) => (
        <Row
          key={k.id}
          task={k}
          depth={depth + 1}
          first={false}
          actions={actions}
          onOpenTask={onOpenTask}
          childrenByParent={childrenByParent}
        />
      ))}
    </>
  );
}
