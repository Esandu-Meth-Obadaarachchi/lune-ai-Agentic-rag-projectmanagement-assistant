"use client";

import { useEffect, useState } from "react";
import { FileText, Link2, Sparkles, Trash2, X } from "lucide-react";
import type { Presence, Project, RetrievedChunk, Task } from "@/lib/types";
import { statusMeta } from "@/lib/constants";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { clearPresence, moveTasksToProject, setPresence, watchPresence } from "@/lib/data/firestore";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { useDeleteTask } from "@/lib/data/useDeleteTask";
import { collectSubtreeIds } from "@/lib/data/tree";
import { useToast } from "@/lib/ui/ToastContext";
import { postJSON } from "@/lib/api";
import { relativeTime } from "@/lib/date";
import { cn, shortId, taskAssignees } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { StatusControl } from "@/components/ui/StatusControl";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { AssigneePicker, AssigneeStack, DuePicker, PrioritySelect, RecurrencePicker, TagEditor } from "@/components/task/Pickers";
import { QuickAdd } from "@/components/task/TaskRow";
import { TimeTracker } from "@/components/task/TimeTracker";
import { TaskTimeline } from "@/components/task/TaskTimeline";
import { Dependencies } from "@/components/task/Dependencies";

export function TaskDrawer({
  task,
  onClose,
  onOpenTask,
}: {
  task: Task | null;
  onClose: () => void;
  /** Lets the breadcrumb and the subtask rows navigate within the hierarchy. */
  onOpenTask?: (t: Task) => void;
}) {
  const { allTasks, allProjects, currentProject, currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  // Resolved against every visible task, not the current project's slice: the
  // drawer is opened from Today and All my tasks too, where the task often
  // belongs to a different project. Reading the current slice meant `live` fell
  // back to a stale prop, the subtask list rendered empty, and adding a subtask
  // wrote it into whichever project happened to be selected.
  const live = allTasks.find((t) => t.id === task?.id) ?? task;
  const actions = useTaskActions({ projectId: live?.projectId });
  const confirmDelete = useDeleteTask(actions);
  const [viewers, setViewers] = useState<Presence[]>([]);
  const project = allProjects.find((p) => p.id === live?.projectId) ?? currentProject;
  const foreign = !!live && live.projectId !== currentProject?.id;
  const [title, setTitle] = useState(live?.title ?? "");
  const [notes, setNotes] = useState(live?.notes ?? "");
  const [related, setRelated] = useState<RetrievedChunk[] | null>(null);

  useEffect(() => {
    setTitle(live?.title ?? "");
    setNotes(live?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.id]); // reset only when a different task opens

  // Smart linking: surface knowledge-base docs related to this task.
  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setRelated(null);
    postJSON<{ chunks: RetrievedChunk[] }>("/api/related", { projectId: task.projectId, query: task.title })
      .then((r) => !cancelled && setRelated(r.chunks))
      .catch(() => !cancelled && setRelated([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.projectId]);

  // Live presence: announce we're on this task, heartbeat while open, clean up on
  // close. Others' avatars appear in the header.
  const taskId = task?.id;
  const memberIds = currentProject?.memberIds ?? currentWorkspace?.memberIds;
  useEffect(() => {
    if (!taskId || !user || !memberIds?.length) return;
    const me = { uid: user.uid, name: user.displayName ?? "You", photoURL: user.photoURL };
    const beat = () => void setPresence(taskId, me, memberIds).catch(() => {});
    beat();
    const interval = setInterval(beat, 20_000);
    const unsub = watchPresence(user.uid, taskId, setViewers);
    return () => {
      clearInterval(interval);
      unsub();
      void clearPresence(taskId, user.uid);
      setViewers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, user?.uid, memberIds?.join(",")]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!live) return null;
  const others = viewers.filter((v) => v.uid !== user?.uid);
  // Completed subtasks sink to the bottom, matching the tree view.
  const subtasks = allTasks
    .filter((t) => t.parentId === live.id)
    .sort((a, b) => {
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      return ad - bd || a.order - b.order;
    });
  const parent = live.parentId ? allTasks.find((t) => t.id === live.parentId) : null;
  const meta = statusMeta(live.status);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 animate-fade-in md:hidden" onClick={onClose} />
      {/* A phone gets a full-height sheet, not a 420px panel squeezed against
          the edge. From md up it is the side drawer it always was. */}
      <aside
        data-overlay-open
        className="fixed inset-0 z-50 flex flex-col border-border bg-surface shadow-pop animate-slide-in md:absolute md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-[420px] md:border-l"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className={meta.color}>●</span>
            {meta.label}
            <span className="mono text-text-faint">· t·{shortId(live.id)}</span>
          </div>
          <div className="ml-auto mr-2 flex items-center">
            {others.length > 0 && (
              <div className="flex items-center -space-x-1.5" title={`${others.map((o) => o.name).join(", ")} also here`}>
                {others.slice(0, 3).map((o) => (
                  <Avatar key={o.uid} name={o.name} src={o.photoURL} size={20} ring />
                ))}
                {others.length > 3 && (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-[9px] text-text-muted ring-2 ring-bg">
                    +{others.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text md:h-7 md:w-7"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {/* Where this task actually lives. Worth stating whenever the drawer
              was opened from a view that spans projects. */}
          {foreign && project && (
            <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs text-text-muted">
              <span
                className="h-2 w-2 shrink-0 rounded-[3px]"
                style={{ background: project.color }}
              />
              <span className="truncate">{project.isInbox ? "Inbox" : project.name}</span>
            </div>
          )}
          {parent && (
            <button
              onClick={() => onOpenTask?.(parent)}
              disabled={!onOpenTask}
              className="mb-2 block max-w-full truncate text-left text-2xs text-text-faint transition-colors hover:text-text-muted disabled:cursor-default disabled:hover:text-text-faint"
              title={onOpenTask ? `Open ${parent.title}` : parent.title}
            >
              ↳ subtask of {parent.title}
            </button>
          )}
          <div className="flex items-start gap-2.5">
            <div className="pt-1">
              <StatusControl status={live.status} onChange={(s) => actions.setStatus(live.id, s)} size={20} />
            </div>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== live.title && actions.rename(live.id, title.trim())}
              rows={1}
              className="flex-1 resize-none bg-transparent text-[17px] font-semibold leading-snug tracking-tight text-text outline-none"
            />
          </div>

          {/* properties */}
          <div className="mt-5 space-y-2.5">
            <Prop label="Priority">
              <PrioritySelect value={live.priority} onChange={(p) => actions.setPriority(live.id, p)} />
            </Prop>
            <Prop label="Assignees">
              <AssigneePicker
                value={taskAssignees(live)}
                onChange={(a) => actions.setAssignees(live.id, a)}
              />
            </Prop>
            <Prop label="Due date">
              <DuePicker
                value={live.dueDate}
                time={live.dueTime}
                endTime={live.dueEndTime}
                status={live.status}
                onChange={(d) => actions.setDue(live.id, d)}
                onTimeChange={(t) => actions.setDueTime(live.id, t)}
                onEndTimeChange={(t) => actions.setDueEndTime(live.id, t)}
              />
            </Prop>
            <Prop label="Repeat">
              <RecurrencePicker value={live.recurrence} onChange={(r) => actions.setRecurrence(live.id, r)} />
            </Prop>
            <Prop label="Project">
              <ProjectMover task={live} current={project} />
            </Prop>
            <Prop label="Estimate">
              <EstimatePicker
                value={live.estimate ?? null}
                onChange={(v) => actions.setEstimate(live.id, v)}
              />
            </Prop>
            <Prop label="Tags">
              <TagEditor tags={live.tags} onChange={(t) => actions.setTags(live.id, t)} />
            </Prop>
          </div>

          {/* time tracking */}
          <div className="mt-5">
            <TimeTracker task={live} actions={actions} />
          </div>

          {/* notes */}
          <div className="mt-5">
            <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-text-faint">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (live.notes ?? "") && actions.setNotes(live.id, notes)}
              placeholder="Add detail, links, acceptance criteria…"
              rows={4}
              className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent/50"
            />
          </div>

          {/* subtasks */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs font-medium uppercase tracking-wide text-text-faint">
                Subtasks {subtasks.length > 0 && `· ${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}`}
              </span>
            </div>
            <div className="space-y-px">
              {subtasks.map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
                  <StatusControl status={s.status} onChange={(st) => actions.setStatus(s.id, st)} size={14} />
                  <button
                    onClick={() => onOpenTask?.(s)}
                    disabled={!onOpenTask}
                    className={cn(
                      "flex-1 truncate text-left text-[13px] disabled:cursor-default",
                      s.status === "done" ? "text-text-faint line-through" : "text-text"
                    )}
                    title={onOpenTask ? `Open ${s.title}` : s.title}
                  >
                    {s.title}
                  </button>
                  {s.estimate != null && (
                    <span className="mono shrink-0 text-2xs text-text-faint">{s.estimate}p</span>
                  )}
                  {taskAssignees(s).length > 0 && (
                    <span className="shrink-0">
                      <AssigneeStack assignees={taskAssignees(s)} size={16} max={2} />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <QuickAdd placeholder="Add subtask" onAdd={(t) => actions.addSubtask(live.id, t)} />
          </div>

          {/* dependencies */}
          <div className="mt-5">
            <Dependencies
              task={live}
              onChange={(ids) => actions.setDependencies(live.id, ids)}
              onOpenTask={onOpenTask}
            />
          </div>

          {/* comments + system events */}
          <div className="mt-5 border-t border-border pt-4">
            <TaskTimeline task={live} />
          </div>

          {/* related from knowledge base (smart linking) */}
          <div className="mt-5">
            <span className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
              <Sparkles className="h-3 w-3 text-accent" /> Related from knowledge base
            </span>
            {related === null ? (
              <div className="space-y-1">
                <div className="shimmer h-9 rounded-md bg-surface-2" />
                <div className="shimmer h-9 rounded-md bg-surface-2" />
              </div>
            ) : related.length === 0 ? (
              <p className="text-2xs text-text-faint">
                No related documents yet. Add files in the Knowledge base to power this.
              </p>
            ) : (
              <div className="space-y-1">
                {related.map((d) => (
                  <div key={d.id} className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span className="flex-1 truncate text-[13px] text-text">{d.source}</span>
                      <span className="mono text-2xs text-text-faint">{d.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 pl-[22px] text-2xs leading-relaxed text-text-muted">
                      {d.text.slice(0, 160)}…
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* linked docs */}
          {live.linkedDocs.length > 0 && (
            <div className="mt-5">
              <span className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-faint">
                <Link2 className="h-3 w-3" /> Linked knowledge
              </span>
              <div className="space-y-1">
                {live.linkedDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px]">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <span className="truncate text-text">{d.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:pb-2.5">
          <span className="mono text-2xs text-text-faint">
            updated {relativeTime(live.updatedAt)}
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void confirmDelete(live.id, live.title, onClose)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </footer>
      </aside>
    </>
  );
}

/**
 * Move a task between projects. Nothing in the app offered this, so anything
 * captured into the Inbox was stuck there permanently. The whole subtree moves
 * and access is re-derived from the destination — see moveTasksToProject.
 */
function ProjectMover({ task, current }: { task: Task; current: Project | null }) {
  const { allProjects, workspaces, allTasks } = useWorkspace();
  const toast = useToast();

  const options = allProjects
    .filter((p) => p.id !== task.projectId)
    .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.name.localeCompare(b.name));

  const move = async (dest: Project) => {
    const ids = collectSubtreeIds(allTasks, task.id);
    const kids = ids.length - 1;
    const from = current;
    const ok = await toast.report(moveTasksToProject(ids, dest), {
      failure: "Could not move the task.",
    });
    if (ok === undefined) return;
    toast.ok(
      kids > 0
        ? `Moved to ${dest.name} with ${kids} subtask${kids === 1 ? "" : "s"}.`
        : `Moved to ${dest.name}.`,
      from
        ? {
            label: "Undo",
            run: () => toast.report(moveTasksToProject(ids, from), { failure: "Could not undo." }),
          }
        : undefined
    );
  };

  return (
    <Dropdown
      width={240}
      trigger={() => (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-text transition-colors hover:bg-surface-2">
          {current && (
            <span
              className="h-2 w-2 shrink-0 rounded-[3px]"
              style={{ background: current.color }}
            />
          )}
          <span className="truncate">
            {current ? (current.isInbox ? "Inbox" : current.name) : "Unknown"}
          </span>
        </span>
      )}
    >
      {(close) => (
        <div className="max-h-[300px] overflow-y-auto p-1">
          {options.length === 0 ? (
            <div className="px-2 py-2 text-2xs text-text-faint">No other projects.</div>
          ) : (
            options.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  close();
                  void move(p);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                <span className="truncate">{p.isInbox ? "Inbox" : p.name}</span>
                <span className="ml-auto shrink-0 truncate text-2xs text-text-faint">
                  {workspaces.find((w) => w.id === p.workspaceId)?.name}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </Dropdown>
  );
}

/** Story points. Fibonacci presets, because relative sizing stops pretending to
 *  be hours somewhere around 8. Kept inline rather than in Pickers.tsx since the
 *  backlog rows carry their own denser variant. */
const POINTS = [1, 2, 3, 5, 8, 13];

function EstimatePicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {POINTS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(value === p ? null : p)}
          title={`${p} point${p === 1 ? "" : "s"}`}
          className={
            value === p
              ? "mono grid h-6 w-6 place-items-center rounded bg-accent text-2xs text-accent-fg"
              : "mono grid h-6 w-6 place-items-center rounded text-2xs text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
          }
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-xs text-text-muted sm:w-20">{label}</span>
      <div className="flex min-h-[28px] flex-1 flex-wrap items-center">{children}</div>
    </div>
  );
}
