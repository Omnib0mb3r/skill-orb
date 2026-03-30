# Implementation Plan: 06-obsidian-sync

> **Module rename note:** The directory is `06-notebooklm-integration` but the module is being built as `06-obsidian-sync`. The directory rename is a cosmetic cleanup deferred to a later session.

---

## What We're Building

A CLI tool that generates a structured session summary from DevNeural's data and appends it as a markdown note to the user's Obsidian vault. The goal is to build a "second brain" — as the user works across projects, DevNeural accumulates connection data (tools used, skills applied, project relationships), and this module synthesizes that data into human-readable notes stored where the user can access and reflect on them.

The key insight is that DevNeural already captures *what happened* (logs + weights). This module adds *what it means* — a narrative layer via the Claude API on top of raw signal data.

---

## Context: Where This Fits in DevNeural

DevNeural is a graph-based session intelligence system. Its data pipeline:

1. **01-data-layer** — hooks into Claude Code sessions, logging every tool use to JSONL files and maintaining a weighted connection graph in `weights.json` (edges between projects, tools, and skills)
2. **02-api-server** — serves the graph via REST API; rebuilds in-memory index on weights.json changes
3. **03-web-app** — 3D visualization of the graph
4. **04-session-intelligence** — queries the API at session start to inject context into Claude
5. **05-voice-interface** — voice query layer over the graph

**06-obsidian-sync** is a terminal consumer — it reads from 01 and 02 and writes outward to the user's Obsidian vault. It does not write back into DevNeural's data store.

---

## Architecture Overview

The module has five logical components wired together by a single CLI entry point:

```
src/
  generate-summary.ts     ← CLI entry point (main)
  config.ts               ← Config loading and validation
  session/
    log-reader.ts         ← Reads today's JSONL log
    graph-reader.ts       ← Reads graph for insights (API with file fallback)
  summary/
    generator.ts          ← Calls Claude API to synthesize narrative
    renderer.ts           ← Renders SessionSummary to Obsidian markdown
  obsidian/
    writer.ts             ← Reads/writes project files in vault
  types.ts                ← Shared TypeScript interfaces
tests/
  config.test.ts
  log-reader.test.ts
  graph-reader.test.ts
  generator.test.ts
  renderer.test.ts
  writer.test.ts
```

Module format: ESM (`"type": "module"`, NodeNext tsconfig). Follows the pattern established by 02-api-server and 05-voice-interface.

---

## Component 1: Configuration (`config.ts`)

The config file lives at `<module_dir>/config.json` by default. The path can be overridden via the `DEVNEURAL_OBSIDIAN_CONFIG` environment variable.

**Config schema (validated with Zod):**

```typescript
interface ObsidianSyncConfig {
  vault_path: string;           // Absolute path to Obsidian vault root (required)
  notes_subfolder: string;      // Default: "DevNeural/Projects"
  data_root: string;            // Path to DevNeural data root (same as DEVNEURAL_DATA_ROOT)
  api_base_url: string;         // Default: "http://localhost:3747"
  prepend_sessions: boolean;    // Default: true (newest session at top)
  claude_model: string;         // Default: "claude-haiku-4-5-20251001"
}
```

**Behavior:**
- `loadConfig(configPath?: string): ObsidianSyncConfig` — reads and validates the JSON file
- Throws with a clear message if required fields are missing or malformed
- Zod validation ensures all paths are non-empty strings

**Prerequisites:** The `ANTHROPIC_API_KEY` environment variable must be set before running the CLI. If missing, the Anthropic SDK will throw a non-descriptive error — the config loader should check for it explicitly and print `Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.` then exit 1.

---

## Component 2: Session Log Reader (`session/log-reader.ts`)

Reads the JSONL log for a given date from `<data_root>/logs/YYYY-MM-DD.jsonl`. Each line is a `LogEntry` as defined by 01-data-layer.

**Key responsibilities:**
- Parse all log entries for the target date (default: today UTC)
- Identify which project(s) were active (by frequency — the most-logged project is "primary")
- Determine session time window from first/last timestamps
- Extract the raw connection events for graph insight analysis

**Interface:**

