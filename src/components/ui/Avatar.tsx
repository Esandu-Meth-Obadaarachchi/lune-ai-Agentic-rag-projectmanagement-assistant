import { cn, hueFrom, initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 22,
  className,
  ring,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const hue = hueFrom(name || "?");
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-inset ring-hairline/10",
          ring && "!ring-2 ring-bg",
          className
        )}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-medium text-white",
        ring && "ring-2 ring-bg",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        // Low chroma on purpose: a row of fully saturated avatars fights the
        // single gold accent for attention. Identity survives at 34%.
        background: `linear-gradient(148deg, hsl(${hue} 34% 46%), hsl(${(hue + 34) % 360} 30% 30%))`,
      }}
      title={name ?? undefined}
    >
      {initials(name)}
    </div>
  );
}

/** Unassigned placeholder. */
export function AvatarEmpty({ size = 22 }: { size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full border border-dashed border-hairline/20 text-text-faint transition-colors hover:border-accent/40 hover:text-text-muted"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      title="Unassigned"
    >
      +
    </div>
  );
}
