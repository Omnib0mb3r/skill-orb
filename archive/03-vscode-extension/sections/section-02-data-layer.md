# section-02-data-layer

## Overview

This section updates the existing `01-data-layer` package to enrich JSONL log entries with project stage and tag metadata read from `devneural.json` files. It depends on **section-01-schema** (which defines and documents the `devneural.json` format and creates those files for existing projects).

The change is additive and log-only: `stage` and `tags` flow into JSONL entries but never into `weights.json` edges. The hook runner must never block on a missing or malformed `devneural.json`.

---

## Dependency

**Requires section-01-schema to be complete first.** That section defines:
- The `devneural.json` format (`name`, `localPath`, `githubUrl`, `stage`, `tags`, `description`)
- Valid `stage` values: `alpha | beta | deployed | archived`
- Valid `tags` values: `revision-needed | sandbox`
- The `validateDevNeuralConfig` module at `01-data-layer/src/schema/devneural-config.ts`
- `devneural.json` files created at the root of each existing DevNeural project

---

## Files to Create or Modify

All paths are within the `01-data-layer` package at `C:\dev\tools\DevNeural\01-data-layer`.

| File | Action |
|---|---|
| `src/types.ts` | Modify — add `stage?` and `tags?` to `LogEntry` |
| `src/hook-runner.ts` | Modify — add `readDevneuralJson()` helper and call it during `main()` |
| `src/logger/index.ts` | Modify — `buildLogEntry` accepts optional `stage`/`tags` and includes them |
| `tests/hook-runner.test.ts` | Modify — add new test groups for `devneural.json` reading behavior |
| `tests/logger.test.ts` | Modify — assert that `stage`/`tags` appear in log entries when provided |

---

## Tests First

Add a new `describe` block to `C:\dev\tools\DevNeural\01-data-layer\tests\hook-runner.test.ts`:

```typescript
describe('readDevneuralJson', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { removeTempDir(tempDir); });

  it('reads stage and tags from devneural.json in the current directory', async () => {
    // Write a valid devneural.json in tempDir, call readDevneuralJson(tempDir),
    // assert result.stage and result.tags match what was written
  });

  it('walks up 3 directory levels to find devneural.json', async () => {
    // Write devneural.json at tempDir root, call readDevneuralJson(tempDir/a/b/c),
    // assert stage and tags are read correctly from the ancestor directory
  });

  it('returns undefined when no devneural.json exists anywhere in the path', async () => {
    // Call readDevneuralJson('/nonexistent/path/deep/nested'),
    // assert result is undefined (no throw)
  });

  it('returns undefined and logs a warning when devneural.json contains malformed JSON', async () => {
    // Write "{ not json" to tempDir/devneural.json,
    // spy on console.warn, call readDevneuralJson(tempDir),
    // assert result is undefined and warn was called
  });

  it('returns undefined for stage when devneural.json is missing the stage field', async () => {
    // Write devneural.json without stage field,
    // assert result.stage is undefined, no throw
  });
});

describe('LogEntry type', () => {
  it('LogEntry type includes optional stage and tags fields', () => {
    // Type-level check: construct a LogEntry with stage and tags — must compile
    const entry: LogEntry = {
      schema_version: 1,
      timestamp: new Date().toISOString(),
      session_id: 'sess',
      tool_use_id: 'tu',
      project: 'proj',
      project_source: 'git-remote',
      tool_name: 'Bash',
      tool_input: {},
      connection_type: 'project->tool',
      source_node: 'project:proj',
      target_node: 'tool:Bash',
      stage: 'beta',
      tags: ['sandbox'],
    };
    expect(entry.stage).toBe('beta');
    expect(entry.tags).toEqual(['sandbox']);
  });

  it('LogEntry type allows stage and tags to be absent', () => {
    // Construct a LogEntry without stage or tags — must compile (optional fields)
    const entry: LogEntry = {
      schema_version: 1,
      timestamp: new Date().toISOString(),
      session_id: 'sess',
      tool_use_id: 'tu',
      project: 'proj',
      project_source: 'git-remote',
      tool_name: 'Bash',
      tool_input: {},
      connection_type: 'project->tool',
      source_node: 'project:proj',
      target_node: 'tool:Bash',
    };
    expect(entry.stage).toBeUndefined();
  });
});

describe('weights.json does not contain stage/tags', () => {
  it('WeightsFileEntry (ConnectionRecord) has no stage or tags fields after hook run', () => {
    // Write a devneural.json with stage:'beta' in the cwd,
    // run hook-runner subprocess on a Bash payload with cwd pointing to that dir,
    // read weights.json, assert no 'stage' or 'tags' key exists on any connection record
  });
});
```

