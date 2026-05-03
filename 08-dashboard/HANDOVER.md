# Dashboard sub-workflow handover

> Mid-task pickup doc for Phase 3.4 dashboard design work. Read this AFTER `docs/SESSION-HANDOVER.md`. The previous session paused mid-way through running the `design-website` skill on the v4 mockup; the blocker is MCP tooling not being surfaced into the session's tool space, which a Claude Code session restart should fix.
> Last updated: 2026-05-03

---

## TL;DR for the next session

1. Phase 3.4 visual design work is in progress. v4 mockup is committed at `1c2ddbf` and considered the visual baseline by the user.
2. We started running the `design-website` skill (installed today) to take v4 from "designer-y by feel" to "designer-y with computed values" before scaffolding Next.js.
3. **Blocker:** chrome-devtools, playwright, and context7 MCPs report `Connected` in `claude mcp list` but their tool schemas were NOT in the session's tool space (`ToolSearch` returned nothing for any of them). This session was likely started before they were registered.
4. **Fix:** the user is restarting Claude Code. New session should verify the MCPs are now callable, then resume the workflow from Step 2.
5. The mockup server is local-only (`npx serve` on 5173) and gets killed on session restart. Restart it before iterating.

---

## Where the work lives

| File | What it is |
|---|---|
| `c:/dev/Projects/DevNeural/08-dashboard/mockup/index.html` | v4 static mockup, the visual baseline. Committed at 1c2ddbf, pushed. |
| `c:/dev/Projects/DevNeural/08-dashboard/BRIEF.md` | Step 1 INTAKE output, adapted for an internal app (the skill is built for client marketing sites — see "Adaptation notes" below). |
| `c:/dev/Projects/DevNeural/08-dashboard/references/` | Empty. Step 2 fills this with one `<domain>.md` per analyzed reference. |
| `c:/dev/Projects/DevNeural/docs/spec/phase-3-dashboard.md` | The phase spec. Section 10 is the locked design language we're computing tokens from. |
| `c:/dev/Projects/DevNeural/docs/SESSION-HANDOVER.md` | The top-level rolling handover. Read this first. |
| `C:/dev/Projects/design-system/` | The design-website skill's substrate. PROCESS.md, ANTI-SLOP.md, STACK-DECISIONS.md, analyzer/extract-prompt.md, references/INDEX.md, tokens/. |
| `C:/Users/michael/.claude/skills/design-website/` | The skill itself. |

## Recent commits relevant to this work

```
1c2ddbf  feat(08-dashboard): P3.4 home view static mockup
777bcc2  docs: full session handover update through P3.3
4707385  feat(09-bridge): P3.3 session bridge VS Code extension
```

## What was done before the pause

**v1 → v4 iteration on the static mockup:**
- v1: SaaS-y bloom, shimmer, all 7 status colors visible at once. User: "looks like a fucking rainbow and AI slop."
- v2: stripped to terminal-grade. Icon rail stream deck (56px), bottom vitals ribbon, no right rail, flat activity log, OKLCH-style restraint. User: "too austere."
- v3: middle ground. Reintroduced display weight on brief headline, section icons, one cyan node pulsing on the orb. User: "somewhere between the two."
- v4: restored v1 styling with v2 structural changes. Bottom vitals ribbon (40px, fixed), orb panel added to main grid, reminders moved to top of right rail, stream deck cards bumped slightly. User: **"i love this latest design."** Committed.

**Skill workflow started:**
- Step 1 INTAKE: `08-dashboard/BRIEF.md` written, capturing internal-app adapted intake.
- Step 2 REFERENCE ANALYSIS: BLOCKED on MCP tooling.

## The blocker (precisely)

`claude mcp list` output:
```
chrome-devtools: ✓ Connected
playwright:      ✓ Connected
context7:        ✓ Connected
```

But in the session, `ToolSearch` queries for `+chrome devtools`, `+playwright`, `+context7` all returned `No matching deferred tools found`. The MCPs are configured at the harness level but their callable tool schemas are not surfaced into the model's tool space for this session.

The skill's hard rule (`SKILL.md`):
> If any MCP is missing, stop and tell the user. Do not proceed with manual fallbacks unless the user explicitly approves; the workflow's quality bar depends on the tooling.

So we stopped. The user is restarting Claude Code to pick up the MCPs.

---

## How to resume (new session, after restart)

### 1. Confirm the MCPs are actually surfaced now

Try a tool search before doing anything else:

```
ToolSearch query="+chrome devtools" max_results=10
ToolSearch query="+playwright" max_results=10
ToolSearch query="+context7" max_results=10
```

If any of these still come back empty, the restart did not solve the surfacing issue. Stop again and tell the user. Do NOT fall back to WebFetch as a substitute — the skill explicitly forbids manual fallback without explicit approval, and the user already declined that path.

### 2. Restart the mockup server

It does not survive session restart.

```powershell
cd c:/dev/Projects/DevNeural/08-dashboard/mockup
npx --yes serve -l 5173 .
```

(Run in background.) Confirm with `curl http://localhost:5173/` returns 200.

### 3. Resume from Step 2 of the skill workflow

The four reference URLs to analyze (per `BRIEF.md`):

