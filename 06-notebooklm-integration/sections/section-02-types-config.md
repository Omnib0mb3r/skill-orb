# Section 02: Types and Config

## Overview

This section creates two foundational files that every other component depends on:

- `src/types.ts` — all shared TypeScript interfaces for the module
- `src/config.ts` — Zod-validated config loader with environment variable support

**Depends on:** section-01-setup (project scaffold, `package.json`, `tsconfig.json`, `vitest.config.ts`, and directory structure must exist)

**Blocks:** section-03-log-reader, section-04-graph-reader, section-05-renderer, section-06-generator, section-07-writer

---

## Files to Create

```
06-notebooklm-integration/src/types.ts
06-notebooklm-integration/src/config.ts
06-notebooklm-integration/tests/config.test.ts
```

---

## Tests First

File: `C:\dev\tools\DevNeural\06-notebooklm-integration\tests\config.test.ts`

Write these test stubs before implementing `config.ts`. Each test name maps directly to a specific behavior:

```
# Test: loadConfig returns valid config when all required fields present
# Test: loadConfig throws with descriptive message when vault_path is missing
# Test: loadConfig throws with descriptive message when data_root is missing
# Test: loadConfig applies defaults for optional fields (notes_subfolder, api_base_url, prepend_sessions, claude_model)
# Test: loadConfig throws when config file does not exist
# Test: loadConfig reads path from DEVNEURAL_OBSIDIAN_CONFIG env var when no arg provided
# Test: loadConfig throws when config JSON is malformed
# Test: config check throws with clear message when ANTHROPIC_API_KEY env var is missing
```

Each test should use a temporary in-memory JSON file (write to `os.tmpdir()`) so no on-disk config.json is required for CI. The `DEVNEURAL_OBSIDIAN_CONFIG` and `ANTHROPIC_API_KEY` tests should save and restore the relevant env vars using `beforeEach`/`afterEach` to avoid leaking state between tests.

---

## Implementation: `src/types.ts`

File: `C:\dev\tools\DevNeural\06-notebooklm-integration\src\types.ts`

This file has no runtime logic — it exports only TypeScript interfaces. No imports needed except any type-only imports if you choose to re-export from another module.

### Interfaces to define

**`ObsidianSyncConfig`** — the validated runtime config object:

```typescript
interface ObsidianSyncConfig {
  vault_path: string;           // Absolute path to Obsidian vault root (required)
  notes_subfolder: string;      // Default: "DevNeural/Projects"
  data_root: string;            // Path to DevNeural data root (required)
  api_base_url: string;         // Default: "http://localhost:3747"
  prepend_sessions: boolean;    // Default: true
  claude_model: string;         // Default: "claude-haiku-4-5-20251001"
}
```

**`LogEntry`** — one line of a JSONL session log (from 01-data-layer):

Fields used downstream: `timestamp`, `project`, `source_node`, `target_node`, `connection_type`, `stage`, `tags`. The `tool_input` field contains tool-specific data and should be typed as `Record<string, unknown>` to avoid over-constraining. Define the full interface here rather than importing from 01-data-layer (that module is not a formal package dependency).

```typescript
interface LogEntry {
  timestamp: string;
  project: string;
  source_node: string;
  target_node: string;
  connection_type: string;
  stage?: string;
  tags?: string[];
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}
```

**`ConnectionEvent`** — a source→target pair extracted from log entries:

```typescript
interface ConnectionEvent {
  source_node: string;
  target_node: string;
  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
  timestamp: string;
}
```

**`SessionData`** — the processed result of reading one day's log file:

```typescript
interface SessionData {
  date: string;                  // YYYY-MM-DD
  primary_project: string;       // Most-active project ID
  all_projects: string[];        // All project IDs that appeared
  entries: LogEntry[];           // All log entries for the date
  session_start: string;         // ISO 8601 UTC — earliest timestamp
  session_end: string;           // ISO 8601 UTC — latest timestamp
  connection_events: ConnectionEvent[];
}
```

