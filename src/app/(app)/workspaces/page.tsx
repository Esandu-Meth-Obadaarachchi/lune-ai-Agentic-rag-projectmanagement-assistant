"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Inbox as InboxIcon } from "lucide-react";
import { statusMeta } from "@/lib/constants";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { dueState } from "@/lib/date";
import type { Project, Task, Workspace } from "@/lib/types";
import { Logo } from "@/components/ui/Logo";
import { StatusBar } from "@/components/ui/StatusBar";
import { cn } from "@/lib/utils";

/** All workspaces at once — one column per business, like a portfolio kanban. */
export default function AllWorkspacesPage() {
  const { user } = useAuth();
  // `allProjects` / `allTasks` already span every workspace the user can see,
  // so this screen reads them from the provider rather than opening a second
  // pair of identical Firestore listeners of its own.
  const { workspaces, allProjects: projects, allTasks: tasks, openWorkspaceProject, selectWorkspace } =
    useWorkspace();
  const router = useRouter();

  const projByWs = useMemo(() => {
    const m = new Map<string, Project[]>();
    projects.forEach((p) => {
      const list = m.get(p.workspaceId) ?? [];
      list.push(p);
      m.set(p.workspaceId, list);
    });
    // inbox first within each workspace
    m.forEach((list) => list.sort((a, b) => Number(!!b.isInbox) - Number(!!a.isInbox)));
    return m;
  }, [projects]);

  const tasksByProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const list = m.get(t.projectId) ?? [];
      list.push(t);
      m.set(t.projectId, list);
    });
    return m;
  }, [tasks]);

  // Hover preview. The columns scroll (overflow-y-auto) and would clip an
  // absolutely-positioned panel, so it is portalled and positioned from the
  // card's viewport rect.
  const [preview, setPreview] = useState<{ project: Project; tasks: Task[]; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPreview = (project: Project, tasks: Task[], rect: DOMRect) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setPreview({ project, tasks, rect }), 160);
  };
  const closePreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setPreview(null);
  };

  if (!user) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={32} className="animate-pulse-dot" />
      </div>
    );
  }

  const open = (ws: Workspace) => tasks.filter((t) => t.workspaceId === ws.id && t.status !== "done").length;
  const overdue = (ws: Workspace) =>
    tasks.filter(
      (t) => t.workspaceId === ws.id && t.status !== "done" && dueState(t.dueDate, t.status) === "overdue"
    ).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-hairline/[0.07] px-5 py-4">
        <div className="min-w-0">
          <h1 className="t-title text-xl">All workspaces</h1>
          <p className="mt-0.5 text-2xs text-text-faint">
            {workspaces.length} {workspaces.length === 1 ? "business" : "businesses"} ·{" "}
            {projects.length} projects
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Metric value={tasks.filter((t) => t.status !== "done").length} label="open" />
          <Metric
            value={tasks.filter((t) => t.status !== "done" && dueState(t.dueDate, t.status) === "overdue").length}
            label="overdue"
            tone="danger"
          />
          <Metric value={tasks.filter((t) => t.status === "done").length} label="done" />
          <div className="hidden w-40 md:block">
            <StatusBar tasks={tasks} />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 sm:snap-none sm:p-4">
        {workspaces.map((ws) => {
          const wsProjects = projByWs.get(ws.id) ?? [];
          const od = overdue(ws);
          return (
            <div key={ws.id} className="flex w-[84vw] shrink-0 snap-start flex-col sm:w-[288px] sm:snap-align-none">
              <button
                onClick={() => {
                  selectWorkspace(ws.id);
                  router.push("/overview");
                }}
                title={`Open ${ws.name}`}
                className="press mb-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hairline/[0.06]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-hairline/[0.06] text-base shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]">
                  {ws.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text">{ws.name}</span>
                  <span className="mono block text-2xs text-text-faint">
                    {wsProjects.length} project{wsProjects.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="mono block text-sm font-semibold text-text">{open(ws)}</span>
                  <span className="block text-2xs text-text-faint">open</span>
                </span>
                {od > 0 && (
                  <span className="mono shrink-0 rounded bg-danger/[0.14] px-1.5 py-0.5 text-2xs font-semibold text-danger">
                    {od}
                  </span>
                )}
              </button>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-lg border border-hairline/[0.05] bg-hairline/[0.02] p-1.5">
                {wsProjects.map((p) => (
                  <PortfolioCard
                    key={p.id}
                    project={p}
                    tasks={tasksByProject.get(p.id) ?? []}
                    onHover={(rect) => openPreview(p, tasksByProject.get(p.id) ?? [], rect)}
                    onLeave={closePreview}
                    onOpen={() => {
                      closePreview();
                      openWorkspaceProject(ws.id, p.id);
                      router.push("/");
                    }}
                  />
                ))}
                {wsProjects.length === 0 && (
                  <div className="grid place-items-center rounded-md border border-dashed border-hairline/[0.08] py-8 text-2xs text-text-faint">
                    No projects yet
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {workspaces.length === 0 && (
          <div className="grid w-full place-items-center text-sm text-text-muted">No workspaces yet.</div>
        )}
      </div>

      {preview && <ProjectHoverCard {...preview} />}
    </div>
  );
}

/** Floating read-only peek at a project: progress, status mix, next few tasks. */
function ProjectHoverCard({ project, tasks, rect }: { project: Project; tasks: Task[]; rect: DOMRect }) {
  if (typeof document === "undefined") return null;

  const W = 264;
  const left = Math.min(rect.right + 8, window.innerWidth - W - 8);
  const top = Math.min(rect.top, window.innerHeight - 260);

  const done = tasks.filter((t) => t.status === "done").length;
  const open = tasks.length - done;
  const next = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);

  return createPortal(
    <div
      className="glass pointer-events-none fixed z-[200] animate-fade-in rounded-lg p-3 shadow-e3"
      style={{ left, top, width: W }}
    >
      <div className="flex items-center gap-2">
        {project.isInbox ? (
          <InboxIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: project.color }} />
        )}
        <span className="truncate text-sm font-semibold text-text">{project.name}</span>
      </div>
      {project.description && (
        <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-text-muted">{project.description}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-2xs text-text-muted">
        <span><b className="mono text-text">{open}</b> open</span>
        <span><b className="mono text-text">{done}</b> done</span>
        <span className="ml-auto mono text-text-faint">{tasks.length} total</span>
      </div>

      <div className="mt-2.5 space-y-1">
        {next.length === 0 ? (
          <p className="text-2xs text-text-faint">Nothing open.</p>
        ) : (
          next.map((t) => {
            const meta = statusMeta(t.status);
            return (
              <div key={t.id} className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                <span className="min-w-0 flex-1 truncate text-2xs text-text">{t.title}</span>
                {t.dueDate && <DueDateChip date={t.dueDate} time={t.dueTime} status={t.status} icon={false} />}
              </div>
            );
          })
        )}
        {open > next.length && (
          <p className="pt-0.5 text-2xs text-text-faint">+{open - next.length} more open</p>
        )}
      </div>
    </div>,
    document.body
  );
}

function PortfolioCard({
  project,
  tasks,
  onOpen,
  onHover,
  onLeave,
}: {
  project: Project;
  tasks: Task[];
  onOpen: () => void;
  onHover: (rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const open = total - done;
  const overdue = tasks.filter((t) => t.status !== "done" && dueState(t.dueDate, t.status) === "overdue").length;

  return (
    <button
      onClick={onOpen}
      onMouseEnter={(e) => onHover(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onLeave}
      className="card card-hover press group w-full rounded-md px-2.5 py-2 text-left"
    >
      <div className="flex items-center gap-2">
        {project.isInbox ? (
          <InboxIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
        ) : (
          <span
            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-hairline/20"
            style={{ background: project.color }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{project.name}</span>
        {overdue > 0 && (
          <span className="mono shrink-0 text-2xs font-semibold text-danger" title={`${overdue} overdue`}>
            {overdue}!
          </span>
        )}
        {/* The number people actually scan for. Muted to nothing when there is
            no open work, so a finished project stops shouting. */}
        <span
          className={cn(
            "mono shrink-0 text-sm tabular-nums",
            open > 0 ? "font-semibold text-text" : "text-text-faint"
          )}
        >
          {open}
        </span>
      </div>
      <StatusBar tasks={tasks} className="mt-2" />
    </button>
  );
}

/** A number with its label, for the header summary. */
function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "danger";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "mono text-base font-semibold tabular-nums",
          tone === "danger" && value > 0 ? "text-danger" : "text-text"
        )}
      >
        {value}
      </span>
      <span className="text-2xs text-text-faint">{label}</span>
    </span>
  );
}
