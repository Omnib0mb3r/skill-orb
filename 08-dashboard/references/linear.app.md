# linear.app

**URL:** https://linear.app
**Captured:** 2026-05-03 (viewport rendered ~1023px wide)
**Lighthouse:** not run (deferred to verify step on our build, not on references)

## Aesthetic vocabulary

Cool-tilted near-black canvas with low-chroma neutral hierarchy. A single saturated indigo accent does all the work; status hues are absent on the marketing surface. Dark theme with hairline white-alpha borders (no solid 1px lines). Display headlines use Inter Variable at weight 510 with aggressive negative letter-spacing. Section rhythm is asymmetric vertically (96 top / 128 bottom) which gives the page a "leaning forward" cadence. Mono is Berkeley Mono and shows up only in code samples and tabular data, never decorative. Motion is restrained: hover state is color-only with a soft cubic-bezier; no parallax; section reveals are short translate+fade, not theatrical.

## Type system

| Element | Family | Size | Weight | Line-height | Letter-spacing | Color |
|---------|--------|------|--------|-------------|----------------|-------|
| h1 | Inter Variable | 64px | 510 | 64px (1.0) | -1.408px (-0.022em) | oklch(97% 0.003 250) |
| h2 | Inter Variable | 40px | 510 | 44px (1.1) | -0.88px (-0.022em) | oklch(97% 0.003 250) |
| h3 (section heading) | Inter Variable | 20px | 590 | 26.6px (1.33) | -0.24px (-0.012em) | oklch(85% 0.012 250) |
| h3 (nav label) | Inter Variable | 13px | 510 | 19.5px (1.5) | -0.13px (-0.01em) | oklch(97% 0.003 250) |
| h4 | Inter Variable | 16px | 590 | 24px (1.5) | normal | oklch(85% 0.012 250) |
| body p | Inter Variable | 15px | 400 | 24px (1.6) | -0.165px (-0.011em) | oklch(62% 0.012 258) |
| nano body | Inter Variable | 14px | 400 | 21px (1.5) | -0.182px (-0.013em) | oklch(62% 0.012 258) |
| button | Inter Variable | 13px | 510 | 32px | normal | oklch(11% 0.005 250) on light fill |

**Modular ratio:** mixed by intent. Body and label sizes track ~1.333 (perfect fourth: 13 → 15 (close), 15 → 20 = 1.333). Display range is a deliberate jump (h2 40 → h1 64 = 1.6, not the same ratio). This is a **two-band scale**: a tight body band (1.333) plus a dramatic display jump for hero moments. Worth lifting.
**Pairing:** Inter Variable (display + body, weight does the work) + Berkeley Mono (data, code only).
**Notes:**
- Negative letter-spacing scales with size (~ -0.022em on display, -0.012em on h3, ~-0.011em on body). Computed, not eyeballed.
- Display weight is 510 (between 500 and 600), not the typical 600/700. Reads as "confident not aggressive."
- Body color is muted (oklch ~62%) by default. High-contrast white (oklch 97%) is reserved for headings and active items.

## Color palette

| Token | OKLCH | Hex/RGB | Role |
|-------|-------|---------|------|
| bg | oklch(11.5% 0.005 250) | rgb(8, 9, 10) | Canvas |
| bg-elev | oklch(15% 0.005 250) | rgb(15, 16, 17) | Card surface (rare) |
| fg | oklch(97% 0.003 250) | rgb(247, 248, 248) | Primary text |
| fg-2 | oklch(85% 0.012 250) | rgb(208, 214, 224) | Secondary text |
| fg-muted | oklch(62% 0.012 258) | rgb(138, 143, 152) | Muted body |
| fg-disabled | oklch(46% 0.011 263) | rgb(98, 102, 109) | Disabled |
| accent | oklch(58% 0.18 270) | rgb(94, 106, 210) | One indigo accent for primary CTAs |
| border-faint | oklch(100% 0 0 / 0.05) | rgba(255,255,255,0.05) | Almost-invisible card divider |
| border | oklch(100% 0 0 / 0.08) | rgba(255,255,255,0.08) | Standard card divider |

**Notes:**
- Pure black is **not** used (`#000`). Background tilts cool-blue at oklch ~11.5% L.
- Pure white is **not** used (`#FFF`). Foreground is oklch ~97% L.
- All borders are white-alpha overlays, not opaque grays. This is the technique that lets surfaces stack without harsh edges.
- A single accent color, not a palette. Status hues do not appear on the marketing site.

## Spacing

**Base unit:** 4px (computed paddings and gaps cleanly divide).
**Section padding (vertical):** 96px top / 128px bottom (asymmetric — top tighter than bottom).
**Container max-width:** ~1364px reported (loose; content lives in narrower bands ~1024 with 80-120px gutters).
**Element gaps observed:** 8 / 12 / 16 / 24 / 32 / 48 / 64 (clean 4-multiples).

## Layout / structural choices

- **Hero:** type-only, headline at 64px / 510 weight with two-line break baked into the design ("The product development / system for teams and agents"). No image. CTA inline below.
- **Capability sections:** alternating wide-block scenes with screenshots placed asymmetrically in 60/40 splits. Each section is its own visual scene, not a uniform card grid.
- **Customer logos:** monochrome, single horizontal strip, no carousel.
- **Footer:** dense column-grid in 13px text, all-mono nav labels.

## Motion

- **Hover:** color-only, soft easing (~200ms). No translate, no scale.
- **Scroll reveals:** short fade + 12px y-translate on enter, ~600ms. No parallax.
- **Page transitions:** standard load.
- **Cursor:** default OS.
- **Easing voice:** soft and confident, not snappy. Long-tail ease-out feel.

## Unusual / signature

- Two-band type scale (tight body + dramatic display jump) instead of one continuous modular scale.
- Section vertical asymmetry (96/128) creates forward cadence without anyone consciously noticing.
- Hairline borders are white-alpha overlays at ~5-8% opacity, never opaque grays.
- Body-default text is muted (oklch 62%); white is a deliberate emphasis, not the default.

## Pull-forward candidates for DevNeural Hub

1. **Two-band type scale.** Tight body (12 → 14 → 16 → 18 ~ 1.222 ratio) + dramatic display jump (h2 → h1 step ~1.4-1.6x). Avoid one continuous ratio across the whole scale.
2. **Cool-tilted near-black canvas.** Bg at oklch ~11% with hue ~250, not pure black.
3. **Off-white foreground.** Fg at oklch ~97% (slight cool tilt to match bg), not pure white.
4. **Muted body, white emphasis.** Default body text in oklch ~62% muted. Reserve high-L for headings and active states.
5. **White-alpha hairline borders** at 5-8% opacity. No opaque gray borders.
6. **Indigo as a secondary accent** alongside our primary violet. (Linear's #5E6AD2 ≈ oklch 58% 0.18 270 — close to a desaturated companion to our 64% 0.20 295.)
7. **Negative letter-spacing scales with size.** Display at -0.022em, h3 at -0.012em, body at -0.011em. Not a flat -0.02 across.
8. **Section vertical rhythm asymmetric.** Adapt for our app shell: top rail 56px, bottom vitals 40px, panel gap 24, panel inner 16/24 — keep the asymmetry.
