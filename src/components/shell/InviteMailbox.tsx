"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Mail, X } from "lucide-react";
import { authedFetch, postJSON } from "@/lib/api";
import type { Invite } from "@/lib/types";
import { Dropdown } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

/**
 * Invite mailbox. Invites are never auto-accepted — the user explicitly accepts
 * or declines each one here, and only then do they join the workspace.
 */
export function InviteMailbox() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/members?mine=1");
      if (!res.ok) return;
      const { invites } = (await res.json()) as { invites?: Invite[] };
      setInvites(invites ?? []);
    } catch {
      /* offline / not configured */
    }
  }, []);

  useEffect(() => {
    refresh();
    // Cheap poll; invites are rare and this avoids another listener.
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const respond = async (inviteId: string, action: "acceptOne" | "declineOne") => {
    setBusy(inviteId);
    try {
      await postJSON("/api/members", { action, inviteId });
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      // Accepting adds a workspace; the workspaces listener picks it up.
    } finally {
      setBusy(null);
    }
  };

  if (invites.length === 0) return null;

  return (
    <Dropdown
      width={288}
      align="left"
      trigger={() => (
        <span
          className="relative grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-hairline/[0.06] hover:text-text"
          title={`${invites.length} pending invite${invites.length === 1 ? "" : "s"}`}
        >
          <Mail className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-accent-fg">
            {invites.length}
          </span>
        </span>
      )}
    >
      {() => (
        <div>
          <div className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-text-faint">
            Workspace invites
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {invites.map((inv) => (
              <div key={inv.id} className="rounded-md border border-hairline/[0.08] bg-surface-2 p-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-sm">
                    {inv.workspaceEmoji || "🧠"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{inv.workspaceName}</div>
                    <div className="truncate text-2xs text-text-faint">
                      {inv.invitedByName} · {inv.role}
                      {inv.scope?.length ? ` · ${inv.scope.length} project${inv.scope.length === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    disabled={busy === inv.id}
                    onClick={() => respond(inv.id, "acceptOne")}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1 text-2xs font-medium text-accent-fg",
                      "hover:bg-accent-hover disabled:opacity-50"
                    )}
                  >
                    <Check className="h-3 w-3" /> Accept
                  </button>
                  <button
                    disabled={busy === inv.id}
                    onClick={() => respond(inv.id, "declineOne")}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-hairline/[0.08] px-2 py-1 text-2xs text-text-muted hover:bg-hairline/[0.09] hover:text-text disabled:opacity-50"
                  >
                    <X className="h-3 w-3" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
