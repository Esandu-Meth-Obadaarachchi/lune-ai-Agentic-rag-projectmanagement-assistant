# Design system

**One idea: moonlight.** A single fixed light source sits at the top-left of the
viewport. Everything else is a slab of frosted glass floating on that lit ground,
catching a highlight on its top edge that decays as it falls away. Gold is not a
brand colour here, it is the light.

The product stays what it always was: calm, dense, keyboard-fast, dark-first.
The material is what changed. Every layer is now the same material at a different
depth, so a dropdown, the sidebar, a modal and the task drawer all read as one
family.

## The three depths

| Depth | What | Class |
|---|---|---|
| Ground | The lit backdrop, never content | `.moonlit` on the frame root |
| Slab | The working surface (main content area) | `bg-surface/85` + hairline + inset sheen |
| Glass | Anything that floats: sidebar, drawer, modal, palette, dropdown | `.glass` / `.glass-panel` |

`.glass` is a **web frosted-glass approximation** of the Apple materials idea. It
is not Apple's Liquid Glass, which is a native platform material with no public
web implementation. Four layers do the work: a translucent tint, a backdrop blur
plus saturation lift, a sheen running along the light's axis, and an inset
hairline on the top edge that reads as a lit rim.

On a dark ground **elevation comes from the lit rim, not the fill**. Making a
panel lighter barely reads; giving it a 1px bright top edge and a deep, cool
shadow reads immediately. Reach for `shadow-e1…e4` rather than inventing shadows.

## Tokens

CSS variables in `src/app/globals.css` (`:root`/`.dark` and `.light`), consumed
via Tailwind semantic colours in `tailwind.config.ts`. **Never hardcode a hex.**

| Token | Dark | Meaning |
|---|---|---|
| `bg` / `bg-deep` | `#06070a` | the unlit ground |
| `surface` / `surface-2` / `surface-3` | `#161921` … | raised layers |
| `hairline` | pure light | **the edge for anything translucent** — `border-hairline/[0.08]` |
| `border` / `border-strong` | solid greys | edges on fully opaque surfaces only |
| `text` / `text-muted` / `text-faint` | `#eaecf2` … | text hierarchy |
| `accent` / `accent-hover` / `accent-fg` | `#f5c542` | the light: primary, AI, and *now* |
| `lumen` | `#ffe2a0` | the highlight end of the light |
| `todo` `progress` `blocked` `done` | | task status |
| `danger` `warn` `ok` `info` | | semantic |

**Prefer `hairline/[alpha]` over `border`** on any translucent surface. A solid
grey border on glass looks muddy; light at low alpha looks like an edge.

## Type

**Geist + Geist Mono**, self-hosted via the `geist` package (no runtime font
request). One superfamily rather than a pairing, with hierarchy carried by an
optical tracking ramp — tight at display sizes, opening up as it shrinks. This is
the same move Apple makes with SF Display / SF Text.

Use the ramp classes rather than one-off tracking: `.t-display`, `.t-title`,
`.t-heading`, `.t-meta`, `.t-eyebrow`. Body is `text-sm` (13px) in dense rows and
`text-base` (14px) in prose and inputs. `.mono` for machine data (ids, counts,
timestamps) and adds tabular numerals.

Eyebrows are rationed: at most one per three sections on any marketing surface.
In the app, section labels in nav and panels are fine.

## Shape

**One radius scale. Do not invent new radii.**

- controls, inputs, rows, chips → `rounded-md` (10px)
- cards → `rounded-lg` (14px)
- floating panels → `rounded-xl` (20px) / `rounded-2xl` (24px)
- pills, toggles, avatars, status circles → `rounded-full`

## Colour discipline

- **One accent.** Gold means primary, AI, or *now*. Never add a second brand
  colour; meaning is carried by the semantic tokens.
- Due dates carry urgency by text colour and weight. Only overdue (danger) and
  today (gold) get a fill.
- Tags keep a hue-derived dot for scannability but the label stays `text-muted`.
  A row of saturated pills is what makes a dense list look noisy.
- Avatars sit at 34% saturation. Identity survives; the noise does not.

