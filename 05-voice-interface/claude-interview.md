# Interview Transcript: 05-voice-interface

---

## Q1: How does a voice query actually reach this module?

**Answer:** The user wants it to work with Claude Voice dictation AND control the DevNeural orb. Simplified to: a `/voice` slash command in Claude Code that the user types or dictates into, which then processes the query.

---

## Q2: Which specific graph queries should the voice interface support?

**Answer (multi-select):**
- What's connected to [project/skill]?
- What's my project context right now?
- What skills am I using most?
- Show me [node] connections
- What projects are at what stage of development, and what projects should I look at to build?

Future scope (not in this plan): launching tasks, searching git.

---

## Q3: How should the active project be identified during a voice query?

**Answer:** Not sure — defer to plan. (Decision: default to resolving from cwd, same pattern as 04-session-intelligence, with optional explicit project name in the query.)

---

## Q4: For the entry point — stdin hook, CLI, MCP, or HTTP?

**Answer:** "What keeps this simple and free and worked to control the DevNeural orb." The orb is the most important part. They replaced the VS Code extension with a web app (03-web-app) to house the orb because it's simpler and gives more freedom.

**Clarification from follow-up:** UX trigger is a `/voice` slash command in Claude Code, then dictate or type the question.

---

## Q5: NL parsing approach?

**Answer:** Hybrid — local fast-path (wink-nlp / natural.BayesClassifier) + Claude Haiku fallback for ambiguous queries.

---

## Q6: Should voice queries be logged back to the graph?

**Answer:** No — voice is read-only. Don't write to the graph when voice queries are made.

---

## Q7: Current state of the orb / 03-web-app?

**Answer:** The orb is the most important part. They moved from VS Code extension to a web app. Planning was done via /deep-plan for 03-web-app but the implementation phase hasn't been run yet. So the plan exists but no code yet.

---

## Q8: Orb bridge — how should voice commands reach the web app?

**Answer:** Via 02-api-server WebSocket (option 1). Want to keep it local. "What you think is best is ok" — endorses the existing WebSocket approach.

---

## Q9: Since 03-web-app hasn't been implemented — how to handle in this plan?

**Answer:** Build 03-web-app and 05-voice-interface together in one combined plan.

---

## Q10: How does a user invoke a voice query?

**Answer:** Type `/voice` in Claude Code, then dictate or type the question.

---

## Key Decisions Summary

| Decision | Answer |
|----------|--------|
| Entry point | `/voice` slash command in Claude Code |
| Scope | Build 03-web-app + 05-voice-interface together |
| NL parsing | Hybrid: local fast-path + Haiku fallback |
| Voice logging | Read-only — no writes to the graph |
| Orb bridge | Via 02-api-server WebSocket (keep local) |
| Project identity | Resolve from cwd by default; override from query text |
| Supported intents | connections, context, top skills, node detail, project stages |
| 03-web-app state | Planned, not yet implemented |
