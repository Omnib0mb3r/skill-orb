# vercel.com (docs surface)

**URL:** https://vercel.com/docs (the dashboard proper is auth-walled, so the docs serve as a public proxy for Vercel's UI vocabulary)
**Captured:** 2026-05-03 (viewport rendered ~1023px wide)
**Lighthouse:** not run on references

## Aesthetic vocabulary

Geist set across the entire surface, with **aggressive negative letter-spacing** as the signature display move. The docs are intentionally low-color (whites, near-blacks, one mid-gray, indigo accent) to keep the focus on long-form text. Body uses 12px supporting text in places, which is dense and tight on retina. Layout is left-rail nav + main + right-rail TOC, classic three-column docs shell. Hover and focus states are subtle but specific (1px offset focus rings, accent-colored borders on inputs). Shows a strong use of `cmd+K` search ("Search Documentation ⌘ K") — pull-forward as the canonical command-palette affordance.

## Type system

| Element | Family | Size | Weight | Line-height | Letter-spacing | Color |
|---------|--------|------|--------|-------------|----------------|-------|
| h1 | Geist | 40px | 600 | 48px (1.2) | -2.4px (-0.06em) | oklch(15% 0 0) |
| h2 | Geist | 24px | 600 | 32px (1.33) | -0.96px (-0.04em) | oklch(15% 0 0) |
| body | Geist | 16px | 400 | ~24px | normal | oklch(15% 0 0) |
| supporting (12px) | Geist | 12px | 400 | 16px (1.33) | normal | oklch(40% 0 0) |
| nav button | Geist | 14px | 400 | 14px (1.0) | normal | oklch(40% 0 0) |
| search trigger | Geist | 14px | 400 | 20px (1.43) | normal | oklch(15% 0 0) |
| Ask AI button | Geist | 14px | 500 | 21px (1.5) | normal | oklch(15% 0 0) |

**Modular ratio:** ~1.5 (the perfect fifth). h2 (24) → h1 (40) = 1.667 (augmented). body (16) → h2 (24) = 1.5. Wider than Linear. The aggressive negative letter-spacing compensates for the otherwise generous size jumps.
**Pairing:** Geist (display + body) + Geist Mono (code blocks). One family, one mono.
**Notes:**
- **Letter-spacing as character.** -0.06em on h1 (very tight), -0.04em on h2. Roughly 2.5x stronger than Linear's display-tier ls. This is the deliberate "Vercel typographic move" we should evaluate copying or specifically not copying.
- 12px body-supporting text fails the 14px floor. Edge of legibility (ANTI-SLOP rule 22). For our app, push supporting text to 13px minimum.
- Geist is permitted — it's a lightly different grotesk than Inter (slightly more constructed, narrower). Optional swap if we want distance from Inter ubiquity.

## Color palette

| Token | OKLCH | sRGB | Role |
|-------|-------|------|------|
| bg | oklch(100% 0 0) | rgb(255, 255, 255) | Canvas (light theme) |
| bg-card | oklch(98% 0 0) | rgb(250, 250, 250) | Card surface |
| fg | oklch(15% 0 0) | near-black | Primary text |
| fg-muted | oklch(40% 0 0) | rgba(0,0,0,~0.65) | Supporting text |
| fg-disabled | oklch(60% 0 0) | mid-gray | Tertiary |
| border | oklch(93% 0 0) | rgb(229, 229, 229) | Hairline divider |
| accent | oklch(48% 0.27 273) | cobalt-blue | Highlighted nav, links, focus |

**Notes:**
- Light theme. We're not adopting this part.
- Border at oklch ~93% L is the high-contrast equivalent of Linear's white-alpha 5-8% on dark.
- One blue accent. No status hues on the docs surface (the dashboard product surface has them — out of view here).

## Spacing

**Base unit:** 4px.
**Three-column docs grid:** 240 left rail + main (variable) + 240 right rail TOC, with ~32-40px gutters.

## Layout / structural choices

- **Persistent top rail:** logo + nav menus (Products / Resources / Solutions) + cmd+K search trigger + Ask AI + sign-in.
- **Three-column docs shell:** left-rail (categories, expandable trees) + main + right-rail (in-page TOC).
- **No hero on docs.** Heading + paragraph + cards-grid of "Get started", "Quick references", "Build", "AI", "Collaborate".
- **Card-grid sections:** four 12px-text "Trusted by the best teams" cards in tight rhythm.
- **Footer:** dense, dim, four-column.

## Motion

- **Hover:** color shift on nav, underline-grow on inline links, border-lightening on cards.
- **Scroll:** none specific; just standard scroll.
- **Custom cursor:** none.
- **Focus rings:** specific accent-colored 2px offset rings.

## Unusual / signature

- **Aggressive negative letter-spacing on display.** -2.4px on 40px (-0.06em). Most reference-extreme value on the list.
- **`cmd+K` as the primary search affordance** in the top rail. Inline keyboard hint visible at rest.
- **Geist** family used over Inter — distinguishing them at a glance is hard, but Geist is narrower and slightly more constructed.

## Pull-forward candidates for DevNeural Hub

1. **`cmd+K` search trigger in the top rail** with persistent visible keyboard hint. Already in BRIEF.md spec; confirm the visual treatment matches Vercel's pattern (left icon + "Search…" + right ⌘K chip).
2. **Top rail height and density.** Vercel uses ~56-64px tall, with brand left and utility right. Our spec already says 56px — confirm.
3. **Tightened display letter-spacing scaling with size.** Linear-style `-0.022em` is gentle. Consider running Vercel-style at `-0.04em` on h1/h2 for a more decisive feel. Cap at h1; do NOT apply to body (12-13px supporting text).
4. **Hairline border discipline.** Same approach: very-low-contrast 1px lines that barely separate surfaces. We use white-alpha 5-8% on dark; Vercel uses oklch 93% on light. Same intent.
5. **Three-column docs shell** is structurally what our App.tsx layout will be (left rail / main / right rail). The pattern is already in the v4 mockup.
6. **DO NOT** ship 12px body text. Floor is 13px for labels and 14px for prose (per ANTI-SLOP rule 22 + APP-ADAPTATION).
7. **Geist as an alternative to Inter** is on the table if we want differentiation, but the BRIEF locks Inter. Don't change.
