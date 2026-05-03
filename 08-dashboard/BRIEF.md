# DevNeural Hub — Project Brief

> Adapted from design-website skill INTAKE step. This is an internal product application, not a client marketing site, so several intake fields are reframed (no "client", no "audience conversion goals", no "deploy preference" beyond local-first).

**Last updated:** 2026-05-02
**Status:** Step 1 complete. Step 2 (reference analysis) next.

---

## Project

- **Name:** DevNeural Hub (internally: "the dashboard")
- **Owner / sole user:** Michael Collins
- **Repo:** github.com/Omnib0mb3r/DevNeural
- **Workspace:** `c:/dev/Projects/DevNeural/08-dashboard/`
- **Spec of record:** `docs/spec/phase-3-dashboard.md` (visual design language: section 10)

## Domain context

DevNeural is a local-first second brain that captures, embeds, and reinforces patterns from Claude Code sessions on `OTLCDEV`. The dashboard is the central hub: glance + steer + search + monitor. Bound to `0.0.0.0:7474` on `OTLCDEV`, reachable via Tailscale only. PIN-locked. One user.

## Audience

One developer (Michael), every day, all day. No marketing audience. No conversion funnel. No anonymous visitors.

## Goals (primary)

1. **Glanceability.** Status of sessions, system, and brain visible without thought.
2. **Steerability.** Send a prompt to a running Claude session from anywhere on the tailnet.
3. **Recall.** Search wiki + raw chunks + reference docs from one input.

## Goals (secondary)

4. Lives in browser tabs all day without fatigue (high information density, restrained motion, no distractions).

## Scope

Phase 3.4: a multi-tab single-page application. Tabs: Home, Wiki, Sessions, Projects, System, Reminders, Orb. Mobile-installable PWA in P3.11.

## References (worth analyzing for token synthesis)

The spec section 10.12 explicitly names these as aesthetic anchors. We extract their *application-shell vocabulary*, not marketing.

1. **linear.app/inbox** (or a screenshot of the Linear app proper) — density, restraint, dark theme, motion economy
2. **raycast.com** (the marketing site, but its product screenshots show the actual command palette UI we want to study)
3. **vercel.com/dashboard** style (we'll grab the public docs/cli reference page since their dashboard is auth-walled)
4. **openstatus.dev** — monitoring board UX, status pills

We avoid: shadcn marketing examples, Notion, anything productivity-app-ish.

## Brand constraints (already locked in spec section 10)

- **Theme:** dark only in v1
- **Accent:** electric violet `#8B5CF6` (will re-author in OKLCH during synthesis)
- **Status palette:** green `#10B981`, amber `#F59E0B`, red `#EF4444`, cyan `#22D3EE`, indigo `#818CF8`, gold `#FBBF24`
- **UI font:** Inter (variable)
- **Display:** Inter Tight 700
- **Mono:** JetBrains Mono
- **Tabular numerics:** site-wide
- **Icons:** Lucide, stroke 1.5, sizes 16/20/24
- **Radius:** 6 cards / 4 inputs / pill round
- **Density target:** Linear / Raycast / Vercel territory

The synthesis step will re-author these as OKLCH tokens, lock the type scale to a single ratio, and pick custom easing curves.

## Content state

All copy is real (sourced from the live daemon endpoints already shipped in P3.1-3.3). Mock data in the v4 mockup is realistic; the real app pulls from `GET /sessions`, `GET /projects`, `GET /dashboard/daily-brief`, `GET /reference`, `WS /dashboard/events`, etc.

## Stack (locked, not a workflow decision)

- Next.js 15 App Router (per spec section 11)
- TypeScript
- Tailwind CSS with token-driven theme (NO Tailwind defaults — see ANTI-SLOP rule 4)
- shadcn/ui primitives (explicitly permitted by ANTI-SLOP rule 12 for *applications*)
- Tremor for charts
- Lucide for icons
- Tanstack Query for client state
- Daemon (Fastify) serves the built `out/` in production

This is the application case the design-website skill defers to. Stack pick is not relitigated.

## Hosting / deploy

Local-first. `07-daemon` serves the built dashboard at the same port. No Vercel, no Netlify, no cloud. Tailscale for remote access.

## Deadline / budget

Internal project. Quality over speed. The mockup is the gate — once tokens + visual look pass, scaffold the real Next.js.

## Verification gates (adapted)

The standard skill gates apply *with adjustments* for an app:

- **Lighthouse Performance ≥ 90** — yes (slow dashboards feel cheap)
- **Lighthouse Accessibility ≥ 95** — yes (keyboard navigation matters, this lives in a browser tab)
- **Lighthouse Best Practices ≥ 90** — yes
- **Lighthouse SEO** — *skipped* (not indexable, behind PIN auth + Tailscale)
- **Zero critical/serious axe violations** — yes
- **Token compliance** — yes (no hex literals in components after Step 4)
- **Multi-browser screenshots via Playwright** — yes (Chromium primary, Firefox + WebKit sanity)
- **Reference vocabulary match** — yes (against the four references, not marketing sites)

## Out of scope for this run

- Backend changes to the daemon (already shipped in P3.1-3.3)
- The Next.js scaffold itself (P3.4.1 is the next phase, after this run)
- Phase 4 orb wiring (orb panel uses static SVG placeholder for now)
- Mobile breakpoints (P3.11 polishes mobile; we still capture screenshots)

---

## Workflow state

| Step | Status | Output |
|---|---|---|
| 1 INTAKE | done | this file |
| 2 REFERENCE ANALYSIS | next | `references/[domain].md` per source |
| 3 SYNTHESIS | pending | `tokens.css` + updated mockup |
| 4 BUILD | pending | mockup updated to consume tokens, ANTI-SLOP cross-check |
| 5 VERIFY | pending | `VERIFICATION.md` with Playwright + Lighthouse output |
| 6 ITERATE | pending | post-mortem + design-system improvements |
