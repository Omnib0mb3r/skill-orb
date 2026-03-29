# 04-session-intelligence — Spec

## Purpose

A SessionStart hook that fires when Claude Code opens a session, queries the DevNeural API for nodes connected to the current project, and injects a ranked list of relevant repos, skills, and tools into Claude's context — preventing duplicate work and surfacing cross-project patterns.

## Full Requirements Reference

See: `../requirements.md` — section "Claude Session Intelligence"

## Key Decisions (from interview)

- **Mechanism:** SessionStart hook in settings.json — fires automatically on every Claude Code session open
- **Language:** TypeScript / Node.js (or shell script calling the API)
- **Scope:** Must work globally across all projects (configured in global settings.json)

## What This Split Builds

1. **SessionStart hook script** — runs on every Claude Code session open:
   - Detects current project (CWD, git root, or project identifier from 01-data-layer)
   - Queries 02-api-server for connected nodes relevant to this project
   - Ranks results by connection weight
   - Formats recommendations as structured context for Claude

2. **Context formatting** — output that gets injected into Claude's session:
   - Surfaces relevant repos, skills, and tools with connection strength
   - Clear, concise format Claude can act on without noise
   - Handles graceful fallback when API server is not running

3. **Global settings.json wiring** — hook configuration that:
   - Works across all projects without per-project setup
   - Minimal startup overhead

## Interfaces

**Inputs:**
- Current session context (project path, CWD)
- REST API from 02-api-server (`/graph/subgraph?project=...`)

**Outputs:**
- Structured context string injected into Claude's session via hook mechanism

## Dependencies

**Needs from other splits:**
- 02-api-server: `GET /graph/subgraph` or similar endpoint
- 01-data-layer: project identification convention (how projects are keyed in weights.json)

**Provides to other splits:** Nothing (terminal consumer)

## Key Unknowns / Design Decisions for /deep-plan

- Exact Claude Code SessionStart hook payload and output format (how context gets injected)
- How to identify "current project" reliably (git remote URL? directory name? CLAUDE.md marker?)
- Ranking algorithm: weight-only vs. recency-weighted vs. frequency-weighted
- How much context to surface — too much is noise, too little misses the point
- Fallback behavior when API server is offline
- Whether the hook script is shell + curl or a compiled TypeScript binary
