"use client";

import { useMemo } from "react";
import { addDays, addMonths, addWeeks } from "date-fns";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "./WorkspaceContext";
import { createTask, deleteTaskTree, logEvent, notify, restoreTasks, updateTask } from "./firestore";
import { statusMeta } from "@/lib/constants";
import { collectSubtreeIds } from "./tree";
import { deleteCalendarEvent, syncTaskToCalendar } from "@/lib/api";
import { toISODate } from "@/lib/date";
import type { Assignee, Recurrence, Task, TaskPriority, TaskStatus, TimeEntry } from "@/lib/types";

function advance(iso: string, r: Recurrence): string {
  const d = new Date(iso);
  const next =
    r.freq === "daily" ? addDays(d, r.interval) : r.freq === "weekly" ? addWeeks(d, r.interval) : addMonths(d, r.interval);
  return toISODate(next);
}

/**
 * Task mutations pre-bound to a project/workspace/user. Views call these;
 * nobody else touches Firestore for tasks directly. New tasks are placed at the
 * end of their sibling group by order.
 *
 * Pass `projectId` when acting on a task that may not belong to the currently
 * selected project — the drawer opened from Today or All my tasks, for
 * instance. Without it, creates were landing in whichever project happened to
 * be selected, carrying that project's workspaceId and memberIds, so a subtask
 * added from a cross-project view ended up somewhere its parent's team could
 * not see.
 */
