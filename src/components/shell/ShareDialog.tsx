"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, Shield, Trash2, UserPlus } from "lucide-react";
import { authedFetch, postJSON } from "@/lib/api";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import type { Invite, MemberRole, Workspace, WorkspaceMember } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { Field, Modal, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

const ROLES: { id: MemberRole; label: string; hint: string }[] = [
  { id: "admin", label: "Admin", hint: "Can manage members and everything in scope" },
  { id: "member", label: "Member", hint: "Can edit tasks and knowledge in scope" },
  { id: "client-viewer", label: "Viewer", hint: "Read-only access to their projects" },
];

function roleLabel(role: MemberRole) {
  if (role === "owner") return "Owner";
  return ROLES.find((r) => r.id === role)?.label ?? "Member";
}

interface ShareState {
  members: WorkspaceMember[];
  invites: Invite[];
  isManager: boolean;
  ownerId: string;
}

export function ShareDialog({ workspace, open, onClose }: { workspace: Workspace; open: boolean; onClose: () => void }) {
  const { projects } = useWorkspace();
  const realProjects = projects.filter((p) => !p.isInbox);
  const [state, setState] = useState<ShareState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [scope, setScope] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // We don't auto-send email (no mail provider yet). Instead the inviter copies
  // a ready-made message and sends it however they like; the teammate joins the
  // moment they sign in with that Google email.
  const copyInvite = (to: string) => {
    const url = typeof window !== "undefined" ? window.location.origin : "https://esa-ai-personal-assistant.netlify.app";
    const msg = `You're invited to join "${workspace.name}" on Lune AI.\nOpen ${url} and sign in with Google using ${to} — you'll be added automatically.`;
    navigator.clipboard?.writeText(msg).then(() => {
      setCopied(to);
      setTimeout(() => setCopied((c) => (c === to ? null : c)), 2200);
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/members?workspaceId=${workspace.id}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
      setState(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const projectName = (id: string) => realProjects.find((p) => p.id === id)?.name ?? "project";
  const scopeSummary = (s: string[] | null | undefined) =>
    s == null ? "All projects" : s.length === 1 ? projectName(s[0]) : `${s.length} projects`;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await postJSON("/api/members", { workspaceId: workspace.id, ...body });
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async () => {
    if (!email.trim()) return;
    const to = email.trim();
    const ok = await act({ action: "invite", email: to, role, scope });
    if (ok) {
      copyInvite(to); // put the invite message on the clipboard, ready to send
      setEmail("");
      setRole("member");
      setScope(null);
    }
  };

  const canManage = state?.isManager;

  return (
    <Modal open={open} onClose={onClose} title={`Share ${workspace.emoji} ${workspace.name}`} width={520}>
      {loading && !state ? (
        <div className="grid place-items-center py-10 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Members */}
          <div>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">
              Members
            </h3>
            <div className="card divide-y divide-hairline/[0.042] overflow-hidden">
              {state?.members.map((m) => (
                <div key={m.uid} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar name={m.name} src={m.photoURL} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{m.name}</div>
                    <div className="truncate text-2xs text-text-faint">{m.email}</div>
                  </div>
                  {m.role !== "owner" && (
                    <span className="hidden text-2xs text-text-faint sm:inline">{scopeSummary(m.scope)}</span>
                  )}
                  {canManage && m.role !== "owner" ? (
                    <Dropdown
                      align="right"
                      width={150}
                      trigger={() => (
                        <span className="inline-flex items-center gap-1 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-0.5 text-2xs text-text-muted hover:text-text">
                          {roleLabel(m.role)}
                        </span>
                      )}
                    >
                      {(close) => (
                        <div>
                          {ROLES.map((r) => (
                            <MenuItem
                              key={r.id}
                              icon={r.id === m.role ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                              onClick={async () => {
                                close();
                                await act({ action: "update", uid: m.uid, role: r.id });
                              }}
                            >
                              {r.label}
                            </MenuItem>
                          ))}
                          <div className="my-1 h-px bg-hairline/[0.08]" />
                          <MenuItem
                            danger
                            icon={<Trash2 className="h-4 w-4" />}
                            onClick={async () => {
                              close();
                              await act({ action: "removeMember", uid: m.uid });
                            }}
                          >
                            Remove
                          </MenuItem>
                        </div>
                      )}
                    </Dropdown>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-0.5 text-2xs text-text-muted">
                      {m.role === "owner" && <Shield className="h-3 w-3 text-accent" />}
                      {roleLabel(m.role)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Per-member scope editor (managers only) */}
          {canManage && state && state.members.some((m) => m.role !== "owner") && (
            <MemberScopes state={state} realProjects={realProjects} onSave={act} busy={busy} scopeSummary={scopeSummary} />
          )}

          {/* Pending invites */}
          {state && state.invites.length > 0 && (
            <div>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">Pending</h3>
              <div className="card divide-y divide-hairline/[0.042] overflow-hidden">
                {state.invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2.5 px-3 py-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-text-faint">
                      <Mail className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text">{inv.email}</div>
                      <div className="truncate text-2xs text-text-faint">
                        {roleLabel(inv.role)} · {scopeSummary(inv.scope)}
                      </div>
                    </div>
                    <button
                      onClick={() => copyInvite(inv.email)}
                      className="inline-flex items-center gap-1 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-1 text-2xs text-text-muted hover:text-text"
                      title="Copy invite message to send"
                    >
                      {copied === inv.email ? (
                        <>
                          <Check className="h-3 w-3 text-accent" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy invite
                        </>
                      )}
                    </button>
                    {canManage && (
                      <button
                        onClick={() => act({ action: "revokeInvite", inviteId: inv.id })}
                        className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-danger/10 hover:text-danger"
                        title="Revoke invite"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite form */}
          {canManage && (
            <div>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">
                Invite a teammate
              </h3>
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <input
                    className={cn(inputClass, "flex-1")}
                    type="email"
                    placeholder="teammate@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                  />
                  <Dropdown
                    align="right"
                    width={220}
                    trigger={() => (
                      <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline/[0.08] bg-surface-2 px-3 text-sm text-text-muted hover:text-text">
                        {roleLabel(role)}
                      </span>
                    )}
                  >
                    {(close) => (
                      <div>
                        {ROLES.map((r) => (
                          <MenuItem
                            key={r.id}
                            icon={r.id === role ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                            onClick={() => {
                              setRole(r.id);
                              close();
                            }}
                          >
                            <div>
                              <div>{r.label}</div>
                              <div className="text-2xs text-text-faint">{r.hint}</div>
                            </div>
                          </MenuItem>
                        ))}
                      </div>
                    )}
                  </Dropdown>
                </div>

                <ScopeSelector value={scope} onChange={setScope} projects={realProjects} />

                <div className="flex items-center justify-between gap-2">
                  <p className="text-2xs leading-snug text-text-faint">
                    Creates the invite and copies a message to send them. They join
                    automatically when they sign in with that Google email.
                  </p>
                  <Button variant="primary" onClick={sendInvite} disabled={!email.trim() || busy}>
                    <UserPlus className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Create invite"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}
          {!canManage && (
            <p className="text-2xs text-text-faint">Only owners and admins can invite or change access.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Whole-workspace vs specific-projects picker. `null` == whole workspace. */
function ScopeSelector({
  value,
  onChange,
  projects,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  projects: { id: string; name: string; color: string }[];
}) {
  const specific = value !== null;
  const toggle = (id: string) => {
    const set = new Set(value ?? []);
    set.has(id) ? set.delete(id) : set.add(id);
    onChange([...set]);
  };
  return (
    <div className="rounded-lg border border-hairline/[0.08] bg-surface-2/50 p-2.5">
      <div className="mb-2 flex gap-1">
        <button
          onClick={() => onChange(null)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors",
            !specific ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-hairline/[0.06]"
          )}
        >
          Whole workspace
        </button>
        <button
          onClick={() => onChange(value ?? [])}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors",
            specific ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-hairline/[0.06]"
          )}
        >
          Specific projects
        </button>
      </div>
      {specific && (
        <div className="max-h-36 space-y-0.5 overflow-y-auto">
          {projects.length === 0 && <div className="px-1 py-1 text-2xs text-text-faint">No projects yet.</div>}
          {projects.map((p) => {
            const on = (value ?? []).includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-text hover:bg-hairline/[0.06]"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded border",
                    on ? "border-accent bg-accent text-white" : "border-hairline/[0.08]"
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                <span className="truncate">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Inline scope editing for existing (non-owner) members. */
function MemberScopes({
  state,
  realProjects,
  onSave,
  busy,
  scopeSummary,
}: {
  state: ShareState;
  realProjects: { id: string; name: string; color: string }[];
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  scopeSummary: (s: string[] | null | undefined) => string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const editable = state.members.filter((m) => m.role !== "owner");
  if (editable.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">Project access</h3>
      <div className="card divide-y divide-hairline/[0.042] overflow-hidden">
        {editable.map((m) => (
          <div key={m.uid} className="px-3 py-2">
            <button
              onClick={() => {
                setEditing(editing === m.uid ? null : m.uid);
                setDraft(m.scope ?? null);
              }}
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text">{m.name}</span>
              <span className="text-2xs text-text-faint">{scopeSummary(m.scope)}</span>
            </button>
            {editing === m.uid && (
              <div className="mt-2 space-y-2">
                <ScopeSelector value={draft} onChange={setDraft} projects={realProjects} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await onSave({ action: "update", uid: m.uid, scope: draft });
                      if (ok) setEditing(null);
                    }}
                  >
                    Save access
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
