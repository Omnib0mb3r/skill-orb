# Code Review: section-06-file-watcher

## Finding 1 — LogEntry type placement deviates from spec
**Category:** Architecture  
The spec says declare LogEntry locally in `src/watcher/index.ts` with `[key: string]: unknown` index signature. Instead, the implementation imports from `src/graph/types.ts` which lacks the index signature. This creates coupling between the watcher module and graph types, and the missing index signature will cause TypeScript errors in Section 07 when spreading additional log entry fields.

## Finding 2 — `unlink` handler uses empty strings for required WeightsFile fields
**Category:** Minor  
`buildGraph({ connections: {}, last_updated: '', version: '' })` is functional but semantically odd. Non-issue since buildGraph ignores those fields.

## Finding 3 — Race condition in `readNewBytes` (stat then open)
**Category:** Edge case  
Between `stat()` and `open()`, the file could be truncated. If truncated, the offset is set too high and future content is silently skipped. Spec doesn't cover rotation, so this is an observation.

## Finding 4 — `stopWatchers` doesn't await in-flight `readNewBytes` calls
**Category:** Latent bug  
In-flight async I/O continues after `stopWatchers()` returns, potentially calling callbacks into the next session's handlers. Not required by spec but noted.

## Finding 5 — Missing assertion in "weights.json not existing at startup" test
**Category:** Test quality  
The test only asserts `callCount >= 1`, not that the received graph has correct content. Spec says "assert it was called with the correct graph".

## Finding 6 — Inconsistent init wait (100ms vs 150ms)
**Category:** Nitpick  
The "new JSONL file after startup" test uses 100ms init wait; weights tests use 150ms. Inconsistent; 100ms may be insufficient on slow CI.

## Finding 7 — Test node count assertion lacks explanatory comment
**Category:** Nitpick  
Test asserts 3 nodes but spec said 4; no comment explains the discrepancy.
