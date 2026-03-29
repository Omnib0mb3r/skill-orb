# Section 04: Logger

## Overview

This section implements the logger module — the component responsible for constructing log entries and writing them to daily append-only JSONL files. It has no dependencies on other non-foundation sections (config, identity, weights) and can be implemented in parallel with sections 02, 03, and 05.

**Dependency:** Requires `section-01-foundation` (types and project scaffold) to be complete.

**Blocks:** `section-06-hook-runner` depends on this section.

---

## Files to Create

- `src/logger/types.ts` — re-exports `LogEntry` type from the shared types
- `src/logger/index.ts` — the three logger functions
- `tests/logger.test.ts` — full test suite (7 tests)

---

## Tests First

Write these tests in `tests/logger.test.ts` before implementing. All tests use a temp directory fixture as `dataRoot`. Create the temp dir in `beforeEach` and remove it in `afterEach`.

### `getLogFilePath`

**Test: produces correct filename for a given date**
- Call `getLogFilePath(dataRoot, new Date('2026-03-28T15:30:00Z'))`
- Expected result: `<dataRoot>/logs/2026-03-28.jsonl`
- Verify the path string ends with the correct filename and uses the correct base directory

### `buildLogEntry`

**Test: sets `schema_version: 1`**
- Call `buildLogEntry(...)` with any valid arguments
- Assert `entry.schema_version === 1`

**Test: `project→tool` connection type sets correct nodes**
- Pass `connectionType: 'project→tool'`, `sourceNode: 'project:github.com/user/repo'`, `targetNode: 'tool:Bash'`
- Assert `entry.connection_type === 'project→tool'`
- Assert `entry.source_node === 'project:github.com/user/repo'`
- Assert `entry.target_node === 'tool:Bash'`

**Test: `project→skill` connection type sets correct nodes**
- Pass `connectionType: 'project→skill'`, `sourceNode: 'project:github.com/user/repo'`, `targetNode: 'skill:gsd:execute-phase'`
- Assert `entry.connection_type === 'project→skill'`
- Assert `entry.target_node === 'skill:gsd:execute-phase'`

**Test: `project→project` connection type sets correct nodes**
- Pass `connectionType: 'project→project'`, `sourceNode: 'project:github.com/user/a'`, `targetNode: 'project:github.com/user/b'`
- Assert `entry.connection_type === 'project→project'`

**Test: copies fields from payload**
- Build a minimal `HookPayload` stub with known `session_id`, `tool_use_id`, `tool_name`, `tool_input`
- Assert the resulting entry copies all four fields exactly

**Test: `timestamp` is ISO 8601 UTC string**
- Assert `new Date(entry.timestamp).toISOString() === entry.timestamp` (round-trips cleanly)
- Assert the string ends with `'Z'`

### `appendLogEntry`

**Test: creates `logs/` directory if it doesn't exist**
- Start with a fresh `dataRoot` that has no `logs/` subdirectory
- Call `appendLogEntry(entry, dataRoot)`
- Assert the `logs/` directory now exists and the file was created

**Test: writes a valid JSON line terminated with `\n`**
- Call `appendLogEntry(entry, dataRoot)` once
- Read the file back
- Assert the content ends with `\n`
- Assert `JSON.parse(line)` succeeds without throwing
- Assert the parsed object has `schema_version: 1`

**Test: appends to existing file without overwriting**
- Call `appendLogEntry` twice with different entries (use a different `tool_name` on the second)
- Read the file back
- Assert there are exactly two lines (split on `\n`, filter empty)
- Assert the first line's `tool_name` and second line's `tool_name` are both present

**Test: written JSON deserializes to a valid `LogEntry` shape**
- Write one entry, read it back, parse it
- Assert all required fields are present: `schema_version`, `timestamp`, `session_id`, `tool_use_id`, `project`, `project_source`, `tool_name`, `tool_input`, `connection_type`, `source_node`, `target_node`

**Test: logs to stderr and does not throw when write fails**
- Point `dataRoot` to a path where writing is impossible (e.g., use a file path as `dataRoot` so `logs/` subdir creation fails, or make the logs dir a file not a directory)
- Call `appendLogEntry(entry, dataRoot)` — should not throw
- Optionally assert stderr received a message (capture via `vi.spyOn(console, 'error')` or spy on `process.stderr`)

---

## Implementation Details

### `src/logger/types.ts`

Re-export the `LogEntry` interface. In `section-01-foundation` the core types are defined in a shared types file. This file exists so that consumers can import from `'./logger'` rather than navigating to a root types file.

