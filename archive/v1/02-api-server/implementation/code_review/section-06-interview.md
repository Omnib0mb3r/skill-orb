# Code Review Interview: section-06-file-watcher

## Items Reviewed

### Finding #1 — LogEntry index signature (ASKED USER)
**Decision:** Add `[key: string]: unknown` to `LogEntry` in `src/graph/types.ts`
**Rationale:** User approved Option B. Real JSONL entries have extra fields; Section 07 will need the index signature when broadcasting log entries over WebSocket. One-line, zero-risk change.
**Applied:** Yes — added index signature to `LogEntry` in `src/graph/types.ts`

### Finding #5 — Missing graph assertion in startup test (AUTO-FIX)
**Applied:** Changed test to assert `receivedGraph.nodeIndex.size === 3` and `edgeList.length === 2`

### Finding #6 — Inconsistent init wait 100ms vs 150ms (AUTO-FIX)
**Applied:** Updated "new JSONL file after startup" test from 100ms to 150ms

### Finding #7 — Missing comment on node count (AUTO-FIX)
**Applied:** Added comment `// fixture has 2 connections sharing one source node → 3 unique nodes (not 4)`

## Items Let Go
- Finding #2: empty strings in unlink handler — functional, buildGraph ignores those fields
- Finding #3: stat/open race on file truncation — out of spec scope
- Finding #4: in-flight callbacks after stopWatchers — not required by spec, tests pass
