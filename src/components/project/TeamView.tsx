"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Loader2, Sparkles, Trash2, Upload, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { createTask, updateProject } from "@/lib/data/firestore";
import { authedFetch } from "@/lib/api";
import { MAX_BRIEF_CHARS, PRIORITIES, PROJECT_ROLES } from "@/lib/constants";
import type { Project, ProjectMember, TaskPriority, WorkspaceMember } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { TagChip } from "@/components/ui/TagChip";
import { Modal, Field, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/** One AI-proposed task before it is written. */
interface Proposed {
  title: string;
  notes: string;
  priority: TaskPriority;
  assigneeUid: string | null;
  assigneeName: string | null;
  reason: string;
}

export function TeamView({ project }: { project: Project }) {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();

  const members: WorkspaceMember[] = useMemo(() => {
    const all = currentWorkspace?.members ?? [];
    return all.filter((m) => !project.memberIds || project.memberIds.includes(m.uid));
  }, [currentWorkspace, project.memberIds]);

  const myRole = currentWorkspace?.members.find((m) => m.uid === user?.uid)?.role;
  const canEdit = myRole === "owner" || myRole === "admin";

  // Local, editable copy of the roster's profiles, seeded from project.team.
  const seed = (): Record<string, ProjectMember> => {
    const map: Record<string, ProjectMember> = {};
    members.forEach((m) => {
      const existing = project.team?.find((t) => t.uid === m.uid);
      map[m.uid] = existing ?? { uid: m.uid, name: m.name, role: "", skills: [], notes: "" };
    });
    return map;
  };
  const [profiles, setProfiles] = useState<Record<string, ProjectMember>>(seed);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const patch = (uid: string, p: Partial<ProjectMember>) => {
    setProfiles((prev) => ({ ...prev, [uid]: { ...prev[uid], ...p } }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const team = members.map((m) => profiles[m.uid]).filter(Boolean);
      await updateProject(project.id, { team });
      setDirty(false);
    } catch (e) {
      console.error("save team failed", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text">Team</h2>
          <span className="whitespace-nowrap text-2xs text-text-faint">
            · {members.length} on this project
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
              <Sparkles className="h-3.5 w-3.5 text-accent" /> Assign work with AI
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline/[0.08] px-6 py-10 text-center text-sm text-text-muted">
          No members on this project yet. Share the project from Overview to add teammates.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const p = profiles[m.uid];
            const roleIsPreset = !p?.role || PROJECT_ROLES.includes(p.role);
            return (
              <div key={m.uid} className="rounded-lg border border-hairline/[0.08] bg-surface px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={m.name} src={m.photoURL} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{m.name}</div>
                    <div className="truncate text-2xs text-text-faint">{m.email}</div>
                  </div>
                  <span className="rounded border border-hairline/[0.08] bg-surface-2 px-1.5 py-0.5 text-2xs capitalize text-text-muted">
                    {m.role}
                  </span>
                </div>

                {canEdit ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr]">
                    <div>
                      <select
                        value={roleIsPreset ? p?.role ?? "" : "__custom"}
                        onChange={(e) =>
                          patch(m.uid, { role: e.target.value === "__custom" ? " " : e.target.value })
                        }
                        className={cn(inputClass, "py-1.5 text-sm")}
                      >
                        <option value="">Role…</option>
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                        <option value="__custom">Custom…</option>
                      </select>
                      {!roleIsPreset && (
                        <input
                          className={cn(inputClass, "mt-1.5 py-1.5 text-sm")}
                          placeholder="Custom role"
                          value={p?.role?.trim() ?? ""}
                          onChange={(e) => patch(m.uid, { role: e.target.value })}
                        />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <input
                        className={cn(inputClass, "py-1.5 text-sm")}
                        placeholder="Skills / tech stack, comma separated (e.g. Node, PostgreSQL, Docker)"
                        defaultValue={(p?.skills ?? []).join(", ")}
                        onBlur={(e) =>
                          patch(m.uid, {
                            skills: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <input
                        className={cn(inputClass, "py-1.5 text-sm")}
                        placeholder="Notes (availability, focus…)"
                        defaultValue={p?.notes ?? ""}
                        onBlur={(e) => patch(m.uid, { notes: e.target.value.trim() })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p?.role?.trim() && <TagChip tag={p.role.trim()} />}
                    {(p?.skills ?? []).map((s) => (
                      <TagChip key={s} tag={s} />
                    ))}
                    {!p?.role?.trim() && (p?.skills ?? []).length === 0 && (
                      <span className="text-2xs text-text-faint">No role set</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assignOpen && (
        <AssignModal
          project={project}
          members={members}
          onClose={() => setAssignOpen(false)}
        />
      )}
    </div>
  );
}

/* --------------------------- assign-from-brief --------------------------- */

function AssignModal({
  project,
  members,
  onClose,
}: {
  project: Project;
  members: WorkspaceMember[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<Proposed[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(0);

  const generate = async () => {
    if (!file && !text.trim()) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("projectId", project.id);
      if (file) form.append("file", file);
      else form.append("text", text.slice(0, MAX_BRIEF_CHARS));
      const res = await authedFetch("/api/assign", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setProposals(json.tasks as Proposed[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const setRow = (i: number, p: Partial<Proposed>) =>
    setProposals((prev) => prev!.map((t, idx) => (idx === i ? { ...t, ...p } : t)));
  const removeRow = (i: number) =>
    setProposals((prev) => prev!.filter((_, idx) => idx !== i));

  const createAll = async () => {
    if (!proposals || !user || !currentWorkspace) return;
    setCreating(true);
    const memberIds = project.memberIds ?? currentWorkspace.memberIds;
    let done = 0;
    for (const t of proposals) {
      const m = members.find((x) => x.uid === t.assigneeUid);
      try {
        await createTask({
          workspaceId: project.workspaceId,
          projectId: project.id,
          title: t.title,
          notes: t.notes,
          priority: t.priority,
          memberIds,
          createdBy: user.uid,
          assignee: m ? { id: m.uid, name: m.name, avatar: m.photoURL } : null,
        });
        done++;
        setCreated(done);
      } catch (e) {
        console.error("create task failed", e);
      }
    }
    setCreating(false);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Assign work with AI" width={620}>
      {!proposals ? (
        <div>
          <p className="mb-3 text-sm text-text-muted">
            Upload a brief or paste a feature list. The AI splits it into tasks and assigns each to
            the best-fit member, balancing current workload. Nothing is created until you approve it.
          </p>

          <div
            onClick={() => fileRef.current?.click()}
            className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-hairline/[0.08] px-6 py-6 text-center transition-colors hover:border-hairline/20 hover:bg-hairline/[0.06]"
          >
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.docx,.txt,.md,.csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-accent">
              <Upload className="h-5 w-5" />
            </div>
            <div className="mt-2 text-sm font-medium text-text">
              {file ? file.name : "Drop a brief or click to upload"}
            </div>
            <div className="mt-0.5 text-2xs text-text-muted">PDF, DOCX, Markdown, text</div>
          </div>

          <div className="my-3 text-center text-2xs uppercase tracking-wide text-text-faint">or</div>

          <textarea
            className={cn(inputClass, "min-h-[120px] resize-y")}
            placeholder="Paste the feature brief or task list here…"
            maxLength={MAX_BRIEF_CHARS}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {error && <div className="mt-2 text-2xs text-danger">{error}</div>}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={generate}
              disabled={loading || (!file && !text.trim())}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {loading ? "Reading brief…" : "Generate tasks"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-text-muted">
            {proposals.length} proposed task{proposals.length === 1 ? "" : "s"}. Adjust the assignee or
            priority, remove any you do not want, then create them.
          </p>

          <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {proposals.map((t, i) => (
              <div key={i} className="rounded-lg border border-hairline/[0.08] bg-surface px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium text-text outline-none"
                    value={t.title}
                    onChange={(e) => setRow(i, { title: e.target.value })}
                  />
                  <button
                    onClick={() => removeRow(i)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint hover:bg-hairline/[0.06] hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {t.notes && <div className="mt-0.5 text-2xs text-text-muted">{t.notes}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={t.assigneeUid ?? ""}
                    onChange={(e) => {
                      const m = members.find((x) => x.uid === e.target.value);
                      setRow(i, { assigneeUid: m?.uid ?? null, assigneeName: m?.name ?? null });
                    }}
                    className={cn(inputClass, "h-7 w-auto py-0 text-2xs")}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={t.priority}
                    onChange={(e) => setRow(i, { priority: e.target.value as TaskPriority })}
                    className={cn(inputClass, "h-7 w-auto py-0 text-2xs")}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {t.reason && <span className="text-2xs text-text-faint">· {t.reason}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setProposals(null)} disabled={creating}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={createAll} disabled={creating || proposals.length === 0}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {creating ? `Creating ${created}/${proposals.length}` : `Create ${proposals.length} task${proposals.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
