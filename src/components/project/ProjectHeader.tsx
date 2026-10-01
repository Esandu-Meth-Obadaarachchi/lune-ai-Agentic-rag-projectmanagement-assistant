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
    <header className="flex flex-col gap-2.5 border-b border-hairline/[0.07] px-3 pb-2.5 pt-3 sm:px-4 sm:pt-3.5">
      {/* Identity + numbers + actions. One line, because the project name and
          what to do about it belong together. */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-hairline/20"
          style={{ background: project.color }}
        />
        <h1 className="t-title min-w-0 truncate text-lg text-text">{project.name}</h1>

        <div className="ml-0.5 hidden shrink-0 items-center gap-2.5 lg:flex">
          <Stat label="open" value={open} />
          {overdue > 0 && <Stat label="overdue" value={overdue} tone="danger" />}
          <Stat label="done" value={done} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {filterable && (
            <FilterBar filter={filter} onChange={onFilter} members={members} project={project} />
          )}
          <Dropdown
            align="right"
            width={188}
            trigger={() => (
              <span className="press inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-text-muted transition-colors hover:bg-hairline/[0.06] hover:text-text sm:px-2.5">
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
            className="h-8"
            onClick={() => router.push("/agent")}
            title="Ask the brain"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="hidden sm:inline">Ask the brain</span>
          </Button>
        </div>
      </div>

      {printing && <PrintView project={project} tasks={tasks} onClose={() => setPrinting(false)} />}

      {/* The view switcher, as one segmented control on its own line. The active
          view is a raised pill catching the light; the rest sit flush in the
          track. Scrolls on narrow screens with a fade at the edge. */}
      <div className="relative -mx-0.5 min-w-0">
        <div className="flex w-fit min-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-hairline/[0.06] bg-hairline/[0.025] p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "press flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-sm font-medium transition-all duration-200 ease-smooth",
                tab === t.id
                  ? "bg-hairline/[0.09] text-text shadow-[inset_0_1px_0_rgb(var(--hairline)/0.1),0_1px_2px_rgb(0_0_0/0.25)]"
                  : "text-text-muted hover:bg-hairline/[0.05] hover:text-text"
              )}
            >
              <t.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t.label}
            </button>
          ))}
        </div>
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
    <span className="inline-flex items-baseline gap-1 text-2xs text-text-faint">
      <span className={cn("mono text-xs font-semibold", tone === "danger" ? "text-danger" : "text-text")}>
        {value}
      </span>
      {label}
    </span>
  );
}
