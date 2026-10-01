---
name: design-system
description: How to design and build UI in Second Brain — the dark, glass-on-moonlit-ground, gold-accent system. Use whenever creating or restyling any screen, view, component, layout, empty state, or interaction. Covers the material model, tokens, type ramp, shape scale, density and motion.
---

# Lune — UI/UX system

Build every surface to this system. The product is a power-user tool: **calm and
dense**, dark-first, keyboard-fast. Full reference: `docs/DESIGN_SYSTEM.md`,
`src/app/globals.css`, `tailwind.config.ts`.

## The one idea

**Moonlight.** A fixed light source at the top-left of the viewport. Everything
is a slab of frosted glass floating on that lit ground, catching a highlight on
its top edge. Gold is the light, not a brand colour.

Three depths, and every surface is one of them:

1. **Ground** — `.moonlit` on the frame root. Backdrop only, never content.
2. **Slab** — the working content area. `bg-surface/85` + hairline + inset sheen.
3. **Glass** — anything that floats: sidebar, task drawer, modal, command
   palette, dropdown. `.glass` / `.glass-panel`.

`.glass` is a web frosted-glass **approximation** of Apple's materials idea, not
Apple's Liquid Glass (a native material with no public web implementation).

## The rules that matter most

1. **Tokens only, never raw hex.** `bg bg-deep surface surface-2 surface-3
   hairline border border-strong text text-muted text-faint accent accent-hover
   accent-fg lumen` plus semantics `danger warn ok info` and status `todo
   progress blocked done`. New colours go in `globals.css` (both themes) and
   `tailwind.config.ts`, never inline.
2. **`hairline` is the edge for anything translucent.** `border-hairline/[0.08]`,
   not `border-border`. A solid grey border on glass looks muddy; light at low
   alpha looks like a real edge. Solid `border` is for fully opaque surfaces.
3. **Elevation is the lit rim, not the fill.** On a dark ground, a 1px bright top
   edge plus a deep cool shadow reads as depth; a lighter fill barely does. Use
   the `shadow-e1…e4` ladder, `shadow-glow` for the accent.
4. **One accent.** Gold means primary / AI / *now*. Never a second brand colour.
5. **One radius scale.** Controls and rows `rounded-md` (10px), cards
   `rounded-lg` (14px), floating panels `rounded-xl`/`rounded-2xl`, pills full.
   Do not invent radii.
6. **Density with alignment.** Rows ≈ 32–36px, `text-sm` body, `text-2xs` meta.
   Right-hand row metadata goes in **fixed-width right-aligned columns** so it
   lines up down the list, and the hover-action column's width is reserved so
   rows never reflow. Ragged metadata is the main reason a dense list looks
   unconsidered.
7. **Type is a ramp, not one-off tracking.** Geist + Geist Mono (self-hosted via
   the `geist` package). Use `.t-display`, `.t-title`, `.t-heading`, `.t-meta`,
   `.t-eyebrow`, and `.mono` for machine data. Tracking tightens as type grows.
8. **Motion is subtle and motivated.** `ease-smooth` is the house easing, and
   every control carries `.press`. Nothing over ~350ms, nothing decorative.
9. **Keyboard-first.** Enter commits inline edits and sends the composer; Escape
   cancels; inputs are borderless until focused.

## Mobile (do not skip)

- **Every `flex-1 truncate` needs `min-w-0`**, or the row pushes the page wider
  than a phone viewport and the screen scrolls sideways.
- **Below `sm`, dense rows go two-line**: title full width, metadata underneath,
  hover actions collapsed to one 44px tap target. Fixed metadata columns return
  from `sm` up. See `TaskRow`.
- Tap targets ≥ 44px on touch. Horizontal column layouts use `snap-x` with ~85vw
  columns. Chips that would truncate to one character become dots.
- Verify at 390px: `document.documentElement.scrollWidth === clientWidth`.

## Colour discipline in dense views

- Due dates carry urgency by text colour and weight; only overdue (danger) and
  today (gold) get a fill.
- Tags keep a hue-derived dot for scanning, but the label is `text-muted`. No
  saturated pill rows.
- Avatars sit at 34% saturation.

## Fixed accessibility boundaries

`prefers-reduced-motion` kills animation. `prefers-reduced-transparency` swaps
every glass surface for a solid slab and drops the ground wash — check the layout
still works. Gold focus ring at `outline-offset: 2px` on everything interactive.
Light mode is a first-class fallback and must stay legible.

## Reuse these primitives (do not reinvent)

`src/components/ui`: `Button` · `Avatar`/`AvatarEmpty` · `Logo`/`LogoTile`/
`Wordmark` · `Dropdown`+`MenuItem` (the engine behind every picker/menu) ·
`Modal`+`Field`+`inputClass` · `DueDateChip` · `PriorityIndicator`/`PriorityDot`
· `TagChip` · `SubtaskProgress` · `StatusControl` · `Skeleton`.

`src/components/task`: `TaskRow`, `TaskCard`, `TaskDrawer`, `Pickers`.

Any dropdown, menu, status/priority/assignee/date picker, or overflow menu →
compose `Dropdown` + `MenuItem`. Any dialog → `Modal`.

## Patterns

- **Empty state**: centred, a `bg-hairline/[0.06]` rounded icon tile with an
  inset sheen (`h-11 w-11`), a `text-sm` title, a `text-xs text-text-muted` line,
  and usually an inline add affordance.
- **Active nav / cursor**: the `.rail` class — a short gold bar catching the
  selected row. Used by the sidebar, project list and command palette alike.
- **Segmented control**: a `bg-hairline/[0.025]` track with the active item as a
  raised pill (`bg-hairline/[0.09]` + inset sheen). See `ProjectHeader` tabs.
- **Board columns**: faint lanes (`bg-hairline/[0.02]` + hairline) so cards read
  as sitting in a track rather than scattered.
- **Loading**: `Skeleton`/`RowSkeleton` with `shimmer`; `Logo` with
  `animate-moon-drift` full-screen.

## Seeing your work

`/preview` is a dev-only harness (404 in production) that mounts the real shell
and views against `src/app/preview/fixtures.ts`, so you can open and screenshot
any screen without a Google sign-in.
`?screen=today|overview|my-tasks|knowledge|workspaces|agent` picks the surface.
Drive it with `playwright-cli` and actually look at the result before claiming a
UI change is done.

## Definition of done

No raw hex; tokens throughout. `hairline` on translucent edges. One radius from
the scale. Reused primitives. Consistent across the task views + drawer if it
touches tasks. `npm run typecheck` clean. Dark and light both legible; reduced
motion and reduced transparency both usable.
