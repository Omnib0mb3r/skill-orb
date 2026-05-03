# Session handover

> Pick up where the last session left off. Designed to be the first file a new Claude (or you) reads when starting fresh.
> Last updated: 2026-05-02 (after Phase 2 burndown complete).

---

## Where we are

DevNeural v2 is a local-first second brain: capture, semantic RAG, learning wiki, real-time recommendation, reinforcement, and (coming) a central dashboard. Phase 1 (the daemon) is built and pushed. Phase 2 (v1 burndown) is done. Documentation is comprehensive and reframed around the second-brain identity. Next concrete work is Phase 3 (the dashboard build).

## TL;DR

- **Identity is "second brain."** Not a metaphor. The system has all six second-brain properties (persistent memory, semantic recall, watches without being asked, surfaces in real time, compounds with use, lives on local hardware). See `docs/spec/devneural-v2.md` section 0.
- **Two layers: semantics + logic.** Semantics = embeddings, vector search, fuzzy recall. Logic = `[trigger] → [insight]` schema, validation, promotion rules, hard editorial rules. Both required. See section 7.
- **Read first:** `README.md` (top-level overview), then `docs/spec/devneural-v2.md` for the system architecture, then `docs/spec/DEVNEURAL.md` for the wiki schema, then this file.
- **Phase status:** Phases 1 and 2 done. Phase 3 next. Phases 4 and 5 specs written and queued.
- **Branch:** `master`. All work is on master, no feature branches.
- **Local-first:** ollama with `qwen3:8b` is the LLM. No API keys required. Anthropic SDK is installed but only used if `DEVNEURAL_LLM_PROVIDER=anthropic`.
- **No em dashes anywhere** (per global CLAUDE.md). Use periods, commas, colons, semicolons, parens, hyphens. This applies to chat output, code comments, commit messages, docs.
- **No AI co-author tags** in commits. Ever.

---

## Phase order and status

| # | Scope | Status | Spec |
|---|---|---|---|
| 1 | Build the daemon (capture, ingest, query, reinforce, lint, setup) | done, pushed | `docs/spec/devneural-v2.md` |
| 2 | Burn down v1 (archive 01/02/04, kill monday, rewrite top-level docs) | done | inline in v2 spec section 13 |
| 3 | Central control dashboard (Next.js + PWA + Tailscale + visual design language) | spec done, build queued | `docs/spec/phase-3-dashboard.md` |
| 4 | Orb rebind to wiki data model + visual features | spec done, deferred | `docs/spec/phase-4-orb.md` |
| 5 | Settings audit, finalizes personalized parts of install docs | spec done, deferred | `docs/spec/phase-5-settings-audit.md` |

---

## What's done (recent commits)

```
c41c54a  docs(install,spec): install/recovery docs + phase 3/4/5 specs
6eafb80  feat(07-daemon): P7-lite graph endpoints + P8 setup polish
aee5078  feat(07-daemon): P6 lint + whats-new digest
698a1b7  feat(07-daemon): P4 prompt injection + P5 reinforcement
fc41743  feat(07-daemon): P3.6 curation layer (summarizer, glossary, task, curator)
6c7dca4  feat(07-daemon): P3.5 local-first LLM substrate with validation
2ee2766  feat(07-daemon): P3 wiki ingest pipeline
9c45adc  feat(07-daemon): P2 embedder, vector store, sqlite index
c1ddf41  feat(07-daemon): P1 capture layer
345fafb  docs(spec): lock v2 architecture and wiki schema
```

The `07-daemon/` module is complete end to end: capture → store/embed → ingest → query/curate → reinforce → lint. Plus an install/setup CLI and full install docs.

47/47 unit tests pass.

---

## What was done in Phase 2 (burndown)

Completed in this session:

