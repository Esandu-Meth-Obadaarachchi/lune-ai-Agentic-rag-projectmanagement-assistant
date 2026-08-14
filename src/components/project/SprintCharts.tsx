"use client";

import { useId, useState } from "react";
import { format } from "date-fns";
import type { BurndownPoint } from "@/lib/types";
import type { VelocityBar } from "@/lib/data/sprint";
import { cn } from "@/lib/utils";

/**
 * Two small charts for the sprint panel, hand-rolled in SVG — the project has no
 * chart library and neither of these earns one.
 *
 * Both use a single accent series against recessive grid and axis ink. The
 * burndown's ideal line is a reference, not a peer series, so it stays muted and
 * dashed: line style carries the difference as well as colour, which keeps it
 * readable without colour vision.
 */

const PAD = { top: 10, right: 10, bottom: 20, left: 28 };

/* ------------------------------ burndown ------------------------------ */

export function Burndown({ data, height = 148 }: { data: BurndownPoint[]; height?: number }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 520;

  if (data.length < 2) {
    return <EmptyChart height={height} label="The burndown appears once the sprint has run a day." />;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.remaining, d.ideal)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const real = data.filter((d) => d.actual);
  const line = (pts: BurndownPoint[], key: "remaining" | "ideal") =>
    pts.map((d, i) => `${i === 0 ? "M" : "L"} ${x(data.indexOf(d))} ${y(d[key])}`).join(" ");

  const area =
    real.length > 1
      ? `${line(real, "remaining")} L ${x(real.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
      : "";

  const ticks = [0, max / 2, max];
  const active = hover != null ? data[hover] : null;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Burndown: ${real.at(-1)?.remaining ?? 0} points remaining of ${Math.round(data[0].ideal)} committed`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.20" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="rgb(var(--border))"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="mono"
              fontSize="9"
              fill="rgb(var(--text-faint))"
            >
              {Math.round(t)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        <path
          d={line(data, "ideal")}
          fill="none"
          stroke="rgb(var(--text-faint))"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        {real.length > 1 && (
          <path
            d={line(real, "remaining")}
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {real.length > 0 && (
          <circle
            cx={x(real.length - 1)}
            cy={y(real.at(-1)!.remaining)}
            r="3.5"
            fill="rgb(var(--accent))"
            stroke="rgb(var(--surface))"
            strokeWidth="2"
          />
        )}

        {active && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="rgb(var(--border-strong))"
            strokeWidth="1"
          />
        )}

        {/* Hit targets, wider than the marks. */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - innerW / (data.length - 1) / 2}
            y={PAD.top}
            width={innerW / (data.length - 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        <text x={PAD.left} y={height - 6} fontSize="9" fill="rgb(var(--text-faint))" className="mono">
          {format(new Date(data[0].date), "d MMM")}
        </text>
        <text
          x={width - PAD.right}
          y={height - 6}
          textAnchor="end"
          fontSize="9"
          fill="rgb(var(--text-faint))"
          className="mono"
        >
          {format(new Date(data.at(-1)!.date), "d MMM")}
        </text>
      </svg>

      <figcaption className="mt-1.5 flex items-center gap-3 text-2xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-accent" /> Remaining
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-text-faint" /> Ideal
        </span>
        {active && (
          <span className="mono ml-auto text-text">
            {format(new Date(active.date), "d MMM")} · {active.remaining} left
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/* ------------------------------ velocity ------------------------------ */

export function Velocity({ bars, average }: { bars: VelocityBar[]; average: number | null }) {
  if (!bars.length) {
    return <EmptyChart height={110} label="Velocity appears after your first sprint closes." />;
  }
  const max = Math.max(1, ...bars.map((b) => Math.max(b.delivered, b.committed)));

  return (
    <figure className="m-0">
      <div className="flex h-[110px] items-end gap-2">
        {bars.map((b) => (
          <div key={b.sprintId} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="mono text-2xs text-text">{b.delivered}</span>
            <div
              className="relative flex w-full justify-center"
              style={{ height: 72 }}
              title={`${b.name}: ${b.delivered} delivered of ${b.committed} committed`}
            >
              {/* Committed sits behind as a target, delivered in front. */}
              <div
                className="absolute bottom-0 w-full rounded-t-[4px] border border-border bg-surface-2"
                style={{ height: `${(b.committed / max) * 100}%` }}
              />
              <div
                className="absolute bottom-0 w-full rounded-t-[4px] bg-accent/80 transition-colors group-hover:bg-accent"
                style={{ height: `${(b.delivered / max) * 100}%` }}
              />
            </div>
            <span className="w-full truncate text-center text-2xs text-text-faint">{b.name}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex items-center gap-3 text-2xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] bg-accent/80" /> Delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] border border-border bg-surface-2" /> Committed
        </span>
        {average != null && (
          <span className="mono ml-auto text-text">avg {average.toFixed(1)} pts</span>
        )}
      </figcaption>
    </figure>
  );
}

function EmptyChart({ height, label }: { height: number; label: string }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-lg border border-dashed border-border/60 px-4 text-center text-2xs text-text-faint"
      )}
      style={{ height }}
    >
      {label}
    </div>
  );
}
