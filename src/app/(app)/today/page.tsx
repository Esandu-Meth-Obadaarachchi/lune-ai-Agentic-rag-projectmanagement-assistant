"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CalendarCheck2, ChevronLeft, ChevronRight, Download, NotebookPen } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { saveDayPlan, watchDayPlan } from "@/lib/data/firestore";
import { addDays, format } from "date-fns";
import { dueLabel, greeting, toISODate, todayISO } from "@/lib/date";
import type { Task, Workspace } from "@/lib/types";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { AssigneeStack } from "@/components/task/Pickers";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { Logo } from "@/components/ui/Logo";
import { PRIORITY_ORDER } from "@/lib/constants";
import { exportTodayCSV, type DayExportRow } from "@/lib/export";
import { cn, taskAssignees } from "@/lib/utils";

export default function TodayPage() {
  const { user } = useAuth();
  const { allTasks, allProjects: projects, workspaces, openWorkspaceProject } = useWorkspace();
  const router = useRouter();
  const today = todayISO();

  // The day the whole view is focused on. Defaults to today; the header and the
  // notebook share this so navigating moves the task list and the planner together.
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const shiftDate = (days: number) => setDate((d) => toISODate(addDays(new Date(d), days)));

  const projName = useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.isInbox ? "Inbox" : p.name));
    return m;
  }, [projects]);

  // Tasks assigned to me sort to the top; ties fall back to time then priority.
  const sortMineFirst = useMemo(() => {
    const mine = (t: Task) => taskAssignees(t).some((a) => a.id === user?.uid);
    return (a: Task, b: Task) => {
      const am = mine(a);
      const bm = mine(b);
      if (am !== bm) return am ? -1 : 1;
      return byTimeThenPriority(a, b);
    };
  }, [user?.uid]);

  // Every open task due on the focused day, from every workspace and project.
  const dueOnDate = useMemo(
    () =>
      allTasks
        .filter((t) => t.status !== "done" && t.dueDate === date)
        .sort(sortMineFirst),
    [allTasks, date, sortMineFirst]
  );
  // Overdue is always relative to the real today, and only shown when the view
  // is focused on today — it makes no sense against a future or past day.
  const overdue = useMemo(
    () =>
      allTasks
        .filter((t) => t.status !== "done" && !!t.dueDate && t.dueDate < today)
        .sort(sortMineFirst),
    [allTasks, today, sortMineFirst]
  );
  const showOverdue = isToday && overdue.length > 0;
  const doneOnDate = allTasks.filter((t) => t.status === "done" && t.dueDate === date).length;

  // Everything on the plate for the focused day: due that day (any status) +
  // still-open overdue when the day in view is today.
  const exportToday = () => {
    const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name;
    const rows: DayExportRow[] = [
      ...allTasks
        .filter((t) => t.dueDate === date)
        .map((t) => ({
          task: t,
          bucket: "Due today" as const,
          workspace: wsName(t.workspaceId),
          project: projName.get(t.projectId),
        })),
      ...(showOverdue
        ? overdue.map((t) => ({
            task: t,
            bucket: "Overdue" as const,
            workspace: wsName(t.workspaceId),
            project: projName.get(t.projectId),
          }))
        : []),
    ];
    exportTodayCSV(date, rows);
  };

  const wsById = useMemo(() => {
    const m = new Map<string, Workspace>();
    workspaces.forEach((w) => m.set(w.id, w));
    return m;
  }, [workspaces]);

  const openTask = (t: Task) => {
    openWorkspaceProject(t.workspaceId, t.projectId);
    router.push(`/?task=${t.id}`);
  };

  if (!user) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={32} className="animate-pulse-dot" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-hairline/[0.08] px-4 py-3 sm:px-5 sm:py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/[0.12] text-accent shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]">
          <CalendarCheck2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h1 className="t-title truncate text-xl">
            {isToday ? greeting() : dueLabel(date) || format(new Date(date), "EEEE")}
          </h1>
          <p className="mt-0.5 text-2xs text-text-faint">{format(new Date(date), "EEEE, d MMMM")}</p>
        </div>
        <div className="ml-auto flex w-full items-center gap-1.5 sm:w-auto">
          <div className="hidden items-center gap-4 sm:flex">
            <Stat label={isToday ? "due today" : "due"} value={dueOnDate.length} />
            {showOverdue && <Stat label="overdue" value={overdue.length} tone="danger" />}
            {doneOnDate > 0 && <Stat label="done" value={doneOnDate} />}
          </div>
          {/* One segmented cluster: prev / today / next reads as a single
              control rather than three boxes that happen to sit together. */}
          <div className="flex items-center gap-0.5 rounded-md border border-hairline/[0.06] bg-hairline/[0.025] p-0.5">
            <button
              onClick={() => shiftDate(-1)}
              title="Previous day"
              aria-label="Previous day"
              className="press grid h-7 w-7 place-items-center rounded-[7px] text-text-muted transition-colors hover:bg-hairline/[0.07] hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setDate(today)}
              title="Jump to today"
              className={cn(
                "press h-7 rounded-[7px] px-2.5 text-2xs font-medium transition-colors",
                isToday
                  ? "text-text-faint"
                  : "bg-accent/15 text-accent hover:bg-accent/20"
              )}
            >
              {isToday ? "Today" : "Back to today"}
            </button>
            <button
              onClick={() => shiftDate(1)}
              title="Next day"
              aria-label="Next day"
              className="press grid h-7 w-7 place-items-center rounded-[7px] text-text-muted transition-colors hover:bg-hairline/[0.07] hover:text-text"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={exportToday}
            title="Export the day's tasks as CSV"
            className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-hairline/[0.12] px-2.5 text-2xs font-medium text-text-muted shadow-[inset_0_1px_0_rgb(var(--hairline)/0.05)] transition-colors hover:border-hairline/20 hover:bg-hairline/[0.05] hover:text-text"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:gap-5 sm:px-5 sm:py-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: the day's tasks */}
        <section className="min-w-0 space-y-6">
          <TaskGroup
            title={isToday ? "Due today" : `Due ${dueLabel(date) || format(new Date(date), "d MMM")}`}
            tasks={dueOnDate}
            wsById={wsById}
            projName={projName}
            onOpen={openTask}
            empty={
              isToday
                ? "Nothing is due today. Enjoy the quiet, or pull something forward."
                : "Nothing is due on this day."
            }
          />
          {showOverdue && (
            <TaskGroup
              title="Overdue"
              tasks={overdue}
              wsById={wsById}
              projName={projName}
              onOpen={openTask}
              tone="danger"
            />
          )}
        </section>

        {/* Right: the notebook, following the same focused day */}
        <Notebook uid={user.uid} date={date} setDate={setDate} today={today} />
      </div>
    </div>
  );
}