- Moved `01-data-layer/`, `02-api-server/`, `04-session-intelligence/` to `archive/v1/` (git mv, history preserved).
- Moved v1 planning docs (`requirements.md`, `project-manifest.md`, `devneural.md`, `deep_project_interview.md`, `deep_project_session.json`) to `archive/v1/`.
- Killed the `/sync` endpoint: now returns `410 Gone` with a deprecation message. Monday integration is dead. Project status board is moving into Phase 3 dashboard.
- Rewrote `start.bat` at repo root to launch the daemon (with `status`, `setup`, `stop` subcommands). v1 server references gone.
- Rewrote top-level `README.md` with the second-brain identity as the lead, capabilities table, two-layers architecture explanation, and updated file map.
- Added `Pics/` to `.gitignore` (personal screenshots, not for repo).
- Renumbered v2 spec to add new section 0 (Identity) and section 7 (The two layers), pushing prior 7-17 to 8-18.
- Added section 10 (Visual design language) to phase-3-dashboard, renumbering 10-16 to 11-17.

47/47 tests still passing after burndown. Daemon compiles clean. Hooks unchanged (already point at v2 paths).

## What's next: Phase 3 (dashboard build)

The full spec is in `docs/spec/phase-3-dashboard.md`. Scope is broken into 12 sub-phases (3.1 through 3.12). MVP is 3.1-3.4. Detailed visual design language lives in section 10.

Recommended approach:

1. Confirm user is ready to start build (or wants to pause).
2. Begin with 3.1 (daemon API extensions): add the new HTTP routes for dashboard data without writing UI yet.
3. Then 3.2 (reference corpus pipeline): PDF + image upload → OCR → chunk → embed → store. Audio/video can defer to 3.5.
4. Then 3.3 (session bridge VS Code extension at `09-bridge/`).
5. Then 3.4 (dashboard scaffold at `08-dashboard/` with Next.js + Tailwind + shadcn, PIN auth, all pages stubbed against real data).

Each sub-phase ships independently and is verifiable.

---

## Critical user preferences (from past conversations)

These are durable preferences. Honor them every session.

