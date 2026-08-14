"use client";

import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import type { Selection } from "./useSelection";

interface Options {
  /** Rows in view order. */
  rows: Task[];
  selection: Selection;
  /** Currently focused row id, and how to change it. */
  cursor: string | null;
  setCursor: (id: string | null) => void;
  onOpen: (t: Task) => void;
  onToggleDone: (t: Task) => void;
  onDelete: (t: Task) => void;
  onNew: () => void;
  enabled?: boolean;
}

/** Ignore keys while the user is typing or an overlay owns the screen. */
function shouldIgnore(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el?.isContentEditable) return true;
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return !!document.querySelector("[aria-modal], [data-overlay-open]");
}

/**
 * Keyboard navigation for a task list, in the shape people already know from
 * Linear and Gmail:
 *
 *   j / k or ↓ / ↑   move the cursor      x  select
 *   Enter or e       open                 a  select all
 *   space            toggle done          n  new task
 *   shift+j/k        extend selection     Esc clear
 *   #                delete
 *
 * The cursor is separate from the selection: moving does not select, which is
 * what makes shift-extend and x-then-move work the way people expect.
 */
export function useTaskKeys({
  rows,
  selection,
  cursor,
  setCursor,
  onOpen,
  onToggleDone,
  onDelete,
  onNew,
  enabled = true,
}: Options) {
  // Handlers change every render; a ref keeps the listener stable so we do not
  // rebind on every keystroke.
  const latest = useRef({ rows, selection, cursor, setCursor, onOpen, onToggleDone, onDelete, onNew });
  latest.current = { rows, selection, cursor, setCursor, onOpen, onToggleDone, onDelete, onNew };

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnore(e)) return;
      const s = latest.current;
      if (!s.rows.length) {
        if (e.key === "n") {
          e.preventDefault();
          s.onNew();
        }
        return;
      }

      const at = s.cursor ? s.rows.findIndex((r) => r.id === s.cursor) : -1;
      const move = (delta: number) => {
        const next = at < 0 ? (delta > 0 ? 0 : s.rows.length - 1) : at + delta;
        const clamped = Math.max(0, Math.min(next, s.rows.length - 1));
        const target = s.rows[clamped];
        if (!target) return;
        s.setCursor(target.id);
        if (e.shiftKey) s.selection.extendTo(target.id);
        // Keep the row on screen without yanking the page around.
        document
          .querySelector<HTMLElement>(`[data-task-row="${target.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      };

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "x": {
          if (!s.cursor) return;
          e.preventDefault();
          s.selection.toggle(s.cursor);
          break;
        }
        case "a":
          e.preventDefault();
          s.selection.selectAll();
          break;
        case "e":
        case "Enter": {
          const t = s.rows.find((r) => r.id === s.cursor);
          if (!t) return;
          e.preventDefault();
          s.onOpen(t);
          break;
        }
        case " ": {
          const t = s.rows.find((r) => r.id === s.cursor);
          if (!t) return;
          e.preventDefault();
          s.onToggleDone(t);
          break;
        }
        case "#": {
          const t = s.rows.find((r) => r.id === s.cursor);
          if (!t) return;
          e.preventDefault();
          s.onDelete(t);
          break;
        }
        case "n":
          e.preventDefault();
          s.onNew();
          break;
        case "Escape":
          if (s.selection.count > 0) {
            e.preventDefault();
            s.selection.clear();
          }
          break;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
