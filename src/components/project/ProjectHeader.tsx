"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookText, CalendarDays, Clock, Download, FileText, KanbanSquare, Layers, ListTree, Network, PencilRuler, Rocket, Rows3, Sparkles, Users, UsersRound } from "lucide-react";
import type { Project, Task, WorkspaceMember } from "@/lib/types";
import { dueState } from "@/lib/date";
import { EMPTY_FILTER, isFilterActive, type TaskFilter } from "@/lib/data/filter";
import { exportTimeCSV } from "@/lib/export";
import { Button } from "@/components/ui/Button";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { PrintView } from "./PrintView";
import { FilterBar } from "./FilterBar";
import { cn } from "@/lib/utils";

export type ViewTab =
  | "tree"
  | "board"
  | "list"
  | "calendar"
  | "sprints"
  | "backlog"
  | "map"
  | "draw"
  | "docs"
  | "members"
  | "team";

const TABS: { id: ViewTab; label: string; icon: typeof ListTree }[] = [
  { id: "tree", label: "Tree", icon: ListTree },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "list", label: "List", icon: Rows3 },
  { id: "sprints", label: "Sprints", icon: Rocket },
  { id: "backlog", label: "Backlog", icon: Layers },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "map", label: "Map", icon: Network },
  { id: "draw", label: "Draw", icon: PencilRuler },
  { id: "docs", label: "Docs", icon: BookText },
  { id: "members", label: "Members", icon: UsersRound },
  { id: "team", label: "Team", icon: Users },
];

export function ProjectHeader({
  project,
  tasks,
  tab,
  onTab,
  filter,
  onFilter,
  members,
  shownCount,
}: {
  project: Project;
  tasks: Task[];
  tab: ViewTab;
  onTab: (t: ViewTab) => void;
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  members: WorkspaceMember[];
  /** How many tasks survive the filter, so the header can say what is hidden. */
  shownCount: number;
}) {
  const router = useRouter();
  const [printing, setPrinting] = useState(false);
  const open = tasks.filter((t) => t.status !== "done").length;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && dueState(t.dueDate, t.status) === "overdue"
  ).length;
  const done = tasks.filter((t) => t.status === "done").length;
  const hidden = tasks.length - shownCount;
  const filtering = isFilterActive(filter);
  // Tabs that render tasks; the rest ignore the filter entirely.
  const filterable = !["docs", "team", "draw", "map"].includes(tab);

  return (
    <header className="flex flex-col gap-2.5 border-b border-border px-3 pb-2 pt-3 sm:px-4 sm:pb-2.5 sm:pt-3.5">
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: project.color }} />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-text">
            {project.name}
          </h1>
        </div>

        <div className="ml-1 hidden items-center gap-1.5 lg:flex">
          <Stat label="open" value={open} />
          {overdue > 0 && <Stat label="overdue" value={overdue} tone="danger" />}
          <Stat label="done" value={done} tone="ok" />
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Dropdown
            align="right"
            width={188}
            trigger={() => (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text sm:px-2.5">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
              </span>
            )}
          >
            {(close) => (
              <div>
                <MenuItem
                  icon={<FileText className="h-4 w-4" />}
                  onClick={() => {
                    setPrinting(true);
                    close();
                  }}
                >
                  Print / PDF
                </MenuItem>
                <MenuItem
                  icon={<Clock className="h-4 w-4" />}
                  onClick={() => {
                    exportTimeCSV(project.name, tasks);
                    close();
                  }}
                >
                  Time report (CSV)
                </MenuItem>
              </div>
            )}
          </Dropdown>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/agent")}
            title="Ask the brain"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="hidden sm:inline">Ask the brain</span>
          </Button>
        </div>
      </div>

      {printing && <PrintView project={project} tasks={tasks} onClose={() => setPrinting(false)} />}

      {/* tab switcher + filters. The tab strip scrolls on narrow screens and
          fades at its right edge so it reads as scrollable rather than cut off. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <div className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  tab === t.id
                    ? "bg-surface-2 text-text"
                    : "text-text-muted hover:bg-surface-2 hover:text-text"
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg to-transparent" />
        </div>

        {filterable && (
          <div className="shrink-0">
            <FilterBar filter={filter} onChange={onFilter} members={members} project={project} />
          </div>
        )}
      </div>

      {filtering && filterable && (
        <div className="flex items-center gap-2 text-2xs text-text-muted">
          <span className="mono text-text">{shownCount}</span>
          shown
          {hidden > 0 && (
            <>
              <span className="text-text-faint">·</span>
              <span className="mono text-text-faint">{hidden}</span>
              <span className="text-text-faint">hidden by filter</span>
            </>
          )}
          <button
            onClick={() => onFilter({ ...EMPTY_FILTER })}
            className="ml-auto text-accent hover:underline"
          >
            Clear
          </button>
        </div>
      )}
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "ok";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-2xs",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger",
        tone === "ok" && "text-text-muted",
        !tone && "text-text-muted"
      )}
    >
      <span className="mono font-semibold text-text">{value}</span>
      {label}
    </span>
  );
}
