# DevNeural

> Your second brain. Local. Learning. Watching. Surfacing what matters when you need it.

DevNeural is a personal second brain for software work. It captures everything you do in Claude Code, builds a semantic search layer (RAG) over the raw record, compiles transferable insights into a maintained wiki, recommends relevant prior thinking to Claude in real time, learns from what actually works, and surfaces it all through a dashboard you can hit from anywhere via Tailscale.

It runs entirely on your own hardware. No API costs. No cloud. Your data never leaves your machine.

---

## What it is

A second brain has six properties. DevNeural has all six.

| Property | DevNeural |
|---|---|
| **Persistent memory** across sessions, projects, and time | Wiki + RAG layers stored locally, versioned in git |
| **Semantic recall** (you remember the shape of a problem, not the words) | Local embedder + vector search over wiki and raw transcripts |
| **Watches and learns without being asked** | Claude Code hooks + transcript watcher capture continuously |
| **Surfaces relevant prior thinking in real time** | At every prompt, the curator injects the most useful 600 tokens |
| **Compounds with use** | Reinforcement loop: useful injections strengthen, ignored ones decay |
| **Lives entirely on your hardware** | Local LLM (ollama), local embedder (ONNX), local vector store, local wiki |

---

## Capabilities at a glance

| Capability | What it does |
|---|---|
| **RAG layer** | Every transcript chunk and uploaded doc embedded into local vector store. Semantic recall by meaning, not keywords. |
| **Learning wiki** | LLM-compiled markdown pages following a `[trigger] → [insight]` schema. Edges are explicit cross-references. |
| **Recommendation engine** | At every Claude prompt, top-relevance page injected as additional context. Below threshold = silence. Better nothing than noise. |
| **Cross-project intelligence** | Insights observed in two or more projects promote to global. The brain spans your work, not one repo. |
| **Reference corpus** (Phase 3) | Upload manuals, books, PDFs, images, videos. Local OCR + transcription. Searchable second-brain knowledge. |
| **Reinforcement** | Useful injections raise page weight; corrections lower it; unused pages decay. Empirical, not editorial. |
| **Dashboard** (Phase 3) | Central hub. Sessions, projects, search, system metrics, daily brief, reminders, web push. PWA-installable on phone. Tailscale for remote access. |
| **Orb** (Phase 4) | 3D visualization of the concept graph. The "look at the cool thing" surface. |
| **Local-first** | Default LLM is ollama (qwen3:8b). Anthropic API supported as fallback. Zero cost in default config. |

---

## The two layers

DevNeural is built on two complementary layers. Neither alone is sufficient.

**Semantics layer (meaning-based).** Vector embeddings, cosine similarity, two-tier retrieval. This is what lets you recall by intent. "The warehouse layout decision" finds work where you didn't use those words.

**Logic layer (rules-based).** The structured `[trigger] → [insight]` page schema, validation gates on every LLM output, promotion criteria, reinforcement rules, hard editorial rules. This is what keeps the wiki from becoming a junk drawer.

Without semantics: a junk drawer of insights nobody can find. Without logic: a vector store of noise that scores high but means nothing. The combination is what makes the wiki a brain.

See [docs/spec/devneural-v2.md section 7](docs/spec/devneural-v2.md) for the full breakdown.

---

## Architecture

```
Claude Code session(s)
  ├─ hooks (Pre/Post/UserPromptSubmit/Stop) → hook-runner
  └─ transcripts → ~/.claude/projects/<slug>/<session>.jsonl
                        │
                        ▼
                  ┌─────────────────────────────────────────┐
                  │  07-daemon (long-running, lazy-spawned) │
                  │   capture → embed → ingest → query      │
                  │   reinforce → lint → reconcile          │
                  │   curate at UserPromptSubmit            │
                  └──┬──────────────┬──────────────┬────────┘
                     │              │              │
              POST /api/chat    in-process    on-disk
                     │              │              │
                     ▼              ▼              ▼
                ┌──────┐     ┌──────────┐   ┌──────────────┐
                │ollama│     │ Chroma + │   │ wiki/ + ref/ │
                │qwen3 │     │ SQLite   │   │ + git log    │
                └──────┘     │ FTS5     │   └──────────────┘
                             └──────────┘
                     ▲
              served at
                     │
              ┌──────────────────────────────────────┐
              │  08-dashboard (Phase 3, Next.js PWA)│
              │  - reachable via Tailscale          │
              │  - mobile-installable                │
              └──────────────────────────────────────┘
```

