# Section 05 Weights — Code Review Interview

## Issue 1 (CRITICAL): loadWeights swallows non-ENOENT errors silently
**Decision:** Fix — log `[DevNeural] weights read error:` for non-ENOENT errors, keep ENOENT silent.
**Applied:** Changed first catch block to check `(err as NodeJS.ErrnoException).code !== 'ENOENT'` before logging. Added test "logs to stderr for non-ENOENT read errors" using EISDIR (directory at weights.json path).

## Issue 2 (HIGH): Concurrent RMW test misleadingly claimed locking prevents clobbering
**Decision:** Option A — rescope test to atomicity-only guarantee; drop locking claim.
**Applied:** Renamed to "two concurrent write-file-atomic saves produce valid non-corrupt JSON (atomicity guarantee)". Added comment clarifying that without a lock wrapper (section-06), one update may clobber another — test only asserts file integrity.

## Issue 3 (HIGH): Lock fallback test didn't mock proper-lockfile
**Decision:** Add vi.mock so the fallback is actually tested.
**Applied:** Added `vi.mock('proper-lockfile', ...)` at file level (hoisted by vitest). Lock fallback test now uses `vi.mocked(properLockfile.lock).mockRejectedValueOnce(...)` to simulate lock failure, then verifies saveWeights resolves and file is written. Note: needed `vi.mock` factory (not `vi.spyOn`) because proper-lockfile's CJS exports are non-configurable.

## Issue 4 (MEDIUM): saveWeights mutated caller's WeightsFile.updated_at
**Decision:** Non-mutating write — cleaner and safer.
**Applied:** Changed to `const toWrite = { ...weights, updated_at: new Date().toISOString() }`. Updated saveWeights test description and added assertion that `weights.updated_at` is unchanged after the call.

## Auto-fixes applied

### LOW: Unnecessary `as ConnectionRecord` cast removed
`src/weights/index.ts` line 57 — object literal satisfies ConnectionRecord structurally; cast removed.

### LOW: Parse-error spy assertion strengthened
Changed from `expect.stringContaining('[DevNeural]')` to `'[DevNeural] weights parse error:'` for the first argument. Also added ENOENT silencing assertion to the absent-file test.

### LOW: Valid-JSON roundtrip test now asserts connection_type
Added `expect(result.connections['project:foo||tool:Bash'].connection_type).toBe('project->tool')`.
