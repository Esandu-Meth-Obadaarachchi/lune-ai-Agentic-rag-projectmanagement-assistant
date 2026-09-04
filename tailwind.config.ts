import type { Config } from "tailwindcss";

/**
 * LUNE — design language.
 *
 * One idea: moonlight. A fixed light source top-left of the viewport; slabs of
 * frosted glass floating on a cool near-black ground, each catching a highlight
 * on its top edge. Gold is the light, not a brand colour.
 *
 * Shape rule (one scale, applied everywhere):
 *   controls / inputs / rows -> rounded-md (10px)
 *   cards                    -> rounded-lg (14px)
 *   floating panels          -> rounded-xl (20px) / rounded-2xl (24px)
 *   chips, toggles, avatars  -> rounded-full
 *
 * All colours come from CSS variables in globals.css so both themes share one
 * component layer. Never hardcode a hex in a component — reach for a token.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        "bg-deep": "rgb(var(--bg-deep) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--surface-3) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        /* Pure light at low alpha. The correct edge for anything translucent:
           `border-hairline/10` rather than a solid grey that kills the glass. */
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "text-faint": "rgb(var(--text-faint) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        lumen: "rgb(var(--lumen) / <alpha-value>)",
        // Semantic status colours (task states, due-date chips, priority)
        todo: "rgb(var(--todo) / <alpha-value>)",
        progress: "rgb(var(--progress) / <alpha-value>)",
        blocked: "rgb(var(--blocked) / <alpha-value>)",
        done: "rgb(var(--done) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // Optical scale: tracking tightens as the type grows.
        "2xs": ["0.6875rem", { lineHeight: "0.9rem", letterSpacing: "0.004em" }],
        xs: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0em" }],
        sm: ["0.8125rem", { lineHeight: "1.15rem", letterSpacing: "-0.004em" }],
        base: ["0.875rem", { lineHeight: "1.35rem", letterSpacing: "-0.008em" }],
        lg: ["1rem", { lineHeight: "1.45rem", letterSpacing: "-0.012em" }],
        xl: ["1.1875rem", { lineHeight: "1.5rem", letterSpacing: "-0.018em" }],
        "2xl": ["1.5rem", { lineHeight: "1.75rem", letterSpacing: "-0.022em" }],
        "3xl": ["1.9375rem", { lineHeight: "2.15rem", letterSpacing: "-0.026em" }],
        "4xl": ["2.5rem", { lineHeight: "2.6rem", letterSpacing: "-0.03em" }],
        "5xl": ["3.25rem", { lineHeight: "3.3rem", letterSpacing: "-0.034em" }],
        "6xl": ["4rem", { lineHeight: "4rem", letterSpacing: "-0.038em" }],
      },
      borderRadius: {
        // One shape scale, documented above. Do not invent new radii.
        sm: "7px",
        DEFAULT: "8px",
        md: "10px",
        lg: "14px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
      },
      boxShadow: {
        // Elevation is a ladder, not a set of one-offs. Shadows are cool-tinted
        // (never pure black) so they read as shadow cast on a lit ground.
        e1: "0 1px 2px rgb(0 0 0 / 0.28)",
        e2: "0 2px 4px rgb(0 0 0 / 0.24), 0 8px 20px -8px rgb(0 0 0 / 0.45)",
        e3: "0 1px 2px rgb(0 0 0 / 0.3), 0 24px 60px -18px rgb(0 0 0 / 0.62)",
        e4: "0 2px 6px rgb(0 0 0 / 0.34), 0 44px 90px -24px rgb(0 0 0 / 0.72)",
        // kept for compatibility with existing call sites
        card: "0 1px 2px rgb(0 0 0 / 0.28)",
        pop: "0 1px 2px rgb(0 0 0 / 0.3), 0 24px 60px -18px rgb(0 0 0 / 0.62)",
        // The light itself, on the accent.
        glow: "0 0 0 1px rgb(var(--accent) / 0.28), 0 8px 26px -8px rgb(var(--accent) / 0.4)",
        "glow-lg": "0 0 0 1px rgb(var(--accent) / 0.3), 0 16px 48px -12px rgb(var(--accent) / 0.45)",
        // The lit top rim, for anything translucent.
        sheen: "inset 0 1px 0 rgb(var(--hairline) / 0.1)",
      },
      transitionTimingFunction: {
        // easeOutExpo — decisive, no overshoot. The house easing.
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
        // gentle spring with a hint of overshoot for playful pops.
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      backdropBlur: {
        glass: "28px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.975)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        /* The mark's light drifting across the crescent while the app loads.
           Motivated: it is the only signal that work is happening. */
        "moon-drift": {
          "0%, 100%": { opacity: "0.55", transform: "translateX(-6%)" },
          "50%": { opacity: "1", transform: "translateX(6%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-in": "slide-in 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slide-up 0.34s cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scale-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "moon-drift": "moon-drift 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
