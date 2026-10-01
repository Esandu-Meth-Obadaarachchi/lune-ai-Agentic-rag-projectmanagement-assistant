"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Loader2, RefreshCw } from "lucide-react";
import { authedFetch, browserTimeZone, postJSON } from "@/lib/api";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

interface Status {
  configured: boolean;
  connected: boolean;
  liveSync: boolean;
  webhookConfigured: boolean;
}

export function CalendarSync() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/calendar/status");
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
  }, []);

  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      await postJSON("/api/calendar/sync", { tz: browserTimeZone() });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Returning from the OAuth flow: seed the sync + tidy the URL.
    const p = new URLSearchParams(window.location.search);
    if (p.get("calendar") === "connected") {
      window.history.replaceState(null, "", window.location.pathname);
      runSync().then(refresh);
    }
  }, [refresh, runSync]);

  if (!status || !status.configured) return null;

  if (!status.connected) {
    return (
      <button
        onClick={async () => {
          const { url } = await (await authedFetch("/api/calendar/connect")).json();
          if (url) window.location.href = url;
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-1 text-2xs text-text-muted transition-colors hover:border-accent/30 hover:text-accent"
      >
        <CalendarCheck2 className="h-3 w-3" /> Connect Google Calendar
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={runSync}
        disabled={busy}
        title="Sync now"
        className="inline-flex items-center gap-1.5 rounded-md border border-hairline/[0.08] bg-surface-2 px-2 py-1 text-2xs text-text-muted transition-colors hover:text-text"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {busy ? "Syncing…" : "Sync now"}
      </button>
      <Dropdown
        align="right"
        width={200}
        trigger={() => (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-ok/25 bg-ok/10 px-2 py-1 text-2xs text-ok">
            <CalendarCheck2 className="h-3 w-3" />
            {status.liveSync ? "Synced (live)" : "Synced"}
          </span>
        )}
      >
        {(close) => (
          <div>
            {!status.liveSync && (
              <div className="px-2 py-1.5 text-2xs leading-snug text-text-faint">
                Live reverse-sync is off. Set <span className="mono">CALENDAR_WEBHOOK_URL</span> to a
                public HTTPS URL and reconnect to enable it. Use “Sync now” meanwhile.
              </div>
            )}
            <MenuItem
              danger
              onClick={async () => {
                await postJSON("/api/calendar/disconnect", {});
                await refresh();
                close();
              }}
            >
              Disconnect calendar
            </MenuItem>
          </div>
        )}
      </Dropdown>
    </div>
  );
}
