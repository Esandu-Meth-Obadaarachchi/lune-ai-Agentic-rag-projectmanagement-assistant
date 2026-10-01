"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  FileText,
  HelpCircle,
  ListChecks,
  PencilLine,
  Quote,
  X,
} from "lucide-react";
import type { AgentCard, RetrievedChunk } from "@/lib/types";
import { statusMeta } from "@/lib/constants";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { Button } from "@/components/ui/Button";
import { postJSON } from "@/lib/api";
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

/** Send a follow-up turn on the user's behalf — how the interactive cards
 *  (an option button, an approval confirmation) continue the conversation. */
export type ReplyFn = (message: string) => void;

export function AgentCards({ cards, onReply }: { cards: AgentCard[]; onReply?: ReplyFn }) {
  if (!cards.length) return null;
  return (
    <div className="mt-2.5 space-y-2">
      {cards.map((c, i) => (
        <CardView key={i} card={c} onReply={onReply} />
      ))}
    </div>
  );
}

function CardView({ card, onReply }: { card: AgentCard; onReply?: ReplyFn }) {
  switch (card.kind) {
    case "clarify":
      return <Clarify data={card.data as ClarifyData} onReply={onReply} />;
    case "example_request":
      return <ExampleRequest data={card.data as { of: string; why?: string | null }} />;
    case "approval":
      return <Approval data={card.data as ApprovalData} onReply={onReply} />;
    case "assign_approval":
      return <AssignApproval data={card.data as AssignApprovalData} />;
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


/* ---------------------- the agent asked instead of acting ---------------------- */

interface ClarifyData {
  question: string;
  options?: string[];
  because?: string | null;
}

/**
 * A question the agent stopped to ask. The options are buttons rather than text,
 * because the whole reason the agent asked is that it already knows the
 * candidates — making the user retype one of them would waste the round trip
 * that asking was meant to save.
 */
function Clarify({ data, onReply }: { data: ClarifyData; onReply?: ReplyFn }) {
  return (
    <div className="card border-accent/25 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">{data.question}</div>
          {data.because && <div className="mt-0.5 text-2xs text-text-faint">{data.because}</div>}
          {!!data.options?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onReply?.(option)}
                  disabled={!onReply}
                  className="rounded-full border border-hairline/[0.12] bg-surface-2 px-2.5 py-1 text-2xs text-text transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The agent wants to see how the user writes this kind of thing before writing it. */
function ExampleRequest({ data }: { data: { of: string; why?: string | null } }) {
  return (
    <div className="card p-3">
      <div className="flex items-start gap-2">
        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text">
            Paste an example of <span className="font-medium">{data.of}</span> and I&apos;ll match
            its format.
          </div>
          {data.why && <div className="mt-0.5 text-2xs text-text-faint">{data.why}</div>}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- a held plan, pending approval -------------------------- */

interface ApprovalData {
  proposalId: string;
  action: string;
  project: string;
  count: number;
  outline: string[];
}

/**
 * A write large enough that the agent stopped to show its work first.
 *
 * Approving posts the stored plan back, and the server runs exactly that tree
 * with no model in the loop — so what is listed here is precisely what gets
 * created. Nothing has been written at the point this card renders.
 */
function Approval({ data, onReply }: { data: ApprovalData; onReply?: ReplyFn }) {
  const [state, setState] = useState<"open" | "working" | "approved" | "cancelled">("open");
  const [error, setError] = useState("");

  const decide = async (action: "approve" | "cancel") => {
    setState("working");
    setError("");
    try {
      const res = await postJSON<{ status: string; created: number; message: string }>(
        `/api/proposals/${data.proposalId}`,
        { action }
      );
      setState(res.status === "approved" ? "approved" : "cancelled");
      if (res.status === "approved" && res.created > 0) onReply?.(`(${res.message})`);
    } catch (e) {
      setState("open");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div className="card overflow-hidden border-accent/25">
      <div className="flex items-center gap-1.5 border-b border-hairline/[0.08] px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
        <ListChecks className="h-3.5 w-3.5" /> {data.count} tasks · {data.project} · not yet created
      </div>
      <div className="max-h-52 overflow-y-auto px-3 py-2">
        {data.outline.map((line, i) => (
          <div
            key={i}
            className="mono whitespace-pre text-2xs leading-relaxed text-text-muted"
          >
            {line}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-hairline/[0.08] px-3 py-2">
        {state === "approved" ? (
          <span className="inline-flex items-center gap-1 text-2xs text-done">
            <Check className="h-3.5 w-3.5" /> Created.
          </span>
        ) : state === "cancelled" ? (
          <span className="inline-flex items-center gap-1 text-2xs text-text-faint">
            <X className="h-3.5 w-3.5" /> Discarded. Nothing was created.
          </span>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => decide("approve")} disabled={state === "working"}>
              {state === "working" ? "Creating…" : `Create ${data.count} tasks`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => decide("cancel")}
              disabled={state === "working"}
            >
              Discard
            </Button>
            {error && <span className="text-2xs text-danger">{error}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------ a brief split + assigned, pending approval ------------------------ */

interface AssignApprovalData {
  proposalId: string;
  project: string;
  count: number;
  tasks: { title: string; priority: string; assignee: string | null; reason: string }[];
}

/**
 * A brief the agent has split into tasks and matched to people. Same contract as
 * `Approval`: nothing exists until the button is pressed, and the server runs the
 * stored list with no model involved.
 */
function AssignApproval({ data }: { data: AssignApprovalData }) {
  const [state, setState] = useState<"open" | "working" | "approved" | "cancelled">("open");
  const [error, setError] = useState("");

  const decide = async (action: "approve" | "cancel") => {
    setState("working");
    setError("");
    try {
      const res = await postJSON<{ status: string }>(`/api/proposals/${data.proposalId}`, { action });
      setState(res.status === "approved" ? "approved" : "cancelled");
    } catch (e) {
      setState("open");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div className="card overflow-hidden border-accent/25">
      <div className="flex items-center gap-1.5 border-b border-hairline/[0.08] px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
        <ListChecks className="h-3.5 w-3.5" /> {data.count} tasks · {data.project} · not yet created
      </div>
      <div className="max-h-72 divide-y divide-hairline/[0.06] overflow-y-auto">
        {data.tasks.map((t, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-2">
            <span className="mt-1.5"><PriorityDot priority={t.priority as never} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text">{t.title}</div>
              {t.reason && <div className="text-2xs text-text-faint">{t.reason}</div>}
            </div>
            <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-2xs text-text-muted">
              {t.assignee ?? "Unassigned"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-hairline/[0.08] px-3 py-2">
        {state === "approved" ? (
          <span className="inline-flex items-center gap-1 text-2xs text-done">
            <Check className="h-3.5 w-3.5" /> Created and assigned.
          </span>
        ) : state === "cancelled" ? (
          <span className="inline-flex items-center gap-1 text-2xs text-text-faint">
            <X className="h-3.5 w-3.5" /> Discarded. Nothing was created.
          </span>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => decide("approve")} disabled={state === "working"}>
              {state === "working" ? "Creating…" : `Approve & assign ${data.count} tasks`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide("cancel")} disabled={state === "working"}>
              Discard
            </Button>
            {error && <span className="text-2xs text-danger">{error}</span>}
          </>
        )}
      </div>
    </div>
  );
}