function byTimeThenPriority(a: Task, b: Task): number {
  const at = a.dueTime ?? "99:99";
  const bt = b.dueTime ?? "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  // PRIORITY_ORDER runs urgent -> low, so a lower index means higher priority.
  return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
}

function TaskGroup({
  title,
  tasks,
  wsById,
  projName,
  onOpen,
  empty,
  tone,
}: {
  title: string;
  tasks: Task[];
  wsById: Map<string, Workspace>;
  projName: Map<string, string>;
  onOpen: (t: Task) => void;
  empty?: string;
  tone?: "danger";
}) {
  return (
    <div>
      <h2
        className={cn(
          "mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.09em]",
          tone === "danger" ? "text-danger" : "text-text-faint"
        )}
      >
        {title}
        <span className="mono rounded bg-hairline/[0.07] px-1.5 py-px text-2xs font-semibold normal-case tracking-normal text-text-muted">
          {tasks.length}
        </span>
      </h2>
      {tasks.length === 0 ? (
        empty ? (
          <div className="card grid place-items-center gap-2 px-4 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-hairline/[0.06] text-text-faint shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]">
              <CalendarCheck2 className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <p className="max-w-[34ch] text-sm text-text-muted">{empty}</p>
          </div>
        ) : null
      ) : (
        <div className="card divide-y divide-hairline/[0.042] overflow-hidden">
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t)}
              className="relative flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors duration-150 hover:bg-hairline/[0.05] sm:py-2.5"
            >
              <PriorityDot priority={t.priority} />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{t.title}</span>
              {taskAssignees(t).length > 0 && (
                <span className="shrink-0">
                  <AssigneeStack assignees={taskAssignees(t)} size={18} max={3} />
                </span>
              )}
              <span className="hidden shrink-0 items-center gap-1 text-2xs text-text-faint md:flex">
                {wsById.get(t.workspaceId)?.emoji}
                {wsById.get(t.workspaceId)?.name}
                {projName.get(t.projectId) && (
                  <>
                    <span className="text-text-faint/50">/</span>
                    <span className="text-text-muted">{projName.get(t.projectId)}</span>
                  </>
                )}
              </span>
              <DueDateChip date={t.dueDate} time={t.dueTime} status={t.status} icon={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A per-day personal notebook that autosaves to Firestore. Its day is driven by
 *  the page so the task list and the planner always move together. */
function Notebook({
  uid,
  date,
  setDate,
  today,
}: {
  uid: string;
  date: string;
  setDate: Dispatch<SetStateAction<string>>;
  today: string;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const editingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load + live-sync the note for the selected day.
  useEffect(() => {
    editingRef.current = false;
    setStatus("idle");
    const unsub = watchDayPlan(uid, date, (c) => {
      if (!editingRef.current) setContent(c);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [uid, date]);

  const onChange = (v: string) => {
    editingRef.current = true;
    setContent(v);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await saveDayPlan(uid, date, v);
      setStatus("saved");
    }, 600);
  };

  const shift = (days: number) => setDate((d) => toISODate(addDays(new Date(d), days)));
  const isToday = date === today;

  return (
    <section className="min-w-0 min-h-[320px] lg:sticky lg:top-6 lg:h-[calc(100vh-8.5rem)]">
      <div className="card flex h-full flex-col overflow-hidden">
        <div className="lit flex items-center gap-2 border-b border-hairline/[0.07] px-3.5 py-2.5">
          <NotebookPen className="h-4 w-4 text-accent" />
          <span className="t-heading text-sm text-text">Day planner</span>
          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-hairline/[0.06] bg-hairline/[0.025] p-0.5">
            <button
              onClick={() => shift(-1)}
              className="press grid h-6 w-6 place-items-center rounded-[6px] text-text-faint transition-colors hover:bg-hairline/[0.07] hover:text-text"
              title="Previous day"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setDate(today)}
              className={cn(
                "mono press rounded-[6px] px-2 py-0.5 text-2xs font-medium transition-colors",
                isToday ? "text-text-faint" : "text-accent hover:bg-hairline/[0.07]"
              )}
            >
              {dueLabel(date) || format(new Date(date), "d MMM")}
            </button>
            <button
              onClick={() => shift(1)}
              className="press grid h-6 w-6 place-items-center rounded-[6px] text-text-faint transition-colors hover:bg-hairline/[0.07] hover:text-text"
              title="Next day"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={"Plan your day…\n\n09:00  Deep work — solar dashboard\n11:00  Standup\n14:00  Gradify build\n\nNotes, ideas, anything."}
          className="min-h-[280px] flex-1 resize-none bg-transparent px-4 py-3.5 text-sm leading-[1.75] text-text outline-none placeholder:text-text-faint/60"
          spellCheck={false}
        />
        <div className="flex items-center justify-end gap-1.5 border-t border-hairline/[0.07] px-3.5 py-1.5 text-2xs text-text-faint">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              status === "saving" ? "animate-pulse-dot bg-accent" : "bg-ok/70"
            )}
            aria-hidden
          />
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Synced"}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "mono text-base font-semibold tabular-nums",
          tone === "danger" && value > 0 ? "text-danger" : "text-text"
        )}
      >
        {value}
      </span>
      <span className="whitespace-nowrap text-2xs text-text-faint">{label}</span>
    </span>
  );
}
