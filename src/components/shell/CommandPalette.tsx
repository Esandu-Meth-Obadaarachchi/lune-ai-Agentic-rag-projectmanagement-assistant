"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CalendarCheck2,
  CornerDownLeft,
  FileText,
  Inbox,
  LayoutGrid,
  ListChecks,
  Plus,
  Search,
  Sparkles,
  SquareCheck,
} from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { useToast } from "@/lib/ui/ToastContext";
import { statusMeta } from "@/lib/constants";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * ⌘K. The sidebar has advertised this key since the first release and nothing
 * was ever bound to it.
 *
 * Search runs over tasks, projects and pages the user can already see — no new
 * query, no index, just the live context. Typing with no match offers to create
 * the task instead, so the palette is also the fastest way to capture.
 */

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  /** Coloured dot, for task status and project colour. */
  dot?: string;
  run: () => void;
};

/** Subsequence match: "sld" finds "Solar Dashboard". Returns null for no match,
 *  otherwise a score where lower is better (earlier and tighter wins). */
function fuzzy(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const direct = h.indexOf(n);
  if (direct >= 0) return direct; // a literal run always beats a scattered one
  let i = 0;
  let first = -1;
  let last = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) {
      if (first < 0) first = j;
      last = j;
      i++;
    }
  }
  if (i < n.length) return null;
  return 1000 + (last - first) + first;
}

/** Fired by any UI that wants the palette (the sidebar row, the mobile search
 *  button). A custom event beats a synthetic ⌘K, which depends on the listener
 *  never checking `isTrusted` and reads as a hack at the call site. */
export const OPEN_PALETTE = "lune:open-palette";

export function openCommandPalette() {
  document.dispatchEvent(new CustomEvent(OPEN_PALETTE));
}

export function CommandPalette({ onOpenTask }: { onOpenTask?: (t: Task) => void }) {
  const router = useRouter();
  const toast = useToast();
  const {
    allTasks,
    allProjects,
    workspaces,
    pages,
    inboxProject,
    openWorkspaceProject,
  } = useWorkspace();
  const actions = useTaskActions({ projectId: inboxProject?.id });

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Open on ⌘K / Ctrl-K, and on "/" when not already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
    }
  }, [open]);

  const close = () => setOpen(false);

  const wsName = useMemo(() => {
    const m = new Map<string, string>();
    workspaces.forEach((w) => m.set(w.id, w.name));
    return m;
  }, [workspaces]);

  const projName = useMemo(() => {
    const m = new Map<string, string>();
    allProjects.forEach((p) => m.set(p.id, p.isInbox ? "Inbox" : p.name));
    return m;
  }, [allProjects]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    const nav: [string, string, typeof Search][] = [
      ["Today", "/today", CalendarCheck2],
      ["Overview", "/overview", LayoutGrid],
      ["All my tasks", "/my-tasks", ListChecks],
      ["All workspaces", "/workspaces", Boxes],
      ["Ask the brain", "/agent", Sparkles],
      ["Knowledge base", "/knowledge", BookOpen],
      ["Pages", "/pages", FileText],
    ];
    nav.forEach(([label, href, icon]) =>
      out.push({
        id: `nav:${href}`,
        group: "Go to",
        label,
        icon,
        run: () => {
          router.push(href);
          close();
        },
      })
    );

    allProjects
      .filter((p) => !p.isInbox)
      .forEach((p) =>
        out.push({
          id: `proj:${p.id}`,
          group: "Projects",
          label: p.name,
          hint: wsName.get(p.workspaceId),
          icon: SquareCheck,
          dot: p.color,
          run: () => {
            openWorkspaceProject(p.workspaceId, p.id);
            router.push("/");
            close();
          },
        })
      );

    // Open tasks first — closed work is rarely what you are hunting for.
    [...allTasks]
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
      .forEach((t) =>
        out.push({
          id: `task:${t.id}`,
          group: "Tasks",
          label: t.title,
          hint: [wsName.get(t.workspaceId), projName.get(t.projectId)].filter(Boolean).join(" / "),
          icon: SquareCheck,
          dot: statusMeta(t.status).hex,
          run: () => {
            if (onOpenTask) {
              openWorkspaceProject(t.workspaceId, t.projectId);
              onOpenTask(t);
            } else {
              openWorkspaceProject(t.workspaceId, t.projectId);
              router.push(`/?task=${t.id}`);
            }
            close();
          },
        })
      );

    pages.forEach((p) =>
      out.push({
        id: `page:${p.id}`,
        group: "Pages",
        label: p.title || "Untitled",
        hint: p.projectId ? projName.get(p.projectId) : "Workspace",
        icon: FileText,
        run: () => {
          router.push(`/pages/${p.id}`);
          close();
        },
      })
    );

    return out;
  }, [allTasks, allProjects, pages, wsName, projName, router, openWorkspaceProject, onOpenTask]);

  const results = useMemo(() => {
    if (!q.trim()) {
      // A useful resting state rather than a wall of everything.
      return items.filter((i) => i.group === "Go to" || i.group === "Projects").slice(0, 12);
    }
    return items
      .map((i) => {
        const s = fuzzy(q.trim(), i.label);
        return s === null ? null : { item: i, score: s };
      })
      .filter((x): x is { item: Item; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 30)
      .map((x) => x.item);
  }, [items, q]);

  // Nothing matched, but there is something typed: offer to capture it.
  const canCreate = q.trim().length > 1 && inboxProject && actions.ready;
  const rows: Item[] = useMemo(() => {
    if (!canCreate) return results;
    const create: Item = {
      id: "create",
      group: "Create",
      label: `Add task "${q.trim()}"`,
      hint: "Inbox",
      icon: Plus,
      run: () => {
        void toast.report(Promise.resolve(actions.add(q.trim())), {
          success: "Added to Inbox.",
          failure: "Could not add the task.",
        });
        close();
      },
    };
    return results.length ? [...results, create] : [create];
  }, [results, canCreate, q, actions, toast]);

  useEffect(() => setCursor(0), [q]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      rows[cursor]?.run();
    }
  };

  let lastGroup = "";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-start justify-center p-3 pt-[8vh] sm:pt-[14vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div
        className="card relative z-10 flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden p-0 shadow-pop animate-scale-in"
        role="dialog"
        aria-modal
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, projects and pages…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-faint"
          />
          <kbd className="mono hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-text-faint sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-text-muted">
              Nothing matches “{q}”.
            </div>
          ) : (
            rows.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {header && (
                    <div className="px-3.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-text-faint">
                      {header}
                    </div>
                  )}
                  <button
                    data-i={i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={item.run}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
                      i === cursor ? "bg-surface-2" : "hover:bg-surface-2/60"
                    )}
                  >
                    {item.dot ? (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: item.dot }}
                      />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="hidden shrink-0 truncate text-2xs text-text-faint sm:block">
                        {item.hint}
                      </span>
                    )}
                    {i === cursor && (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-2xs text-text-faint">
          <span className="flex items-center gap-1">
            <kbd className="mono rounded border border-border bg-surface-2 px-1 py-0.5">↑↓</kbd>
            move
          </span>
          <span className="flex items-center gap-1">
            <kbd className="mono rounded border border-border bg-surface-2 px-1 py-0.5">↵</kbd>
            open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Inbox className="h-3 w-3" />
            type to capture
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
