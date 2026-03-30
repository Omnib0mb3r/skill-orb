# Section 07: Integration — Full Build and Test Pass

## Overview

This is the final section of the `04-session-intelligence` module. The deliverable is a complete passing test suite and a clean `npm run build`. No new source files are created here. The work is:

1. Writing (or completing) the three test files
2. Running `npm run build` to confirm TypeScript compilation succeeds
3. Running `npm test` to confirm all tests pass

This section depends on all previous sections being complete:

- **section-01-setup** — `package.json`, `tsconfig.json`, `vitest.config.ts` must exist
- **section-02-identity** — `src/identity.ts` must exist and compile
- **section-03-api-client** — `src/api-client.ts` with `fetchSubgraph` must exist
- **section-04-formatter** — `src/formatter.ts` with `formatSubgraph` must exist
- **section-05-entry-point** — `src/session-start.ts` compiled to `dist/session-start.js` must exist
- **section-06-install-script** — `src/install-hook.ts` must exist (it is tested independently via unit tests on `mergeHooks`)

---

## Files to Create

```
04-session-intelligence/
├── tests/
│   ├── helpers.ts                # Shared mock API server and temp dir utilities
│   ├── api-client.test.ts        # Unit tests for fetchSubgraph
│   ├── formatter.test.ts         # Unit tests for formatSubgraph
│   └── session-start.test.ts     # Integration tests against compiled binary
```

---

## Test Helpers (`tests/helpers.ts`)

This file provides three shared utilities used across all test files. It must use only Node.js built-ins (`fs`, `os`, `http`).

```typescript
// tests/helpers.ts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as http from 'node:http';

/** Creates a temporary directory with prefix "devneural-04-test-". */
export function createTempDir(): string

/** Removes a temp directory recursively and forcefully. */
export function removeTempDir(dir: string): void

interface MockServerOptions {
  /** If set, delays all responses by this many milliseconds. */
  delayMs?: number;
  /** HTTP status code (default: 200). */
  status?: number;
}

interface MockServer {
  port: number;
  stop(): Promise<void>;
}

/**
 * Starts a minimal node:http server that returns the configured response
 * for any request. Returns the bound port and a stop() method.
 *
 * Pass delayMs to test timeout behavior (use 6000 to exceed the 5-second
 * client timeout).
 */
export function startMockApiServer(
  response: unknown,
  options?: MockServerOptions,
): Promise<MockServer>
```

The `startMockApiServer` implementation should:
- Call `server.listen(0)` to get a random available port (avoids port conflicts between parallel tests)
- Wait for the `'listening'` event before resolving, then read the assigned port from `server.address()`
- If `delayMs` is set, call `setTimeout` before writing the response headers
- Always respond with `Content-Type: application/json` and the serialized `response` body
- `stop()` calls `server.close()` and resolves when the server has fully closed

---

## Unit Tests: API Client (`tests/api-client.test.ts`)

These tests import `fetchSubgraph` directly from the source (not via the compiled binary). They start a real `node:http` mock server for each test that needs one.

**Test cases:**

1. **Successful response** — start a mock server returning a valid `GraphResponse` (with at least one node and one edge). Call `fetchSubgraph('project:test', { apiUrl: 'http://localhost:<port>', timeoutMs: 5000 })`. Assert the return value is not null and contains `nodes`, `edges`, `updated_at`.

2. **Server offline (ECONNREFUSED)** — do NOT start a server. Pass a port where nothing is listening. Assert return value is `null`.

3. **5-second timeout** — start a mock server with `delayMs: 6000`. Call with `timeoutMs: 5000`. Assert return value is `null`. Mark test with `{ timeout: 15000 }` to prevent Vitest's default 5-second test timeout from killing the test first.

4. **Empty graph response** — start a mock server returning `{ nodes: [], edges: [], updated_at: '2024-01-01T00:00:00Z' }`. Assert return value is not null (empty is valid, not an error) and has empty arrays.

5. **Malformed JSON** — start a mock server that returns the literal string `{invalid json}`. Assert return value is `null`.