```typescript
interface SessionData {
  date: string;                  // YYYY-MM-DD
  primary_project: string;       // Most-active project ID
  all_projects: string[];        // All project IDs that appeared in logs
  entries: LogEntry[];           // All log entries for the date
  session_start: string;         // ISO 8601 UTC — earliest timestamp
  session_end: string;           // ISO 8601 UTC — latest timestamp
  connection_events: ConnectionEvent[];  // source→target pairs with timestamps
}

interface ConnectionEvent {
  source_node: string;
  target_node: string;
  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
  timestamp: string;
}
```

**Connection type note:** The 02-api-server defines four connection types including `tool->skill` (per `02-api-server/src/graph/types.ts`). The log-reader must include `tool->skill` events in `connection_events` — not just the three project-centric types.

**Error handling:** If the log file doesn't exist (no DevNeural activity that day), return a null `SessionData` and log a warning to stderr. The CLI should print a helpful message and exit cleanly rather than crash.

---

## Component 3: Graph Reader (`session/graph-reader.ts`)

Queries the graph to extract insights relevant to the active project. Tries the 02-api-server REST API first; falls back to reading `weights.json` directly if the API is unreachable.

**API path:** `GET /graph/subgraph?project=<project_id>`
**Fallback:** Read `weights.json` directly and filter edges by `source_node` or `target_node` matching the project.

**Project ID prefix handling:** `weights.json` stores node IDs with the `project:` prefix (e.g., `project:github.com/Omnib0mb3r/DevNeural`). The `primary_project` from `SessionData` is a bare ID (without prefix). The graph-reader must compare against both forms: `source_node === 'project:' + projectId || source_node === projectId`.

**Key responsibilities:**
- Identify new connections formed today (edges where `first_seen` date = today)
- Identify connections that crossed a weight milestone today (approximated by: `last_seen` = today AND `raw_count` is a round number: 10, 25, 50, 100). **Known limitation:** this is a heuristic — an edge that was already at a round count and simply touched again today will appear as a false positive milestone. True milestone detection would require diffing against yesterday's weights.json, which is out of scope. Accept the approximation and note it in comments.
- Identify the top 3 highest-weight edges for the project
- Produce 2-4 plain-English insight strings from the above

**Interface:**

```typescript
interface GraphInsight {
  type: 'new_connection' | 'high_weight' | 'weight_milestone';
  source_node: string;
  target_node: string;
  weight: number;
  raw_count: number;
  description: string;           // Plain English — e.g. "New connection: project:devneural → skill:obsidian-integration"
}

function extractGraphInsights(
  projectId: string,
  date: string,
  config: ObsidianSyncConfig
): Promise<GraphInsight[]>
```

**Error handling:** If both API and direct file read fail, return an empty array and log a warning. The summary generator degrades gracefully — no graph insights section if none available.

---

## Component 4: Summary Generator (`summary/generator.ts`)

Uses the Anthropic SDK (`@anthropic-ai/sdk`) to call the Claude API and generate a session narrative from the structured session data and graph insights.

**What it sends to Claude:**
- The project identifier and today's date
- Session time window and number of connection events
- Deduplicated list of `tool_name` values from `LogEntry` (e.g., `["Bash", "Write", "Edit", "Read"]`)
- File paths touched: extracted from `tool_input.file_path` (for Read/Write/Edit) and `tool_input.path` (for Glob), deduplicated and truncated to the last path component for readability
- Skill nodes observed: target nodes from `connection_events` where `target_node.startsWith('skill:')`, stripped of the prefix
- The list of `GraphInsight` descriptions
- Instruction to produce: a `what_i_worked_on` paragraph, a `lessons_learned` paragraph

**What it does NOT send:**
- Raw log entry dumps (too verbose, and `tool_input` for Write operations contains full file contents — this would blow through token limits)
- Full tool_input payloads

**Interface:**

```typescript
interface SessionSummary {
  date: string;
  project: string;
  what_i_worked_on: string;      // 2-4 sentence AI-drafted paragraph
  graph_insights: string[];      // From graph reader — 2-4 bullet strings
  lessons_learned: string;       // 2-4 sentence AI-drafted paragraph
}

async function generateSummary(
  sessionData: SessionData,
  insights: GraphInsight[],
  config: ObsidianSyncConfig
): Promise<SessionSummary>
```

