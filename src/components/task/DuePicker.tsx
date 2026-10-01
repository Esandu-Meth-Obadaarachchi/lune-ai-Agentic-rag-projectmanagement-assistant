"use client";

import { useState } from "react";
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
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { parseDate, toISODate } from "@/lib/date";
import type { TaskStatus } from "@/lib/types";
import { Dropdown } from "@/components/ui/Dropdown";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Due date + optional time range. A real month grid (the native date input
 * looked foreign in the dark theme and varies per browser), plus a start and
 * end time. With no start time the task is all-day; with one it becomes a timed
 * Google Calendar event.
 */
export function DuePicker({
  value,
  time,
  endTime,
  status,
  onChange,
  onTimeChange,
  onEndTimeChange,
  placeholder = true,
  onOpenChange,
}: {
  value?: string | null;
  time?: string | null;
  endTime?: string | null;
  status?: TaskStatus;
  onChange: (iso: string | null) => void;
  onTimeChange?: (time: string | null) => void;
  onEndTimeChange?: (time: string | null) => void;
  placeholder?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dropdown
      width={272}
      align="right"
      onOpenChange={onOpenChange}
      trigger={() =>
        value ? (
          <DueDateChip date={value} time={time} status={status} />
        ) : placeholder ? (
          <span
            className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-hairline/[0.06] hover:text-text"
            title="Set due date"
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span />
        )
      }
    >
      {(close) => (
        <Panel
          value={value}
          time={time}
          endTime={endTime}
          onChange={onChange}
          onTimeChange={onTimeChange}
          onEndTimeChange={onEndTimeChange}
          close={close}
        />
      )}
    </Dropdown>
  );
}

function Panel({
  value,
  time,
  endTime,
  onChange,
  onTimeChange,
  onEndTimeChange,
  close,
}: {
  value?: string | null;
  time?: string | null;
  endTime?: string | null;
  onChange: (iso: string | null) => void;
  onTimeChange?: (t: string | null) => void;
  onEndTimeChange?: (t: string | null) => void;
  close: () => void;
}) {
  const selected = parseDate(value ?? null);
  const [month, setMonth] = useState(() => selected ?? new Date());

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const quick = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    onChange(toISODate(d));
    setMonth(d);
  };

  // End must be after start; nudge it forward when the user picks an earlier one.
  const endInvalid = Boolean(time && endTime && endTime <= time);

  return (
    <div className="p-1.5">
      <div className="mb-1.5 grid grid-cols-4 gap-1">
        {([["Today", 0], ["Tmrw", 1], ["+3d", 3], ["+1w", 7]] as const).map(([label, off]) => (
          <button
            key={label}
            onClick={() => quick(off)}
            className="rounded-md px-1 py-1 text-2xs text-text-muted hover:bg-hairline/[0.06] hover:text-text"
          >
            {label}
          </button>
        ))}
      </div>

      {/* month nav */}
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          onClick={() => setMonth((m) => addMonths(m, -1))}
          className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-hairline/[0.06] hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-medium text-text">{format(month, "MMMM yyyy")}</span>
        <button
          onClick={() => setMonth((m) => addMonths(m, 1))}
          className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-hairline/[0.06] hover:text-text"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="grid h-6 place-items-center text-2xs text-text-faint">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const isSel = selected && isSameDay(day, selected);
          const outside = !isSameMonth(day, month);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onChange(toISODate(day))}
              className={cn(
                "grid h-7 place-items-center rounded-md text-2xs transition-colors",
                isSel
                  ? "bg-accent font-semibold text-accent-fg"
                  : outside
                    ? "text-text-faint hover:bg-hairline/[0.06]"
                    : "text-text hover:bg-hairline/[0.06]",
                !isSel && isToday(day) && "ring-1 ring-inset ring-accent/50"
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>

      {onTimeChange && (
        <>
          <div className="my-1.5 h-px bg-hairline/[0.08]" />
          <div className="flex items-center gap-1.5 px-0.5">
            <label className="flex-1">
              <span className="mb-0.5 block text-2xs text-text-faint">Start</span>
              <input
                type="time"
                value={time ?? ""}
                disabled={!value}
                onChange={(e) => onTimeChange(e.target.value || null)}
                className="w-full rounded-md border border-hairline/[0.08] bg-surface-2 px-1.5 py-1 text-sm text-text outline-none focus:border-accent/60 disabled:opacity-40"
              />
            </label>
            <label className="flex-1">
              <span className="mb-0.5 block text-2xs text-text-faint">End</span>
              <input
                type="time"
                value={endTime ?? ""}
                disabled={!value || !time || !onEndTimeChange}
                onChange={(e) => onEndTimeChange?.(e.target.value || null)}
                className={cn(
                  "w-full rounded-md border bg-surface-2 px-1.5 py-1 text-sm text-text outline-none focus:border-accent/60 disabled:opacity-40",
                  endInvalid ? "border-danger/60" : "border-hairline/[0.08]"
                )}
              />
            </label>
          </div>
          {endInvalid && (
            <p className="mt-1 px-0.5 text-2xs text-danger">
              End is before start, so it will run to the next day.
            </p>
          )}
          {!time && value && (
            <p className="mt-1 px-0.5 text-2xs text-text-faint">
              No start time means an all-day event.
            </p>
          )}
        </>
      )}

      {value && (
        <button
          onClick={() => {
            onChange(null);
            close();
          }}
          className="mt-1.5 w-full rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
        >
          Clear due date
        </button>
      )}
    </div>
  );
}