export function useTaskActions(opts: { projectId?: string | null } = {}) {
  const { user } = useAuth();
  const ctx = useWorkspace();
  const { currentWorkspace, currentProject, allProjects, workspaces, tasks, allTasks } = ctx;
  const { projectId } = opts;

  return useMemo(() => {
    // Resolve the target project: an explicit override first, else the
    // selected one. The workspace always follows the project, never the UI.
    const target = projectId
      ? (allProjects.find((p) => p.id === projectId) ?? currentProject)
      : currentProject;
    const targetWorkspace = target
      ? (workspaces.find((w) => w.id === target.workspaceId) ?? currentWorkspace)
      : currentWorkspace;

    const ready = Boolean(user && targetWorkspace && target);
    // A task inherits the access list of its project (so project-scoped
    // teammates see it), falling back to the workspace for older projects.
    const memberIds = target?.memberIds ?? targetWorkspace?.memberIds ?? [];

    // Sibling order is computed against the target project's own tasks, which
    // for a cross-project drawer are not the ones in the current view.
    const scope = target && target.id !== currentProject?.id ? allTasks : tasks;
    const nextOrder = (parentId: string | null) => {
      const siblings = scope.filter(
        (t) => t.parentId === parentId && t.projectId === target?.id
      );
      return siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : Date.now();
    };

    const add = async (
      title: string,
      opts: { parentId?: string | null; status?: TaskStatus; priority?: TaskPriority; dueDate?: string | null } = {}
    ) => {
      if (!ready || !title.trim()) return;
      const id = await createTask({
        workspaceId: targetWorkspace!.id,
        projectId: target!.id,
        parentId: opts.parentId ?? null,
        title: title.trim(),
        memberIds,
        createdBy: user!.uid,
        status: opts.status,
        priority: opts.priority,
        dueDate: opts.dueDate ?? null,
        order: nextOrder(opts.parentId ?? null),
        assignee: user ? { id: user.uid, name: user.displayName ?? "You", avatar: user.photoURL } : null,
      });
      if (id && opts.dueDate) syncTaskToCalendar(id);
      return id;
    };

    // When a recurring task is completed, spawn its next occurrence.
    const spawnIfRecurring = async (task: Task) => {
      if (!task.recurrence || !task.dueDate) return;
      const id = await add(task.title, {
        parentId: task.parentId,
        priority: task.priority,
        dueDate: advance(task.dueDate, task.recurrence),
      });
      if (id) await updateTask(id, { recurrence: task.recurrence, tags: task.tags });
    };

    // Reads resolve against every visible task, not just the current project's
    // slice, so acting on a task from a cross-project view still finds it.
    const lookup = (id: string) => allTasks.find((t) => t.id === id) ?? tasks.find((t) => t.id === id);

    const actor = {
      uid: user?.uid ?? "",
      name: user?.displayName ?? "You",
      photoURL: user?.photoURL ?? null,
    };

    /** Record a timeline event for a task we already hold. Fire-and-forget by
     *  design: a missing event must never make the edit look like it failed. */
    const event = (
      id: string,
      verb: Parameters<typeof logEvent>[0]["verb"],
      from?: string | null,
      to?: string | null
    ) => {
      const t = lookup(id);
      if (!t || !user) return;
      logEvent({ task: t, actor, verb, from, to });
    };

    const applyStatus = async (id: string, status: TaskStatus) => {
      const prev = lookup(id);
      await updateTask(id, { status });
      if (prev && prev.status !== status) {
        event(id, "status", statusMeta(prev.status).label, statusMeta(status).label);
      }
      if (status === "done" && prev && prev.status !== "done") await spawnIfRecurring(prev);
    };

    const withEntries = (id: string, fn: (entries: TimeEntry[]) => TimeEntry[]) => {
      const t = lookup(id);
      if (!t) return;
      return updateTask(id, { timeEntries: fn(t.timeEntries ?? []) });
    };

    return {
      ready,
      add,
      addSubtask: (parentId: string, title: string) => add(title, { parentId }),
      rename: async (id: string, title: string) => {
        await updateTask(id, { title });
        syncTaskToCalendar(id);
      },
      setNotes: (id: string, notes: string) => updateTask(id, { notes }),
      setStatus: applyStatus,
      setPriority: (id: string, priority: TaskPriority) => updateTask(id, { priority }),
      setDue: async (id: string, dueDate: string | null) => {
        const prev = lookup(id)?.dueDate ?? null;
        // Clearing the date clears the time too.
        await updateTask(id, dueDate ? { dueDate } : { dueDate: null, dueTime: null, dueEndTime: null });
        if (prev !== dueDate) event(id, "due", prev, dueDate);
        syncTaskToCalendar(id);
      },
      setDueTime: async (id: string, dueTime: string | null) => {
        // Dropping the start time makes it all-day, so the end time goes too.
        await updateTask(id, dueTime ? { dueTime } : { dueTime: null, dueEndTime: null });
        syncTaskToCalendar(id);
      },
      setDueEndTime: async (id: string, dueEndTime: string | null) => {
        await updateTask(id, { dueEndTime });
        syncTaskToCalendar(id);
      },
      setTags: (id: string, tags: string[]) => updateTask(id, { tags }),
      setEstimate: async (id: string, estimate: number | null) => {
        const prev = lookup(id)?.estimate ?? null;
        await updateTask(id, { estimate });
        if (prev !== estimate) {
          event(id, "estimate", prev == null ? null : String(prev), estimate == null ? null : `${estimate} points`);
        }
      },
      setSprint: (id: string, sprintId: string | null) => updateTask(id, { sprintId }),
      setAssignees: async (id: string, list: Assignee[]) => {
        const task = lookup(id);
        const before = task ? (task.assignees ?? []) : [];
        // Keep the legacy single-assignee fields mirroring the first entry so
        // anything still reading assigneeId (print, older data) stays correct.
        const first = list[0] ?? null;
        await updateTask(id, {
          assignees: list,
          assigneeId: first?.id ?? null,
          assigneeName: first?.name ?? null,
          assigneeAvatar: first?.avatar ?? null,
        });
        const added = list.filter((a) => !before.some((b) => b.id === a.id));
        const gone = before.filter((b) => !list.some((a) => a.id === b.id));
        added.forEach((a) => event(id, "assigned", null, a.name));
        gone.forEach((a) => event(id, "unassigned", a.name, null));
        // Tell people they picked up work; never tell the actor about themselves.
        if (task && added.length && user) {
          notify({
            recipients: added.map((a) => a.id),
            kind: "assigned",
            actor,
            task,
          });
        }
      },
      toggleDone: (t: Task) => applyStatus(t.id, t.status === "done" ? "todo" : "done"),
      /** How many descendants a delete would take with it. Callers use this to
       *  decide whether to confirm before destroying a subtree. */
      subtreeCount: (id: string) => Math.max(collectSubtreeIds(scope, id).length - 1, 0),
      /**
       * Delete a task and its descendants. Returns the removed documents so the
       * caller can offer undo — nothing else in the app records them, and once
       * the batch commits they are gone.
       */
      remove: async (id: string): Promise<Task[]> => {
        const ids = collectSubtreeIds(scope, id);
        const removed = scope.filter((t) => ids.includes(t.id));
        removed
          .filter((t) => t.googleEventId)
          .forEach((t) => deleteCalendarEvent(t.googleEventId as string));
        await deleteTaskTree(ids);
        return removed;
      },
      restore: (removed: Task[]) => restoreTasks(removed),
      patch: (id: string, patch: Partial<Task>) => updateTask(id, patch),

      // recurrence
      setRecurrence: (id: string, recurrence: Recurrence | null) => updateTask(id, { recurrence }),

      // time tracking
      startTimer: (id: string) =>
        withEntries(id, (e) =>
          e.some((x) => x.end === null)
            ? e
            : [...e, { id: crypto.randomUUID(), start: Date.now(), end: null, seconds: 0 }]
        ),
      stopTimer: (id: string) =>
        withEntries(id, (e) =>
          e.map((x) => (x.end === null ? { ...x, end: Date.now(), seconds: Math.round((Date.now() - x.start) / 1000) } : x))
        ),
      addTimeEntry: (id: string, seconds: number, note = "") =>
        withEntries(id, (e) => [...e, { id: crypto.randomUUID(), start: Date.now(), end: Date.now(), seconds, note }]),
      deleteTimeEntry: (id: string, entryId: string) =>
        withEntries(id, (e) => e.filter((x) => x.id !== entryId)),
    };
  }, [user, currentWorkspace, currentProject, allProjects, workspaces, tasks, allTasks, projectId]);
}

export type TaskActions = ReturnType<typeof useTaskActions>;