**Prompt design:** The system prompt establishes the context (DevNeural is a tool-use tracker; the user is a developer; these notes are for their personal Obsidian second brain). The user message provides the structured data. The model is asked to respond in JSON matching the `SessionSummary` shape (minus `date` and `project` which are filled in by the caller).

**Model:** Configurable via `config.claude_model`. Default: `claude-haiku-4-5-20251001` (fast and cheap for summary generation; can override to `claude-sonnet-4-6` for richer output). Note: `max_tokens: 1024` is sufficient for two short paragraphs.

**Error handling:** If the API call fails, return a minimal `SessionSummary` with placeholder text in the generated fields. Don't crash the CLI — the user still wants the note written even if AI generation fails.

---

## Component 5: Renderer (`summary/renderer.ts`)

Pure function — takes a `SessionSummary` and renders it as a markdown string ready to insert into an Obsidian file.

**Output format:**

```markdown
## Session: YYYY-MM-DD

### What I worked on
{what_i_worked_on paragraph}

### Graph insights
- {insight 1}
- {insight 2}
- {insight 3}

### Lessons learned
{lessons_learned paragraph}

<!-- USER NOTES: Add your own reflections here -->

---
```

If `graph_insights` is empty (reader returned none), the entire "Graph insights" section is omitted.

The rendered string always ends with a `---` horizontal rule so sessions are visually separated in the Obsidian file.

---

## Component 6: Obsidian Writer (`obsidian/writer.ts`)

Manages reading and writing the per-project markdown file in the Obsidian vault.

**File path:** `<vault_path>/<notes_subfolder>/<project-slug>.md`

