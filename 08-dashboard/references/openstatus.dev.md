# openstatus.dev

**URL:** https://www.openstatus.dev
**Captured:** 2026-05-03 (viewport rendered ~1023px wide)
**Lighthouse:** not run on references

## Aesthetic vocabulary

Engineer's marketing site: nearly the entire UI is set in the OS monospace stack (`ui-monospace`), light theme on a near-pure-white background with near-black text. Body falls back to Inter for long-form copy. Type scale is compressed (h1 = 30px, h2 = 24px, body = 16-18px) with negative letter-spacing on display. Color palette is austere: black, white, two shades of gray, one cobalt blue accent for links/CTAs. Status pills appear as outlined mono rectangles, never colored fills. The aesthetic argument is "this is for engineers, written by engineers, the rendering is the message." Scroll motion is minimal; hover is color-only.

## Type system

| Element | Family | Size | Weight | Line-height | Letter-spacing | Color |
|---------|--------|------|--------|-------------|----------------|-------|
| h1 | ui-monospace | 30px | 500 | 36px (1.2) | -0.75px (-0.025em) | oklch(15% 0 0) |
| h2 | ui-monospace | 24px | 500 | 32px (1.33) | -0.6px (-0.025em) | oklch(15% 0 0) |
| body lead | ui-monospace | 18px | 400 | 28px (1.55) | normal | oklch(14% 0 0 / 0.8) |
| body | ui-monospace | 16px | 400 | 28px (1.75) | normal | oklch(14% 0 0 / 0.8) |
| nav | ui-monospace | 16px | 400 | 24px (1.5) | normal | oklch(15% 0 0) |
| pill / chip | ui-monospace | 14px | 500 | 20px | normal | oklch(15% 0 0) |

**Modular ratio:** **1.25** (major third). 16 → 18 (1.125), 18 → 24 (1.333), 24 → 30 (1.25). Tightly clustered. The site has almost no display tier — h1 at 30px is barely bigger than body. Reads as "no marketing voice, just facts."
**Pairing:** OS monospace stack (`ui-monospace, SF Mono, Menlo, Monaco, Consolas`) for nearly everything + Inter as body fallback.
**Notes:**
- Negative letter-spacing on display (-0.025em on h1 and h2). Same direction as Linear, slightly stronger.
- Body color uses 80% opacity black instead of a separate muted token. Subtle depth without a second neutral step.

## Color palette

| Token | OKLCH | sRGB | Role |
|-------|-------|------|------|
| bg | oklch(100% 0 0) | rgb(255, 255, 255) | Canvas (PURE WHITE — do not copy) |
| bg-card | oklch(96% 0 0) | rgb(245, 245, 245) | Card surface |
| fg | oklch(15% 0 0) | rgb(0, 0, 0) | Primary text (effectively pure black) |
| fg-muted | oklch(14% 0 0 / 0.8) | rgba(0,0,0,0.8) | Body |
| fg-faint | oklch(48% 0 0) | rgba(0,0,0,0.5) | Tertiary |
| accent | oklch(48% 0.27 273) | cobalt-blue | Links, CTAs |
| border | oklch(91% 0 0) | rgb(231, 231, 231) | Divider |
| status-ok | oklch(60% 0.18 145) | green | (mono pill) |
| status-fail | oklch(50% 0.27 30) | red | (mono pill) |

**Notes:**
- Effectively pure white and pure black are used. They get a pass because the entire visual language is "engineering output" where saturated/tuned values would feel inauthentic.
- Status pills are outlined boxes, not filled — the color carries minimal area.

## Spacing

**Base unit:** 4px. Vertical rhythm tight: 24/32/48 between elements; 64/96 between sections.
**Container:** ~1024px max-width.

## Layout / structural choices

- **Hero:** centered headline + lead + CTA + Mac-window screenshot. Hero h1 at 30px is **smaller than most marketing sites' h2**. Deliberate restraint.
- **Capability rows:** alternating two-column with sparse text on one side, screenshot on the other. Often a single line + bullet list per row.
- **FAQ:** simple stacked accordion, mono labels.
- **Footer:** mono single-line `2025 OpenStatus` line.

## Motion

- **Hover:** color shift only; underline appears on links.
- **Scroll:** none observed beyond browser default.
- **Easing voice:** absent. The site doesn't try to feel "designed" through motion.

## Unusual / signature

- **Whole site in monospace.** Most ambitious choice on this reference list.
- **Compressed display tier.** No 60-80px headlines. The site's voice is dense informational, not theatrical.
- **Status pills as outlined mono rects.** The "monitoring" aesthetic distilled.

## Pull-forward candidates for DevNeural Hub

1. **Mono-flavored chrome.** Use JetBrains Mono for all numbers, labels, and chip/pill text. Body and headings in Inter; mono carries the "telemetry" register.
2. **Status pill as outlined-rectangle, not fill.** Stroke 1px in status hue, fg in status hue, transparent or near-bg fill. Reduces visual area of saturated color.
3. **Tabular numerics site-wide** (already in BRIEF.md spec). OpenStatus does this implicitly via mono.
4. **Compress the display tier when the panel is information-dense.** Daily-brief headline can be 24-28px instead of 40+, like OpenStatus's 30px h1. Reserve display-jump for Home or empty states.
5. **Body uses opacity-on-fg, not a separate muted neutral** — could test for our muted body. Cheaper on the palette.
6. **DO NOT** copy light theme. We're locked dark.
7. **DO NOT** copy compressed scale across the whole app — the dashboard needs hierarchy more than OpenStatus does. Use it surgically.
