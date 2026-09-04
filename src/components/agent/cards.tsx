"use client";

import { CheckCircle2, FileText, ListChecks, PencilLine } from "lucide-react";
import type { AgentCard, RetrievedChunk } from "@/lib/types";
import { statusMeta } from "@/lib/constants";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { cn } from "@/lib/utils";

interface TaskLike {
  id: string;
  title: string;
  project?: string | null;
  status?: string;
  priority?: string;
  due?: string | null;
  dueDate?: string | null;
  assignee?: string | null;
  parent?: string | null;
  subtasks?: number;
}

export function AgentCards({ cards }: { cards: AgentCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="mt-2.5 space-y-2">
      {cards.map((c, i) => (
        <CardView key={i} card={c} />
      ))}
    </div>
  );
}

function CardView({ card }: { card: AgentCard }) {
  switch (card.kind) {
    case "created_task":
      return <ActionTask data={card.data as TaskLike} label="Created" icon={<CheckCircle2 className="h-3.5 w-3.5 text-done" />} />;
    case "updated_task":
      return <ActionTask data={card.data as TaskLike} label="Updated" icon={<PencilLine className="h-3.5 w-3.5 text-progress" />} />;
    case "task_list":
      return <TaskList data={card.data as TaskLike[]} />;
    case "sources":
      return <Sources data={card.data as RetrievedChunk[]} />;
    default:
      return null;
  }
}

function ActionTask({ data, label, icon }: { data: TaskLike; label: string; icon: React.ReactNode }) {
  const due = data.dueDate ?? data.due;
  return (
    <div className="card flex items-center gap-2.5 p-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{data.title}</div>
        <div className="text-2xs text-text-faint">
          {label}
          {data.project ? ` · ${data.project}` : ""}
        </div>
      </div>
      {data.priority && <PriorityDot priority={data.priority as never} />}
      {due && <DueDateChip date={due} />}
    </div>
  );
}

function TaskList({ data }: { data: TaskLike[] }) {
  if (!data.length)
    return <div className="card p-3 text-sm text-text-muted">No matching tasks.</div>;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-hairline/[0.08] px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
        <ListChecks className="h-3.5 w-3.5" /> {data.length} task{data.length === 1 ? "" : "s"}
      </div>
      <div className="divide-y divide-hairline/[0.042]">
        {data.slice(0, 8).map((t) => {
          const meta = statusMeta((t.status as never) ?? "todo");
          return (
            <div key={t.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
              <span
                className={cn(
                  "flex-1 truncate text-sm",
                  t.status === "done" ? "text-text-faint line-through" : "text-text"
                )}
              >
                {t.title}
                {t.parent && <span className="ml-1.5 text-2xs text-text-faint">↳ {t.parent}</span>}
                {!!t.subtasks && <span className="ml-1.5 text-2xs text-text-faint">· {t.subtasks} sub</span>}
              </span>
              {t.assignee && <span className="hidden shrink-0 text-2xs text-text-muted sm:inline">{t.assignee}</span>}
              {t.project && <span className="hidden text-2xs text-text-faint sm:inline">{t.project}</span>}
              {t.due && <DueDateChip date={t.due} status={t.status as never} icon={false} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sources({ data }: { data: RetrievedChunk[] }) {
  if (!data.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-hairline/[0.08] px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
        <FileText className="h-3.5 w-3.5" /> Sources
      </div>
      <div className="divide-y divide-hairline/[0.042]">
        {data.slice(0, 4).map((s) => (
          <div key={s.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{s.source}</span>
              {s.project && <span className="text-2xs text-text-faint">{s.project}</span>}
              <span className="mono text-2xs text-text-faint">{s.score.toFixed(2)}</span>
            </div>
            <p className="mt-1 line-clamp-2 pl-[22px] text-2xs leading-relaxed text-text-muted">
              {s.text.slice(0, 180)}…
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
