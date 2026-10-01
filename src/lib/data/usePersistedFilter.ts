"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_FILTER, type DueWindow, type TaskFilter } from "@/lib/data/filter";
import type { TaskPriority } from "@/lib/types";

/**
 * A view filter that survives a refresh and a change of project.
 *
 * It used to be plain component state, so hiding completed tasks lasted until
 * the next reload or project switch and then had to be set again.
 *
 * What is remembered, and where, depends on whether the value still means
 * anything somewhere else:
 *
 *   everywhere   hide completed, priority, due window. "Hide done" is a
 *                preference about how you like to read a list, not about one
 *                project, so it follows you.
 *   per project  assignees and tags. Those name people and labels that belong to
 *                one team. Carrying "assigned to Nadeesha" into a project she is
 *                not on would filter everything out and look like an empty
 *                project, so each project keeps its own.
 *   never        the free-text search. It is a lookup you run and finish, and a
 *                search box that reopens full of last week's query reads as a
 *                bug.
 *
 * Storage is best-effort throughout. It can be unavailable or hold something
 * from an older shape, and neither is allowed to break the page — a bad read
 * just means starting from an empty filter.
 */

const GLOBAL_KEY = "sb-filter";
const projectKey = (id: string) => `sb-filter:p:${id}`;

const DUE_WINDOWS: DueWindow[] = ["any", "overdue", "today", "week", "none"];
// Typed as a full Record so adding a priority to `TaskPriority` is a compile
// error here until it is listed, rather than a saved filter quietly losing it.
const PRIORITY_SET: Record<TaskPriority, true> = { low: true, med: true, high: true, urgent: true };
const PRIORITIES = Object.keys(PRIORITY_SET) as TaskPriority[];

interface GlobalPart {
  hideDone: boolean;
  priorities: TaskPriority[];
  due: DueWindow;
}

interface ProjectPart {
  assignees: string[];
  tags: string[];
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a convenience; a full or blocked store must not break the filter */
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function readGlobal(): GlobalPart {
  const raw = read(GLOBAL_KEY) as Partial<GlobalPart> | null;
  return {
    hideDone: raw?.hideDone === true,
    // Validated against the known values, not trusted: a priority that was
    // renamed would otherwise silently hide every task.
    priorities: strings(raw?.priorities).filter((p): p is TaskPriority =>
      PRIORITIES.includes(p as TaskPriority)
    ),
    due: DUE_WINDOWS.includes(raw?.due as DueWindow) ? (raw!.due as DueWindow) : "any",
  };
}

function readProject(projectId: string | undefined): ProjectPart {
  const raw = projectId ? (read(projectKey(projectId)) as Partial<ProjectPart> | null) : null;
  return { assignees: strings(raw?.assignees), tags: strings(raw?.tags) };
}

function load(projectId: string | undefined): TaskFilter {
  return { ...EMPTY_FILTER, ...readGlobal(), ...readProject(projectId) };
}

export function usePersistedFilter(
  projectId: string | undefined
): [TaskFilter, (next: TaskFilter) => void] {
  // Starts empty and fills in after mount. Reading storage during the first
  // render would give the server and the client different markup.
  const [filter, setFilterState] = useState<TaskFilter>(EMPTY_FILTER);

  // Re-read whenever the project changes, so each project's own assignee and tag
  // filters come back and the previous project's do not linger.
  useEffect(() => {
    setFilterState(load(projectId));
  }, [projectId]);

  // Written from the setter rather than from an effect on `filter`. An effect
  // would run once on mount with the empty initial value and overwrite what was
  // saved before it had been read back.
  const setFilter = useCallback(
    (next: TaskFilter) => {
      setFilterState(next);
      write(GLOBAL_KEY, {
        hideDone: next.hideDone,
        priorities: next.priorities,
        due: next.due,
      } satisfies GlobalPart);
      if (projectId) {
        write(projectKey(projectId), {
          assignees: next.assignees,
          tags: next.tags,
        } satisfies ProjectPart);
      }
    },
    [projectId]
  );

  return [filter, setFilter];
}