**`GraphInsight`** — one insight derived from the graph for the active project:

```typescript
interface GraphInsight {
  type: 'new_connection' | 'high_weight' | 'weight_milestone';
  source_node: string;
  target_node: string;
  weight: number;
  raw_count: number;
  description: string;           // Plain English, e.g. "New connection: project:devneural → skill:obsidian-integration"
}
```

**`SessionSummary`** — the final structured output before rendering:

```typescript
interface SessionSummary {
  date: string;
  project: string;
  what_i_worked_on: string;      // AI-drafted, 2-4 sentences
  graph_insights: string[];      // From GraphInsight.description values
  lessons_learned: string;       // AI-drafted, 2-4 sentences
}
```

Export all interfaces. The module uses ESM (`"type": "module"`) so use `export interface` / `export type` syntax throughout.

---

## Implementation: `src/config.ts`

File: `C:\dev\tools\DevNeural\06-notebooklm-integration\src\config.ts`

### Dependencies

- `zod` (runtime validation)
- `node:fs` (reading the config file)
- `node:path` (resolving config path)
- Types from `./types.js` (use `.js` extension for NodeNext module resolution)

### Zod Schema

Define a Zod schema that mirrors `ObsidianSyncConfig`. Required fields: `vault_path` (non-empty string), `data_root` (non-empty string). Optional fields with defaults:

| Field | Default |
|-------|---------|
| `notes_subfolder` | `"DevNeural/Projects"` |
| `api_base_url` | `"http://localhost:3747"` |
| `prepend_sessions` | `true` |
| `claude_model` | `"claude-haiku-4-5-20251001"` |

Use `z.string().min(1)` for required string fields so empty strings are rejected.

### `loadConfig(configPath?: string): ObsidianSyncConfig`

Behavior:
1. Resolve the config file path: use `configPath` argument if provided, otherwise check `process.env.DEVNEURAL_OBSIDIAN_CONFIG`, otherwise fall back to `./config.json` relative to the module's directory (use `import.meta.url` + `path.resolve` for ESM-compatible `__dirname` equivalent).
2. Read the file synchronously with `fs.readFileSync`. If the file does not exist, throw with a message like: `Config file not found: <resolved_path>. Copy config.example.json and fill in vault_path and data_root.`
3. Parse the file contents as JSON. If `JSON.parse` throws, rethrow with a message like: `Config file is not valid JSON: <resolved_path>`.
4. Validate through the Zod schema. On `ZodError`, throw with a message that includes the first validation issue's path and message so the user knows exactly which field is wrong.
5. Return the validated and defaulted config object typed as `ObsidianSyncConfig`.

### `checkApiKey(): void`

A separate exported function (not part of `loadConfig`) that checks `process.env.ANTHROPIC_API_KEY`. If absent or empty, print the following to stderr and call `process.exit(1)`:

```
Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.
```

This function is called by the CLI entry point before loading config (section-08). It is tested in `config.test.ts` but lives in `config.ts` because it is part of the startup validation concern.

---

## Key Design Notes

**ESM imports:** All internal imports must use the `.js` extension even for `.ts` source files (NodeNext resolution requirement). For example: `import type { ObsidianSyncConfig } from './types.js'`.

**`import.meta.url` for `__dirname`:** In ESM, use the following pattern to get the directory of `config.ts` for the default config path fallback:

```typescript
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

**Zod error surfacing:** Do not swallow Zod errors. When validation fails, extract `error.errors[0]` and include both `error.errors[0].path.join('.')` and `error.errors[0].message` in the thrown error message so the user can identify the bad field without reading source code.

**No side effects on import:** `loadConfig` and `checkApiKey` are functions — calling them is explicit. The module must not execute any I/O or `process.exit` at import time.

---

## Acceptance Criteria

All eight tests in `tests/config.test.ts` pass with `vitest run`. The types file has no compilation errors. Downstream sections (03–07) can import from `./types.js` and `./config.js` without modification.
