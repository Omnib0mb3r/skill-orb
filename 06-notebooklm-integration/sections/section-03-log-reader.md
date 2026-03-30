# Section 03: Log Reader

## Overview

This section implements `src/session/log-reader.ts` and its test file `tests/log-reader.test.ts`. The log reader is responsible for parsing the raw JSONL activity logs produced by the 01-data-layer module and returning a structured `SessionData` object describing what happened in a given day's session.

**Dependencies:** section-01-setup (project scaffold), section-02-types-config (shared types and config). Both must be complete before starting this section.

**Blocks:** section-08-cli-integration (cannot wire the full pipeline until this is ready).

**Parallelizable with:** section-04-graph-reader, section-05-renderer, section-06-generator.

---

## Background

DevNeural's 01-data-layer hooks into Claude Code sessions and writes one JSON object per line to `<data_root>/logs/YYYY-MM-DD.jsonl`. Each line is a `LogEntry`. This module has no write-back responsibilities — it reads only.

The log reader:
1. Opens the JSONL file for the target date (default: today UTC)
2. Parses every line into a `LogEntry`
3. Derives which project was most active (by log entry count)
4. Calculates the session time window (earliest and latest timestamps)
5. Extracts `ConnectionEvent` objects for all four connection types: `project->tool`, `project->skill`, `project->project`, and `tool->skill`
6. Returns a fully populated `SessionData`, or `null` if the log file is absent

---

## Interfaces (from `src/types.ts` — section-02)

These types are defined in section-02 and imported here. Do not redefine them.

```typescript
interface LogEntry {
  timestamp: string;          // ISO 8601 UTC
  project: string;            // bare project ID, e.g. "github.com/Omnib0mb3r/DevNeural"
  source_node: string;        // e.g. "project:github.com/Omnib0mb3r/DevNeural"
  target_node: string;        // e.g. "tool:Bash" or "skill:typescript"
  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
  stage?: string;
  tags?: string[];
  tool_name?: string;         // populated for tool-use events
  tool_input?: Record<string, unknown>;  // raw tool input payload
}

interface ConnectionEvent {
  source_node: string;
  target_node: string;
  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
  timestamp: string;
}

interface SessionData {
  date: string;                  // YYYY-MM-DD
  primary_project: string;       // Most-active project ID (bare, no prefix)
  all_projects: string[];        // All project IDs that appeared in logs (deduplicated)
  entries: LogEntry[];           // All log entries for the date
  session_start: string;         // ISO 8601 UTC — earliest timestamp
  session_end: string;           // ISO 8601 UTC — latest timestamp
  connection_events: ConnectionEvent[];
}
```

---

## Files to Create

### `tests/fixtures/sample-session.jsonl`

Create a fixture JSONL file used across log-reader tests. It must contain at least:
- Multiple entries for a single primary project (to test frequency detection)
- At least one entry for a secondary project (to test `all_projects` deduplication)
- Entries covering all four `connection_type` values
- A spread of timestamps (earliest and latest clearly distinguishable)
- Some entries with `tool_input` containing a `file_path` key (for later use by section-06 generator tests — not parsed by log-reader itself, but having it in the fixture avoids creating a second fixture)

Example shape for one line (exact values are up to the implementer):

```json
{"timestamp":"2025-10-01T09:00:00Z","project":"github.com/user/devneural","source_node":"project:github.com/user/devneural","target_node":"tool:Bash","connection_type":"project->tool","tool_name":"Bash","tool_input":{"command":"npm test"}}
```

A fixture of 8-12 lines is sufficient. Save it at `tests/fixtures/sample-session.jsonl`.

The tests should import or reference the fixture path as an absolute path resolved via `import.meta.url` (ESM pattern), e.g.:

```typescript
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'sample-session.jsonl');
```

---

### `tests/log-reader.test.ts`

Write this file **before** implementing `log-reader.ts`. All tests should fail initially against a stub that throws `"not implemented"`.

**Test stubs (one `it()` per line):**