6. **`DEVNEURAL_API_URL` env var override** — set `process.env.DEVNEURAL_API_URL` to the mock server URL, call `buildApiConfig()`, confirm it returns the correct `apiUrl`. Clean up env var after the test.

---

## Unit Tests: Formatter (`tests/formatter.test.ts`)

These tests import `formatSubgraph` directly from source. All inputs are constructed in-memory — no I/O or mock servers.

A helper `makeEdge(overrides)` can be defined locally in the test file to reduce repetition when constructing edge objects.

**Default config used in all tests:** `{ maxResultsPerType: 10, minWeight: 1.0 }`

**Test cases:**

1. **Both sections present** — provide a `GraphResponse` with a `project->skill` edge and a `project->project` edge, both above `minWeight`. The source of both edges is `"project:test-project"`. Assert output contains both `"Skills (top connections):"` and `"Related Projects:"`.

2. **Skills only** — provide only `project->skill` edges. Assert output contains `"Skills"` section but does NOT contain `"Related Projects:"`.

3. **Projects only** — provide only `project->project` edges. Assert output contains `"Related Projects"` but does NOT contain the Skills header.

4. **No connections above threshold** — all edges have `weight: 0.5`. Assert output contains `"No significant connections found"`.

5. **`raw_count` appears in output** — provide an edge with `raw_count: 42`. Assert output contains `"42 uses"`.

6. **Relative time: today** — set `last_seen` to today's ISO date. Assert output contains `"today"`.

7. **Relative time: 2 days ago** — set `last_seen` to (now - 2 days). Assert output contains `"2 days ago"`.

8. **Relative time: 8 days ago** — set `last_seen` to (now - 8 days). Assert output contains `"1 week ago"`.

9. **Label fallback** — provide an edge with `target: "skill:my-orphan-skill"` where that ID has no entry in `nodes`. Assert the output contains `"my-orphan-skill"` (type prefix stripped).

10. **Top-10 limit** — provide 15 `project->skill` edges all with `weight: 5.0`. Assert the output contains exactly 10 skill bullet points (e.g., count occurrences of `"•"` in the Skills section).

11. **Weight filter** — provide a `project->skill` edge with `weight: 0.5` (below `minWeight: 1.0`). Assert that skill does NOT appear in output.

12. **Outgoing-only filter** — provide an edge where `target === "project:test-project"` (i.e., this project is the target, not the source). Assert that edge does NOT appear in output.

13. **`project->tool` edges excluded** — provide an edge with `connection_type: "project->tool"`. Assert it does NOT appear in output.

---

## Integration Tests: Session Start Binary (`tests/session-start.test.ts`)

These tests compile the binary once in `beforeAll`, then spawn it with `spawnSync` for each test. The mock API server is started before the relevant tests and stopped after.

**`beforeAll` block:**

```typescript
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

beforeAll(() => {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}, 30_000); // allow 30s for compilation
```

**`spawnSync` helper pattern:**

```typescript
import { spawnSync } from 'node:child_process';

function runHook(payload: object, env?: NodeJS.ProcessEnv) {
  return spawnSync('node', [path.join(ROOT, 'dist/session-start.js')], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 10_000,
  });
}
```

**Standard payload shape:**

```typescript
const basePayload = {
  session_id: 'test-session-123',
  cwd: process.cwd(),
  hook_event_name: 'SessionStart',
};
```

**Test cases:**

1. **Happy path — skills and projects returned** — start mock server returning a `GraphResponse` with at least 2 `project->skill` edges and 1 `project->project` edge above weight 1.0. Run hook with `DEVNEURAL_API_URL` pointing to mock server. Assert:
   - `stdout` contains `"DevNeural Context for"`
   - `stdout` contains the skill label
   - `stdout` contains the weight value (e.g., `"/10"`)
   - `stdout` contains `"uses"`
   - `status === 0`

2. **No connections — empty graph** — mock server returns `{ nodes: [], edges: [], updated_at: '...' }`. Assert `stdout` contains `"No significant connections"` and `status === 0`.

