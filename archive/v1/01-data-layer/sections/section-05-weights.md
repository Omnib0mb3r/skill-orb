# Section 05: Weights

**Depends on:** section-01-foundation (types, project scaffold)
**Blocks:** section-06-hook-runner
**Parallelizable with:** section-02-config, section-03-identity, section-04-logger

---

## What This Section Delivers

Two source files and a full test suite:

- `src/weights/types.ts` — re-exports `WeightsFile` and `ConnectionRecord` from the shared types
- `src/weights/index.ts` — four functions for loading, keying, updating, and saving the connection weight graph
- `tests/weights.test.ts` — 15 tests covering happy path, error handling, atomicity, and concurrent write simulation

### Deviations from plan

- **`loadWeights` error handling** — differentiates ENOENT (silent) from other read errors (logs `[DevNeural] weights read error:`). Plan only specified ENOENT case.
- **`saveWeights` non-mutating** — does not mutate caller's `WeightsFile.updated_at`; writes `{ ...weights, updated_at: ... }` instead.
- **Test count is 15, not 9** — expanded to cover EISDIR read error, non-mutation assertion, and strengthened assertions.
- **Concurrency test scoped to atomicity-only** — the concurrent RMW test asserts file integrity (write-file-atomic guarantee), not that both updates are preserved. Loss-prevention requires the lock wrapper in section-06.
- **Lock fallback test uses `vi.mock`** — `vi.spyOn` fails on proper-lockfile CJS non-configurable exports; file-level `vi.mock` factory used instead.
- **`proper-lockfile` not used in weights module** — lock coordination is section-06's responsibility. The lock fallback test uses `vi.mock` to simulate the scenario but `saveWeights` itself is fully lock-agnostic.

The weights module is the persistence layer for the graph. It is the only module that reads and writes `weights.json`. It is stateless at import time — no module-level state, no open file handles.

---

## Types (from section-01-foundation)

The types below are defined in section-01. Reproduce them here for reference — do not redefine them.

```typescript
type ConnectionType = 'project→tool' | 'project→skill' | 'project→project';

interface ConnectionRecord {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;       // total observations, unbounded
  weight: number;          // normalized: min(raw_count, 100) / 100 * 10, stored as float
  first_seen: string;      // ISO 8601 UTC
  last_seen: string;       // ISO 8601 UTC
}

interface WeightsFile {
  schema_version: 1;
  updated_at: string;      // ISO 8601 UTC, set on every write
  connections: Record<string, ConnectionRecord>; // keyed by connection key
}
```

**Connection key format:** `"<source_node>||<target_node>"` — double-pipe delimiter.
Example: `"project:github.com/user/DevNeural||tool:Bash"`

---

## Tests First

File: `tests/weights.test.ts`

Write these tests before implementing. Use a temporary directory (`os.tmpdir()` + unique suffix) as `dataRoot` in `beforeEach`/`afterEach`. The temp dir should be cleaned up in `afterEach`.

### `connectionKey`

- Returns `"a||b"` for source `"a"` and target `"b"` (double-pipe delimiter, no spaces)

### `loadWeights`

- Returns a valid empty `WeightsFile` (`{ schema_version: 1, updated_at: ..., connections: {} }`) when `weights.json` does not exist
- Returns the parsed `WeightsFile` when the file is valid JSON
- Returns an empty graph and logs to stderr when the file contains invalid JSON (does not throw)

### `updateWeight`

- Creates a new `ConnectionRecord` with `raw_count=1`, `weight=0.1`, and `first_seen` set when the connection did not previously exist
- Increments `raw_count` and recalculates `weight` correctly for an existing connection (e.g., `raw_count=2` → `weight=0.2`)
- Caps `weight` at `10.0` when `raw_count >= 100` (e.g., `raw_count=200` → `weight=10.0`)
- Updates `last_seen` but does not change `first_seen` on a subsequent call
- Mutates in place — the returned reference is the same object passed in

### `saveWeights`

- Writes valid JSON to `weights.json` in `dataRoot`
- Sets `updated_at` on the written file to a current UTC timestamp
- Atomic write — another process reading the file during a write does not see partial content (the file is either absent or complete)

### Concurrency

- Two simulated concurrent read-modify-write cycles produce a valid, non-corrupt `weights.json` (file locking prevents one update silently clobbering the other)
- Lock fallback — if lock acquisition fails (simulated by mocking `proper-lockfile` to throw), the write still completes without throwing (unlocked fallback path)

---

## Implementation

### File: `src/weights/types.ts`

Re-export the shared types. This file exists so that `src/hook-runner.ts` and `src/weights/index.ts` can import from a local path without reaching into the top-level types file.

```typescript
export type { WeightsFile, ConnectionRecord } from '../types';
```

(Adjust the import path to wherever section-01 places the shared type definitions.)

### File: `src/weights/index.ts`

Four exported functions. Import `path`, `fs`, `write-file-atomic`, and `proper-lockfile`.