## Density and alignment

- Rows ≈ 32–36px. Right-hand metadata sits in **fixed-width, right-aligned
  columns** so it lines up down the whole list. Ragged metadata that starts at a
  different x on every row is the single biggest reason a dense list looks
  unconsidered.
- Reserve the hover-action column's width so rows never reflow on hover.
- Reveal per-row actions on hover from `sm` up; keep them visible on touch.

## Motion

Subtle and motivated. `animate-fade-in` / `slide-in` / `slide-up` / `scale-in` on
mount, `animate-pulse-dot` and `animate-moon-drift` for loading. House easing is
`ease-smooth` (easeOutExpo). Every control gets `.press` (a real scale-down), so
the app feels physical. Nothing over ~350ms.

## Accessibility boundaries (fixed, not contextual)

- `prefers-reduced-motion` collapses all animation and transition.
- `prefers-reduced-transparency` swaps every glass surface for a solid slab and
  drops the ground wash. Layout, contrast and hierarchy all survive without blur.
- Focus is a gold ring at `outline-offset: 2px`, visible on every interactive
  element.
- Light mode is a first-class fallback: the ground is deliberately darker than
  the slabs, or white cards on a near-white page read as one flat sheet.

## Mobile

The phone is not a narrow desktop. Two rules carry most of the work:

1. **`truncate` needs `min-w-0`.** A flex child defaults to `min-width: auto`,
   so it cannot shrink below its text and instead pushes the whole page wider
   than the viewport. On a wide desktop container nothing shows; at 390px the
   screen scrolls sideways. Every `flex-1 truncate` in this codebase carries
   `min-w-0`, and so must any new one.
2. **Below `sm`, a dense row becomes two lines.** The fixed metadata columns
   that make a desktop list scannable leave roughly 90px for the title on a
   phone. `TaskRow` drops the title to full width and moves whatever metadata
   exists onto a second line underneath; the columns return from `sm` up. The
   three hover actions collapse to one 44px tap target.

Also: tap targets are at least 44px on touch (`h-11` wrappers around small
controls); the tree's nesting step is `--tree-indent`, tighter on a phone
because each level is width taken out of the title; horizontally scrolling
column layouts (board, portfolio) use `snap-x` with ~85vw columns so one column
fills the screen and the next peeks; and a labelled chip that would truncate to
a single character (calendar month cells) becomes a dot instead, with the full
list one tap away.

Check any new screen at 390px with the overflow assertion:
`document.documentElement.scrollWidth === clientWidth`.

## Component library (`src/components/ui`)

Reach for these before inventing:

- `Button` (primary/ghost/outline/subtle/danger, sizes incl. icon)
- `Avatar` / `AvatarEmpty`, `Logo` / `LogoTile` / `Wordmark`
- `Dropdown` + `MenuItem` (the glass popover engine behind every picker)
- `Modal` + `Field` + `inputClass`
- `DueDateChip`, `PriorityIndicator` + `PriorityDot`, `TagChip`,
  `SubtaskProgress`, `StatusControl`, `Skeleton`

## The mark

A crescent lit by the same source as everything else: thickest at the upper left,
tapering to a point at both tips, gradient running from `lumen` through `accent`
along the light's axis. The bite circle is very slightly *larger* than the disc
and offset down-right — that is what tapers it instead of leaving a fat uniform
"C". Bare by default; `LogoTile` wraps it in glass where a container is needed.

## Reviewing UI changes

`/preview` is a **dev-only** harness (404 in production) that mounts the real
shell and views against fixtures in `src/app/preview/fixtures.ts`, so any screen
can be opened and screenshotted without a Google sign-in.
`?screen=today|overview|my-tasks|knowledge|workspaces|agent` picks the surface.

## Definition of done for a UI change

No raw hex; tokens throughout. `hairline` on translucent edges. One radius from
the scale. `"use client"` only if stateful. Reused primitives. Consistent across
the task views and the drawer if it touches tasks. `npm run typecheck` clean.
Dark **and** light both legible, and the reduced-motion and reduced-transparency
paths still usable.