- **Be direct, not verbose.** The user has called me out multiple times for sprawling answers when a yes/no would do.
- **Don't barrel into action.** Questions deserve answers, not action. The user explicitly said: "A question is NOT authorization to act. Sometimes the user wants to talk something out first."
- **No em dashes. Anywhere. Ever.** Period.
- **Bluntness over politeness.** The user wants to be told when an idea is bad or out of scope.
- **Root cause first.** Don't suggest workarounds unless they're truly the only option.
- **Full file paths.** `C:/dev/Projects/...` not `foo/bar.ts`.
- **No em dashes (repeating because it's that important).**
- **Local-first.** No API costs. Local LLM (ollama). Local embedder. Local vector store. No cloud services.
- **Sellability matters.** The user mentioned wanting to sell this. Decisions should consider product polish, not just personal hack.
- **Privacy matters.** All data local on `OTLCDEV` (the user's main machine).
- **Tailscale is the network perimeter** for any remote access.

---

## Important architectural choices

- **Replaced ChromaDB with in-process vector store.** Chroma's JS client requires a Python server, too heavy. We use a 200-line `VectorStore` class. Swap point if we ever outgrow it: `07-daemon/src/store/vector-store.ts`.
- **Local LLM via ollama.** Default model `qwen3:8b`, fallback `qwen2.5:7b-instruct`. Set via `DEVNEURAL_OLLAMA_MODEL` env.
- **MiniLM embedder.** `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`, 384-dim. Models cached at `c:/dev/data/skill-connections/models/`.
- **SQLite + FTS5** via `better-sqlite3` for metadata and keyword search.
- **Wiki is git-versioned markdown on disk.** Every ingest auto-commits. Every page is hand-readable.
- **Hooks lazy-spawn the daemon.** Don't need to start it manually after install.
- **Five-layer self-loop guards** prevent the daemon from observing its own LLM-driven sessions.

---

## Open questions / pending decisions

These are real choices the user has not yet made:

1. **Phase 3 dashboard: when to start?** Phase 2 burndown is done. User has not explicitly authorized starting Phase 3 build.
2. **Project status board (Kanban):** added to Phase 3 dashboard scope as the replacement for monday. Stage source of truth stays `devneural.jsonc`. Confirm scope before building.
3. **Self-update mechanism** for the daemon. Currently: `git pull && npm install && npm run build`. Could automate. Deferred to Phase 3 polish.
4. **Telemetry from friends' installs** if user ever distributes this. Earlier conversation: user disregarded the "send to a friend" angle and reframed as "documentation must be reconstructable." Telemetry is therefore not in scope.
5. **Reference-corpus image processing:** tesseract default vs vision-model upgrade. Phase 3 spec defaults to tesseract; vision is opt-in.
6. **Daily brief generator:** local Qwen vs hybrid (Haiku for the brief only). User committed to local-only; default Qwen.

---

## Where to read what

| If you need to | Read |
|---|---|
| Understand the system | `docs/spec/devneural-v2.md` |
| Understand the wiki schema the LLM follows | `docs/spec/DEVNEURAL.md` |
| Install the system | `INSTALL.md` then `docs/install/04-step-by-step.md` |
| Recover from a bad state | `docs/install/06-recovery-and-reconstruction.md` |
| Fix a specific symptom | `docs/install/07-troubleshooting.md` |
| Design phase 3 (dashboard) | `docs/spec/phase-3-dashboard.md` |
| Design phase 4 (orb) | `docs/spec/phase-4-orb.md` |
| Run phase 5 (settings audit) | `docs/spec/phase-5-settings-audit.md` |
| Read the daemon code | `07-daemon/src/` |
| Run the daemon | `cd 07-daemon && npm run setup` then `npm run start` (or just let it lazy-start) |
| Check daemon health | `cd 07-daemon && npm run status` |

---

## How the user works (style notes)

- Types fast, doesn't always proofread. Treat typos as obvious; don't ask for clarification on simple ones.
- When pushing back, often uses "you know what?" or "actually" or "wait." Match the energy.
- Frustration cues: "im asking a simple fucking question," "dont be lazy," "just do it." When you see these, you've been verbose or evasive. Trim and act.
- Approval cues: "yeah," "ok," "go," "do it," "perfect." These authorize action.
- "Move on" / "next" = proceed to the next phase or step without ceremony.
- "Lets keep talking" = no action yet, conversation mode.
- "Dont build yet" / "table that" = capture in a doc, do not implement.
- The user often pastes content from other sessions or sources. Treat pasted content as input, not as the user's authoring.

---

## Known gotchas

- **Windows `kill $!` in bash does NOT kill node.exe.** It kills the bash subshell. Use `taskkill /F /PID <pid>` instead. I orphaned daemons twice doing this.
- **CLAUDE_CODE_ENTRYPOINT** can be `claude-vscode` (we added this to the allowed list). Don't remove it.
- **Hook output to stdout becomes additional context** in Claude. Anything you write to stdout from `hook-runner.ts` ends up in the prompt. Be careful.
- **Daemon log can grow forever.** No rotation in v1. Manually truncate if it gets huge. Phase 3 should add rotation.
- **Wiki git auto-commit** runs on every ingest. If something breaks the wiki repo (manual edit, merge conflict), every subsequent ingest fails the commit step but the page write still succeeds. Check `daemon.log` for git errors.
- **Initial corpus seed** runs in background on first daemon launch IF ollama is configured AND not already seeded. State at `c:/dev/data/skill-connections/corpus-seed.state.json`. Force re-run with `POST /reseed`.

---

## What's NOT done that some might expect

- **Dashboard:** spec only, no code (Phase 3).
- **Orb rebind:** spec only, old v1 orb code unchanged (Phase 4).
- **05-voice-interface:** untouched, will reshape in a later phase.
- **06-notebooklm-integration:** untouched, will reshape in a later phase.
- **Reference corpus (PDFs/images/audio/video):** spec'd in Phase 3, no code.
- **Session bridge (09-bridge):** spec'd in Phase 3, no code.
- **PWA/mobile:** spec'd in Phase 3, no code.
- **Web push notifications:** spec'd in Phase 3, no code.
- **Tailscale wiring:** prereq documented, daemon does not bind `0.0.0.0` yet (Phase 3 changes that).
- **Autostart on Windows boot:** documented as manual Task Scheduler entry; Phase 3 will provide a polished option.

---

## How to start the next session productively

1. Read this file.
2. Read the most recent commit message (`git log -1`) to see what just happened.
3. If the user hasn't given direction yet, ask "Phase 2 burndown next, correct?" and wait.
4. If the user gives a direction, follow it. Don't re-litigate the spec.

---

*Michael Collins. Stay on the level.*
