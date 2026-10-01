import { cn } from "@/lib/utils";

/**
 * The Lune mark.
 *
 * A crescent lit by the same light source as the rest of the app: the moonlight
 * falls from the upper left, so the crescent is thickest at the upper left and
 * thins as it curves away to the lower right, and the gradient runs from the
 * highlight (`--lumen`) through the core gold. That consistency is the whole
 * point — the mark is not decoration sitting on the interface, it is lit by it.
 *
 * Bare by default. `LogoTile` wraps it in a glass tile for the few places that
 * need a container (favicon, avatar slots).
 */
export function Logo({
  size = 26,
  className,
  glow = true,
}: {
  size?: number;
  className?: string;
  /** The soft cast light around the mark. Off inside dense rows. */
  glow?: boolean;
}) {
  // Unique per size so several marks on one page never clash their <defs>.
  const uid = `lune-${size}`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Lune"
      className={cn("shrink-0", className)}
      style={
        glow
          ? { filter: `drop-shadow(0 0 ${size * 0.28}px rgb(var(--accent) / 0.32))` }
          : undefined
      }
    >
      <defs>
        {/* Runs along the light's own axis: upper left to lower right. */}
        <linearGradient id={`${uid}-gold`} x1="0.16" y1="0.08" x2="0.86" y2="0.94">
          <stop offset="0" stopColor="rgb(var(--lumen))" />
          <stop offset="0.38" stopColor="rgb(var(--accent))" />
          <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity="0.62" />
        </linearGradient>
        {/* The lit rim on the outer arc, brightest where the light strikes. */}
        <linearGradient id={`${uid}-rim`} x1="0.1" y1="0" x2="0.7" y2="0.8">
          <stop offset="0" stopColor="rgb(var(--lumen))" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="rgb(var(--lumen))" stopOpacity="0.1" />
          <stop offset="1" stopColor="rgb(var(--lumen))" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}-crescent`}>
          {/* White keeps, black cuts. The bite is very slightly LARGER than the
              disc and offset down-right, which is what tapers the crescent to a
              point at both tips instead of leaving a fat uniform "C". Max
              thickness lands at ~15% of the diameter, up and left, where the
              light comes from. */}
          <circle cx="50" cy="50" r="42" fill="white" />
          <circle cx="62.5" cy="57" r="43" fill="black" />
        </mask>
      </defs>

      <g mask={`url(#${uid}-crescent)`}>
        <circle cx="50" cy="50" r="42" fill={`url(#${uid}-gold)`} />
        {/* The hairline catch-light on the outer edge. */}
        <circle
          cx="50"
          cy="50"
          r="41.2"
          fill="none"
          stroke={`url(#${uid}-rim)`}
          strokeWidth="1.6"
        />
      </g>
    </svg>
  );
}

/** The mark on a glass tile, for slots that need a contained shape. */
export function LogoTile({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn("glass grid shrink-0 place-items-center rounded-lg", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Logo size={size * 0.62} glow={false} />
    </div>
  );
}

export function Wordmark({
  className,
  size = 26,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <span className="t-title text-[15px] text-text">
        Lune<span className="ml-1 font-medium text-text-faint">AI</span>
      </span>
    </div>
  );
}