1. **linear.app** (or any of their public app screenshots) — application density, restraint, dark theme, motion economy
2. **raycast.com** — command palette + product screenshots showing the actual application UI we want to study
3. **openstatus.dev** — monitoring board UX, status pills
4. **vercel.com** (their docs / dashboard surface, since the dashboard proper is auth-walled)

For each, run the procedure in `C:/dev/Projects/design-system/analyzer/extract-prompt.md`:
- Navigate via chrome-devtools MCP
- Capture screenshots at 375 / 768 / 1280 / 1920
- Extract type system (computed font-size for h1/h2/h3/body/small + modular ratio)
- Extract color palette in OKLCH
- Extract spacing system + base unit
- Extract grid/layout primitives
- Extract motion patterns
- Note unusual choices
- Identify pull-forward candidates
- Write `08-dashboard/references/<domain>.md` per the schema in extract-prompt.md

### 4. Step 3 SYNTHESIS (after Step 2)

- Author `08-dashboard/tokens.css` with OKLCH neutrals + a single locked modular type ratio + 2 custom cubic-bezier easing curves
- Update mockup to consume tokens (no hex literals)
- **Stop and show the user the tokens before applying.** This is the cheapest gate to iterate.

### 5. Steps 4-6

Per `C:/dev/Projects/design-system/PROCESS.md`. Verification (Step 5) uses Playwright MCP for multi-browser screenshots + Chrome DevTools MCP for Lighthouse. Skip the SEO score (per BRIEF.md adaptation — internal app, behind PIN auth + Tailscale).

After Step 6, do the post-mortem: propose either an `INTERNAL-APP-ADAPTATION.md` doc the skill reads, or a fork called `design-internal-app`. The user wants to wait for evidence before encoding the adaptation.

---

## Adaptation notes (the skill is built for client marketing sites)

The skill assumes a client + marketing site + conversion goals. We adapted in BRIEF.md:

| Skill assumption | Our adaptation |
|---|---|
| Client name, domain | Single user (Michael), internal tool. No client. |
| Audience / conversion goals | One developer, all-day glanceability + steerability + recall. |
| Stack pick (HTML/Astro/Next per scope) | Locked to Next.js 15 + Tailwind + shadcn (per spec; ANTI-SLOP rule 12 explicitly permits shadcn for *applications*). |
| ANTI-SLOP rule 12: never shadcn for marketing | N/A — this is an app, the rule's app exception applies. |
| Lighthouse SEO ≥ 90 | Skipped (PIN auth + Tailscale, not indexable). |
| Hero + sections vocabulary | Replaced with dashboard vocabulary: shell, rails, ribbons, panels, feeds. |
| Reference vault (mostly marketing) | Used the four spec section 10.12 anchors instead. |

What we DO pull from the skill:
- OKLCH token authoring discipline
- Locked modular type scale (replacing v4's ad-hoc 10/11/12/13/14/15/24/30 grab-bag)
- Custom cubic-bezier easing instead of `ease`/`linear`
- Token compliance audit (no hex literals in components)
- Playwright multi-breakpoint screenshots as a verification gate
- Lighthouse perf/a11y/best-practices gates
- Reference extraction via Chrome DevTools MCP for *computed* values, not visual estimates

---

## User preferences locked from this session

(In addition to the durable ones in `docs/SESSION-HANDOVER.md`.)

- The user is happy with v4's overall styling. Don't strip it back to v2-grade austerity. Keep the bloom on the daily brief, keep the shimmer pill, keep the colored rings on activity icons, keep the orb's pulsing cyan ingest cursor.
- The user wants:
  - Bottom vitals ribbon (CPU + status lights pinned to the bottom of the window) — non-negotiable now
  - Orb panel present on Home (not deferred to Phase 4)
  - Reminders surfaced at the TOP of the right rail (not buried at the bottom)
  - Stream deck cards a touch bigger than v1 — done in v4, keep
- The user said "this dashboard need to be beautiful" and "i need to be in this all day every day." Both rules apply: it cannot be sterile, it cannot be loud.

## Blockers / open questions for the user

1. After restart, does the MCP surfacing work? If not, we have a deeper Claude Code config issue to diagnose.
2. Whether to keep "What's new" in the main grid or kill it (overlaps with the Live activity feed in the right rail). v4 keeps it; the user has not weighed in on whether that's right.
3. The orb in v1-v4 is a static SVG placeholder. Phase 4 wires it to real wiki data. Decision deferred until Phase 4.

## Things to NOT do on restart

- Don't re-litigate the v4 styling. The user loves it. Iterate within it, don't tear it down.
- Don't proceed with the skill workflow if MCPs still don't surface. The user explicitly chose option 1 (restart) over option 2 (degraded WebFetch fallback) and option 3 (skip Steps 2 + 5). Honor that.
- Don't update the design-website skill yet. The user wants the post-mortem (Step 6) to be informed by evidence, not pre-emptive guesses. Adaptation file gets written AFTER one full successful run.
- Don't scaffold the real Next.js (`08-dashboard/` proper) until tokens.css is locked and the mockup looks right. Phase 3.4.1 starts after this design pass concludes.