3. **API offline** — no server started; point `DEVNEURAL_API_URL` to `http://localhost:1` (refused). Assert:
   - `stdout` contains `"API offline"` (case-insensitive)
   - `stdout` contains a path or command to start the server
   - `status === 0`

4. **API timeout** — mock server uses `delayMs: 6000`. Assert `stdout` contains `"API offline"` and test completes within 7 seconds. Mark test with `{ timeout: 15000 }`.

5. **Malformed stdin** — call `spawnSync` with `input: 'not valid json at all'`. Assert `status === 0` and `stdout === ''` (silent failure).

6. **CWD with no git** — create a temp dir with `createTempDir()`, no `.git` inside. Pass it as `cwd` in the payload. Start a mock server. Assert hook exits 0 (fallback identity used, API was queried). Clean up temp dir after test.

7. **Top-10 limit** — mock server returns `GraphResponse` with 15 `project->skill` edges all above weight threshold. Assert the output contains exactly 10 skill bullet point entries (count `"•"` in stdout).

8. **Weight filtering in binary** — mock server returns `GraphResponse` with skills that have `weight: 0.5`. Assert those skill labels do NOT appear in stdout.

---

## Final Validation Checklist

After all tests are written and all source sections are implemented, verify:

- [x] `npm run build` exits 0 (run from `04-session-intelligence/`)
- [x] `npm test` exits 0 (all 42 tests pass across 5 files)
- [x] No test file imports Fastify — all mock servers use `node:http.createServer`
- [x] No test reads from or writes to `~/.claude/settings.json` — install script tests operate on constructed objects passed to `mergeHooks` directly
- [x] The timeout test (`api-client.test.ts` test 3 and `session-start.test.ts` test 4) each carry `{ timeout: 15000 }` to avoid false failures from Vitest's default 5-second limit
- [x] `beforeAll` in `session-start.test.ts` has a 30-second timeout to allow `tsc` compilation
- [x] `01-data-layer` is built before running tests (otherwise `identity.ts` import fails at test load time)

## Deviations from Plan

- **`helpers.ts` API**: implemented as a raw-handler interface (`(req, res) => void`) rather than the plan's response-object API (`response: unknown, options?`). The handler form is required because `session-start.test.ts` needs to inspect the `?project=` query parameter to construct per-project graph responses. The response-object API would not support this.
- **`session-start.test.ts` compile step**: uses `spawnSync('npm', ['run', 'build'])` (captures stdout/stderr for error reporting) rather than `execSync` with `stdio: 'inherit'`. Both invoke the same build; `spawnSync` surfaces compilation errors more clearly on failure.
- **`api-client.test.ts` mock server**: defines a local `startMockServer` instead of importing from `helpers.ts`, since the API unit tests have simpler needs and the local version keeps the file self-contained.
- **Extra test cases**: `formatter.test.ts` has 15 tests (plan specified 13) — added boundary test at `weight === 1.0`. `api-client.test.ts` has 8 tests (plan specified 6) — added non-OK HTTP status test and default-port test.

## Files Created

All test files were written during their corresponding implementation sections:
- `tests/helpers.ts` — section-05-entry-point
- `tests/session-start.test.ts` — section-05-entry-point
- `tests/formatter.test.ts` — section-04-formatter
- `tests/api-client.test.ts` — section-03-api-client
- `tests/install-hook.test.ts` — section-06-install-script
- `tests/identity.test.ts` — section-02-identity

---

## Key Constraints

- The mock API server must bind to a random available port (pass `0` to `listen`)  so tests don't conflict with each other
- The `spawnSync` calls must pass `DEVNEURAL_API_URL` in the `env` option — do not rely on inherited environment having an API URL set
- `execSync('npm run build', ...)` in `beforeAll` is sufficient; there is no need to re-compile between tests since source files do not change during the test run
- If `01-data-layer` is not yet built, `npm run build` in `04-session-intelligence` will fail because `src/identity.ts` imports from `../01-data-layer/dist/`. The implementer must run `npm run build` in `01-data-layer/` first (one-time prerequisite)