Project slug derived from the project ID:
1. Strip `project:` prefix if present
2. Extract the last path component (split on `/` and `\` for Windows paths)
3. Lowercase the result always (Obsidian is case-sensitive on some platforms)
4. Collision handling: if two different project IDs reduce to the same last component (e.g., `github.com/user/tools` and `c:/dev/tools`), use `<penultimate>-<last>` form instead (e.g., `user-tools` and `dev-tools`)

Examples: `github.com/Omnib0mb3r/DevNeural` → `devneural`, `c:/dev/tools/DevNeural` → `devneural` (collision would disambiguate to `tools-devneural` and `devneural` respectively if needed)

**Write behavior:**
- If the file doesn't exist: create it with a `# <project-slug>` heading, a `<!-- DEVNEURAL_SESSIONS_START -->` marker on the next line, then the session entry
- If the file exists: first check if `## Session: YYYY-MM-DD` already exists — if yes, print `Session for YYYY-MM-DD already exists in <path>. Use --force to overwrite.` and exit 0 (idempotent by default)
- If the file exists and `prepend_sessions = true`: insert the new session block immediately after `<!-- DEVNEURAL_SESSIONS_START -->`. If the marker doesn't exist (manually created file), insert after the first heading line.
- If the file exists and `prepend_sessions = false`: append to the end of the file
- All file reads and writes use `{ encoding: 'utf-8' }` explicitly
- Parent directories are created if missing (`fs.mkdirSync({ recursive: true })`)

**Interface:**

```typescript
function writeSessionEntry(
  summary: SessionSummary,
  rendered: string,
  config: ObsidianSyncConfig
): void
```

Synchronous — no async needed for a single file write. Uses Node's `fs` module directly (no `write-file-atomic` needed here; Obsidian vault is not a shared database, and lost writes are not critical).

---

## CLI Entry Point (`generate-summary.ts`)

The main script that wires everything together. Parses CLI arguments, calls each component in sequence, and prints a confirmation or error message.

**CLI interface:**

```
Usage: node dist/generate-summary.js [options]

Options:
  --date YYYY-MM-DD    Generate summary for a specific date (default: today UTC)
                       Note: dates are UTC — run with --date $(date -u +%Y-%m-%d) on Linux/Mac
                       to use your local date if you work past midnight UTC
  --project <name>     Override project detection
  --dry-run            Print generated markdown to stdout, don't write to vault
  --force              Overwrite existing session entry for the same date
  --config <path>      Path to config.json (default: ./config.json)
  --help               Show this help

Required environment:
  ANTHROPIC_API_KEY    Anthropic API key for Claude summary generation
```

**Execution sequence:**
1. Parse args
2. Check `ANTHROPIC_API_KEY` is set; exit 1 with clear message if missing
3. Load and validate config
4. Read session log for target date → `SessionData | null`
5. If null (no log for that date), print message and exit 0
6. Read graph insights for primary project → `GraphInsight[]`
7. Generate session summary → `SessionSummary`
8. Render to markdown string
9. If `--dry-run`: print to stdout and exit
10. Write to Obsidian vault (wrapped in try/catch — print error and exit 1 on failure)
11. Print confirmation: `✓ Session note written: <full_path>`

**Exit codes:** 0 = success (including "no log found" and "session already exists" cases), 1 = config error, missing API key, or Obsidian write failure

---

## Data Contracts with Other Modules

### From 01-data-layer

Log file: `<data_root>/logs/YYYY-MM-DD.jsonl`
- Read-only; no writes back
- One `LogEntry` JSON object per line
- Fields used: `timestamp`, `project`, `source_node`, `target_node`, `connection_type`, `stage`, `tags`

### From 02-api-server (optional)

Endpoint: `GET /graph/subgraph?project=<project_id>`
- Returns `GraphResponse` with `nodes` and `edges` arrays
- Falls back to direct `weights.json` read if API is unreachable
- `weights.json` path: `<data_root>/weights.json`
- Fields used: `source_node`, `target_node`, `weight`, `raw_count`, `first_seen`, `last_seen`

---

## Package Configuration

**package.json key fields:**

```json
{
  "name": "devneural-obsidian-sync",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/generate-summary.ts",
    "test": "vitest run"
  }
}
```

**Dependencies:**
- `@anthropic-ai/sdk` — Claude API calls (production dependency, not devDependency)
- `zod` — config validation

**Build artifacts include:**
- `dist/` — compiled JS
- `config.example.json` — template config for first-time setup (copy to `config.json` and fill in `vault_path` and `data_root`)

**Dev dependencies:**
- `typescript`, `tsx`
- `vitest`
- `@types/node`

**tsconfig.json key settings:**
- `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- `target: "ES2022"`
- `strict: true`
- `outDir: "./dist"`

---

## Error Handling Strategy

Following the project-wide "never throws" pattern for I/O:

| Operation | On failure |
|-----------|-----------|
| Config load | Throw (fatal — user must fix config before running) |
| Log file read | Return null SessionData; CLI exits cleanly with message |
| Graph API call | Catch, fall back to file read; log warning |
| Graph file read | Catch, return empty insights array; log warning |
| Claude API call | Catch, return summary with placeholder text; log warning |
| Obsidian file write | Catch and rethrow (data loss risk — let it surface as error) |

---

## Testing Approach

All components are pure or near-pure functions — easy to unit test with fixture data.

**Unit tests:**
- `config.test.ts` — valid/invalid config shapes, missing fields, Zod errors
- `log-reader.test.ts` — parse real JSONL fixture, handle missing file, multiple projects, time window calculation
- `graph-reader.test.ts` — insight extraction logic with fixture graph data, API fallback logic (mock `fetch`)
- `generator.test.ts` — mock Anthropic SDK; verify prompt construction; test degraded output when API fails
- `renderer.test.ts` — snapshot test the markdown output for different `SessionSummary` shapes; test empty graph_insights omission
- `writer.test.ts` — temp dir fixture; test create-new-file, prepend, append, slug derivation, directory creation

**Integration test:**
- `generate-summary.integration.test.ts` — uses real fixture JSONL + weights.json files in a temp directory; mocks only the Claude API call; verifies the full pipeline produces a correctly formatted Obsidian file

---

## Build Order

The components have no circular dependencies. Build order for implementation:

1. `types.ts` — shared interfaces (no dependencies)
2. `config.ts` — Zod schema (depends on types)
3. `session/log-reader.ts` — file I/O (depends on types)
4. `session/graph-reader.ts` — API + file I/O (depends on types, config)
5. `summary/renderer.ts` — pure string rendering (depends on types)
6. `summary/generator.ts` — Claude API (depends on types, config)
7. `obsidian/writer.ts` — file I/O (depends on types, config, renderer)
8. `generate-summary.ts` — wires everything (depends on all above)

Tests for each component can be written alongside it (TDD pattern).
