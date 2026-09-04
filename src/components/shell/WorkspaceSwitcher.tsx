"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { createWorkspace, deleteWorkspace } from "@/lib/data/firestore";
import type { Workspace } from "@/lib/types";
import { WORKSPACE_EMOJIS } from "@/lib/constants";
import { Dropdown } from "@/components/ui/Dropdown";
import { Modal, Field, inputClass } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher() {
  const { user } = useAuth();
  const { workspaces, currentWorkspace, selectWorkspace } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(WORKSPACE_EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Workspace | null>(null);

  const confirmDelete = async () => {
    if (!user || !toDelete) return;
    setBusy(true);
    try {
      await deleteWorkspace(user.uid, toDelete.id);
      setToDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!user || !name.trim()) return;
    setBusy(true);
    try {
      const id = await createWorkspace(user, name.trim(), emoji);
      selectWorkspace(id);
      setCreating(false);
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropdown
        width={244}
        className="!left-0"
        trigger={() => (
          <div className="press flex w-full items-center gap-2.5 rounded-md border border-hairline/[0.08] bg-hairline/[0.04] px-2 py-1.5 text-left transition-colors duration-200 hover:border-hairline/[0.14] hover:bg-hairline/[0.07]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-hairline/[0.06] text-base shadow-[inset_0_1px_0_rgb(var(--hairline)/0.07)]">
              {currentWorkspace?.emoji ?? "🧠"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="t-heading truncate text-sm text-text">
                {currentWorkspace?.name ?? "Workspace"}
              </div>
              <div className="text-2xs text-text-faint">
                {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
              </div>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          </div>
        )}
      >
        {(close) => (
          <div>
            <div className="px-2 pb-1 pt-0.5 text-2xs font-semibold uppercase tracking-[0.09em] text-text-faint">
              Workspaces
            </div>
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={cn(
                  "group flex items-center rounded-md pr-1 transition-colors hover:bg-hairline/[0.07]",
                  w.id === currentWorkspace?.id && "bg-hairline/[0.07]"
                )}
              >
                <button
                  onClick={() => {
                    selectWorkspace(w.id);
                    close();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-hairline/[0.06] text-sm">
                    {w.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text">{w.name}</span>
                  {w.id === currentWorkspace?.id && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setToDelete(w);
                    close();
                  }}
                  title="Delete workspace"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="my-1 h-px bg-hairline/[0.08]" />
            <button
              onClick={() => {
                setCreating(true);
                close();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-sm text-text-muted transition-colors hover:bg-hairline/[0.07] hover:text-text"
            >
              <span className="grid h-6 w-6 place-items-center rounded-md border border-dashed border-hairline/20">
                <Plus className="h-3.5 w-3.5" />
              </span>
              New workspace
            </button>
          </div>
        )}
      </Dropdown>

      <Modal open={creating} onClose={() => setCreating(false)} title="New workspace">
        <Field label="Emoji">
          <div className="flex flex-wrap gap-1.5">
            {WORKSPACE_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={cn(
                  "press grid h-9 w-9 place-items-center rounded-md border text-lg transition-all duration-200",
                  emoji === e ? "border-accent/60 bg-accent/10 shadow-glow" : "border-hairline/[0.09] hover:bg-hairline/[0.06]"
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Name">
          <input
            className={inputClass}
            placeholder="e.g. Hotel ODON"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete workspace">
        <p className="text-sm leading-relaxed text-text-muted">
          Delete <span className="font-medium text-text">{toDelete?.emoji} {toDelete?.name}</span> and
          all of its projects and tasks? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete workspace"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
