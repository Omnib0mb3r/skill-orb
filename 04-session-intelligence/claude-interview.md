# Interview Transcript: 04-session-intelligence

---

## Q1: Output mechanism

**Question:** The hook can output context two ways: plain stdout (text visible in Claude's context window as a system-reminder style note) or JSON `additionalContext` (injected more discretely). Which do you prefer?

**Answer:** Plain stdout (Recommended) — simpler, visible, and works around the known `additionalContext` plugin bug.

---

## Q2: Node types to surface

**Question:** Which node types should appear in the injected context? (The graph has tools like Bash/Edit, skills like deep-plan, and connected projects.)

**Answer:** Skills and connected projects only. Tools (Bash, Edit, etc.) are too generic and low-signal to be worth surfacing.

---

## Q3: Result limits

**Question:** What are the right limits for surfaced results?

**Answer:** Loose — top 10 per type, weight ≥ 1.0. Surface everything with any meaningful signal.

---

## Q4: Startup bug handling

**Question:** Research found a known bug where the `startup` matcher silently fails to inject context in new sessions (issue #10373). How should we handle this?

**Answer:** Register for all 4 matchers (startup, resume, clear, compact). Redundant fires are cheap since the hook is fast. Guarantees context is always present.

---

## Q5: API offline behavior

**Question:** If the DevNeural API server isn't running (port 3747), what should the hook output?

**Answer:** Short notice with start command — e.g., "DevNeural: API offline. Start: cd C:/dev/tools/DevNeural && npm run dev:api"

---

## Q6: Installation approach

**Question:** How should the hook be installed/registered in settings.json?

**Answer (verbatim):** "Part of a broader setup document I think — I want to set up once for a PC, and then based on the Standard DevNeural.md and Json files that will be in each project, everything just works, and since these files also drive how the repos is saved and local drive is saved, it's kinda the gospel — and I'm thinking there in the .MD and .Json files that are mentioned on the other parts of this project, those docs are version-controlled and if we update a global version of them, and then open a project with an older config file, the user may be prompted to update the DevNeural files."

**Summary:** 04-session-intelligence provides an `npm run install-hook` script that patches `~/.claude/settings.json`. This is called as one step within a broader DevNeural PC setup process. The `devneural.json` and `DevNeural.md` per-project config files are the "gospel" that drives the ecosystem.

---

## Q7: Code sharing with 01-data-layer

**Question:** The hook needs the project identity to query the API. The 01-data-layer already has `resolveProjectIdentity()`. Should 04 reuse it?

**Answer:** Import from 01-data-layer directly — reuse the existing TypeScript module. Single source of truth for identity logic.

---

## Q8: API timeout

**Question:** If the API is slow to respond, what's the max wait before the hook gives up and outputs the offline message?

**Answer:** 5 seconds — generous enough to handle a cold-starting API server without false offline messages.
