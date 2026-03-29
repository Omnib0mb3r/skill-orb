# Section 06 — File Watcher and Event Buffer

## Overview

This section implements `src/watcher/index.ts`, which manages two chokidar v4 file watchers and an in-memory event buffer. It depends on Section 02 (`GraphNode`, `GraphEdge`, `InMemoryGraph`, `buildGraph`, and the re-declared `WeightsFile` and `LogEntry` types) and is consumed by Section 07 (server wiring).

The module's public interface is two functions: `startWatchers` and `stopWatchers`. All watcher state (chokidar instances, byte offsets, event buffer) is module-internal.

---

## Dependencies

- **Section 01** must be complete: project scaffold, `package.json` with `"type": "module"`, all npm dependencies installed (including `chokidar@^4`).
- **Section 02** must be complete: `src/graph/types.ts` exports `InMemoryGraph`, `GraphNode`, `GraphEdge`; `src/graph/builder.ts` exports `buildGraph` and the local `WeightsFile` type.

The `LogEntry` type represents a single parsed line from a JSONL log file in `<dataRoot>/logs/`. It is not defined in Section 02 and must be declared in this module (or in `src/graph/types.ts`). A minimal declaration:

```typescript
// Declare locally in src/watcher/index.ts (do not import from 01-data-layer)
export interface LogEntry {
  tool_use_id: string;
  timestamp: string;
  connection_type: string;
  source_node: string;
  target_node: string;
  [key: string]: unknown; // passthrough for any additional fields
}
```

---

## Files to Create

- `src/watcher/index.ts` — the watcher module
- `tests/watcher/watcher.test.ts` — unit tests using temp directories

---

## Tests First

File: `tests/watcher/watcher.test.ts`

Use `createTempDir` / `removeTempDir` from `tests/helpers/tempDir.ts` in `beforeEach` / `afterEach`. Set `stabilityThreshold` to 50ms in test mode by passing a config option to `startWatchers`. Use Promise-based polling (100ms interval, 5-second timeout) — never fixed sleeps — for all assertions that depend on filesystem event delivery.

```typescript
// Helper: async function pollUntil(fn: () => boolean, intervalMs = 100, timeoutMs = 5000): Promise<void>
//   Resolves when fn() returns true, rejects with timeout error if not resolved within timeoutMs.

// --- weights.json watcher tests ---

// Test: onGraphChange is called when weights.json is written to a temp data root
//   - write a valid weights.json fixture to <tempDir>/weights.json
//   - start watchers
//   - poll every 100ms up to 5s for onGraphChange to be called
//   - assert it was called at least once

// Test: onGraphChange receives a correctly-parsed InMemoryGraph on change
//   - fixture has 2 connections → expect nodeIndex.size === 4, edgeList.length === 2

// Test: onGraphChange is called with an empty InMemoryGraph when weights.json is deleted (unlink)
//   - write valid weights.json, start watchers, wait for first callback
//   - delete weights.json
//   - poll for second onGraphChange call
//   - assert received graph has nodeIndex.size === 0 and edgeList.length === 0

// Test: watcher handles weights.json not existing at startup
//   - start watchers on a temp dir that has NO weights.json
//   - write weights.json after starting the watcher
//   - poll for onGraphChange to be called
//   - assert it was called with the correct graph

// Test: watcher retains last valid graph when weights.json is overwritten with invalid JSON
//   - write valid weights.json → await first callback, record graph
//   - overwrite with invalid JSON
//   - poll briefly (500ms); assert onGraphChange is NOT called a second time

// --- logs/ directory watcher tests ---

// Test: startup scan — onNewLogEntry called for each line in an existing JSONL file
//   - create <tempDir>/logs/2024-01-01.jsonl with 3 valid LogEntry lines
//   - start watchers (ignoreInitial: false processes existing files)
//   - poll until callCount === 3 (up to 5s)

// Test: offset tracking — after startup scan, only new appended lines trigger onNewLogEntry
//   - same fixture with 3 lines → startup scan fires 3 calls
//   - await startup to complete
//   - append 2 new lines to the same file
//   - poll until 2 additional calls (total 5), assert no duplicates

// Test: new JSONL file added after startup — onNewLogEntry called for each line
//   - start watchers with empty logs/ dir
//   - write a new JSONL file with 2 lines
//   - poll until callCount === 2

// Test: invalid JSON lines are skipped without crashing
//   - create JSONL file with 1 valid line, 1 invalid line, 1 valid line
//   - poll until callCount === 2 (invalid line skipped)
//   - no error thrown from startWatchers

// --- Event buffer tests ---

// Test: buffer cap — adding entry 1001 drops the oldest
//   - trigger 1001 log events
//   - assert buffer length === 1000
//   - assert the oldest entry (entry index 0) is gone

// Test: entries stored newest-first
//   - add entries A, B, C
//   - buffer[0] === C, buffer[1] === B, buffer[2] === A

// Test: startup scan populates buffer WITHOUT broadcasting
//   - pass a mock broadcast spy alongside onNewLogEntry
//   - after startup scan, buffer has entries but broadcast was never called

// --- stopWatchers test ---

// Test: stopWatchers prevents further callbacks after being called
//   - start watchers, call stopWatchers
//   - write weights.json
//   - wait 500ms, assert onGraphChange was never called
```

