"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Multi-select over an ordered list of task ids.
 *
 * Shared by the views and the keyboard layer so "the selection" means one
 * thing: shift-click extends from the last anchor, ⌘/ctrl-click toggles, a
 * plain click replaces. The ordered id list comes from the view, so a range
 * follows what is on screen rather than some underlying sort.
 */
export function useSelection(ordered: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const only = useCallback((id: string) => {
    anchor.current = id;
    setSelected(new Set([id]));
  }, []);

  /** Extend from the anchor to `id`, keeping anything already picked. */
  const extendTo = useCallback(
    (id: string) => {
      const from = anchor.current;
      if (!from) return only(id);
      const a = ordered.indexOf(from);
      const b = ordered.indexOf(id);
      if (a < 0 || b < 0) return only(id);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setSelected((prev) => {
        const next = new Set(prev);
        ordered.slice(lo, hi + 1).forEach((x) => next.add(x));
        return next;
      });
    },
    [ordered, only]
  );

  /** One handler for every row click, so modifier behaviour never drifts. */
  const handleClick = useCallback(
    (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      if (e.shiftKey) return extendTo(id);
      if (e.metaKey || e.ctrlKey) return toggle(id);
      return only(id);
    },
    [extendTo, toggle, only]
  );

  const selectAll = useCallback(() => setSelected(new Set(ordered)), [ordered]);

  // Ids that are still on screen, in view order. A selected task that has been
  // filtered away or deleted must not be acted on.
  const ids = useMemo(() => ordered.filter((id) => selected.has(id)), [ordered, selected]);

  return {
    selected,
    ids,
    count: ids.length,
    isSelected: (id: string) => selected.has(id),
    toggle,
    only,
    extendTo,
    handleClick,
    selectAll,
    clear,
  };
}

export type Selection = ReturnType<typeof useSelection>;