```typescript
export type { LogEntry } from '../types';
```

If the types are defined inline in `src/logger/types.ts` (rather than a shared root), define `LogEntry` here directly. Either approach is fine — be consistent with whatever `section-01-foundation` established.

### `src/logger/index.ts`

Three exported functions. Keep them small — each has a single responsibility.

#### `getLogFilePath(dataRoot: string, date?: Date): string`

- `date` defaults to `new Date()` when not provided
- Format the date as `YYYY-MM-DD` using UTC methods (`date.getUTCFullYear()`, `date.getUTCMonth()`, `date.getUTCDate()`) — do NOT use `toLocaleDateString()` or locale-sensitive methods
- Return `path.join(dataRoot, 'logs', '<YYYY-MM-DD>.jsonl')`
- This is a pure function — no I/O

```typescript
export function getLogFilePath(dataRoot: string, date?: Date): string
```

#### `buildLogEntry(payload, identity, connectionType, sourceNode, targetNode): LogEntry`

- Pure function — no I/O, no async
- Constructs and returns a `LogEntry` by combining the payload, resolved identity, and connection metadata
- `timestamp` is `new Date().toISOString()` — current UTC time at moment of call
- `project` comes from `identity.id`
- `project_source` comes from `identity.source`
- `schema_version` is always `1`

```typescript
export function buildLogEntry(
  payload: HookPayload,
  identity: ProjectIdentity,
  connectionType: ConnectionType,
  sourceNode: string,
  targetNode: string
): LogEntry
```

#### `appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void>`

- Serializes the entry as `JSON.stringify(entry) + '\n'`
- Calls `getLogFilePath(dataRoot)` to determine target path (uses current date)
- Creates `<dataRoot>/logs/` recursively with `fs.promises.mkdir({ recursive: true })` before writing
- Appends using `fs.promises.appendFile(filePath, line, 'utf8')`
- The append is atomic at the kernel level for entries under ~4KB. Entries from `Write` tool calls may be larger — this is accepted for MVP
- The entire function body (including mkdir) is wrapped in try/catch — on any error, call `console.error('[DevNeural] logger error:', err.message)` and return. Never throw, never rethrow.

```typescript
export async function appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void>
```

---

## The `LogEntry` Type (Reference)

This is the interface this module works with. It is defined in `section-01-foundation` — do not redefine it here, just import it.

```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;                       // ISO 8601 UTC
  session_id: string;                      // from hook payload
  tool_use_id: string;                     // unique per tool invocation
  project: string;                         // canonical project identifier
  project_source: ProjectSource;           // 'git-remote' | 'git-root' | 'cwd'
  tool_name: string;                       // from hook payload
  tool_input: Record<string, unknown>;     // from hook payload (full, no truncation)
  connection_type: ConnectionType;         // 'project→tool' | 'project→skill' | 'project→project'
  source_node: string;                     // prefixed: "project:..."
  target_node: string;                     // prefixed: "tool:...", "skill:...", "project:..."
}
```

---

## The `HookPayload` Type (Reference)

The payload arriving on stdin. `buildLogEntry` copies `session_id`, `tool_use_id`, `tool_name`, and `tool_input` directly from this.

```typescript
interface HookPayload {
  hook_event_name: 'PostToolUse';
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
  transcript_path: string;
  permission_mode: string;
}
```

---

## The `ProjectIdentity` Type (Reference)

Comes from `section-03-identity`. `buildLogEntry` reads `identity.id` → `entry.project` and `identity.source` → `entry.project_source`.

```typescript
interface ProjectIdentity {
  id: string;
  source: ProjectSource;   // 'git-remote' | 'git-root' | 'cwd'
}
```

---

## Node.js API Notes

- Use `path.join` for all path construction — never string concatenation
- Use `fs.promises` (not `fs.writeFileSync`) for all I/O in this module
- The `'a'` flag is the default for `appendFile` — no need to specify it explicitly
- `mkdir` with `{ recursive: true }` is a no-op if the directory already exists — safe to call on every append

---

## Checklist

- [ ] `src/logger/types.ts` — re-exports `LogEntry`
- [ ] `src/logger/index.ts` — implements `getLogFilePath`, `buildLogEntry`, `appendLogEntry`
- [ ] `tests/logger.test.ts` — all 7 tests pass
- [ ] `appendLogEntry` never throws under any condition
- [ ] `buildLogEntry` is a pure function (no side effects)
- [ ] UTC date formatting used in `getLogFilePath` (not local time)
- [ ] `path.join` used for all path construction
