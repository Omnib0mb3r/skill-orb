# Section 03 Code Review Interview — graph/queries.ts

## Review Findings Summary

Two issues found, all resolved automatically. No user questions needed.

---

## I2 — Live reference to `graph.edgeList` in `getFullGraph` [AUTO-FIXED]

**Issue:** `edges: graph.edgeList` returned the shared array directly. A caller mutating the
returned array (sort, splice) would silently corrupt the pre-sorted order that `getTopEdges` depends on.

**Fix applied:** Changed to `edges: graph.edgeList.slice()` — returns a shallow copy.

---

## I1 — `getNodeById` does not normalize un-prefixed IDs [LET GO]

**Finding:** Unlike `getSubgraph`, `getNodeById` does not prepend `project:` for un-prefixed input.

**Decision:** Let go. The section spec explicitly states the parameter is "The full node id string
(e.g. 'project:github.com/user/repo')". Route handlers will pass the full prefixed id from the URL
path. Added JSDoc clarification: "Unlike getSubgraph, no prefix normalization is performed — callers
must pass the full id."

---

## S1 — No-double-prefix test was vacuous [AUTO-FIXED]

**Issue:** Test only checked `withPrefix.edges.length === withoutPrefix.edges.length`, which would
pass if both returned empty.

**Fix applied:** Added `expect(withPrefix.edges.length).toBeGreaterThan(0)` guard.

---

## S3 — No test for target-side-only node in `getNodeById` [AUTO-FIXED]

**Issue:** All existing getNodeById tests used a node that was a source. The adjacency map in
buildGraph correctly handles target-side nodes, but no test confirmed this.

**Fix applied:** Added test: "returns edges for a node that only appears as target (not source)" —
builds a graph where `tool:Edit` is only a target, verifies `getNodeById('tool:Edit')` returns 2 edges.

---

## S2, S4 — [LET GO]

- S2: makeWeights insertion order — theoretical concern for future test authors, not a current bug
- S4: JSDoc on getSubgraph says "project node" — minor, left as-is since the parameter docs are correct

---

## Final test count: 25 tests, all passing
