"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Inbox as InboxIcon, LayoutGrid, Users } from "lucide-react";
import { ShareDialog } from "@/components/shell/ShareDialog";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { computeDigest } from "@/lib/data/standup";
import { STATUS_ORDER, statusMeta } from "@/lib/constants";
import { dueState } from "@/lib/date";
import type { Project, Task } from "@/lib/types";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { Logo } from "@/components/ui/Logo";
import { StatusBar } from "@/components/ui/StatusBar";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const { currentWorkspace, projects, workspaceTasks, selectProject } = useWorkspace();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);

  const digest = useMemo(() => computeDigest(workspaceTasks), [workspaceTasks]);
  const open = workspaceTasks.filter((t) => t.status !== "done").length;
  const done = workspaceTasks.filter((t) => t.status === "done").length;

  const byProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    workspaceTasks.forEach((t) => {
      const list = map.get(t.projectId) ?? [];
      list.push(t);
      map.set(t.projectId, list);
    });
    return map;
  }, [workspaceTasks]);

  const openProject = (id: string) => {
    selectProject(id);
    router.push("/");
  };
  const openTask = (t: Task) => {
    selectProject(t.projectId);
    router.push(`/?task=${t.id}`);
  };

  // Inbox first, then the rest.
  const ordered = [...projects].sort((a, b) => Number(!!b.isInbox) - Number(!!a.isInbox));

  if (!currentWorkspace) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={32} className="animate-pulse-dot" />
      </div>
    );
  }

  const attention = [...digest.overdue, ...digest.dueToday, ...digest.blocked];

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <header className="flex items-center gap-3 border-b border-hairline/[0.08] px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-hairline/[0.06] text-xl shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]">
          {currentWorkspace.emoji}
        </span>
        <div className="min-w-0">
          <h1 className="t-title truncate text-xl">{currentWorkspace.name}</h1>
          <p className="mt-0.5 text-2xs text-text-faint">
            {projects.length} project{projects.length === 1 ? "" : "s"} · {workspaceTasks.length} tasks
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="hidden items-center gap-4 sm:flex">
            <Stat label="open" value={open} />
            <Stat label="overdue" value={digest.overdue.length} tone="danger" />
            <Stat label="done" value={done} />
          </div>
          <button
            onClick={() => setSharing(true)}
            className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-hairline/[0.12] px-2.5 text-2xs font-medium text-text-muted shadow-[inset_0_1px_0_rgb(var(--hairline)/0.05)] transition-colors hover:border-hairline/20 hover:bg-hairline/[0.05] hover:text-text"
          >
            <Users className="h-3.5 w-3.5" /> Share
          </button>
        </div>
      </header>

      <ShareDialog workspace={currentWorkspace} open={sharing} onClose={() => setSharing(false)} />

      <div className="mx-auto max-w-5xl space-y-7 px-5 py-6">
        {/* Where the whole workspace stands, as one band. Four boxed numbers
            said the same thing but made you assemble the picture yourself. */}
        <div className="card p-4">
          <StatusBar tasks={workspaceTasks} height={8} />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* Legend follows the bar, left to right, so the two read as one
                object rather than two lists that happen to share colours. */}
            {(["done", "in_progress", "blocked", "todo"] as const).map((sid) => {
              const meta = statusMeta(sid);
              const count = workspaceTasks.filter((t) => t.status === sid).length;
              const pct = workspaceTasks.length
                ? Math.round((count / workspaceTasks.length) * 100)
                : 0;
              return (
                <span key={sid} className="flex items-baseline gap-2">
                  <span className={cn("h-2 w-2 shrink-0 translate-y-[-1px] rounded-full", meta.dot)} />
                  <span className="mono text-base font-semibold tabular-nums text-text">{count}</span>
                  <span className="text-2xs text-text-muted">{meta.label}</span>
                  <span className="mono text-2xs text-text-faint">{pct}%</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* projects */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.09em] text-text-faint">
            <LayoutGrid className="h-3.5 w-3.5" /> Projects
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                tasks={byProject.get(p.id) ?? []}
                onOpen={() => openProject(p.id)}
              />
            ))}
          </div>
        </section>

        {/* needs attention */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.09em] text-text-faint">
            <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
          </h2>
          {attention.length === 0 ? (
            <div className="card p-4 text-sm text-text-muted">
              Nothing overdue, due today or blocked across this workspace.
            </div>
          ) : (
            <div className="card divide-y divide-hairline/[0.042] overflow-hidden">
              {attention.slice(0, 12).map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hairline/[0.05]"
                >
                  <PriorityDot priority={t.priority} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{t.title}</span>
                  <span className="hidden shrink-0 text-2xs text-text-faint sm:inline">
                    {projects.find((p) => p.id === t.projectId)?.name}
                  </span>
                  {t.status === "blocked" ? (
                    <span className="mono rounded bg-blocked/[0.14] px-1.5 py-0.5 text-2xs font-semibold text-blocked">
                      blocked
                    </span>
                  ) : (
                    <DueDateChip date={t.dueDate} time={t.dueTime} status={t.status} icon={false} />
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectCard({ project, tasks, onOpen }: { project: Project; tasks: Task[]; onOpen: () => void }) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const open = total - done;
  const overdue = tasks.filter((t) => t.status !== "done" && dueState(t.dueDate, t.status) === "overdue").length;

  return (
    <button onClick={onOpen} className="card card-hover press p-3 text-left">
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
        <span
          className={cn(
            "mono shrink-0 text-base tabular-nums",
            open > 0 ? "font-semibold text-text" : "text-text-faint"
          )}
        >
          {open}
        </span>
      </div>

      <StatusBar tasks={tasks} className="mt-2.5" />

      <div className="mt-2 flex items-center gap-3 text-2xs text-text-faint">
        <span>{open} open</span>
        <span>{done} done</span>
        {overdue > 0 && (
          <span className="ml-auto flex items-center gap-1 font-medium text-danger">
            <CalendarClock className="h-3 w-3" /> {overdue} overdue
          </span>
        )}
      </div>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
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
