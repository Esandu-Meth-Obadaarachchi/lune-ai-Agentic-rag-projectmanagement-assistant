import { priorityMeta } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/types";

/* Priority is ambient information: it should be readable at a glance down the
   column and invisible the rest of the time. Only urgent earns a real colour. */
const barColor: Record<TaskPriority, string> = {
  low: "bg-text-faint/60",
  med: "bg-text-muted",
  high: "bg-warn/90",
  urgent: "bg-danger",
};

/** Subtle 4-bar priority indicator (spec: "subtle dot or bar, 4 levels"). */
export function PriorityIndicator({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cn("inline-flex items-end gap-[2px]", className)}
      title={`${meta.label} priority`}
      aria-label={`${meta.label} priority`}
    >
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2.5px] rounded-full transition-colors",
            i <= meta.level ? barColor[priority] : "bg-hairline/[0.09]"
          )}
          style={{ height: 3 + i * 1.75 }}
        />
      ))}
    </span>
  );
}

/** Single dot variant for dense rows. */
export function PriorityDot({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", barColor[priority])}
      title={`${meta.label} priority`}
    />
  );
}
