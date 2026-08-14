import { addDays, differenceInCalendarDays } from "date-fns";
import { toISODate, todayISO } from "@/lib/date";
import type { BurndownPoint, Sprint, Task } from "@/lib/types";

/**
 * Sprint maths. All of it derives from the tasks and the sprint window — nothing
 * here is stored, so history stays correct when a task is edited after the fact.
 */

/** Points on a task. An unestimated task counts as zero, never as one. */
export function points(t: Task): number {
  return t.estimate ?? 0;
}

export function sumPoints(tasks: Task[]): number {
  return tasks.reduce((n, t) => n + points(t), 0);
}

/** Every task committed to a sprint, subtasks included. */
export function sprintTasks(tasks: Task[], sprintId: string): Task[] {
  return tasks.filter((t) => t.sprintId === sprintId);
}

/**
 * Open work with no sprint. This is the backlog: the pool sprint planning draws
 * from. Done tasks are excluded — finished work with no sprint is history, not
 * something waiting to be scheduled.
 */
export function backlogTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.sprintId && t.status !== "done");
}

export interface SprintStats {
  total: number;
  done: number;
  totalPoints: number;
  donePoints: number;
  /** Points frozen at start. Falls back to the current total for a sprint that
   *  has not started yet, so planning still shows a number. */
  committed: number;
  /** Whole days from today to the end date. Negative once the sprint overruns. */
  daysLeft: number;
  /** Unestimated tasks in the sprint — the number that makes a burndown lie. */
  unestimated: number;
}

export function sprintStats(sprint: Sprint, tasks: Task[]): SprintStats {
  const inSprint = sprintTasks(tasks, sprint.id);
  const done = inSprint.filter((t) => t.status === "done");
  const totalPoints = sumPoints(inSprint);
  return {
    total: inSprint.length,
    done: done.length,
    totalPoints,
    donePoints: sumPoints(done),
    committed: sprint.committedPoints ?? totalPoints,
    daysLeft: differenceInCalendarDays(new Date(sprint.endDate), new Date(todayISO())),
    unestimated: inSprint.filter((t) => t.estimate == null).length,
  };
}

/**
 * Burndown across the sprint window.
 *
 * Remaining is reconstructed from each task's `completedAt`, so no daily
 * snapshot job is needed. One caveat worth knowing: tasks completed before
 * `completedAt` existed have no timestamp, so they read as still open for the
 * whole window. That only affects sprints backfilled onto historic data.
 */
export function burndown(sprint: Sprint, tasks: Task[]): BurndownPoint[] {
  const inSprint = sprintTasks(tasks, sprint.id);
  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const days = Math.max(differenceInCalendarDays(end, start), 0);
  const committed = sprint.committedPoints ?? sumPoints(inSprint);
  const today = todayISO();

  const out: BurndownPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const date = toISODate(addDays(start, i));
    // Everything not yet finished by the end of this day.
    const remaining = inSprint
      .filter((t) => {
        if (t.status !== "done") return true;
        if (!t.completedAt) return true;
        return toISODate(new Date(t.completedAt)) > date;
      })
      .reduce((n, t) => n + points(t), 0);
    out.push({
      date,
      remaining,
      ideal: days === 0 ? 0 : committed - (committed * i) / days,
      actual: date <= today,
    });
  }
  return out;
}

export interface VelocityBar {
  sprintId: string;
  name: string;
  committed: number;
  delivered: number;
}

/** Delivered points per completed sprint, oldest first. Feeds the velocity bars. */
export function velocity(sprints: Sprint[], tasks: Task[], limit = 6): VelocityBar[] {
  return sprints
    .filter((s) => s.status === "completed")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-limit)
    .map((s) => {
      const inSprint = sprintTasks(tasks, s.id);
      return {
        sprintId: s.id,
        name: s.name,
        committed: s.committedPoints ?? sumPoints(inSprint),
        delivered: sumPoints(inSprint.filter((t) => t.status === "done")),
      };
    });
}

/** Mean delivered points across completed sprints. null until one has closed. */
export function averageVelocity(bars: VelocityBar[]): number | null {
  if (!bars.length) return null;
  return bars.reduce((n, b) => n + b.delivered, 0) / bars.length;
}

export interface DeliveredRow {
  uid: string;
  name: string;
  avatar?: string | null;
  tasks: Task[];
  points: number;
  /** Seconds logged against those tasks, from the existing time entries. */
  seconds: number;
}

/**
 * Completed work grouped by person over a date window, ranked by points then
 * count. A task with several assignees counts for each of them — the alternative
 * is crediting only the first, which is how the members board already goes wrong.
 */
export function deliveredByPerson(
  tasks: Task[],
  from: string,
  to: string,
  people: { uid: string; name: string; photoURL?: string | null }[]
): DeliveredRow[] {
  const done = tasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return false;
    const day = toISODate(new Date(t.completedAt));
    return day >= from && day <= to;
  });

  const rows = new Map<string, DeliveredRow>();
  people.forEach((p) =>
    rows.set(p.uid, { uid: p.uid, name: p.name, avatar: p.photoURL, tasks: [], points: 0, seconds: 0 })
  );

  done.forEach((t) => {
    const assignees = t.assignees?.length
      ? t.assignees
      : t.assigneeId
        ? [{ id: t.assigneeId, name: t.assigneeName ?? "Unknown", avatar: t.assigneeAvatar }]
        : [];
    if (!assignees.length) return;
    assignees.forEach((a) => {
      const row =
        rows.get(a.id) ??
        ({ uid: a.id, name: a.name, avatar: a.avatar, tasks: [], points: 0, seconds: 0 } as DeliveredRow);
      row.tasks.push(t);
      row.points += points(t);
      row.seconds += (t.timeEntries ?? []).reduce((n, e) => n + (e.seconds ?? 0), 0);
      rows.set(a.id, row);
    });
  });

  return [...rows.values()].sort((a, b) => b.points - a.points || b.tasks.length - a.tasks.length);
}

/** Completed tasks in the window with nobody assigned — otherwise they vanish. */
export function deliveredUnassigned(tasks: Task[], from: string, to: string): Task[] {
  return tasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return false;
    const day = toISODate(new Date(t.completedAt));
    if (day < from || day > to) return false;
    return !t.assignees?.length && !t.assigneeId;
  });
}
