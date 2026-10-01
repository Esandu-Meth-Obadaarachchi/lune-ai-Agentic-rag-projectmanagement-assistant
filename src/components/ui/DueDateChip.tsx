import { dueLabel, dueState } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

/**
 * Due dates carry urgency through text colour and weight, not through a filled
 * badge. Only the two states that need to interrupt you get a fill: overdue
 * (danger) and today (the gold, because gold means *now* in this system).
 */
const styles: Record<string, string> = {
  overdue: "text-danger bg-danger/[0.12] font-semibold",
  today: "text-accent bg-accent/[0.12] font-semibold",
  soon: "text-warn/90",
  future: "text-text-muted",
  none: "text-text-faint",
};

export function DueDateChip({
  date,
  time,
  status,
  className,
  icon = true,
}: {
  date?: string | null;
  time?: string | null;
  status?: TaskStatus;
  className?: string;
  /** Kept for call-site compatibility; the dot now carries the same job. */
  icon?: boolean;
}) {
  if (!date) return null;
  const state = dueState(date, status);
  const urgent = state === "overdue" || state === "today";
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-2xs",
        styles[state],
        className
      )}
    >
      {icon && urgent && (
        <span className="h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />
      )}
      {dueLabel(date)}
      {time && <span className="opacity-75">{time}</span>}
    </span>
  );
}
