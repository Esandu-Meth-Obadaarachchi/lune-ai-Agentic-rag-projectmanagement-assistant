"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { CalendarRange, Flag, Play, Plus, Rocket, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  startSprint,
  watchSprints,
} from "@/lib/data/firestore";
import {
  averageVelocity,
  burndown,
  sprintStats,
  sprintTasks,
  velocity,
} from "@/lib/data/sprint";
import { toISODate, todayISO } from "@/lib/date";
import type { Project, Sprint, Task } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Modal, inputClass } from "@/components/ui/Modal";
import { TaskCard } from "@/components/task/TaskCard";
import { Burndown, Velocity } from "./SprintCharts";
import { cn } from "@/lib/utils";

/**
 * Sprint tab. One project's sprints: the active one with its board, burndown and
 * commitment, plus planning for what comes next and velocity across what closed.
 */
export function SprintView({
  project,
  onOpenTask,
}: {
  project: Project;
  onOpenTask: (t: Task) => void;
}) {
  const { user } = useAuth();
  const { tasks } = useWorkspace();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<Sprint | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchSprints(user.uid, project.id, setSprints);
  }, [user, project.id]);

  const active = sprints.find((s) => s.status === "active") ?? null;
  const planned = sprints.filter((s) => s.status === "planned");
  const completed = sprints.filter((s) => s.status === "completed");

  const bars = useMemo(() => velocity(sprints, tasks), [sprints, tasks]);
  const avg = averageVelocity(bars);

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Sprints</h2>
        <span className="mono text-2xs text-text-faint">{sprints.length}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New sprint
        </Button>
      </div>

      {active ? (
        <ActiveSprint
          sprint={active}
          tasks={tasks}
          onOpenTask={onOpenTask}
          onClose={() => setClosing(active)}
        />
      ) : (
        <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-text-muted">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-text">No sprint running</div>
            <div className="mt-0.5 max-w-sm text-xs text-text-muted">
              Plan a sprint, pull work into it from the Backlog tab, then start it.
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Plan a sprint
          </Button>
        </div>
      )}

      {planned.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Planned</SectionTitle>
          <div className="space-y-2">
            {planned.map((s) => (
              <PlannedRow
                key={s.id}
                sprint={s}
                tasks={tasks}
                canStart={!active}
                onStart={() => void startSprint(s, tasks, sprints)}
                onDelete={() => void deleteSprint(s.id, tasks)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <SectionTitle>Velocity</SectionTitle>
        <div className="card p-4">
          <Velocity bars={bars} average={avg} />
        </div>
      </section>

      {completed.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Closed</SectionTitle>
          <div className="card divide-y divide-border/60 overflow-hidden">
            {completed.map((s) => {
              const st = sprintStats(s, tasks);
              return (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Flag className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  <span className="flex-1 truncate text-[13px] text-text">{s.name}</span>
                  <span className="mono hidden text-2xs text-text-faint sm:inline">
                    {format(new Date(s.startDate), "d MMM")} – {format(new Date(s.endDate), "d MMM")}
                  </span>
                  <span className="mono text-2xs text-text-muted">
                    {st.donePoints}/{st.committed} pts
                  </span>
                  <span className="mono text-2xs text-text-faint">
                    {st.done}/{st.total} tasks
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {creating && (
        <CreateSprintModal
          project={project}
          existing={sprints}
          onClose={() => setCreating(false)}
        />
      )}
      {closing && (
        <CloseSprintModal
          sprint={closing}
          sprints={sprints}
          tasks={tasks}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">
      {children}
    </h3>
  );
}

/* ------------------------------ active sprint ------------------------------ */

function ActiveSprint({
  sprint,
  tasks,
  onOpenTask,
  onClose,
}: {
  sprint: Sprint;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  onClose: () => void;
}) {
  const stats = sprintStats(sprint, tasks);
  const chart = useMemo(() => burndown(sprint, tasks), [sprint, tasks]);
  const inSprint = sprintTasks(tasks, sprint.id).sort((a, b) => a.order - b.order);
  const late = stats.daysLeft < 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/10 text-accent">
          <Rocket className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-text">{sprint.name}</h3>
            <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-2xs font-medium text-accent">
              Active
            </span>
          </div>
          {sprint.goal && <p className="truncate text-2xs text-text-muted">{sprint.goal}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Stat label="pts done" value={`${stats.donePoints}/${stats.committed}`} />
          <Stat label="tasks" value={`${stats.done}/${stats.total}`} />
          <Stat
            label={late ? "days over" : "days left"}
            value={Math.abs(stats.daysLeft)}
            tone={late ? "danger" : undefined}
          />
          <Button variant="outline" size="sm" onClick={onClose}>
            <Flag className="h-3.5 w-3.5" /> Complete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <SectionTitle>Committed work</SectionTitle>
          {inSprint.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-2xs text-text-faint">
              Nothing committed yet. Pull tasks in from the Backlog tab.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {inSprint.map((t) => (
                <TaskCard key={t.id} task={t} onOpen={() => onOpenTask(t)} />
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <SectionTitle>Burndown</SectionTitle>
          <Burndown data={chart} />
          {stats.unestimated > 0 && (
            <p className="mt-2 rounded-md border border-warn/25 bg-warn/10 px-2.5 py-1.5 text-2xs text-warn">
              {stats.unestimated} task{stats.unestimated === 1 ? " has" : "s have"} no estimate, so
              the burndown understates what is left.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PlannedRow({
  sprint,
  tasks,
  canStart,
  onStart,
  onDelete,
}: {
  sprint: Sprint;
  tasks: Task[];
  canStart: boolean;
  onStart: () => void;
  onDelete: () => void;
}) {
  const stats = sprintStats(sprint, tasks);
  return (
    <div className="card flex flex-wrap items-center gap-2.5 px-3 py-2.5">
      <CalendarRange className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text">{sprint.name}</div>
        <div className="mono text-2xs text-text-faint">
          {format(new Date(sprint.startDate), "d MMM")} –{" "}
          {format(new Date(sprint.endDate), "d MMM")}
        </div>
      </div>
      <span className="mono text-2xs text-text-muted">
        {stats.totalPoints} pts · {stats.total} tasks
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onStart}
        disabled={!canStart}
        title={canStart ? "Start this sprint" : "Complete the running sprint first"}
      >
        <Play className="h-3.5 w-3.5" /> Start
      </Button>
      <button
        onClick={onDelete}
        title="Delete sprint. Its tasks return to the backlog."
        className="grid h-7 w-7 place-items-center rounded-md text-text-faint hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------ modals ------------------------------ */

function CreateSprintModal({
  project,
  existing,
  onClose,
}: {
  project: Project;
  existing: Sprint[];
  onClose: () => void;
}) {
  const today = todayISO();
  const [name, setName] = useState(`Sprint ${existing.length + 1}`);
  const [goal, setGoal] = useState("");
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(toISODate(addDays(new Date(today), 13)));
  const [busy, setBusy] = useState(false);

  const invalid = !name.trim() || endDate < startDate;

  const save = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      await createSprint(project, { name, goal, startDate, endDate });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Plan a sprint" width={420}>
      <Field label="Name">
        <input
          autoFocus
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
      </Field>
      <Field label="Goal (optional)">
        <input
          className={inputClass}
          placeholder="What should be true when this sprint ends?"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={120}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Ends">
          <input
            type="date"
            className={inputClass}
            value={endDate}
            min={startDate}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      {endDate < startDate && (
        <p className="mb-2 text-2xs text-danger">The end date falls before the start date.</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={invalid || busy}>
          {busy ? "Creating…" : "Create sprint"}
        </Button>
      </div>
    </Modal>
  );
}

function CloseSprintModal({
  sprint,
  sprints,
  tasks,
  onClose,
}: {
  sprint: Sprint;
  sprints: Sprint[];
  tasks: Task[];
  onClose: () => void;
}) {
  const open = sprintTasks(tasks, sprint.id).filter((t) => t.status !== "done");
  const targets = sprints.filter((s) => s.id !== sprint.id && s.status === "planned");
  const [carryTo, setCarryTo] = useState<string>("backlog");
  const [busy, setBusy] = useState(false);
  const stats = sprintStats(sprint, tasks);

  const save = async () => {
    setBusy(true);
    try {
      await completeSprint(sprint.id, tasks, carryTo);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Complete ${sprint.name}`} width={420}>
      <p className="mb-3 text-[13px] leading-relaxed text-text-muted">
        Delivered <span className="mono font-medium text-text">{stats.donePoints}</span> of{" "}
        <span className="mono font-medium text-text">{stats.committed}</span> committed points
        across <span className="mono font-medium text-text">{stats.done}</span> tasks.
      </p>

      {open.length > 0 ? (
        <Field label={`Move the ${open.length} unfinished task${open.length === 1 ? "" : "s"} to`}>
          <select
            className={inputClass}
            value={carryTo}
            onChange={(e) => setCarryTo(e.target.value)}
          >
            <option value="backlog">Backlog</option>
            {targets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="mb-3 text-[13px] text-text-muted">Everything committed was finished.</p>
      )}

      <p className="mb-3 text-2xs text-text-faint">
        Completed tasks stay attached to this sprint so the velocity history holds.
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? "Closing…" : "Complete sprint"}
        </Button>
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-text-muted",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger"
      )}
    >
      <span className="mono font-semibold text-text">{value}</span>
      {label}
    </span>
  );
}
