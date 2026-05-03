# 01-data-layer — Spec

## Purpose

MVP foundation. A TypeScript connection logger that intercepts Claude Code hook events and maintains a persistent weighted dependency graph in a shared data directory accessible to all projects.

## Full Requirements Reference

See: `../requirements.md` — sections "Connection Logger" and "Weights & Metadata Layer"

## Key Decisions (from interview)

- **Language:** TypeScript / Node.js
- **This is the MVP** — must work standalone before anything else is built
- **Hook interception:** Both Claude Code hooks (PostToolUse etc. in settings.json) AND skill invocation wrappers
- **Shared data root:** `C:\dev\data\skill-connections\` — lives outside this repo so all projects can write to it

## What This Split Builds

1. **Connection logger** (`src/logger/`) — TypeScript module that:
   - Receives hook event payloads (tool name, project path, session ID, timestamp)
   - Normalizes events into a canonical log entry format
   - Appends structured JSON log entries to `C:\dev\data\skill-connections\logs\`
   - Updates connection weights in `weights.json`

2. **JSON schema** — versioned schema for:
   - Log entry format: `{ timestamp, project, skill/tool name, session ID, connection type }`
   - weights.json structure: connection strengths (0–10 scale) per project/skill/tool pair, with schema version field

3. **Hook wiring** — settings.json hook configuration that:
   - Fires PostToolUse (and other relevant hooks) and calls the logger
   - Lightweight — no impact on session startup time
   - Works globally across all projects

## Interfaces

**Inputs:**
- Claude Code hook event payloads (PostToolUse, skill invocations)
- Hook payload format from Claude Code settings.json hooks documentation

**Outputs:**
- `C:\dev\data\skill-connections\logs\<date>.jsonl` — append-only log files
- `C:\dev\data\skill-connections\weights.json` — connection weight map (read by all other splits)

## Dependencies

**Needs from other splits:** None — this is the foundation.

**Provides to other splits:**
- Shared data root location and schema (02-api-server, 06-notebooklm-integration)
- Log format specification (all consumers)
- weights.json schema (02-api-server, 04-session-intelligence)

## Key Unknowns / Design Decisions for /deep-plan

- Exact Claude Code hook payload format (what fields are available in PostToolUse, skill hooks)
- Weight update strategy: simple increment vs. decay function vs. recency-weighted average
- Log rotation strategy for long-running installs
- Whether weights.json should be updated synchronously or via a separate aggregation step
- How to identify "project" from hook context (CWD? git remote? CLAUDE.md?)
