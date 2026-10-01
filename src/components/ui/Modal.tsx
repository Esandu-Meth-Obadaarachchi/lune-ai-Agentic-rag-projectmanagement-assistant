"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-4 sm:pt-[13vh]">
      {/* The scrim darkens and softens the app behind, so the sheet is clearly
          the only live surface. */}
      <div
        className="fixed inset-0 animate-fade-in bg-bg-deep/70 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div
        // A phone gets a bottom sheet (full width, square bottom corners, rising
        // from the edge); from sm up it is the centred dialog it always was.
        className={cn(
          "glass-panel relative z-10 w-full animate-slide-up rounded-2xl rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          "sm:w-[var(--modal-w)] sm:max-w-[calc(100vw-2rem)] sm:animate-scale-in sm:rounded-2xl sm:pb-5"
        )}
        style={{ "--modal-w": `${width}px` } as React.CSSProperties}
        role="dialog"
        aria-modal
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="t-title text-base">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press grid h-7 w-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-hairline/[0.08] hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-hairline/[0.09] bg-hairline/[0.04] px-3 py-2 text-base text-text placeholder:text-text-faint outline-none transition-all duration-200 ease-smooth focus:border-accent/55 focus:bg-hairline/[0.06] focus:ring-2 focus:ring-accent/15";