For the full architecture, read [docs/spec/devneural-v2.md](docs/spec/devneural-v2.md).
For the LLM's standing instructions on writing wiki pages, read [docs/spec/DEVNEURAL.md](docs/spec/DEVNEURAL.md).

---

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Daemon: capture, ingest, query, reinforce, lint, setup | done |
| 2 | v1 burndown: archive 01/02/04, kill monday sync, rewrite top-level docs | done |
| 3 | Central control dashboard | spec done, build queued |
| 4 | Orb rebind to wiki data model | spec done, deferred |
| 5 | Settings audit, finalizes personalized install docs | spec done, deferred |

See [docs/SESSION-HANDOVER.md](docs/SESSION-HANDOVER.md) for current state and what comes next.

---

## Install

Read [INSTALL.md](INSTALL.md). It points to detailed step-by-step docs under [docs/install/](docs/install/).

Short version:

```powershell
git clone https://github.com/Omnib0mb3r/DevNeural C:/dev/Projects/DevNeural
cd C:/dev/Projects/DevNeural/07-daemon
npm install
npm run setup
```

`setup` is idempotent. It creates the data root, scaffolds the wiki, verifies ollama, installs the four hooks in `~/.claude/settings.json` (with backup), and prints status. Re-run any time.

To check the state of the system at any point:

```powershell
npm run status
```

---

## Prerequisites

- Node 20+
- Git
- ollama with `qwen3:8b` (or `qwen2.5:7b-instruct`)
- VS Code (or any Claude Code-compatible editor)
- Claude Code CLI
- Tailscale (optional, required for Phase 3 remote dashboard)

Detailed setup at [docs/install/01-prerequisites.md](docs/install/01-prerequisites.md).

---

## Where things live

| Path | What |
|---|---|
| `07-daemon/` | The brain. Capture, ingest, query, lint, HTTP/WS API. |
| `03-web-app/` | The orb (Phase 4 rebind, currently the v1 visual). |
| `05-voice-interface/` | Voice query layer (reshapes later). |
| `06-notebooklm-integration/` | Obsidian sync (reshapes later). |
| `08-dashboard/` | Central control dashboard (Phase 3, not yet built). |
| `09-bridge/` | VS Code extension for session steering (Phase 3). |
| `archive/v1/` | v1 modules: 01-data-layer, 02-api-server, 04-session-intelligence. |
| `docs/spec/` | System architecture and phase plans. |
| `docs/install/` | Install, recovery, troubleshooting. |
| `INSTALL.md` | Top-level install entry point. |
| `start.bat` | Quick launcher for the daemon. |
| `devneural.jsonc` | Project metadata for DevNeural itself. |

---

## What's not here anymore

If you came from v1, the following are gone or moved:

- **monday.com sync.** The `/sync` endpoint returns `410 Gone`. Project status is going into the Phase 3 dashboard as a real Kanban board.
- **`01-data-layer/`** (PostToolUse weights tracker). Moved to `archive/v1/`. Replaced by capture in 07-daemon.
- **`02-api-server/`** (Fastify weights server). Moved to `archive/v1/`. Replaced by 07-daemon's HTTP surface.
- **`04-session-intelligence/`** (one-shot SessionStart context inject). Moved to `archive/v1/`. Replaced by per-prompt curator.
- **`requirements.md`, `project-manifest.md`, `devneural.md`, `deep_project_*`** at repo root. Moved to `archive/v1/`.

The orb in `03-web-app/` still references the old data model; it gets rebuilt in Phase 4.

---

## Why this exists

Because Claude forgets between sessions, and you forget between projects. Together you keep solving the same problems in slightly different ways. DevNeural is the persistent layer that makes both of you smarter at your actual work, while keeping every byte on your own machine.

---

## License

See `LICENSE`.

---

*Michael Collins. Stay on the level.*
