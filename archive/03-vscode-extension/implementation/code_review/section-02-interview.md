# Code Review Interview: section-02-data-layer

## Items asked of user

### Issue 2 — validateDevNeuralConfig vs. best-effort extraction
**Question:** Should readDevneuralJson call validateDevNeuralConfig to enforce valid stage/tag values?
**User decision:** Keep best-effort extraction. The plan says this section does NOT validate. JSONL logs
are historical records — having an imperfect stage value is harmless. The validator is for section-03
(API server), where clean data is required to build the graph.

## Auto-fixes applied

- **Issue 1:** Narrow catch to ENOENT; warn+return undefined for non-ENOENT read errors (EPERM, EMFILE, etc.)
- **Issue 4:** Assert `existsSync(weightsFile)` unconditionally in the weights test (remove the `if` guard)
- **Issue 5:** Add missing test case: tags-present, stage-absent in buildLogEntry

## Items let go

- **Issue 2:** Best-effort extraction confirmed correct per plan intent
- **Issue 3:** Using `string`/`string[]` is correct for non-validating extraction
- **Issue 6:** Empty object semantics are acceptable; callers use `meta?.stage` correctly
- **Issue 7:** payload.cwd is always absolute from the Claude Code hook system
