"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Plus, X } from "lucide-react";
import type { Task } from "@/lib/types";
import type { TaskActions } from "@/lib/data/useTaskActions";
import { clock, formatDuration } from "@/lib/date";
import { cn } from "@/lib/utils";

export function TimeTracker({ task, actions }: { task: Task; actions: TaskActions }) {
  const entries = task.timeEntries ?? [];
  const running = entries.find((e) => e.end === null);
  const [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState(false);
  const [mins, setMins] = useState("");

  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [running]);

  const total = entries.reduce(
    (s, e) => s + (e.end === null ? Math.max(0, Math.round((now - e.start) / 1000)) : e.seconds),
    0
  );

  const addManual = () => {
    const m = parseFloat(mins);
    if (m > 0) actions.addTimeEntry(task.id, Math.round(m * 60));
    setMins("");
    setAdding(false);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wide text-text-faint">
          Time tracked {total > 0 && `· ${formatDuration(total)}`}
        </span>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-2xs text-text-faint hover:text-text"
          title="Add time manually"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => (running ? actions.stopTimer(task.id) : actions.startTimer(task.id))}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            running ? "bg-danger/15 text-danger hover:bg-danger/25" : "bg-accent/15 text-accent hover:bg-accent/25"
          )}
        >
          {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Stop" : "Start"}
        </button>
        {running && (
          <span className="mono text-sm tabular-nums text-text">
            {clock(Math.max(0, Math.round((now - running.start) / 1000)))}
          </span>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="1"
            autoFocus
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
            placeholder="minutes"
            className="w-24 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-1 text-sm text-text outline-none focus:border-accent/60"
          />
          <button onClick={addManual} className="text-sm text-accent hover:underline">
            Add
          </button>
        </div>
      )}

      {entries.filter((e) => e.end !== null).length > 0 && (
        <div className="mt-2 space-y-0.5">
          {entries
            .filter((e) => e.end !== null)
            .slice()
            .reverse()
            .map((e) => (
              <div key={e.id} className="group flex items-center gap-2 rounded px-1 py-0.5 text-2xs hover:bg-hairline/[0.06]">
                <span className="mono text-text-muted">{formatDuration(e.seconds)}</span>
                {e.note && <span className="truncate text-text-faint">{e.note}</span>}
                <span className="ml-auto text-text-faint">
                  {new Date(e.start).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
                <button
                  onClick={() => actions.deleteTimeEntry(task.id, e.id)}
                  className="text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
