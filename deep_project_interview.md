# DevNeural — Deep Project Interview Transcript

**Date:** 2026-03-28
**Requirements file:** requirements.md

---

## Q1: Tech stack

**Q:** What's the primary language/runtime?
**A:** TypeScript / Node.js — API server, logger, and VS Code extension all in TS.

---

## Q2: MVP scope

**Q:** What's your MVP — what needs to work before the rest matters?
**A:** Logger + weights.json only. Just capture the data — visualization comes later.

---

## Q3: Claude session intelligence mechanism

**Q:** How does "Claude queries on session start" work mechanically?
**A:** SessionStart hook in settings.json — fires on every session open.

---

## Q4: Logger interception mechanism

**Q:** Where does hook interception happen?
**A:** Both hooks and skill wrappers — Claude Code hooks (PostToolUse etc.) for tool use, skill wrappers for skill invocations.

---

## Q5: VS Code extension delivery

**Q:** Is the panel a proper VS Code extension or a webview served by the API?
**A:** VS Code extension (.vsix) — proper extension with package.json, installed locally.

---

## Summary of Key Context

- **Language:** TypeScript throughout (logger, API server, VS Code extension)
- **MVP:** Data layer only — logger captures invocation events, writes structured logs, updates weights.json
- **Hook types:** Claude Code PostToolUse/skill hooks (settings.json) + skill invocation wrappers, both feed the logger
- **Claude intelligence:** SessionStart hook in settings.json reads graph data and surfaces relevant context
- **VS Code panel:** Proper .vsix extension with a webview rendering Three.js — not a browser tab
- **Data root:** `C:\dev\data\skill-connections\` is shared across all projects (lives outside this repo)
- **Build order:** Data layer → API server → VS Code extension → Session intelligence → Voice → NotebookLM

---

## Proposed Natural Splits

Based on the interview, the project decomposes cleanly into 6 splits following the 6 feature areas:

1. **data-layer** — Logger + JSON schema + hook wiring (MVP). TypeScript logger that intercepts Claude Code hooks and skill wrappers, writes structured logs, maintains weights.json at shared data root.

2. **api-server** — REST + WebSocket server. Reads from shared data root, serves graph data to consumers, emits real-time events over WebSocket.

3. **vscode-extension** — .vsix extension with Three.js webview. Connects to API server via WebSocket, renders 3D neural network, floating panel that's non-blocking.

4. **session-intelligence** — SessionStart hook implementation. Queries API at session open, ranks and surfaces relevant repos/skills/tools as Claude context.

5. **voice-interface** — Voice query interface. Integrates with Claude Voice workflow, translates natural language queries to API calls, feeds session logs back into connection graph.

6. **notebooklm-integration** — Cluster detection + training material generation. Detects high-dependency clusters in graph, auto-generates structured notes, recommendation engine for learning resources.

**Dependencies:**
- 02, 03, 04, 05, 06 all depend on 01 (data layer)
- 03 (vscode-extension) depends on 02 (api-server)
- 04 (session-intelligence) depends on 02 (api-server)
- 05, 06 can run in parallel after 02 is complete
