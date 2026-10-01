"use client";

import { AlertTriangle, CalendarClock, CircleSlash, Sparkles } from "lucide-react";
import type { StandupDigest, Task } from "@/lib/types";
import { greeting } from "@/lib/date";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { cn } from "@/lib/utils";

export function StandupCard({
  digest,
  userName,
  projectName,
  onOpen,
}: {
  digest: StandupDigest;
  userName: string;
  projectName: (projectId: string) => string | undefined;
  onOpen: (t: Task) => void;
}) {
  const clear =
    digest.overdue.length === 0 &&
    digest.dueToday.length === 0 &&
    digest.blocked.length === 0;

  return (
    <div className="card lit overflow-hidden shadow-e1">
      <div className="flex items-center gap-2 border-b border-hairline/[0.08] px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div>
          <div className="text-sm font-semibold text-text">
            {greeting()}, {userName.split(" ")[0]}
          </div>
          <div className="text-2xs text-text-faint">Here&apos;s your standup for today</div>
        </div>
        <div className="ml-auto text-2xs text-text-faint">
          {digest.overdue.length + digest.dueToday.length + digest.blocked.length} need attention
        </div>
      </div>

      {clear && digest.suggested.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text-muted">
          You&apos;re all clear. Nothing overdue, due today or blocked. ✨
        </div>
      ) : (
        <div className="grid gap-px bg-hairline/[0.08] sm:grid-cols-2">
          <Section
            title="Overdue"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            tone="danger"
            tasks={digest.overdue}
            projectName={projectName}
            onOpen={onOpen}
            empty="Nothing overdue"
          />
          <Section
            title="Due today"
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            tone="warn"
            tasks={digest.dueToday}
            projectName={projectName}
            onOpen={onOpen}
            empty="Nothing due today"
          />
          <Section
            title="Blocked"
            icon={<CircleSlash className="h-3.5 w-3.5" />}
            tone="blocked"
            tasks={digest.blocked}
            projectName={projectName}
            onOpen={onOpen}
            empty="Nothing blocked"
          />
          <Section
            title="Suggested focus"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            tone="accent"
            tasks={digest.suggested}
            projectName={projectName}
            onOpen={onOpen}
            empty="No suggestions"
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  tone,
  tasks,
  projectName,
  onOpen,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "danger" | "warn" | "blocked" | "accent";
  tasks: Task[];
  projectName: (id: string) => string | undefined;
  onOpen: (t: Task) => void;
  empty: string;
}) {
  const toneClass = {
    danger: "text-danger",
    warn: "text-warn",
    blocked: "text-blocked",
    accent: "text-accent",
  }[tone];

  return (
    <div className="bg-surface p-3">
      <div className={cn("mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide", toneClass)}>
        {icon}
        {title}
        <span className="mono text-text-faint">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="px-1 py-1 text-2xs text-text-faint">{empty}</div>
      ) : (
        <div className="space-y-0.5">
          {tasks.slice(0, 5).map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hairline/[0.06]"
            >
              <PriorityDot priority={t.priority} />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{t.title}</span>
              <span className="hidden shrink-0 text-2xs text-text-faint sm:inline">
                {projectName(t.projectId)}
              </span>
              {t.dueDate && <DueDateChip date={t.dueDate} status={t.status} icon={false} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
