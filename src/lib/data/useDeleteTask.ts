"use client";

import { useCallback } from "react";
import { useToast } from "@/lib/ui/ToastContext";
import type { TaskActions } from "./useTaskActions";

/**
 * One delete flow for every surface, so the row menu and the drawer behave the
 * same way.
 *
 * A leaf task deletes straight away and offers undo — a confirmation dialog for
 * something instantly reversible is just friction. A task with descendants
 * confirms first, because the blast radius is not visible from the row, and
 * still offers undo afterwards.
 *
 * Undo restores the documents under their original ids, which keeps parentId
 * links inside the restored subtree intact.
 */
export function useDeleteTask(actions: TaskActions) {
  const toast = useToast();

  return useCallback(
    async (id: string, title: string, onDone?: () => void) => {
      const kids = actions.subtreeCount(id);
      if (kids > 0) {
        const ok = window.confirm(
          `Delete "${title}" and its ${kids} subtask${kids === 1 ? "" : "s"}?\n\nYou can undo this straight after.`
        );
        if (!ok) return;
      }

      const removed = await toast.report(actions.remove(id), { failure: "Could not delete." });
      if (removed === undefined) return;
      onDone?.();

      toast.ok(kids > 0 ? `Deleted "${title}" and ${kids} subtask${kids === 1 ? "" : "s"}.` : `Deleted "${title}".`, {
        label: "Undo",
        run: () => toast.report(actions.restore(removed), { failure: "Could not restore." }),
      });
    },
    [actions, toast]
  );
}
