"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  CircleDot,
  MessageSquare,
  Pencil,
  Plus,
  Rocket,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import {
  addComment,
  deleteComment,
  notify,
  updateComment,
  watchTimeline,
} from "@/lib/data/firestore";
import {
  encodeMention,
  extractMentions,
  mentionQueryAt,
  parseMentions,
  plainText,
  rankPeople,
} from "@/lib/data/mentions";
import { useToast } from "@/lib/ui/ToastContext";
import { relativeTime } from "@/lib/date";
import type { Assignee, EventVerb, Task, TimelineEntry } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { cn, taskAssignees } from "@/lib/utils";

/**
 * A task's comments and system events in one chronological thread.
 *
 * Jira splits these into separate tabs, which means you read a decision without
 * the state change that caused it. Interleaving them is the whole point.
 */
export function TaskTimeline({ task }: { task: Task }) {
  const { user } = useAuth();
  const { currentWorkspace, allProjects } = useWorkspace();
  const toast = useToast();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchTimeline(user.uid, task.id, setEntries);
  }, [user, task.id]);

  // Everyone who can see this task, for the mention picker.
  const project = allProjects.find((p) => p.id === task.projectId);
  const people: Assignee[] = useMemo(() => {
    const members = currentWorkspace?.members ?? [];
    return members
      .filter((m) => !project?.memberIds || project.memberIds.includes(m.uid))
      .map((m) => ({ id: m.uid, name: m.name, avatar: m.photoURL }));
  }, [currentWorkspace, project]);

  const comments = entries.filter((e) => e.kind === "comment").length;

  const send = async (body: string) => {
    if (!user) return;
    const mentions = extractMentions(body);
    const author = { uid: user.uid, name: user.displayName ?? "You", photoURL: user.photoURL };
    const ok = await toast.report(addComment({ task, author, body, mentions }), {
      failure: "Could not post the comment.",
    });
    if (ok === undefined) return;

    // Mentioned people, plus everyone assigned, minus the author.
    const excerpt = plainText(body).slice(0, 140);
    if (mentions.length) {
      notify({ recipients: mentions, kind: "mentioned", actor: author, task, detail: excerpt });
    }
    const watchers = taskAssignees(task)
      .map((a) => a.id)
      .filter((id) => !mentions.includes(id));
    if (watchers.length) {
      notify({ recipients: watchers, kind: "comment", actor: author, task, detail: excerpt });
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
        <MessageSquare className="h-3 w-3" />
        Activity
        {comments > 0 && <span className="mono">· {comments}</span>}
      </div>

      <div className="space-y-2.5">
        {entries.length === 0 && (
          <p className="text-2xs text-text-faint">
            No activity yet. Comment to leave context for whoever picks this up.
          </p>
        )}

        {entries.map((e) =>
          e.kind === "event" ? (
            <EventRow key={e.id} entry={e} />
          ) : (
            <CommentRow
              key={e.id}
              entry={e}
              mine={e.uid === user?.uid}
              people={people}
              editing={editing === e.id}
              onEdit={() => setEditing(e.id)}
              onCancelEdit={() => setEditing(null)}
              onSave={async (body) => {
                await toast.report(updateComment(e.id, body, extractMentions(body)), {
                  failure: "Could not save the edit.",
                });
                setEditing(null);
              }}
              onDelete={async () => {
                const snapshot = e;
                const ok = await toast.report(deleteComment(e.id), {
                  failure: "Could not delete the comment.",
                });
                if (ok === undefined) return;
                toast.ok("Comment deleted.", {
                  label: "Undo",
                  run: async () => {
                    await toast.report(
                      addComment({
                        task,
                        author: { uid: snapshot.uid, name: snapshot.name, photoURL: snapshot.photoURL },
                        body: snapshot.body ?? "",
                        mentions: snapshot.mentions ?? [],
                      }),
                      { failure: "Could not restore." }
                    );
                  },
                });
              }}
            />
          )
        )}
      </div>

      <div className="mt-2.5">
        <Composer people={people} onSubmit={send} />
      </div>
    </div>
  );
}

/* ------------------------------ events ------------------------------ */

const VERB_ICON: Record<EventVerb, typeof CircleDot> = {
  created: Plus,
  status: CircleDot,
  assigned: UserPlus,
  unassigned: UserPlus,
  due: CalendarClock,
  sprint: Rocket,
  estimate: CircleDot,
  moved: ArrowRightLeft,
};