```
readSessionLog returns null when JSONL file does not exist for the given date
readSessionLog parses all log entries from the multi-line fixture
readSessionLog identifies primary_project as the most-frequently-appearing project ID
readSessionLog calculates session_start and session_end from first and last timestamps
readSessionLog includes all four connection_type values in connection_events
readSessionLog returns all_projects as a deduplicated list of all project IDs seen
readSessionLog handles a single-line JSONL (one log entry)
readSessionLog handles an empty JSONL file (returns SessionData with empty arrays, not null)
```

Notes on specific tests:
- **null on missing file**: pass a date that has no corresponding fixture file (e.g., `"1970-01-01"`). Expect the return value to be `null`. Also verify that something is written to stderr (use `vi.spyOn(process.stderr, 'write')` or spy on `console.warn`).
- **primary_project**: the fixture must have more entries for one project than any other. Assert the most-frequent project ID is returned.
- **session_start / session_end**: assert they equal the exact ISO strings from the fixture's earliest and latest entries.
- **all four connection types**: assert `connection_events` contains at least one event of each type.
- **empty JSONL**: write an empty file to a temp directory and pass its date. Expect a `SessionData` with `entries: []`, `connection_events: []`, `all_projects: []`. The `primary_project` should be an empty string `""` (or a defined sentinel — pick one and document it in a comment).

---

### `src/session/log-reader.ts`

**Exported function signature:**

```typescript
export async function readSessionLog(
  date: string,          // YYYY-MM-DD
  dataRoot: string       // absolute path to the DevNeural data root
): Promise<SessionData | null>
```

**Implementation notes:**

1. Construct the log file path as `path.join(dataRoot, 'logs', `${date}.jsonl`)`.
2. Check for file existence using `fs.existsSync()` (or a try/catch on `fs.readFileSync`). If absent, `console.warn` to stderr and return `null`.
3. Read the file with `fs.readFileSync(logPath, { encoding: 'utf-8' })`.
4. Split on newlines, filter out empty lines, parse each line with `JSON.parse()`. Lines that fail to parse should be skipped with a `console.warn` (do not throw).
5. Derive `primary_project`:
   - Count occurrences of each `entry.project` value
   - Return the key with the highest count
   - If tie: any of the tied projects is acceptable (document with a comment)
6. Derive `all_projects`: `[...new Set(entries.map(e => e.project))]`
7. Derive `session_start` / `session_end`: sort entry timestamps lexicographically (ISO strings sort correctly), take first and last.
8. Derive `connection_events`: map each entry to a `ConnectionEvent` — include ALL entries, not just those with recognized `connection_type` values. The `connection_type` field on `ConnectionEvent` uses `string` as its fallback union member to accommodate forward-compatibility.

**Important — connection type note from the plan:** All four connection types must be captured, including `tool->skill`. The 01-data-layer writes `tool->skill` events where `source_node` starts with `tool:` and `target_node` starts with `skill:`. Make sure the fixture includes at least one such line, and that the function does not filter by `connection_type` value.

**Stub to write first (before tests pass):**

```typescript
export async function readSessionLog(
  date: string,
  dataRoot: string
): Promise<SessionData | null> {
  throw new Error('not implemented');
}
```

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Log file does not exist | `console.warn` to stderr, return `null` |
| Line fails `JSON.parse` | `console.warn` the line number, skip the line, continue |
| File read throws (permissions, etc.) | Let the error propagate — this is unexpected and should surface |

The CLI entry point (section-08) wraps the call and handles a `null` return with a helpful user message. Log-reader itself only needs to return `null` — it does not `process.exit()`.

---

## Acceptance Criteria

All eight tests in `tests/log-reader.test.ts` pass with `vitest run`. The function is exported as a named export from `src/session/log-reader.ts`. The fixture file exists at `tests/fixtures/sample-session.jsonl` and covers all four connection types.

## Implementation Notes

- Files created: `src/session/log-reader.ts`, `tests/log-reader.test.ts`
- All 8 tests pass (16 total with config tests)
- Uses `fs/promises` (`access` + `readFile`) for true async I/O
- Timestamp sort uses `new Date().getTime()` comparator for timezone safety
- `connection_events` maps ALL entries per spec (no filtering by type)
