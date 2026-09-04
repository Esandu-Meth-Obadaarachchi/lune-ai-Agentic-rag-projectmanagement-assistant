"use client";

import { useState } from "react";
import { Plus, Repeat, X } from "lucide-react";
import { PRIORITIES } from "@/lib/constants";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { addProjectTag, removeProjectTag } from "@/lib/data/firestore";
import type { Assignee, Recurrence, RecurrenceFreq, TaskPriority } from "@/lib/types";
import { Avatar, AvatarEmpty } from "@/components/ui/Avatar";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { PriorityIndicator } from "@/components/ui/PriorityIndicator";
import { TagChip } from "@/components/ui/TagChip";
import { cn } from "@/lib/utils";

export function PrioritySelect({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  return (
    <Dropdown
      width={160}
      trigger={() => (
        <span className="grid h-6 w-6 place-items-center rounded-md hover:bg-hairline/[0.06]" title="Priority">
          <PriorityIndicator priority={value} />
        </span>
      )}
    >
      {(close) =>
        PRIORITIES.map((p) => (
          <MenuItem
            key={p.id}
            active={p.id === value}
            icon={<PriorityIndicator priority={p.id} />}
            onClick={() => {
              onChange(p.id);
              close();
            }}
          >
            {p.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

export function AssigneePicker({
  value = [],
  onChange,
  size = 22,
}: {
  value?: Assignee[];
  onChange: (a: Assignee[]) => void;
  size?: number;
}) {
  const { currentWorkspace } = useWorkspace();
  const members = currentWorkspace?.members ?? [];
  const selectedIds = new Set(value.map((a) => a.id));

  const toggle = (m: { uid: string; name: string; photoURL?: string | null }) => {
    if (selectedIds.has(m.uid)) {
      onChange(value.filter((a) => a.id !== m.uid));
    } else {
      onChange([...value, { id: m.uid, name: m.name, avatar: m.photoURL ?? null }]);
    }
  };

  const title = value.length ? value.map((a) => a.name).join(", ") : "Assign";
  return (
    <Dropdown
      width={220}
      align="right"
      trigger={() => (
        <span className="grid place-items-center rounded-full hover:opacity-80" title={title}>
          {value.length ? <AssigneeStack assignees={value} size={size} /> : <AvatarEmpty size={size} />}
        </span>
      )}
    >
      {(close) => (
        <div>
          <div className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-text-faint">
            Assign to
          </div>
          {members.map((m) => (
            <MenuItem
              key={m.uid}
              active={selectedIds.has(m.uid)}
              icon={<Avatar name={m.name} src={m.photoURL} size={18} />}
              onClick={() => toggle(m)}
            >
              {m.name}
            </MenuItem>
          ))}
          {value.length > 0 && (
            <>
              <div className="my-1 h-px bg-hairline/[0.08]" />
              <MenuItem
                onClick={() => {
                  onChange([]);
                  close();
                }}
              >
                Clear all
              </MenuItem>
            </>
          )}
        </div>
      )}
    </Dropdown>
  );
}

/** Overlapping avatars for a task's assignees, with a +N overflow badge. */
export function AssigneeStack({
  assignees,
  size = 22,
  max = 3,
}: {
  assignees: Assignee[];
  size?: number;
  max?: number;
}) {
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((a, i) => (
        <span
          key={a.id}
          className="rounded-full ring-1 ring-bg"
          style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}
        >
          <Avatar name={a.name} src={a.avatar} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-full bg-surface-2 text-2xs font-medium text-text-muted ring-1 ring-bg"
          style={{ width: size, height: size, marginLeft: -size * 0.32 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// DuePicker (calendar grid + start/end time) lives in its own file.
export { DuePicker } from "./DuePicker";

const RECUR_LABEL: Record<RecurrenceFreq, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
};

export function RecurrencePicker({
  value,
  onChange,
}: {
  value?: Recurrence | null;
  onChange: (r: Recurrence | null) => void;
}) {
  const options: (Recurrence | null)[] = [
    null,
    { freq: "daily", interval: 1 },
    { freq: "weekly", interval: 1 },
    { freq: "monthly", interval: 1 },
  ];
  return (
    <Dropdown
      width={176}
      trigger={() => (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs",
            value ? "text-accent" : "text-text-faint hover:text-text-muted"
          )}
        >
          <Repeat className="h-3.5 w-3.5" />
          {value ? RECUR_LABEL[value.freq] : "Does not repeat"}
        </span>
      )}
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o?.freq ?? "none"}
            active={(o?.freq ?? null) === (value?.freq ?? null)}
            onClick={() => {
              onChange(o);
              close();
            }}
          >
            {o ? RECUR_LABEL[o.freq] : "Does not repeat"}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

/**
 * Task tag editor backed by the current project's tag palette. You pick from
 * the labels defined on the project (custom, per-project — separate from the
 * built-in statuses), and creating a new one adds it to the project palette so
 * every task in the project can reuse it.
 */
export function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
}) {
  const { currentProject } = useWorkspace();
  const [input, setInput] = useState("");
  const palette = currentProject?.tags ?? [];
  const projectId = currentProject?.id;

  const toggle = (t: string) => {
    onChange(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  };

  const create = () => {
    const v = input.trim().toLowerCase();
    setInput("");
    if (!v) return;
    if (projectId && !palette.includes(v)) void addProjectTag(projectId, v);
    if (!tags.includes(v)) onChange([...tags, v]);
  };

  const query = input.trim().toLowerCase();
  const matches = palette.filter((t) => t.includes(query));
  const canCreate = query.length > 0 && !palette.includes(query);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="group inline-flex items-center gap-0.5">
          <TagChip tag={t} />
          <button onClick={() => toggle(t)} className="text-text-faint hover:text-danger" title="Remove tag">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Dropdown
        width={220}
        trigger={() => (
          <span className="inline-flex items-center gap-0.5 rounded border border-dashed border-hairline/[0.08] px-1.5 py-0.5 text-2xs text-text-faint hover:border-hairline/20 hover:text-text">
            <Plus className="h-3 w-3" /> Tag
          </span>
        )}
      >
        {() => (
          <div>
            <div className="px-1.5 pb-1.5">
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
                placeholder="Find or create a tag"
                className="w-full rounded border border-hairline/[0.08] bg-surface-2 px-2 py-1 text-2xs text-text outline-none placeholder:text-text-faint focus:border-hairline/20"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {matches.map((t) => (
                <div key={t} className="group/row flex items-center">
                  <div className="min-w-0 flex-1">
                    <MenuItem active={tags.includes(t)} onClick={() => toggle(t)}>
                      <TagChip tag={t} />
                    </MenuItem>
                  </div>
                  {projectId && (
                    <button
                      onClick={() => {
                        void removeProjectTag(projectId, t);
                        if (tags.includes(t)) onChange(tags.filter((x) => x !== t));
                      }}
                      className="mr-1 hidden shrink-0 rounded p-1 text-text-faint hover:text-danger group-hover/row:block"
                      title="Delete tag from project"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {matches.length === 0 && !canCreate && (
                <div className="px-2 py-1.5 text-2xs text-text-faint">No tags yet</div>
              )}
            </div>
            {canCreate && (
              <>
                <div className="my-1 h-px bg-hairline/[0.08]" />
                <MenuItem icon={<Plus className="h-4 w-4" />} onClick={create}>
                  Create “{query}”
                </MenuItem>
              </>
            )}
          </div>
        )}
      </Dropdown>
    </div>
  );
}
