# Section 04 Logger — Code Review

## CRITICAL: Unicode vs ASCII Arrow Type Mismatch

`src/types.ts` defines `ConnectionType` with ASCII `->` (intentional — avoids Windows cp1252 corruption).
Tests use Unicode `→`. Vitest passes (no type-check) but `tsc` would fail.

**Fix:** Replace all `'project→tool'` etc. with `'project->tool'` in implementation and tests.

## HIGH: Spec Header Says 7 Tests, Body Specifies 12

Spec defect — the body correctly lists 12. Implementation is correct, header is wrong.

## MEDIUM: Duplicate `LogEntry` Re-export

`index.ts` re-exports `LogEntry` — spec established `types.ts` as the sole re-export.
**Fix:** Remove re-export from `index.ts`.

## MEDIUM: Missing test for `getLogFilePath` default (no date arg)

**Fix:** Add test calling `getLogFilePath(dataRoot)` with no second argument.

## LOW: Midnight UTC race condition in 3 tests

Tests call `new Date()` after `appendLogEntry` — could resolve to next day at boundary.
**Fix:** Capture date before calling `appendLogEntry`.

## LOW: Test imports from `../src/logger/index` instead of `../src/logger`

**Fix:** Use directory barrel import.
