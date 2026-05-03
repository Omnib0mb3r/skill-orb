# raycast.com

**URL:** https://www.raycast.com
**Captured:** 2026-05-03 (viewport rendered ~1023px wide)
**Lighthouse:** not run on references

## Aesthetic vocabulary

Pitch-black canvas with pure-white type. Inter at heavier weight (600 on display, 500 on labels). Mono is GeistMono and appears in install snippets. Pull-forward is the **status color set**: cyan, green, gold, red emerge against the black canvas as small accent dots and pills, never full areas. Marketing is heavy on product screenshots embedded inline; the website itself is a frame around app screenshots. Buttons are inverted (white pill, near-black text) and large CTAs use that same pattern site-wide. Less restrained than Linear: hero h1 is 64px / 600 (heavier than Linear's 510), and there's a 56px tertiary display size used for section openers. Motion is more present (subtle hover scaling, glowing transitions on the macOS-window mock).

## Type system

| Element | Family | Size | Weight | Line-height | Letter-spacing | Color |
|---------|--------|------|--------|-------------|----------------|-------|
| h1 | Inter | 64px | 600 | 70.4px (1.1) | normal | oklch(100% 0 0) |
| h2 (section label) | Inter | 20px | 500 | normal | 0.2px (0.01em) | oklch(100% 0 0) |
| h3 (display variant) | Inter | 56px | 400 | 65.5px (1.17) | 0.2px | oklch(100% 0 0) |
| h3 (capability head) | Inter | 24px | 500 | normal | 0.2px | oklch(100% 0 0) |
| h4 | Inter | 24px | 500 | 38.4px (1.6) | 0.2px | oklch(100% 0 0) |
| body lead | Inter | 18px | 400 | normal | 0.2px | oklch(100% 0 0) |
| body | Inter | 16px | 500 | 25.6px (1.6) | normal | oklch(100% 0 0) |
| body muted | Inter | 20px | 500 | normal | 0.2px | oklch(72% 0.005 230) |
| install snippet | GeistMono | 12px | 400 | 13.8px (1.15) | normal | oklch(72% 0.005 230) |
| button | Inter | 14px | 500 | 16px | 0.2px | oklch(28% 0.005 250) on light fill |

**Modular ratio:** also a **two-band** approach. Body band tightly clustered (12 / 14 / 16 / 18 / 20 ~ 1.166). Display jumps to 24, then 56, then 64 (not a smooth ratio). The display tier feels like punctuation, not a continuum.
**Pairing:** Inter (display + body) + GeistMono (terminal-style lines).
**Notes:**
- **Positive** letter-spacing on most type (+0.2px = +0.0125em at 16px). Opposite of Linear's negative-ls discipline. Intentional looseness for "approachable."
- Hero uses 600 weight; Linear uses 510. Result: Raycast reads more confident, Linear reads more refined. Pick one stance, don't mix.
- Pure white is the foreground. Per ANTI-SLOP rule 6 we won't copy this — but note Raycast's contrast register is "blunt".

## Color palette

| Token | OKLCH | Hex/RGB | Role |
|-------|-------|---------|------|
| bg | oklch(10% 0.003 250) | rgb(7, 8, 10) | Canvas |
| fg | oklch(100% 0 0) | rgb(255, 255, 255) | Primary text (PURE WHITE — do not copy) |
| fg-muted | oklch(72% 0.005 230) | rgb(156, 156, 157) | Muted body |
| fg-disabled | oklch(28% 0.005 250) | rgb(47, 48, 49) | On-pill text and disabled |
| status-fail | oklch(67% 0.21 25) | rgb(255, 99, 99) | Red signal |
| status-ok | oklch(83% 0.18 155) | rgb(89, 212, 153) | Green signal |
| status-info | oklch(78% 0.13 230) | rgb(86, 194, 255) | Cyan signal |
| status-pending | oklch(85% 0.18 85) | rgb(255, 197, 49) | Gold signal |
| border | oklch(100% 0 0 / 0.05) | rgba(255,255,255,0.05) | Hairline divider |
| border-strong | oklch(100% 0 0 / 0.10) | rgba(255,255,255,0.10) | Visible divider |

**Notes:**
- Pure black `#000` is not used (bg is rgb(7,8,10)) but pure white IS used. Asymmetric application of the "no pure values" principle.
- Status colors (red/green/cyan/gold) appear small and rarely. They live on app-mock screenshots, not in chrome.
- White-alpha borders at 5/10/20%. Same technique as Linear.

## Spacing

**Base unit:** 4px. Standard 4-multiples (8 / 12 / 16 / 24 / 32 / 48 / 64).
**Hero vertical breathing:** ~120-160px top, ~120px bottom.
**Container:** roughly 1280-1360px, content bands narrower at ~960-1040.

## Layout / structural choices

- **Hero:** centered headline, but headline is broken into two lines and the second line carries a soft glow-shadow effect. CTA below. Mac-window screenshot directly under, near full-width.
- **Capability sections:** big inline product screenshots, often two-column 60/40 with a scrolling animation inside the screenshot frame.
- **Status integrations panel:** dense grid of tool icons (8x4 or 6x4) with hover labels — relevant pull-forward for our left rail.
- **Footer:** standard column-grid, dim contrast.

## Motion

- **Hover:** subtle scale (1.02) + brightness lift on icon tiles.
- **Scroll:** product screenshots fade-in with slight translate.
- **Custom cursor:** none observed.
- **Easing voice:** snappy on hover, softer on scroll-in.

## Unusual / signature

- Status color set used **as occasional accents**, not chrome. Cyan/green/red/gold appear on screenshots and one or two pills.
- Inverted button pattern (white pill / near-black text) used everywhere primary CTAs appear.
- Mac-window product mocks frame nearly every section; the marketing site is a stage for the app, not for itself.

## Pull-forward candidates for DevNeural Hub

1. **Status color set with this saturation profile.** Our status palette already targets oklch ~70-85% L, ~0.13-0.21 C. Lock it close to Raycast's chroma: never desaturated, never flat.
2. **Status colors as accents not chrome.** Use them on dots, pills, ring strokes. Never as panel backgrounds.
3. **Tool/icon dense grid pattern** for our left-rail Stream Deck (sessions, projects, services).
4. **Inverted CTA pill** (light-fill / dark-text) for primary actions in the dashboard top rail.
5. **DO NOT** copy Raycast's pure-white foreground. ANTI-SLOP rule 6 stays.
6. **DO NOT** copy positive letter-spacing on display. Linear's negative-ls direction is the better fit for a dense application.
