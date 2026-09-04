"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free popover menu. Anchors a floating panel to a trigger,
 * closes on outside-click and Escape.
 *
 * The panel renders in a portal on document.body with `position: fixed`, so it
 * is never clipped by an ancestor's `overflow` (e.g. the task drawer) and it
 * flips above the trigger when there isn't room below (e.g. the sidebar footer
 * user menu). Position is measured from the trigger's rect and clamped to the
 * viewport.
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
  width = 200,
  className,
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Position the panel from the trigger rect; re-run on scroll/resize.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "right" ? t.right - width : t.left;
      left = Math.max(margin, Math.min(left, vw - width - margin));
      const popH = popRef.current?.offsetHeight ?? 0;
      const below = t.bottom + 6;
      // Flip above the trigger if the panel would run off the bottom.
      const flip = popH > 0 && below + popH > vh - margin && t.top - 6 - popH > margin;
      setPos({ top: flip ? t.top - 6 - popH : below, left });
    };
    place();
    const raf = requestAnimationFrame(place); // re-place once height is known
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex"
      >
        {trigger(open)}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className={cn(
              "glass fixed z-[110] origin-top animate-scale-in overflow-hidden rounded-xl p-1.5 shadow-e3",
              className
            )}
            style={{
              width,
              minWidth: width,
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  danger,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-sm transition-colors duration-150",
        danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-hairline/[0.07]",
        active && "bg-hairline/[0.07]"
      )}
    >
      {icon && <span className="grid h-4 w-4 place-items-center text-text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <span className="text-accent" aria-hidden>✓</span>}
    </button>
  );
}
