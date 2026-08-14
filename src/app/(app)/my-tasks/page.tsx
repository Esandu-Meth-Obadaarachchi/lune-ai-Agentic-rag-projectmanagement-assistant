"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, KanbanSquare, ListChecks, ListTree, Rows3 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import type { Task } from "@/lib/types";
import { taskAssignees } from "@/lib/utils";
import { TreeView } from "@/components/views/TreeView";
import { ListView } from "@/components/views/ListView";
import { KanbanBoard } from "@/components/views/KanbanBoard";
import { CalendarView } from "@/components/views/CalendarView";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { cn } from "@/lib/utils";

type MineView = "list" | "board" | "tree" | "calendar";

const TABS: { id: MineView; label: string; icon: typeof Rows3 }[] = [
  { id: "list", label: "List", icon: Rows3 },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "tree", label: "Tree", icon: ListTree },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

/**
 * All my tasks — every task assigned to the current user across every project and
 * workspace, shown in the same views used inside a project (List / Board / Tree /
 * Calendar). Reuses those view components with a cross-project task set. Data is
 * still gated by membership: allTasks only ever contains tasks the user can see.
 */
export default function MyTasksPage() {
  const { user } = useAuth();
  const { allTasks, allProjects: projects } = useWorkspace();
  const [view, setView] = useState<MineView>("list");
  const [selected, setSelected] = useState<Task | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sb-mine-view") as MineView | null;
    if (saved) setView(saved);
  }, []);
  const changeView = (v: MineView) => {
    setView(v);
    localStorage.setItem("sb-mine-view", v);
  };

  const myTasks = useMemo(() => {
    if (!user) return [];
    return allTasks.filter(
      (t) => t.assigneeId === user.uid || taskAssignees(t).some((a) => a.id === user.uid)
    );
  }, [allTasks, user]);

  const open = myTasks.filter((t) => t.status !== "done").length;
  const done = myTasks.length - open;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-border px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-3">
          <ListChecks className="h-4 w-4 shrink-0 text-accent" />
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-text">All my tasks</h1>
          <span className="hidden text-2xs text-text-faint sm:inline">across every workspace</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Stat label="open" value={open} />
            <Stat label="done" value={done} />
          </div>
        </div>

        <div className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => changeView(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                view === t.id ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className={cn("min-h-0 flex-1", view === "board" ? "overflow-hidden" : "overflow-auto")}>
        {view === "list" ? (
          <ListView tasks={myTasks} onOpenTask={setSelected} />
        ) : view === "board" ? (
          <KanbanBoard tasks={myTasks} onOpenTask={setSelected} />
        ) : view === "tree" ? (
          <TreeView tasks={myTasks} onOpenTask={setSelected} selectedId={selected?.id} />
        ) : (
          <CalendarView tasks={myTasks} projects={projects} onOpenTask={setSelected} />
        )}
      </div>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} onOpenTask={setSelected} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-text-muted">
      <span className="mono font-semibold text-text">{value}</span>
      {label}
    </span>
  );
}
