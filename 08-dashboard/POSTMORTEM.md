# Post-mortem — DevNeural Hub Phase 3.4 design pass

**Date:** 2026-05-03
**Project:** `c:/dev/Projects/DevNeural/08-dashboard/`
**Skill:** OTLC-Design (run as "design-website" per session handover; same skill, different alias)
**Mode:** Internal app
**Done signal:** "ALLL FINE" (after batched 5-question post-mortem proposal)

---

## 1. New ANTI-SLOP rule?

**Yes.** Added rule 25 to `C:/dev/Projects/design-system/ANTI-SLOP.md`:

> *"Never copy a reference's muted-text lightness without checking it clears 4.5:1 for app body text."*

The DevNeural Hub run lifted Linear's `oklch(62%)` muted directly because Linear is the canonical dark-app reference. Lighthouse caught four `text-txt3` instances at 3.1-3.2:1 contrast. Token bumped to `oklch(70%)` to clear 4.5:1. Documented as a floor: muted on dark canvas (oklch L < 20%) ≥ oklch(70%); muted on light canvas (oklch L > 90%) ≤ oklch(40%). Run contrast check before authoring, not after.

Commit: `anti-slop: contrast on dark surfaces (rule 25)` (in this same commit).

## 2. New pattern for `patterns/`?

**Yes.** Added `C:/dev/Projects/design-system/patterns/app/two-band-type-scale.md`.

Two-band scale: tight body band (~1.143-1.222 ratio) plus dramatic display jumps (1.4-1.6× h2→h1, with no continuous ratio across the bands). Linear's pattern, applied here at 11/12/13/14/16/18 (body) + 22/28/40/56 (display). Documented variations (three-band for spreadsheet density, mono optical correction, weight discipline), reference uses (linear.app, DevNeural Hub, vercel.com/docs), and anti-patterns (extending display past 56 in app shells, body ratio inside display band).

Commit: `patterns: add app/two-band-type-scale` (this commit).

## 3. New reference for `references/INDEX.md`?

**Yes.** Added `openstatus.dev` to the "Modern SaaS done well" section of `C:/dev/Projects/design-system/references/INDEX.md`.

Note: linear.app and raycast.com were already in the vault under "Swiss / Minimal / Product" and "App / Product UI". Vercel was already under both. The new add is `openstatus.dev` — it's the engineer-mono voice reference (whole-UI monospace, compressed display tier, outlined-rect status pills) that wasn't represented elsewhere in the vault and is the right reach when the project voice is "rendered output, not marketing."

Commit: `references: add openstatus.dev` (this commit).

Full per-domain analyses for all four references already saved at `08-dashboard/references/{linear.app,raycast.com,openstatus.dev,vercel.com}.md`.

## 4. PROCESS.md change?

**Yes.** Added intake question 9 to `C:/dev/Projects/design-system/APP-ADAPTATION.md`:

> *"Locked stack — list any framework, library, or platform choices that are non-negotiable upstream of design synthesis. When all values are locked, skip Step 3.5 stack pick in PROCESS.md and consume the locked stack directly."*

Captured at the intake step so synthesis doesn't waste time relitigating Next.js 15 + Tailwind v4 + shadcn (locked by `docs/spec/phase-3-dashboard.md` section 11) on every app run. The DevNeural Hub run worked around this with an "Adaptation notes" table in BRIEF.md; that field is now first-class.

Commit: `process: intake locked-stack field for app branch` (this commit).

## 5. Skill change?

**Yes.** Two edits to `C:/Users/michael/.claude/skills/OTLC-Design/SKILL.md`:

**(a)** New "MCP surface check" subsection under "Required MCPs", to run at the top of Step 2. `claude mcp list` reporting `Connected` is necessary but not sufficient — the model's tool space can lag. Mandates `ToolSearch query="+chrome-devtools" / "+playwright" / "+context7"` before extracting the first reference. If any returns empty, stop and instruct the user to restart Claude Code. This was the failure mode that paused the DevNeural Hub run for a session before this one resumed.

**(b)** New "Behavior notes" rule: *"No mid-workflow pace prompts."* Once intake is complete and the user has authorized end-to-end (explicit "go" / "do it" / "all of it" / "I want this done"), suppress all checkpoint prompts. Execute through the two real gates (Step 3 synthesis, Step 5 verification) plus Step 6 post-mortem; nothing else. Confirmation menus during an authorized run are forbidden. The user told me twice in this run to stop asking ("stop asking for my approval", "stop fucking asking me to approve all these steps"); the rule is now in the skill for future runs.

Commit: `skill: mcp surface check + suppress mid-workflow pace prompts` (this commit).

## 6. (Internal mode) Did anything from this project deserve to go into the owner-brand profile?

The skill's PROCESS.md Step 6 adds a 6th question for internal mode. **Intentionally nothing this round.** Reason: the brand surface for DevNeural Hub is project-specific (electric violet + telemetry mono + dashboard chrome) rather than a transferable owner-brand pattern. The token values lifted from references are reusable as the *technique* (two-band scale, white-alpha hairlines, OKLCH discipline) which is now captured in `patterns/app/` and `ANTI-SLOP.md` rule 25 — that's the right home for them. Owner-brand additions stay deferred until a second internal-app run produces a pattern that genuinely cuts across owner projects.

---

## Status: complete

All five questions answered substantively, plus the internal-mode 6th question with an explicit reasoned skip. Skill run closed.
