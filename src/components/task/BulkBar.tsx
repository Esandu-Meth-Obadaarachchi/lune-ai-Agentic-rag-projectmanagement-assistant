"use client";

import { useMemo } from "react";
import { CalendarClock, Check, Flag, Trash2, UserPlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useProjectStatuses } from "@/lib/data/WorkspaceContext";
import {
  bulkRestore,
  bulkUpdateTasks,
  deleteTaskTree,
  restoreTasks,
} from "@/lib/data/firestore";
import { collectSubtreeIds } from "@/lib/data/tree";
import type { Selection } from "@/lib/data/useSelection";
import { useToast } from "@/lib/ui/ToastContext";
import { PRIORITIES } from "@/lib/constants";
import { todayISO, toISODate } from "@/lib/date";
import { addDays } from "date-fns";
import type { Assignee, Task, TaskPriority } from "@/lib/types";
import { Avatar, AvatarEmpty } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

/**
 * Actions on a multi-selection. Appears only when something is selected, as a
 * floating bar above the content so it never reflows the list underneath.
 *
 * Every action is one batch and every action is undoable — a bulk edit that
 * goes wrong goes wrong across dozens of rows at once, which is exactly when
 * undo matters most.
 */
export function BulkBar({
  selection,
  tasks,
  onDone,
}: {
  selection: Selection;
  /** The full task set the selection indexes into. */
  tasks: Task[];
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const { currentWorkspace, currentProject } = useWorkspace();
  const statuses = useProjectStatuses();
  const toast = useToast();

  const picked = useMemo(
    () => tasks.filter((t) => selection.selected.has(t.id)),
    [tasks, selection.selected]
  );

  const members: Assignee[] = useMemo(
    () =>
      (currentWorkspace?.members ?? [])
        .filter((m) => !currentProject?.memberIds || currentProject.memberIds.includes(m.uid))
        .map((m) => ({ id: m.uid, name: m.name, avatar: m.photoURL })),
    [currentWorkspace, currentProject]
  );

  if (picked.length === 0) return null;
  const n = picked.length;
  const plural = n === 1 ? "task" : "tasks";

  const apply = async (patch: Partial<Task>, label: string) => {
    const undo = await toast.report(bulkUpdateTasks(picked, patch), {
      failure: `Could not update ${n} ${plural}.`,
    });
    if (undo === undefined) return;
    selection.clear();
    onDone?.();
    toast.ok(`${label} for ${n} ${plural}.`, {
      label: "Undo",
      run: () => toast.report(bulkRestore(undo), { failure: "Could not undo." }),
    });
  };

  const assign = (person: Assignee | null) =>
    apply(
      {
        assignees: person ? [person] : [],
        assigneeId: person?.id ?? null,
        assigneeName: person?.name ?? null,
        assigneeAvatar: person?.avatar ?? null,
      },
      person ? `Assigned to ${person.name}` : "Unassigned"
    );

  const removeAll = async () => {
    // Bulk delete takes whole subtrees, so say how many rows will actually go.
    const ids = [...new Set(picked.flatMap((t) => collectSubtreeIds(tasks, t.id)))];
    const extra = ids.length - picked.length;
    const ok = window.confirm(
      extra > 0
        ? `Delete ${n} ${plural} and ${extra} subtask${extra === 1 ? "" : "s"}?\n\nYou can undo this straight after.`
        : `Delete ${n} ${plural}?\n\nYou can undo this straight after.`
    );
    if (!ok) return;

    const removed = tasks.filter((t) => ids.includes(t.id));
    const done = await toast.report(deleteTaskTree(ids), { failure: "Could not delete." });
    if (done === undefined) return;
    selection.clear();
    onDone?.();
    toast.ok(`Deleted ${ids.length} ${ids.length === 1 ? "task" : "tasks"}.`, {
      label: "Undo",
      run: () => toast.report(restoreTasks(removed), { failure: "Could not restore." }),
    });
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-1 overflow-x-auto rounded-lg border border-border-strong bg-surface px-2 py-1.5 shadow-pop animate-slide-up [scrollbar-width:none] sm:w-auto [&::-webkit-scrollbar]:hidden">
        <span className="mono shrink-0 whitespace-nowrap px-1.5 text-2xs text-text">
          {n} selected
        </span>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

        <Menu
          label="Status"
          icon={<Check className="h-3.5 w-3.5" />}
          items={statuses.map((s) => ({
            key: s.id,
            node: (
              <>
                <span
                  className={cn("h-2 w-2 rounded-full", !s.custom && s.dot)}
                  style={s.custom ? { background: s.hex } : undefined}
                />
                {s.label}
              </>
            ),
            run: () => apply({ status: s.id }, `Status set to ${s.label}`),
          }))}
        />

        <Menu
          label="Assignee"
          icon={<UserPlus className="h-3.5 w-3.5" />}
          items={[
            {
              key: "none",
              node: (
                <>
                  <AvatarEmpty size={18} /> Unassigned
                </>
              ),
              run: () => assign(null),
            },
            ...members.map((m) => ({
              key: m.id,
              node: (
                <>
                  <Avatar name={m.name} src={m.avatar} size={18} />
                  <span className="truncate">{m.name}</span>
                </>
              ),
              run: () => assign(m),
            })),
          ]}
        />

        <Menu
          label="Priority"
          icon={<Flag className="h-3.5 w-3.5" />}
          items={PRIORITIES.map((p) => ({
            key: p.id,
            node: (
              <>
                <span className={cn("text-2xs", p.color)}>●</span>
                {p.label}
              </>
            ),
            run: () => apply({ priority: p.id as TaskPriority }, `Priority set to ${p.label}`),
          }))}
        />

        <Menu
          label="Due"
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          items={[
            { key: "today", node: <>Today</>, run: () => apply({ dueDate: todayISO() }, "Due today") },
            {
              key: "tomorrow",
              node: <>Tomorrow</>,
              run: () =>
                apply({ dueDate: toISODate(addDays(new Date(todayISO()), 1)) }, "Due tomorrow"),
            },
            {
              key: "week",
              node: <>Next week</>,
              run: () =>
                apply({ dueDate: toISODate(addDays(new Date(todayISO()), 7)) }, "Due next week"),
            },
            {
              key: "clear",
              node: <span className="text-danger">Clear date</span>,
              run: () => apply({ dueDate: null, dueTime: null, dueEndTime: null }, "Due date cleared"),
            },
          ]}
        />

        <button
          onClick={removeAll}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-danger transition-colors hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
        <button
          onClick={selection.clear}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Menu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: { key: string; node: React.ReactNode; run: () => void }[];
}) {
  return (
    <Dropdown
      width={200}
      trigger={() => (
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-2xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text">
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </span>
      )}
    >
      {(close) => (
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {items.map((i) => (
            <button
              key={i.key}
              onClick={() => {
                close();
                i.run();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {i.node}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
