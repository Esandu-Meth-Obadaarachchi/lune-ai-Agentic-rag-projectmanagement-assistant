"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Info, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toasts and undo.
 *
 * Before this, every Firestore write in the app was a floating promise: a rules
 * rejection, a dropped connection or an offline device produced nothing on
 * screen and the user believed the change had saved. `report()` wraps a
 * mutation so failures always surface, and `undo` gives destructive actions a
 * way back that does not need soft-delete plumbing on every collection.
 */

export type ToastTone = "ok" | "error" | "info";

interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  ok: (message: string, action?: ToastAction) => void;
  error: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
  /**
   * Run a mutation, surfacing any failure as an error toast. Returns true when
   * it succeeded, so callers can skip their own optimistic cleanup on failure.
   */
  report: <T>(work: Promise<T> | (() => Promise<T>), opts?: { success?: string; failure?: string }) => Promise<T | undefined>;
}

const Ctx = createContext<ToastApi | null>(null);

/** Errors hang around longer — there is usually something to read. */
const LIFETIME: Record<ToastTone, number> = { ok: 4000, info: 5000, error: 9000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, action?: ToastAction) => {
      const id = crypto.randomUUID();
      // Cap the stack so a loop of failures cannot bury the screen.
      setToasts((prev) => [...prev.slice(-3), { id, tone, message, action }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME[tone])
      );
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      ok: (m, a) => push("ok", m, a),
      error: (m, a) => push("error", m, a),
      info: (m, a) => push("info", m, a),
      report: async (work, opts) => {
        try {
          const result = await (typeof work === "function" ? work() : work);
          if (opts?.success) push("ok", opts.success);
          return result;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          push("error", opts?.failure ? `${opts.failure} ${detail}` : detail);
          return undefined;
        }
      },
    }),
    [push]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const ICONS: Record<ToastTone, typeof Check> = {
  ok: Check,
  error: AlertTriangle,
  info: Info,
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      // Full width above the safe area on phones, a corner stack on desktop.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[300] flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:items-end"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-lg border bg-surface px-3 py-2.5 shadow-pop animate-slide-up sm:w-auto sm:min-w-[280px]",
              t.tone === "error" ? "border-danger/40" : "border-border"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                t.tone === "error" ? "text-danger" : t.tone === "ok" ? "text-done" : "text-accent"
              )}
            />
            <span className="min-w-0 flex-1 text-[13px] leading-snug text-text">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  void t.action!.run();
                  onDismiss(t.id);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-2xs font-medium text-text transition-colors hover:bg-surface-2"
              >
                <RotateCcw className="h-3 w-3" />
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
