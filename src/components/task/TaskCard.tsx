"use client";

import type { Task } from "@/lib/types";
import { childProgress } from "@/lib/data/tree";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { AssigneeStack } from "@/components/task/Pickers";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { SubtaskProgress } from "@/components/ui/SubtaskProgress";
import { TagChip } from "@/components/ui/TagChip";
import { cn, taskAssignees } from "@/lib/utils";

/** Kanban / board card. Reuses the same task metadata as the tree row. */
export function TaskCard({
  task,
  onOpen,
  dragging,
}: {
  task: Task;
  onOpen?: () => void;
  dragging?: boolean;
}) {
  const { tasks } = useWorkspace();
  const { done, total } = childProgress(tasks, task.id);
  const assignees = taskAssignees(task);

  return (
    <div
      onClick={onOpen}
      className={cn(
        "card card-hover cursor-pointer rounded-md p-2.5 shadow-e1",
        dragging && "rotate-[1.5deg] border-accent/45 shadow-e3"
      )}
    >
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "flex-1 text-sm leading-snug",
            task.status === "done" ? "text-text-faint line-through decoration-text-faint/50" : "text-text"
          )}
        >
          {task.title}
        </p>
        <span className="mt-0.5 shrink-0">
          <PriorityDot priority={task.priority} />
        </span>
      </div>

      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {task.dueDate && <DueDateChip date={task.dueDate} time={task.dueTime} status={task.status} />}
        {total > 0 && <SubtaskProgress done={done} total={total} />}
        <div className="ml-auto">
          {assignees.length > 0 && <AssigneeStack assignees={assignees} size={20} />}
        </div>
      </div>
    </div>
  );
}
