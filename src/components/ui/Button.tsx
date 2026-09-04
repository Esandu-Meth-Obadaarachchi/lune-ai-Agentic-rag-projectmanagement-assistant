"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "subtle" | "danger";
type Size = "sm" | "md" | "icon" | "icon-sm";

/* Every variant carries the lit top rim (`inset 0 1px 0`) so buttons read as
   physical objects catching the same light as the panels they sit on. Press is
   a real scale-down, not a colour change. */
const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.3)] hover:bg-accent-hover hover:shadow-glow",
  ghost: "text-text-muted hover:text-text hover:bg-hairline/[0.06]",
  outline:
    "border border-hairline/[0.12] text-text shadow-[inset_0_1px_0_rgb(var(--hairline)/0.05)] hover:border-hairline/20 hover:bg-hairline/[0.05]",
  subtle:
    "bg-hairline/[0.06] text-text border border-hairline/[0.07] shadow-[inset_0_1px_0_rgb(var(--hairline)/0.06)] hover:bg-hairline/[0.1]",
  danger: "text-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-base gap-2 rounded-md",
  icon: "h-9 w-9 rounded-md",
  "icon-sm": "h-7 w-7 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "press inline-flex select-none items-center justify-center whitespace-nowrap outline-none transition-all duration-200 ease-smooth disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
