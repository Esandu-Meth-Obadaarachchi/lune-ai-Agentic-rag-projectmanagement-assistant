"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { useAuth } from "@/lib/auth/AuthContext";
import { authedFetch } from "@/lib/api";
import { toISODate } from "@/lib/date";
import { taskAssignees } from "@/lib/utils";
import type { Project, Task } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { CalendarSync } from "@/components/project/CalendarSync";
import { DayDetail } from "./DayDetail";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface GEvent {
  id: string;
  title: string;
  time: string | null;
  allDay: boolean;
}

export function CalendarView({
  onOpenTask,
  tasks: tasksProp,
  projects: projectsProp,
}: {
  onOpenTask: (t: Task) => void;
  /** Cross-project task set (My Tasks). Defaults to the current workspace's tasks. */
  tasks?: Task[];
  /** Projects used for colour/name lookup (pass all projects for the cross-project view). */
  projects?: Project[];
}) {
  const ctx = useWorkspace();
  const { user } = useAuth();
  const projects = projectsProp ?? ctx.projects;

  /**
   * Scheduled work in *other* workspaces still occupies the same hours. Left out,
   * a deadline set in one workspace is invisible while you plan in another and you
   * double-book yourself. These are merged in read-only and shown dimmed — they are
   * context ("you are busy then"), not work you can act on from here.
   *
   * Deliberately narrow: due-dated, already synced to Google Calendar, and assigned
   * to you. Anything looser would drown the current workspace's own calendar.
   */
  const crossWorkspace = useMemo(() => {
    if (tasksProp) return []; // caller supplied an explicit set (My Tasks) — respect it
    const wsId = ctx.currentWorkspace?.id;
    const uid = user?.uid;
    if (!wsId || !uid) return [];
    return ctx.allTasks.filter(
      (t) =>
        t.workspaceId !== wsId &&
        !!t.dueDate &&
        !!t.googleEventId &&
        taskAssignees(t).some((a) => a.id === uid)
    );
  }, [tasksProp, ctx.allTasks, ctx.currentWorkspace?.id, user?.uid]);

  const tasks = useMemo(
    () => tasksProp ?? [...ctx.workspaceTasks, ...crossWorkspace],
    [tasksProp, ctx.workspaceTasks, crossWorkspace]
  );

  /** taskId -> owning workspace name, for the chips that came from elsewhere. */
  const foreignWs = useMemo(() => {
    const names = new Map(ctx.workspaces.map((w) => [w.id, w.name]));
    return new Map(
      crossWorkspace.map((t) => [t.id, names.get(t.workspaceId) ?? "Other workspace"])
    );
  }, [crossWorkspace, ctx.workspaces]);
  const actions = useTaskActions();
  const [month, setMonth] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const projColor = useMemo(() => new Map(projects.map((p) => [p.id, p.color])), [projects]);
  const projName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const list = map.get(t.dueDate) ?? [];
      list.push(t);
      map.set(t.dueDate, list);
    });
    return map;
  }, [tasks]);

  // Read-only overlay of the user's real Google Calendar events for the visible range.
  const [gEvents, setGEvents] = useState<Record<string, GEvent[]>>({});
  useEffect(() => {
    if (days.length === 0) return;
    const min = days[0];
    const max = new Date(days[days.length - 1]);
    max.setDate(max.getDate() + 1);
    let cancelled = false;
    authedFetch(
      `/api/calendar/events?timeMin=${encodeURIComponent(min.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}`
    )
      .then((r) => r.json())
      .then(({ events }: { events?: (GEvent & { date: string })[] }) => {
        if (cancelled) return;
        const map: Record<string, GEvent[]> = {};
        (events ?? []).forEach((e) => {
          (map[e.date] ??= []).push(e);
        });
        setGEvents(map);
      })
      .catch(() => !cancelled && setGEvents({}));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const active = activeId ? tasks.find((t) => t.id === activeId) : null;

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const iso = e.over?.id ? String(e.over.id) : null;
    if (iso && active && active.dueDate !== iso) actions.setDue(active.id, iso);
  };

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{format(month, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" variant="subtle" onClick={() => setMonth(new Date())}>
          Today
        </Button>
        <div className="ml-auto">
          <CalendarSync />
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-hairline/[0.08] pb-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 text-2xs font-medium uppercase tracking-wide text-text-faint">
            {d}
          </div>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
      >
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
          {days.map((day) => (
            <DayCell
              key={day.toISOString()}
              day={day}
              month={month}
              tasks={byDay.get(toISODate(day)) ?? []}
              events={gEvents[toISODate(day)] ?? []}
              projColor={projColor}
              foreignWs={foreignWs}
              onOpenTask={onOpenTask}
              onSelectDay={setSelectedDay}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? <Chip task={active} color={projColor.get(active.projectId)} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {selectedDay && (
        <DayDetail
          iso={selectedDay}
          tasks={byDay.get(selectedDay) ?? []}
          events={gEvents[selectedDay] ?? []}
          projColor={projColor}
          projName={projName}
          foreignWs={foreignWs}
          onOpenTask={onOpenTask}
          onSetStatus={(id, s) => actions.setStatus(id, s)}
          onAdd={(title) => actions.add(title, { dueDate: selectedDay })}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function DayCell({
  day,
  month,
  tasks,
  events,
  projColor,
  foreignWs,
  onOpenTask,
  onSelectDay,
}: {
  day: Date;
  month: Date;
  tasks: Task[];
  events: GEvent[];
  projColor: Map<string, string>;
  /** taskId -> workspace name, for tasks merged in from another workspace. */
  foreignWs: Map<string, string>;
  onOpenTask: (t: Task) => void;
  onSelectDay: (iso: string) => void;
}) {
  const iso = toISODate(day);
  const { setNodeRef, isOver } = useDroppable({ id: iso });
  const outside = !isSameMonth(day, month);
  const today = isToday(day);

  const shownTasks = tasks.slice(0, 3);
  const shownEvents = events.slice(0, 2);
  const more = tasks.length - shownTasks.length + (events.length - shownEvents.length);

  return (
    <div
      ref={setNodeRef}
      onClick={() => onSelectDay(iso)}
      className={cn(
        "flex min-h-[58px] cursor-pointer flex-col gap-1 border-b border-r border-hairline/[0.048] p-1 transition-colors hover:bg-hairline/[0.045] sm:min-h-[92px] sm:p-1.5",
        outside && "bg-surface/30",
        isOver && "bg-accent/[0.06] ring-1 ring-inset ring-accent/30"
      )}
    >
      <div
        className={cn(
          "grid h-5 w-5 place-items-center rounded-full text-2xs",
          today ? "bg-accent font-semibold text-accent-fg" : outside ? "text-text-faint" : "text-text-muted"
        )}
      >
        {format(day, "d")}
      </div>
      {/* A phone month-cell is ~50px wide, where a labelled chip truncates to a
          single letter and tells you nothing. Below sm the day shows dots
          instead — how much is on, at a glance — and tapping the day opens the
          existing day detail with the full list. Labels return from sm up. */}
      <div className="flex flex-wrap items-center gap-1 px-0.5 sm:hidden">
        {tasks.slice(0, 4).map((t) => (
          <span
            key={t.id}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: projColor.get(t.projectId) ?? "rgb(var(--accent))" }}
            title={t.title}
          />
        ))}
        {events.slice(0, 2).map((e) => (
          <span key={e.id} className="h-1.5 w-1.5 rounded-full bg-info" title={e.title} />
        ))}
        {tasks.length + events.length > 6 && (
          <span className="mono text-[9px] leading-none text-text-faint">
            +{tasks.length + events.length - 6}
          </span>
        )}
      </div>

      <div className="hidden space-y-1 overflow-hidden sm:block">
        {shownTasks.map((t) => (
          <Chip
            key={t.id}
            task={t}
            color={projColor.get(t.projectId)}
            foreignLabel={foreignWs.get(t.id)}
            onOpen={() => onOpenTask(t)}
          />
        ))}
        {shownEvents.map((e) => (
          <GChip key={e.id} event={e} />
        ))}
        {more > 0 && <div className="px-1 text-2xs text-text-faint">+{more} more</div>}
      </div>
    </div>
  );
}

/** Read-only Google Calendar event chip (not a task). */
function GChip({ event }: { event: GEvent }) {
  return (
    <div
      className="flex items-center gap-1 rounded border border-info/25 bg-info/[0.08] px-1.5 py-0.5 text-2xs text-info"
      title={`${event.title} (Google Calendar)`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
      {event.time && <span className="mono shrink-0 opacity-80">{event.time}</span>}
      <span className="truncate">{event.title}</span>
    </div>
  );
}

function Chip({
  task,
  color,
  onOpen,
  overlay,
  foreignLabel,
}: {
  task: Task;
  color?: string;
  onOpen?: () => void;
  overlay?: boolean;
  /** Owning workspace name when this task belongs to a different workspace. */
  foreignLabel?: string;
}) {
  // Tasks from another workspace are read-only here: dragging would reschedule
  // work outside the workspace you are looking at, and opening the drawer needs
  // that workspace's project loaded. They are a busy marker, nothing more.
  const readOnly = !!foreignLabel;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: readOnly || overlay,
  });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay || readOnly ? {} : attributes)}
      {...(overlay || readOnly ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        if (!readOnly) onOpen?.();
      }}
      title={readOnly ? `${task.title} — ${foreignLabel} (other workspace)` : task.title}
      className={cn(
        "flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs",
        readOnly
          ? "cursor-default border-dashed border-hairline/[0.056] bg-transparent text-text-faint"
          : "cursor-pointer border-hairline/[0.08] bg-surface text-text",
        overlay ? "shadow-e3" : !readOnly && "hover:border-hairline/20",
        isDragging && "opacity-40",
        task.status === "done" && "text-text-faint line-through"
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", readOnly && "opacity-50")}
        style={{ background: color ?? "rgb(var(--text-faint))" }}
      />
      {task.dueTime && <span className="mono shrink-0 opacity-70">{task.dueTime}</span>}
      <span className="truncate">{task.title}</span>
      {readOnly && <span className="ml-auto shrink-0 truncate opacity-70">·{foreignLabel}</span>}
    </div>
  );
}
