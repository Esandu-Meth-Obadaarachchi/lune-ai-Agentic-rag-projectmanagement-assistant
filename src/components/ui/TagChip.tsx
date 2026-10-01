import { cn, hueFrom } from "@/lib/utils";

/**
 * A tag reads as a quiet label, not a badge. The hue still comes from the tag
 * name so tags stay scannable across a long list, but at low chroma and with no
 * fill — a row of saturated pills is what makes a dense list look noisy, and it
 * competes with the single gold accent for attention.
 */
export function TagChip({ tag, className }: { tag: string; className?: string }) {
  const hue = hueFrom(tag);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-px text-2xs font-medium text-text-muted",
        className
      )}
    >
      <span
        className="h-[5px] w-[5px] shrink-0 rounded-full"
        style={{ background: `hsl(${hue} 45% 58%)` }}
        aria-hidden
      />
      {tag}
    </span>
  );
}
