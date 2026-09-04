"use client";

import { useState } from "react";
import { format } from "date-fns";
import type { Task } from "@/lib/types";
import { parseDate } from "@/lib/date";
import { Modal } from "@/components/ui/Modal";
import { StatusControl } from "@/components/ui/StatusControl";
import { QuickAdd } from "@/components/task/TaskRow";
import { cn } from "@/lib/utils";
import type { GEvent } from "./CalendarView";

/** Google-Calendar-style agenda for a single day: all-day items first, then
 *  timed items ascending. Tasks are clickable; Google events are read-only. */
export function DayDetail({
  iso,
  tasks,
  events,
  projColor,
  projName,
  foreignWs,
  onOpenTask,
  onSetStatus,
  onAdd,
  onClose,
}: {
  iso: string;
  tasks: Task[];
  events: GEvent[];
  projColor: Map<string, string>;
  projName: Map<string, string>;
  /** taskId -> workspace name for tasks merged in from another workspace. */
  foreignWs?: Map<string, string>;
  onOpenTask: (t: Task) => void;
  onSetStatus: (id: string, s: Task["status"]) => void;
  onAdd: (title: string) => void;
  onClose: () => void;
}) {
  const d = parseDate(iso) ?? new Date(iso);
  const sortedTasks = [...tasks].sort(byTime((t) => t.dueTime));
  const sortedEvents = [...events].sort(byTime((e) => e.time));
  const [adding, setAdding] = useState(false);

  return (
    <Modal open onClose={onClose} title={format(d, "EEEE d MMMM")} width={420}>
      <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-0.5">
        {sortedTasks.length === 0 && sortedEvents.length === 0 && (
          <p className="py-6 text-center text-sm text-text-faint">Nothing scheduled.</p>
        )}

        {sortedTasks.map((t) => {
          // From another workspace: shown so the clash is visible, but not
          // actionable here — its project is not loaded in this workspace.
          const foreign = foreignWs?.get(t.id);
          if (foreign) {
            return (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 opacity-60"
                title={`${t.title} — ${foreign} (other workspace)`}
              >
                <span className="grid h-[15px] w-[15px] shrink-0 place-items-center">
                  <span
                    className="h-2 w-2 rounded-[3px]"
                    style={{ background: projColor.get(t.projectId) ?? "rgb(var(--text-faint))" }}
                  />
                </span>
                <span className="mono w-11 shrink-0 text-2xs text-text-faint">
                  {t.dueTime ?? "all-day"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{t.title}</span>
                <span className="shrink-0 text-2xs text-text-faint">{foreign}</span>
              </div>
            );
          }
          return (
            <div
              key={t.id}
              className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hairline/[0.06]"
            >
              <StatusControl status={t.status} onChange={(s) => onSetStatus(t.id, s)} size={15} />
              <span className="mono w-11 shrink-0 text-2xs text-text-faint">
                {t.dueTime ?? "all-day"}
              </span>
              <button
                onClick={() => {
                  onOpenTask(t);
                  onClose();
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 text-left text-sm",
                  t.status === "done" ? "text-text-faint line-through" : "text-text"
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-[3px]"
                  style={{ background: projColor.get(t.projectId) ?? "rgb(var(--text-faint))" }}
                />
                <span className="truncate">{t.title}</span>
              </button>
              <span className="hidden shrink-0 text-2xs text-text-faint sm:inline">
                {projName.get(t.projectId)}
              </span>
            </div>
          );
        })}

        {sortedEvents.map((e) => (
          <div key={e.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5" title="Google Calendar">
            <span className="grid h-[15px] w-[15px] shrink-0 place-items-center">
              <span className="h-2 w-2 rounded-full bg-info" />
            </span>
            <span className="mono w-11 shrink-0 text-2xs text-text-faint">{e.time ?? "all-day"}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{e.title}</span>
            <span className="shrink-0 text-2xs text-info">Google</span>
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-hairline/[0.08] pt-1.5">
        {adding ? (
          <QuickAdd
            autoFocus
            placeholder={`Add task on ${format(d, "d MMM")}`}
            onAdd={(title) => onAdd(title)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-text-faint hover:bg-hairline/[0.06] hover:text-text"
          >
            + Add task on this day
          </button>
        )}
      </div>
    </Modal>
  );
}

function byTime<T>(get: (x: T) => string | null | undefined) {
  return (a: T, b: T) => {
    const ta = get(a);
    const tb = get(b);
    if (!ta && !tb) return 0;
    if (!ta) return -1; // all-day first
    if (!tb) return 1;
    return ta.localeCompare(tb);
  };
}
