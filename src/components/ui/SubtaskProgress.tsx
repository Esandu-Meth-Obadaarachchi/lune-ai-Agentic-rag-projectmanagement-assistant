import { cn } from "@/lib/utils";

/** Compact "2/5" subtask progress with a thin bar — reused on cards + rows. */
export function SubtaskProgress({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  const complete = done === total;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs text-text-faint", className)}
      title={`${done} of ${total} subtasks done`}
    >
      <span className="relative h-[3px] w-7 shrink-0 overflow-hidden rounded-full bg-hairline/[0.1]">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            complete ? "bg-done" : "bg-accent"
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="mono tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}
