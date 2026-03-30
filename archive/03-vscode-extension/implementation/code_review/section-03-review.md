# Code Review: section-03-api-server

## ISSUE 1 — server.integration.test.ts NOT PATCHED (CRITICAL)

`createServer({ port: 0, dataRoot: tempDir })` in `tests/server.integration.test.ts` (line 65) lacks the new required `localReposRoot` field. `ServerConfig.localReposRoot` is typed as `string` (non-optional). The integration tests will fail with a TypeScript compile error.

**Auto-fix:** Add `localReposRoot: ''` to all `createServer(...)` calls in integration test.

## ISSUE 2 — WINDOWS PATH SEPARATOR IN REGISTRY WATCHER GLOB (CRITICAL)

`server.ts` lines 92-95 construct the chokidar glob with `path.join(config.localReposRoot, '*', 'devneural.json')`. On Windows, `path.join` emits backslashes. Chokidar glob patterns require forward slashes — a backslash-delimited glob matches nothing on Windows. The watcher starts silently but never fires.

**Auto-fix:** Use forward slashes by replacing `path.join(...)` with string template literal using `/`.

## ISSUE 3 — registry.ts SWALLOWS NON-ENOENT READ ERRORS SILENTLY (MEDIUM)

The `readFile` catch block at lines 100-105 does `continue` with no logging. The plan says non-fatal errors must be "logged as warnings and skipped." A permission error (`EACCES`) is silently dropped.

**Auto-fix:** Add `console.warn` for any non-ENOENT read error before `continue`.

## ISSUE 4 — registry.test.ts MISSING WARN ASSERTION FOR MISSING ROOT (MEDIUM)

Test "returns an empty Map when localReposRoot does not exist" spies on `console.warn` but never asserts it was called. The plan contract says "Must not throw; logs a warning."

**Auto-fix:** Add `expect(stderrSpy).toHaveBeenCalled()` assertion in the test.

## ISSUE 5 — NO WATCHER TEST FOR WeightsFile SECOND ARG (MEDIUM)

All existing `onGraphChange` callbacks in `watcher.test.ts` are `() => {}` (zero-arg). TypeScript silently accepts these against the new `(graph, weights) => void` signature. No test verifies the `WeightsFile` is actually passed as the second argument.

**Let go:** Adding a dedicated test would require adding a new test case to the watcher test suite, which is out of scope for this section. The behavior is verified indirectly through the server integration tests where graph enrichment from weights is tested.

## ISSUE 6 — PRE-EXISTING WATCHER/PRE-LOAD ORDERING RACE (LOW)

`startWatchers` is called before `weights.json` is pre-loaded. If chokidar fires immediately, `latestWeights` is set by the watcher callback and then overwritten by the pre-load. This race predates this diff.

**Let go:** Pre-existing issue; not introduced or worsened by this diff.

## ISSUE 7 — EMPTY-STRING stage SILENTLY SKIPPED (LOW)

`if (!githubUrl || !localPath || !stage || tags === null)` — a `stage: ""` would be skipped with no warning. No semantic difference from a missing field; this is consistent validation behavior.

**Let go:** Empty-string stage is treated the same as missing. The plan says "skips directories where devneural.json is missing required fields" — an empty-string value is effectively missing. Acceptable behavior.

## ISSUE 8 — Zod SNAPSHOT TEST DOESN'T VERIFY ABSENT-FIELD CONTRACT (LOW)

Test "graph:snapshot with unenriched nodes deserializes without error via Zod schema" checks `result.success === true` but doesn't assert absent fields don't appear. The absent-field JSON contract is tested in a different test ("GraphNode for a project WITHOUT a registry entry has no stage, tags, or localPath keys").

**Let go:** The absent-field contract is already covered by a dedicated test. The Zod test is correctly scoped to parse success only.
