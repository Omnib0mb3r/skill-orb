# 06-obsidian-sync — Combined Specification

> **Note on naming:** This module was originally scoped as "notebooklm-integration". Through the interview, the concept was fundamentally redesigned. The directory remains `06-notebooklm-integration` for now but the module should be renamed `06-obsidian-sync` in a follow-up cleanup.

---

## Purpose

At the end of a dev session, generate a structured summary of what was worked on and push it as a markdown note to the user's **Obsidian vault** — building a "second brain" that accumulates knowledge, project context, and lessons learned over time.

DevNeural already captures *what tools and skills were used* in every session (via `weights.json` and JSONL logs). This module reads that data, synthesizes it into a human-readable session note, and writes it to the right place in Obsidian.

---

## Core Concept

```
DevNeural session ends
       ↓
User runs: node generate-summary.js
       ↓
06-obsidian-sync reads:
  - Today's JSONL log (what was used this session)
  - weights.json (graph insights: new/high-weight connections)
       ↓
Generates structured session summary:
  - Project(s) worked on
  - AI-drafted graph insights
  - AI-drafted lessons learned (+ placeholder for user notes)
       ↓
Writes/appends to Obsidian vault:
  <vault>/DevNeural/Projects/<project-name>.md
```

---

## What This Module Builds

### 1. Session Log Reader

