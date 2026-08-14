"use client";

import { useMemo, useState } from "react";
import { Ban, Plus, X } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { collectSubtreeIds } from "@/lib/data/tree";
import { statusMeta } from "@/lib/constants";
import type { Task } from "@/lib/types";
import { Dropdown } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

/**
 * Blocked-by links. `Task.dependencies` has been on the type since the first
 * release with no UI reading or writing it.
 *
 * A task is blocked while any dependency is unfinished. That is surfaced rather
 * than enforced: hard-blocking a status change punishes people for recording
 * reality, and the honest signal is enough.
 */
export function Dependencies({
  task,
  onChange,
  onOpenTask,
}: {
  task: Task;
  onChange: (ids: string[]) => void;
  onOpenTask?: (t: Task) => void;
}) {
  const { allTasks } = useWorkspace();
  const [q, setQ] = useState("");

  // Memoised: `?? []` allocates a fresh array each render, which would make
  // every dependent memo below recompute on every render.
  const ids = useMemo(() => task.dependencies ?? [], [task.dependencies]);
  const blockers = useMemo(
    () => ids.map((id) => allTasks.find((t) => t.id === id)).filter((t): t is Task => !!t),
    [ids, allTasks]
  );
  const openBlockers = blockers.filter((b) => b.status !== "done");

  // A task cannot depend on itself or on anything inside its own subtree —
  // that is a cycle by construction.
  const candidates = useMemo(() => {
    const banned = new Set(collectSubtreeIds(allTasks, task.id));
    const query = q.trim().toLowerCase();
    return allTasks
      .filter(
        (t) =>
          t.projectId === task.projectId &&
          !banned.has(t.id) &&
          !ids.includes(t.id) &&
          (!query || t.title.toLowerCase().includes(query))
      )
      .slice(0, 30);
  }, [allTasks, task.id, task.projectId, ids, q]);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
          <Ban className="h-3 w-3" /> Blocked by
        </span>
        {openBlockers.length > 0 && (
          <span className="rounded border border-blocked/30 bg-blocked/10 px-1.5 py-0.5 text-2xs font-medium text-blocked">
            {openBlockers.length} open
          </span>
        )}
        <Dropdown
          align="right"
          width={280}
          trigger={() => (
            <span className="ml-auto grid h-5 w-5 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-text">
              <Plus className="h-3.5 w-3.5" />
            </span>
          )}
        >
          {(close) => (
            <div className="p-1">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a task…"
                className="mb-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent/40"
              />
              <div className="max-h-[240px] overflow-y-auto">
                {candidates.length === 0 ? (
                  <div className="px-2 py-2 text-2xs text-text-faint">
                    Nothing else in this project to depend on.
                  </div>
                ) : (
                  candidates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onChange([...ids, t.id]);
                        close();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      <span className={cn("shrink-0 text-2xs", statusMeta(t.status).color)}>●</span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </Dropdown>
      </div>

      {blockers.length === 0 ? (
        <p className="text-2xs text-text-faint">Nothing is blocking this.</p>
      ) : (
        <div className="space-y-1">
          {blockers.map((b) => (
            <div
              key={b.id}
              className="group flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5"
            >
              <span className={cn("shrink-0 text-2xs", statusMeta(b.status).color)}>●</span>
              <button
                onClick={() => onOpenTask?.(b)}
                disabled={!onOpenTask}
                className={cn(
                  "flex-1 truncate text-left text-[13px] disabled:cursor-default",
                  b.status === "done" ? "text-text-faint line-through" : "text-text"
                )}
              >
                {b.title}
              </button>
              <button
                onClick={() => onChange(ids.filter((x) => x !== b.id))}
                aria-label={`Remove dependency on ${b.title}`}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-faint opacity-100 transition-opacity hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
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
