"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { CheckCircle2, ChevronDown, Clock, Layers, Rocket } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { assignTasksToSprint, watchSprints } from "@/lib/data/firestore";
import {
  backlogTasks,
  deliveredByPerson,
  deliveredUnassigned,
  sumPoints,
  type DeliveredRow,
} from "@/lib/data/sprint";
import { toISODate, todayISO } from "@/lib/date";
import { PRIORITY_ORDER } from "@/lib/constants";
import type { Project, Sprint, Task } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusControl } from "@/components/ui/StatusControl";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { AssigneeStack } from "@/components/task/Pickers";
import { QuickAdd } from "@/components/task/TaskRow";
import { cn, taskAssignees } from "@/lib/utils";

type Mode = "backlog" | "delivered";

/**
 * Backlog tab, two modes.
 *
 * Backlog   — open work with no sprint, ranked, with inline estimates and a
 *             multi-select that pushes a batch into a sprint.
 * Delivered — what each person actually finished in a date window, by points,
 *             task count and logged time.
 */
export function BacklogView({
  project,
  onOpenTask,
}: {
  project: Project;
  onOpenTask: (t: Task) => void;
}) {
  const { user } = useAuth();
  const { tasks, currentWorkspace } = useWorkspace();
  const [mode, setMode] = useState<Mode>("backlog");
  const [sprints, setSprints] = useState<Sprint[]>([]);

  useEffect(() => {
    if (!user) return;
    return watchSprints(user.uid, project.id, setSprints);
  }, [user, project.id]);

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4">
      <div className="mb-4 flex items-center gap-1">
        <Tab active={mode === "backlog"} onClick={() => setMode("backlog")} icon={Layers}>
          Backlog
        </Tab>
        <Tab active={mode === "delivered"} onClick={() => setMode("delivered")} icon={CheckCircle2}>
          Delivered
        </Tab>
      </div>

      {mode === "backlog" ? (
        <Backlog tasks={tasks} sprints={sprints} onOpenTask={onOpenTask} />
      ) : (
        <Delivered
          tasks={tasks}
          people={(currentWorkspace?.members ?? []).filter(
            (m) => !project.memberIds || project.memberIds.includes(m.uid)
          )}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Layers;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/* ------------------------------ backlog ------------------------------ */

function Backlog({
  tasks,
  sprints,
  onOpenTask,
}: {
  tasks: Task[];
  sprints: Sprint[];
  onOpenTask: (t: Task) => void;
}) {
  const actions = useTaskActions();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Top-level only. A subtask belongs to its parent's commitment, not its own.
  const rows = useMemo(
    () =>
      backlogTasks(tasks)
        .filter((t) => !t.parentId)
        .sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            a.order - b.order
        ),
    [tasks]
  );

  const openSprints = sprints.filter((s) => s.status !== "completed");
  const pickedTasks = rows.filter((t) => picked.has(t.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const push = async (sprintId: string) => {
    await assignTasksToSprint([...picked], sprintId);
    setPicked(new Set());
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-faint">
          Unscheduled
        </span>
        <span className="mono text-2xs text-text-faint">{rows.length}</span>
        <span className="mono text-2xs text-text-muted">{sumPoints(rows)} pts</span>

        {picked.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="mono text-2xs text-text-muted">
              {picked.size} selected · {sumPoints(pickedTasks)} pts
            </span>
            {openSprints.length === 0 ? (
              <span className="text-2xs text-text-faint">Create a sprint first</span>
            ) : (
              openSprints.map((s) => (
                <Button key={s.id} variant="outline" size="sm" onClick={() => void push(s.id)}>
                  <Rocket className="h-3.5 w-3.5" /> {s.name}
                </Button>
              ))
            )}
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-sm font-medium text-text">The backlog is empty</div>
            <div className="mt-0.5 text-xs text-text-muted">
              Everything open is committed to a sprint. Add what comes next below.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((t) => (
              <BacklogRow
                key={t.id}
                task={t}
                picked={picked.has(t.id)}
                onPick={() => toggle(t.id)}
                onOpen={() => onOpenTask(t)}
                onEstimate={(v) => actions.setEstimate(t.id, v)}
                onStatus={(s) => actions.setStatus(t.id, s)}
              />
            ))}
          </div>
        )}
        <div className="border-t border-border/60 px-2">
          <QuickAdd placeholder="Add to backlog" onAdd={(title) => actions.add(title)} />
        </div>
      </div>
    </>
  );
}

/** Story point presets. Fibonacci, because relative sizing stops pretending to
 *  be hours somewhere around 8. */
const POINTS = [1, 2, 3, 5, 8, 13];

function BacklogRow({
  task,
  picked,
  onPick,
  onOpen,
  onEstimate,
  onStatus,
}: {
  task: Task;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onEstimate: (v: number | null) => void;
  onStatus: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 transition-colors sm:gap-2.5 sm:px-3",
        picked ? "bg-accent/[0.06]" : "hover:bg-surface-2"
      )}
    >
      <input
        type="checkbox"
        checked={picked}
        onChange={onPick}
        aria-label={`Select ${task.title}`}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <StatusControl status={task.status} onChange={onStatus} />
      <PriorityDot priority={task.priority} />
      <button onClick={onOpen} className="flex-1 truncate py-3 text-left text-[13.5px] text-text sm:py-2.5">
        {task.title}
      </button>

      {taskAssignees(task).length > 0 && (
        <AssigneeStack assignees={taskAssignees(task)} size={18} max={3} />
      )}
      <DueDateChip date={task.dueDate} time={task.dueTime} status={task.status} icon={false} />

      {/* estimate */}
      <div className="relative shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          title="Story points"
          className={cn(
            "mono inline-flex h-6 min-w-[30px] items-center justify-center gap-0.5 rounded-md border px-1.5 text-2xs transition-colors",
            task.estimate != null
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-dashed border-border text-text-faint hover:border-border-strong hover:text-text-muted"
          )}
        >
          {task.estimate ?? "–"}
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-7 z-50 flex gap-0.5 rounded-md border border-border bg-surface p-1 shadow-pop">
              {POINTS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onEstimate(p);
                    setOpen(false);
                  }}
                  className={cn(
                    "mono grid h-6 w-6 place-items-center rounded text-2xs transition-colors",
                    task.estimate === p
                      ? "bg-accent text-accent-fg"
                      : "text-text-muted hover:bg-surface-2 hover:text-text"
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => {
                  onEstimate(null);
                  setOpen(false);
                }}
                className="grid h-6 w-6 place-items-center rounded text-2xs text-text-faint hover:bg-surface-2 hover:text-danger"
                title="Clear"
              >
                ×
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ delivered ------------------------------ */

const RANGES = [
  { id: "7", label: "7 days", days: 7 },
  { id: "14", label: "14 days", days: 14 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
];

function Delivered({
  tasks,
  people,
  onOpenTask,
}: {
  tasks: Task[];
  people: { uid: string; name: string; photoURL?: string | null }[];
  onOpenTask: (t: Task) => void;
}) {
  const [range, setRange] = useState("14");
  const to = todayISO();
  const days = RANGES.find((r) => r.id === range)?.days ?? 14;
  const from = toISODate(addDays(new Date(to), -(days - 1)));

  const rows = useMemo(() => deliveredByPerson(tasks, from, to, people), [tasks, from, to, people]);
  const orphans = useMemo(() => deliveredUnassigned(tasks, from, to), [tasks, from, to]);
  const totalTasks = rows.reduce((n, r) => n + r.tasks.length, 0) + orphans.length;

  // Tasks completed before completedAt existed carry no timestamp and would
  // otherwise vanish from this view with no explanation.
  const untimed = tasks.filter((t) => t.status === "done" && !t.completedAt).length;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-faint">
          Completed per person
        </span>
        <span className="mono text-2xs text-text-faint">{totalTasks}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                range === r.id
                  ? "bg-surface-2 text-text"
                  : "text-text-muted hover:bg-surface-2 hover:text-text"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 px-1 text-2xs text-text-faint">
        {format(new Date(from), "d MMM")} – {format(new Date(to), "d MMM yyyy")}
      </p>

      {rows.every((r) => r.tasks.length === 0) && orphans.length === 0 ? (
        <div className="card px-4 py-10 text-center">
          <div className="text-sm font-medium text-text">Nothing completed in this window</div>
          <div className="mt-0.5 text-xs text-text-muted">
            Try a longer range, or close some work.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {rows
            .filter((r) => r.tasks.length > 0)
            .map((r) => (
              <PersonCard key={r.uid} row={r} onOpenTask={onOpenTask} />
            ))}
          {orphans.length > 0 && (
            <PersonCard
              row={{
                uid: "unassigned",
                name: "Unassigned",
                tasks: orphans,
                points: sumPoints(orphans),
                seconds: 0,
              }}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
      )}

      {untimed > 0 && (
        <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-2xs text-text-muted">
          {untimed} task{untimed === 1 ? "" : "s"} finished before completion tracking started, so
          {untimed === 1 ? " it does" : " they do"} not appear here. Anything closed from now on
          will.
        </p>
      )}
    </>
  );
}

function PersonCard({ row, onOpenTask }: { row: DeliveredRow; onOpenTask: (t: Task) => void }) {
  const [open, setOpen] = useState(false);
  const hours = row.seconds / 3600;
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        {row.uid === "unassigned" ? (
          <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-border text-2xs text-text-faint">
            ?
          </span>
        ) : (
          <Avatar name={row.name} src={row.avatar} size={24} />
        )}
        <span className="flex-1 truncate text-[13.5px] font-medium text-text">{row.name}</span>
        <span className="mono text-2xs text-text-muted">{row.tasks.length} done</span>
        {row.points > 0 && <span className="mono text-2xs text-accent">{row.points} pts</span>}
        {hours >= 0.1 && (
          <span className="mono inline-flex items-center gap-1 text-2xs text-text-faint">
            <Clock className="h-3 w-3" />
            {hours.toFixed(1)}h
          </span>
        )}
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-text-faint transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="divide-y divide-border/60 border-t border-border">
          {row.tasks
            .slice()
            .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
            .map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenTask(t)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-done" />
                <span className="flex-1 truncate text-[13px] text-text-muted line-through">
                  {t.title}
                </span>
                {t.estimate != null && (
                  <span className="mono text-2xs text-text-faint">{t.estimate}p</span>
                )}
                <span className="mono text-2xs text-text-faint">
                  {t.completedAt ? format(new Date(t.completedAt), "d MMM") : ""}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