---

## Implementation

### `src/watcher/index.ts`

The module manages all watcher state internally. Export only the public functions.

**Module-level state (not exported):**

- `let weightsWatcher: chokidar.FSWatcher | null` — the weights.json chokidar instance
- `let logsWatcher: chokidar.FSWatcher | null` — the logs/ chokidar instance
- `const fileOffsets: Map<string, number>` — maps absolute file path → last consumed byte offset
- `let eventBuffer: LogEntry[]` — capped array, max 1000 entries, newest-first

**Exported public interface:**

```typescript
export interface WatcherOptions {
  /** awaitWriteFinish stabilityThreshold in ms. Default: 300. Set to 50 in tests. */
  stabilityThreshold?: number;
}

/**
 * Starts both file watchers.
 *
 * @param weightsPath - absolute path to weights.json
 * @param logsDir - absolute path to the logs/ directory
 * @param onGraphChange - called with rebuilt InMemoryGraph whenever weights.json changes
 *   (or with empty graph on unlink)
 * @param onNewLogEntry - called for each new LogEntry.
 *   isStartup is true during the startup scan; false for live events.
 * @param opts - optional WatcherOptions
 */
export function startWatchers(
  weightsPath: string,
  logsDir: string,
  onGraphChange: (graph: InMemoryGraph) => void,
  onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void,
  opts?: WatcherOptions
): void

/**
 * Closes both chokidar watchers and resets all module-level state.
 * Safe to call multiple times.
 */
export async function stopWatchers(): Promise<void>

/**
 * Returns a shallow copy of the current event buffer (newest-first).
 * Used by GET /events route handler.
 */
export function getEventBuffer(): LogEntry[]
```

**Note on the `isStartup` flag:** Section 07 uses this to decide whether to call `broadcast`. During the startup scan, `isStartup === true` — the entry is added to the buffer but not broadcast. After startup, `isStartup === false` — the entry is both added to the buffer and broadcast as `connection:new`. This keeps broadcast logic in Section 07 where all wiring lives.

### weights.json watcher behavior

```typescript
chokidar.watch(weightsPath, {
  awaitWriteFinish: {
    stabilityThreshold: opts?.stabilityThreshold ?? 300,
    pollInterval: 50,
  },
  ignoreInitial: true,
})
```

Register handlers:
- `.on('change', async () => { /* read, parse, call onGraphChange */ })`
- `.on('unlink', () => { /* call onGraphChange with buildGraph({ connections: {} }) */ })`

On `change`: use `fs.promises.readFile(weightsPath, 'utf-8')` (async, non-blocking). Parse with `JSON.parse`. If parse throws, log to stderr with `console.error` and return without calling `onGraphChange` — the last valid graph is retained by the server's mutable reference in Section 07. If read succeeds, call `buildGraph(parsed)` and call `onGraphChange(newGraph)`.

**Handling missing weights.json at startup:** `ignoreInitial: true` means the watcher doesn't fire for a file that already exists — the initial graph load is done separately in Section 07 via a direct `readFile` call. chokidar v4 handles watching a non-existent file gracefully; when the file is created, a `change` event fires.

### logs/ directory watcher behavior

```typescript
chokidar.watch(logsDir, {
  depth: 0,
  ignoreInitial: false,  // process existing files at startup
  awaitWriteFinish: {
    stabilityThreshold: opts?.stabilityThreshold ?? 300,
    pollInterval: 50,
  },
})
```

The startup scan happens because `ignoreInitial: false` causes chokidar to emit `add` events for all existing `.jsonl` files when the watcher starts. Track a `let isStartupScan = true` flag that is set to `false` in the `.on('ready', ...)` handler.

Register handlers:
- `.on('add', (filePath) => { readNewBytes(filePath, isStartupScan) })`
- `.on('change', (filePath) => { readNewBytes(filePath, false) })`
- `.on('ready', () => { isStartupScan = false })`

**`readNewBytes(filePath, startup)` — internal async function:**