#### `connectionKey(sourceNode: string, targetNode: string): string`

Pure function. Returns `"${sourceNode}||${targetNode}"`. No validation needed.

#### `loadWeights(dataRoot: string): WeightsFile`

Synchronous. Reads `<dataRoot>/weights.json`.

- If the file does not exist (`ENOENT`), return `{ schema_version: 1, updated_at: new Date().toISOString(), connections: {} }`.
- If the file exists but `JSON.parse` throws, log `[DevNeural] weights parse error: <message>` to stderr and return the same empty structure.
- Never throws.

#### `updateWeight(weights: WeightsFile, sourceNode: string, targetNode: string, connectionType: ConnectionType, now: Date): WeightsFile`

In-place mutation. No I/O.

Key steps:
1. Compute `key = connectionKey(sourceNode, targetNode)`.
2. If `weights.connections[key]` does not exist, create a new `ConnectionRecord` with `raw_count=0`, `first_seen=now.toISOString()`.
3. Increment `raw_count` by 1.
4. Recalculate `weight`: `Math.round(Math.min(raw_count, 100) / 100 * 10 * 10000) / 10000` (4 decimal places, though at integer counts this produces at most 1 decimal place).
5. Set `last_seen = now.toISOString()`.
6. Return the same `weights` reference.

#### `saveWeights(weights: WeightsFile, dataRoot: string): Promise<void>`

Async. Sets `weights.updated_at = new Date().toISOString()` then atomically writes to `<dataRoot>/weights.json`.

Write strategy: use `writeFileAtomic` from `write-file-atomic`. This writes to a temp file (`weights.json.tmp.<pid>` internally) then renames — readers never see a partial file.

Concurrency strategy: wrap the entire call in `proper-lockfile`. Acquire a lock on `weights.json` before reading (in `loadWeights`) and release after saving.

In practice, the lock acquisition and release happen in the hook runner (section-06) around the full read-modify-write cycle, not inside `saveWeights` itself. `saveWeights` is lock-agnostic — it just writes. The lock coordination lives one level up. However, if `saveWeights` is called standalone in tests, it must still complete without error.

Never throws — catch all errors and log `[DevNeural] weights save error: <message>` to stderr.

---

## Concurrency Design Detail

The read-modify-write cycle in the hook runner looks like this:

```
lockfile.lock(weightsPath)
  → loadWeights(dataRoot)       // reads current weights.json
  → updateWeight(weights, ...)  // in-memory mutation
  → saveWeights(weights, dataRoot) // atomic write
lockfile.unlock(weightsPath)
```

This lives in section-06, not here. The weights module functions are individually lock-unaware.

**Lock parameters for `proper-lockfile`:**
- Stale lock timeout: 5 seconds (`stale: 5000`)
- Retries: default (3 retries with exponential backoff)

**Fallback behavior:** If lock acquisition throws (stale lock, another process has held it too long, filesystem issue), the hook runner falls back to calling `loadWeights → updateWeight → saveWeights` without a lock. One lost update is acceptable — weights are soft data, and the JSONL logs preserve full history. This "never block Claude" invariant takes priority over perfect weight consistency.

---

## Dependencies

These packages must be present in `package.json` (added in section-01-foundation):

- `write-file-atomic` — atomic write via temp-file + rename; cross-platform; handles file permissions correctly on Windows
- `proper-lockfile` — file-based locking for the read-modify-write cycle; works on Windows via lockfiles (not `flock`)

Both are runtime dependencies (not devDependencies).

---

## Weight Formula

```
weight = Math.min(raw_count, 100) / 100 * 10
```

- Range: `[0.0, 10.0]`
- At `raw_count = 1`: `weight = 0.1`
- At `raw_count = 50`: `weight = 5.0`
- At `raw_count = 100`: `weight = 10.0` (cap)
- At `raw_count = 200`: `weight = 10.0` (cap — `raw_count` itself is unbounded)
- Stored rounded to 4 decimal places for forward compatibility with future formula changes (e.g., EMA or decay)

---

## Error Handling Summary

| Situation | Behavior |
|---|---|
| `weights.json` does not exist | `loadWeights` returns empty graph silently |
| `weights.json` is corrupt JSON | `loadWeights` logs to stderr, returns empty graph |
| `saveWeights` write fails | Logs to stderr, does not throw |
| Lock acquisition fails | Hook runner falls back to unlocked write (not a weights-module concern) |

All functions in this module must uphold the invariant: **never throw, never interrupt the Claude session.**

---

## File Paths

| Path | Description |
|---|---|
| `C:\dev\tools\DevNeural\01-data-layer\src\weights\types.ts` | Type re-exports |
| `C:\dev\tools\DevNeural\01-data-layer\src\weights\index.ts` | Implementation |
| `C:\dev\tools\DevNeural\01-data-layer\tests\weights.test.ts` | Test suite (9 tests) |
| `C:\dev\data\skill-connections\weights.json` | Runtime output (not in repo) |
