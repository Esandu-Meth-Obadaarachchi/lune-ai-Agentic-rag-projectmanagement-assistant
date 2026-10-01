import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A stacked composition bar for a set of tasks.
 *
 * It replaced a single gold "percent done" bar, which looked decorative and said
 * almost nothing: a project with everything blocked and a project with
 * everything untouched drew exactly the same empty line. Reading left to right
 * the bar now goes finished -> moving -> stuck -> not started, so the shape of a
 * project is legible before you read a single number.
 */
export function StatusBar({
  tasks,
  className,
  height = 4,
}: {
  tasks: Task[];
  className?: string;
  height?: number;
}) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const moving = tasks.filter((t) => t.status === "in_progress").length;
  // Custom statuses fall in with to-do: they are open work that has not started.
  const todo = total - done - blocked - moving;

  const segments = [
    { n: done, cls: "bg-done", label: "done" },
    { n: moving, cls: "bg-progress", label: "in progress" },
    { n: blocked, cls: "bg-blocked", label: "blocked" },
    { n: todo, cls: "bg-hairline/[0.14]", label: "to do" },
  ].filter((s) => s.n > 0);

  const title = total
    ? segments.map((s) => `${s.n} ${s.label}`).join(" · ")
    : "No tasks yet";

  return (
    <span
      className={cn("flex w-full gap-px overflow-hidden rounded-full", className)}
      style={{ height }}
      title={title}
      role="img"
      aria-label={title}
    >
      {total === 0 ? (
        <span className="h-full w-full rounded-full bg-hairline/[0.07]" />
      ) : (
        segments.map((s) => (
          <span
            key={s.label}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", s.cls)}
            style={{ width: `${(s.n / total) * 100}%` }}
          />
        ))
      )}
    </span>
  );
}
