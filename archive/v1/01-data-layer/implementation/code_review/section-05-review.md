# Section 05 Weights — Code Review

## CRITICAL: `loadWeights` silently swallows all filesystem errors, not just `ENOENT`

**File:** `src/weights/index.ts`, lines 23-27

The first `catch` block catches all exceptions from `readFileSync` without inspecting the error code. `ENOENT` (file absent) should be silent per the spec. But `EACCES` (permission denied), `ENOTDIR` (path component is not a directory), `EMFILE` (too many open file handles), and similar errors are also swallowed and silently return an empty graph with no log output.

This violates the spec's intent. A permissions error or a missing data directory is operationally different from an absent file — the operator needs stderr output to diagnose it. The test suite has no coverage for this path.

**Fix:** Check `(err as NodeJS.ErrnoException).code === 'ENOENT'` inside the catch. For all other error codes, log `[DevNeural] weights read error: <message>` before returning `empty()`.

---

## HIGH: Concurrent RMW test does not verify both updates survive

**File:** `tests/weights.test.ts`, lines 211-224

The test runs two read-modify-write cycles with `Promise.all`. Because `loadWeights` is synchronous and `saveWeights` is async, both cycles execute `loadWeights` before either awaits `saveWeights`. Execution order:

1. Cycle A: `loadWeights` → reads empty graph
2. Cycle B: `loadWeights` → reads same empty graph
3. Cycle A: `updateWeight` + `await saveWeights` → writes `{project:foo}`
4. Cycle B: `updateWeight` + `await saveWeights` → writes `{project:bar}`, discarding `project:foo`

The test only asserts parse validity and `schema_version`. It passes while demonstrating the exact data-loss bug. Locking (which lives in section-06) is required to prevent this, so either the test should be scoped to atomicity-only (not claim locking prevents clobbering), or a lock wrapper should be added.

---

## HIGH: Lock fallback test does not mock `proper-lockfile` as the spec required

**File:** `tests/weights.test.ts`, lines 226-231

The plan (line 83-84) specifies: *"Lock fallback — if lock acquisition fails (simulated by mocking `proper-lockfile` to throw), the write still completes without throwing."* The test does not mock `proper-lockfile`. It calls `saveWeights` directly, which is already proven by the `saveWeights` describe block. The test name is misleading and covers nothing new.

---

## MEDIUM: `saveWeights` mutates the caller's `WeightsFile` argument without documentation

**File:** `src/weights/index.ts`, line 70

`weights.updated_at = new Date().toISOString()` mutates the passed-in object. `updateWeight` also mutates in place, but that's its stated contract. `saveWeights` has no such documented contract and the spec says "sets `updated_at` on the written file" — implying the file, not the in-memory object. Either document the mutation in the JSDoc or avoid it with `{ ...weights, updated_at: ... }`.

---

## LOW: Unnecessary `as ConnectionRecord` type assertion

**File:** `src/weights/index.ts`, line 57

The object literal fully satisfies `ConnectionRecord` structurally. The `as ConnectionRecord` cast is unnecessary and suppresses future type errors. Remove it.

---

## LOW: Parse-error spy assertion is weaker than necessary

**File:** `tests/weights.test.ts`, lines 174-177

`expect.stringContaining('[DevNeural]')` is too broad. Should be:
```typescript
expect(stderrSpy).toHaveBeenCalledWith('[DevNeural] weights parse error:', expect.any(String));
```

---

## LOW: Valid-JSON roundtrip test does not assert `connection_type`

**File:** `tests/weights.test.ts`, lines 145-165

The fixture writes `connection_type: 'project->tool'` but only asserts `raw_count`. Add an assertion on `connection_type` to confirm the roundtrip is lossless.