Also update the subprocess integration tests to assert that `stage` appears in JSONL log entries when `devneural.json` is present in the `cwd`:

```typescript
describe('Hook runner orchestration: devneural.json enrichment (subprocess)', () => {
  it('JSONL log entry contains stage and tags when devneural.json is in cwd');
  it('JSONL log entry omits stage and tags when no devneural.json in path');
  it('hook runner exits 0 and proceeds when devneural.json is malformed');
});
```

---

## Implementation Details

### 1. Update `LogEntry` type

**File:** `C:\dev\tools\DevNeural\01-data-layer\src\types.ts`

Add two optional fields to the `LogEntry` interface:

```typescript
export interface LogEntry {
  // ... existing fields ...
  stage?: string;        // from devneural.json — log enrichment only
  tags?: string[];       // from devneural.json — log enrichment only
}
```

Do NOT add `stage` or `tags` to `ConnectionRecord` or `WeightsFile`. These fields belong only on log entries.

### 2. Add `readDevneuralJson` to `hook-runner.ts`

**File:** `C:\dev\tools\DevNeural\01-data-layer\src\hook-runner.ts`

Add a new exported async function:

```typescript
export async function readDevneuralJson(
  startDir: string
): Promise<{ stage?: string; tags?: string[] } | undefined>
```

Logic:
1. Start at `startDir`
2. At each level, check if `devneural.json` exists
3. If found: parse JSON, extract `stage` (string) and `tags` (string[]), return them
4. If not found at this level: walk up one directory (use `path.dirname`)
5. Stop when `path.dirname(current) === current` (filesystem root reached)
6. If any JSON parse error occurs: call `console.warn('[DevNeural] devneural.json parse error: ...')` and return `undefined`
7. If no file found: return `undefined`
8. Never throw under any circumstances

The walk-up ceiling is the filesystem root. No artificial depth limit — walk until root or file found.

### 3. Update `buildLogEntry` in `logger/index.ts`

**File:** `C:\dev\tools\DevNeural\01-data-layer\src\logger\index.ts`

The `buildLogEntry` function gains two optional parameters. Include them in the returned `LogEntry` only when defined (not null — simply absent):

```typescript
export function buildLogEntry(
  payload: HookPayload,
  identity: ProjectIdentity,
  connectionType: ConnectionType,
  sourceNode: string,
  targetNode: string,
  stage?: string,
  tags?: string[],
): LogEntry {
  // Use conditional spread:
  // ...(stage !== undefined ? { stage } : {}),
  // ...(tags !== undefined ? { tags } : {}),
}
```

### 4. Update `main()` in `hook-runner.ts`

Inside `main()`, after resolving identity and before calling `buildLogEntry`, call `readDevneuralJson(payload.cwd)`. Pass the resulting `stage` and `tags` into each `buildLogEntry` call:

```typescript
const meta = await readDevneuralJson(payload.cwd);

const entries = connections.map(conn =>
  buildLogEntry(
    payload, identity,
    conn.connectionType, conn.sourceNode, conn.targetNode,
    meta?.stage, meta?.tags,
  ),
);
```

The weight accumulation path is unchanged — `updateWeight` and `saveWeights` receive no new arguments.

---

## Behavioral Invariants

1. **Non-blocking**: If `devneural.json` reading fails for any reason, the hook runner logs a warning and continues. Tool use is never blocked.

2. **Log-only**: The `stage` and `tags` fields appear in JSONL log entries only. `ConnectionRecord` and `WeightsFile` types are not modified. Existing weights tests continue to produce identical results.

3. **Absent vs null**: When no `devneural.json` is found, the JSONL entry must not contain those keys at all (not `"stage": null`).

4. **Walk-up depth**: The search must traverse at least 3 levels above `cwd`.

5. **Warning format**: Use `console.warn` with `[DevNeural]` prefix for `devneural.json` issues (non-fatal).

---

## Run the Test Suite

```bash
cd C:\dev\tools\DevNeural\01-data-layer
npm test
```

All existing tests must continue to pass.

## What This Section Does NOT Do

- Does not validate the `devneural.json` schema (that is section-01-schema)
- Does not add stage/tags to `weights.json` or `ConnectionRecord`
- Does not scan directories at startup (that is section-03-api-server)
- Does not modify `WeightsFile` field names (that is section-01-schema)