function eventText(e: TimelineEntry): string {
  const to = e.to ?? "";
  const from = e.from ?? "";
  switch (e.verb) {
    case "created":
      return "created this task";
    case "status":
      return from ? `moved it from ${from} to ${to}` : `set the status to ${to}`;
    case "assigned":
      return `assigned ${to}`;
    case "unassigned":
      return `unassigned ${from}`;
    case "due":
      return to ? `set the due date to ${to}` : "cleared the due date";
    case "sprint":
      return to ? `added it to ${to}` : "moved it to the backlog";
    case "estimate":
      return to ? `estimated it at ${to}` : "cleared the estimate";
    case "moved":
      return `moved it to ${to}`;
    default:
      return "updated this task";
  }
}

function EventRow({ entry }: { entry: TimelineEntry }) {
  const Icon = entry.verb ? VERB_ICON[entry.verb] : CircleDot;
  return (
    <div className="flex items-center gap-2 text-2xs text-text-faint">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border bg-surface-2">
        <Icon className="h-2.5 w-2.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-text-muted">{entry.name}</span> {eventText(entry)}
      </span>
      <span className="mono shrink-0">{relativeTime(entry.createdAt)}</span>
    </div>
  );
}

/* ------------------------------ comments ------------------------------ */

function CommentRow({
  entry,
  mine,
  people,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  entry: TimelineEntry;
  mine: boolean;
  people: Assignee[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  if (editing) {
    return (
      <div className="rounded-md border border-accent/30 bg-surface-2 p-2">
        <Composer
          people={people}
          initial={entry.body ?? ""}
          submitLabel="Save"
          onSubmit={(b) => onSave(b)}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div className="group rounded-md p-1.5 transition-colors hover:bg-surface-2/60">
      <div className="flex items-center gap-2">
        <Avatar name={entry.name} src={entry.photoURL} size={20} />
        <span className="truncate text-2xs font-medium text-text">{entry.name}</span>
        <span className="mono text-2xs text-text-faint">{relativeTime(entry.createdAt)}</span>
        {entry.editedAt && <span className="text-2xs text-text-faint">· edited</span>}
        {mine && (
          <div className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <button
              onClick={onEdit}
              aria-label="Edit comment"
              className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-3 hover:text-text"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={onDelete}
              aria-label="Delete comment"
              className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 whitespace-pre-wrap pl-[28px] text-[13px] leading-relaxed text-text">
        {parseMentions(entry.body ?? "").map((span, i) =>
          span.type === "mention" ? (
            <span key={i} className="rounded bg-accent/15 px-1 py-0.5 font-medium text-accent">
              @{span.text}
            </span>
          ) : (
            <span key={i}>{span.text}</span>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Comment box with an @ mention picker. Enter sends, Shift-Enter makes a new
 * line, matching the agent composer.
 */
function Composer({
  people,
  onSubmit,
  onCancel,
  initial = "",
  submitLabel = "Comment",
}: {
  people: Assignee[];
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  initial?: string;
  submitLabel?: string;
}) {
  const [value, setValue] = useState(initial);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const token = mentionQueryAt(value, caret);
  const matches = token ? rankPeople(people, token.query) : [];
  const picking = !!token && matches.length > 0;

  useEffect(() => setPick(0), [token?.query]);

  const choose = (p: Assignee) => {
    if (!token) return;
    const next = value.slice(0, token.start) + encodeMention(p) + " " + value.slice(token.end);
    setValue(next);
    // Put the caret after the inserted mention, not at the end of the box.
    const at = token.start + encodeMention(p).length + 1;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };

  const submit = () => {
    const body = value.trim();
    if (!body) return;
    onSubmit(body);
    setValue("");
  };

  return (
    <div className="relative">
      {picking && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-md border border-border bg-surface p-1 shadow-pop">
          {matches.map((p, i) => (
            <button
              key={p.id}
              onMouseEnter={() => setPick(i)}
              onClick={() => choose(p)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors",
                i === pick ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2"
              )}
            >
              <Avatar name={p.name} src={p.avatar} size={18} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        rows={2}
        placeholder="Comment, or @ someone…"
        onChange={(e) => {
          setValue(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (picking) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPick((p) => Math.min(p + 1, matches.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPick((p) => Math.max(p - 1, 0));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(matches[pick]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setCaret(-1);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        className="w-full resize-none rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent/50"
      />

      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xs text-text-faint">
          <kbd className="mono rounded border border-border bg-surface-2 px-1">↵</kbd> to send
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="ml-auto rounded-md px-2 py-1 text-2xs text-text-muted hover:bg-surface-2 hover:text-text"
          >
            Cancel
          </button>
        )}
        <button
          onClick={submit}
          disabled={!value.trim()}
          className={cn(
            "rounded-md px-2.5 py-1 text-2xs font-medium transition-colors disabled:opacity-40",
            onCancel ? "" : "ml-auto",
            "bg-accent text-accent-fg hover:bg-accent-hover"
          )}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