Reads today's DevNeural JSONL log file to extract session-level data:
- Which project(s) were active (from `project` field in log entries)
- Session time window (first/last `timestamp` in today's log)
- What the session produced (summarized — not a raw tool list)

**Source:** `<dataRoot>/logs/YYYY-MM-DD.jsonl` (UTC date)

### 2. Graph Insight Extractor

Reads `weights.json` (directly or via `GET /graph` on 02-api-server) and extracts notable patterns:
- New connections formed this session (first_seen = today)
- Connections whose weight crossed a notable threshold (e.g. raw_count hit 10, 50, 100)
- Highest-weight edges for the active project(s)
- Any new nodes added to the graph today

**Output:** 2-4 bullet points of plain-English graph insights per project

### 3. Session Summary Generator

Uses the Claude API (`claude-sonnet-4-6` or equivalent) to synthesize a session narrative from the log reader and graph extractor output:

**Document sections:**
1. `## Session: YYYY-MM-DD` — date header for this session entry
2. `### What I worked on` — project name + brief AI-drafted description of session activity
3. `### Graph insights` — 2-4 bullets about notable DevNeural graph changes this session
4. `### Lessons learned` — AI-drafted observations about patterns, tools used, things discovered
5. `<!-- USER NOTES: Add your own reflections here -->` — blank placeholder for manual notes in Obsidian

### 4. Obsidian Writer

Writes the generated session entry to the user's Obsidian vault:
- **File path:** `<vault_path>/DevNeural/Projects/<project-name>.md`
- **Write mode:** Append — new sessions are prepended (newest first) or appended (oldest first) based on config
- **File creation:** Create the file and parent directories if they don't exist

### 5. CLI Interface

Single entry point: `node dist/generate-summary.js` (or `npx tsx src/generate-summary.ts` in dev)

**Behavior:**
1. Load config from `<module_dir>/config.json` (or `DEVNEURAL_OBSIDIAN_CONFIG` env var path)
2. Read today's session data
3. Generate summary via Claude API
4. Write to Obsidian vault
5. Print confirmation: `✓ Session written to <vault_path>/DevNeural/Projects/<project>.md`

**Optional flags:**
- `--date YYYY-MM-DD` — generate summary for a specific past date (not just today)
- `--dry-run` — print the generated markdown to stdout instead of writing to vault
- `--project <name>` — override project detection (useful if multiple projects were active)

### 6. Configuration

**File:** `<module_dir>/config.json` (or path set via `DEVNEURAL_OBSIDIAN_CONFIG`)

```json
{
  "vault_path": "/path/to/obsidian/vault",
  "notes_subfolder": "DevNeural/Projects",
  "data_root": "/path/to/devneural/data",
  "api_base_url": "http://localhost:3747",
  "prepend_sessions": true,
  "claude_model": "claude-sonnet-4-6"
}
```

- `vault_path`: Absolute path to Obsidian vault root (required)
- `notes_subfolder`: Subfolder within vault for DevNeural notes (default: `DevNeural/Projects`)
- `data_root`: Path to DevNeural data root (same as `DEVNEURAL_DATA_ROOT` — used if API not available)
- `api_base_url`: 02-api-server URL; if unreachable, fall back to direct file reads
- `prepend_sessions`: `true` = newest session at top of file; `false` = append at bottom
- `claude_model`: Claude model to use for summary generation

---

## Obsidian File Format

### File path
```
<vault>/DevNeural/Projects/<project-name>.md
```

Project name derived from the log entry `project` field (e.g. `github.com/mcollins/devneural` → `devneural`, or use the full canonical ID).

### File structure (example)

```markdown
# devneural

DevNeural project — AI-assisted developer tooling and graph-based session intelligence.

---

## Session: 2026-03-30

### What I worked on
Implemented the Obsidian sync module (06-obsidian-sync), including session log reading,
graph insight extraction, and Obsidian vault writing.

### Graph insights
- New connection formed: `project:devneural → skill:obsidian-integration` (first seen today)
- `project:devneural → tool:Write` reached weight 8.4 (raw count: 84) — heavily used this session
- `project:devneural → skill:typescript` remains the highest-weight skill connection at 9.1

### Lessons learned
The Obsidian vault structure benefits from per-project files rather than per-session files,
since it naturally groups all context for a given project in one place. The Claude API
summary generation adds meaningful narrative that raw log data alone cannot provide.

<!-- USER NOTES: Add your own reflections here -->

---

## Session: 2026-03-29

...
```

---

## Data Flow

```
INPUTS:
  <dataRoot>/logs/YYYY-MM-DD.jsonl   ← today's session log
  <dataRoot>/weights.json             ← graph state (or via 02-api-server REST)

PROCESSING:
  1. Parse log → extract project, timestamps, connection events
  2. Query graph → extract insights for active project(s)
  3. Call Claude API → generate session narrative
  4. Render markdown → format as Obsidian session entry

OUTPUTS:
  <vault>/DevNeural/Projects/<project-name>.md  ← appended/prepended session entry
  stdout confirmation message
```

---

## Dependencies

### From other splits
- **01-data-layer:** `weights.json` schema, JSONL log format (both documented in `claude-research.md`)
- **02-api-server (optional):** `GET /graph` and `GET /graph/subgraph?project=...` for graph queries; falls back to direct file reads if offline

### External
- `@anthropic-ai/sdk` — Claude API for session narrative generation
- Node.js stdlib (`fs`, `path`) — file I/O
- `zod` — config file validation (consistent with project pattern)

---

## Interfaces

### Input types

```typescript
interface SessionLogEntry {
  timestamp: string;
  project: string;
  connection_type: string;
  source_node: string;
  target_node: string;
  stage?: string;
  tags?: string[];
}

interface GraphInsight {
  type: 'new_connection' | 'weight_milestone' | 'high_weight';
  source: string;
  target: string;
  weight?: number;
  raw_count?: number;
  description: string;  // plain English
}
```

### Output types

```typescript
interface SessionSummary {
  date: string;            // YYYY-MM-DD
  project: string;         // project identifier
  what_i_worked_on: string; // AI-drafted paragraph
  graph_insights: string[];  // 2-4 bullet strings
  lessons_learned: string;   // AI-drafted paragraph
}
```

---

## Phase 2 (Deferred)

The following were scoped out of this phase by user decision — to be added later:

1. **Graph cluster analysis** — periodic reports of tightly-connected skill/tool clusters
2. **Skill recommendations** — surfaces underutilized skills based on betweenness centrality and co-occurrence gaps
3. **Obsidian MOC (Map of Content)** — auto-generated index linking all project notes and cluster reports

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| NotebookLM integration | **Removed** | No viable public API; agnostic markdown output is more durable |
| Trigger | **Manual CLI** | User wants explicit control; hooks can be added later |
| Note organization | **Per-project file** | Groups all project context in one place; natural Obsidian pattern |
| Session ordering | **Configurable** (default: prepend) | Newest-first matches typical journal/log reading pattern |
| LLM for summaries | **Claude API** | Already a project dependency via 05-voice-interface; consistent |
| API vs direct reads | **API with fallback** | Use 02-api-server if running; fall back to direct file reads if offline |
| Module format | **ESM (NodeNext)** | Consistent with 02, 03, 05 splits |

---

## TypeScript Module Conventions

Follows project-wide patterns (from `claude-research.md`):
- ESM module format (`"type": "module"`, NodeNext in tsconfig)
- Strict TypeScript (`strict: true`)
- Vitest for tests (`globals: false`, `environment: 'node'`)
- "Never throws" for I/O — catch, log to stderr with `[DevNeural]` prefix
- `zod` for config validation
- Build: `tsc` → `/dist`
- Dev: `tsx src/generate-summary.ts`
