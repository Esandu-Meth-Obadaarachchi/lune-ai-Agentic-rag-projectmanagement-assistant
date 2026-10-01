"use client";

import { Filter, Search, X } from "lucide-react";
import { PRIORITIES } from "@/lib/constants";
import { activeFilterCount, EMPTY_FILTER, type DueWindow, type TaskFilter } from "@/lib/data/filter";
import type { Project, TaskPriority, WorkspaceMember } from "@/lib/types";
import { Avatar, AvatarEmpty } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

const DUE_OPTIONS: { id: DueWindow; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "week", label: "Next 7 days" },
  { id: "none", label: "No date" },
];

/**
 * Filter controls shared by every task view in a project. Collapsed to a single
 * button with a count until opened, so the dense header stays dense.
 */
export function FilterBar({
  filter,
  onChange,
  members,
  project,
}: {
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  members: WorkspaceMember[];
  project: Project | null;
}) {
  const count = activeFilterCount(filter);
  const set = (patch: Partial<TaskFilter>) => onChange({ ...filter, ...patch });

  const toggle = <K extends "assignees" | "priorities" | "tags">(key: K, value: string) => {
    const list = filter[key] as string[];
    set({
      [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    } as Partial<TaskFilter>);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Text search is always visible — it is the one people reach for most. */}
      <div className="relative hidden min-w-0 flex-1 items-center md:flex md:w-[200px] xl:w-[220px]">
        <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-faint" />
        <input
          value={filter.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Filter tasks…"
          aria-label="Filter tasks by title"
          className="h-8 w-full min-w-0 rounded-md border border-hairline/[0.09] bg-hairline/[0.04] pl-7 pr-6 text-sm text-text outline-none transition-all duration-200 placeholder:text-text-faint focus:border-accent/50 focus:bg-hairline/[0.06] focus:ring-2 focus:ring-accent/15"
        />
        {filter.text && (
          <button
            onClick={() => set({ text: "" })}
            aria-label="Clear text filter"
            className="absolute right-1 grid h-5 w-5 place-items-center rounded text-text-faint hover:text-text"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <Dropdown
        align="right"
        width={252}
        trigger={() => (
          <span
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-2xs font-medium transition-colors",
              count > 0
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-hairline/[0.08] bg-surface-2 text-text-muted hover:border-hairline/20 hover:text-text"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filter</span>
            {count > 0 && <span className="mono">{count}</span>}
          </span>
        )}
      >
        {() => (
          <div className="max-h-[60vh] overflow-y-auto p-1">
            <Section label="Assignee">
              <Row
                active={filter.assignees.includes("unassigned")}
                onClick={() => toggle("assignees", "unassigned")}
              >
                <AvatarEmpty size={18} />
                Unassigned
              </Row>
              {members.map((m) => (
                <Row
                  key={m.uid}
                  active={filter.assignees.includes(m.uid)}
                  onClick={() => toggle("assignees", m.uid)}
                >
                  <Avatar name={m.name} src={m.photoURL} size={18} />
                  <span className="truncate">{m.name}</span>
                </Row>
              ))}
            </Section>

            <Section label="Priority">
              {PRIORITIES.map((p) => (
                <Row
                  key={p.id}
                  active={filter.priorities.includes(p.id as TaskPriority)}
                  onClick={() => toggle("priorities", p.id)}
                >
                  <span className={cn("text-2xs", p.color)}>●</span>
                  {p.label}
                </Row>
              ))}
            </Section>

            <Section label="Due">
              {DUE_OPTIONS.map((d) => (
                <Row key={d.id} active={filter.due === d.id} onClick={() => set({ due: d.id })}>
                  {d.label}
                </Row>
              ))}
            </Section>

            {!!project?.tags?.length && (
              <Section label="Tags">
                {project.tags.map((t) => (
                  <Row key={t} active={filter.tags.includes(t)} onClick={() => toggle("tags", t)}>
                    {t}
                  </Row>
                ))}
              </Section>
            )}

            <Section label="Status">
              <Row active={filter.hideDone} onClick={() => set({ hideDone: !filter.hideDone })}>
                Hide completed
              </Row>
            </Section>

            {count > 0 && (
              <>
                <div className="my-1 h-px bg-hairline/[0.08]" />
                <button
                  onClick={() => onChange({ ...EMPTY_FILTER })}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-danger transition-colors hover:bg-danger/10"
                >
                  Clear all filters
                </button>
              </>
            )}
          </div>
        )}
      </Dropdown>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-hairline/[0.06] hover:text-text"
      )}
    >
      <span
        className={cn(
          "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border",
          active ? "border-accent bg-accent text-accent-fg" : "border-hairline/20"
        )}
      >
        {active && (
          <svg viewBox="0 0 10 8" className="h-2 w-2 fill-none stroke-current stroke-[2]">
            <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}