1. Get `lastOffset = fileOffsets.get(filePath) ?? 0`
2. `const stat = await fs.promises.stat(filePath)` — get current file size
3. If `stat.size <= lastOffset`, return (no new bytes — handles spurious change events)
4. Open the file with `fs.promises.open`, read exactly `stat.size - lastOffset` bytes starting at `lastOffset`, close the file
5. Update `fileOffsets.set(filePath, stat.size)`
6. Convert the buffer to a string, split on `\n`, filter empty strings
7. For each line: try `JSON.parse(line)` as `LogEntry`. On success: call `prependToBuffer(entry)` and call `onNewLogEntry(entry, startup)`. On parse error: `console.error(...)` and continue.

**`prependToBuffer(entry: LogEntry)` — internal function:**

```typescript
function prependToBuffer(entry: LogEntry): void {
  eventBuffer.unshift(entry)
  if (eventBuffer.length > 1000) {
    eventBuffer.pop()
  }
}
```

### `stopWatchers` implementation

```typescript
export async function stopWatchers(): Promise<void> {
  await Promise.all([
    weightsWatcher?.close(),
    logsWatcher?.close(),
  ])
  weightsWatcher = null
  logsWatcher = null
  fileOffsets.clear()
  eventBuffer = []
}
```

### Error handling summary

| Scenario | Behavior |
|---|---|
| `weights.json` JSON parse fails | Log to stderr, retain last valid graph, do not call `onGraphChange` |
| `weights.json` unlink | Call `onGraphChange` with `buildGraph({ connections: {} })` |
| JSONL line parse fails | Log to stderr, skip line, continue |
| `fs.promises.readFile` throws | Log to stderr, do not crash |
| `stopWatchers` called before start | No-op |

---

## Fixture Data for Tests

Write these as inline constants in the test file.

**Minimal WeightsFile fixture:**

```typescript
const fixtureWeights = {
  connections: {
    "project:github.com/user/repo||tool:Read": {
      source_node: "project:github.com/user/repo",
      target_node: "tool:Read",
      connection_type: "project->tool",
      raw_count: 5,
      weight: 0.8,
      first_seen: "2024-01-01T00:00:00.000Z",
      last_seen: "2024-01-02T00:00:00.000Z",
    },
    "project:github.com/user/repo||tool:Write": {
      source_node: "project:github.com/user/repo",
      target_node: "tool:Write",
      connection_type: "project->tool",
      raw_count: 3,
      weight: 0.5,
      first_seen: "2024-01-01T00:00:00.000Z",
      last_seen: "2024-01-02T00:00:00.000Z",
    },
  },
  last_updated: "2024-01-02T00:00:00.000Z",
  version: "1.0"
}
```

**Minimal JSONL fixture (3 lines):**

```
{"tool_use_id":"abc1","timestamp":"2024-01-01T00:00:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Read"}
{"tool_use_id":"abc2","timestamp":"2024-01-01T00:01:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Write"}
{"tool_use_id":"abc3","timestamp":"2024-01-01T00:02:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Edit"}
```

---

## Key Implementation Notes

**chokidar v4 is ESM-only.** Import as:

```typescript
import chokidar from 'chokidar'
```

Not `import { watch } from 'chokidar'` — chokidar v4 uses a default export.

**`fs.promises.read` vs `fs.promises.readFile` for offset reads.** Reading from a byte offset requires the lower-level `fs.promises.open` → `filehandle.read(buffer, offset, length, position)` → `filehandle.close()` API. `fs.promises.readFile` always reads from offset 0.

**Windows path separators.** chokidar v4 normalizes paths to forward slashes on Windows. When using paths as `Map` keys (for `fileOffsets`), store the path exactly as received from chokidar — do not mix sources.

**`awaitWriteFinish` in test mode.** Pass `stabilityThreshold: 50` via `WatcherOptions` in test `beforeEach`. The vitest test timeout should be at least 10 seconds to accommodate the 5-second polling timeout.

**Module-level state across tests.** Always call `stopWatchers()` in `afterEach` to reset all module-level state between tests.

---

## Acceptance Criteria

1. `tests/watcher/watcher.test.ts` exists with all tests above implemented.
2. All tests pass with `npm test`.
3. Offset tracking test verifies that 3 initial lines produce 3 callbacks and 2 appended lines produce exactly 2 more (total 5, not 6 or more).
4. The buffer cap test confirms `eventBuffer.length === 1000` after 1001 insertions and the oldest entry is gone.
5. `stopWatchers()` reliably prevents callbacks in the stopWatchers test.
6. `src/watcher/index.ts` compiles without TypeScript errors: `npm run build` succeeds.
