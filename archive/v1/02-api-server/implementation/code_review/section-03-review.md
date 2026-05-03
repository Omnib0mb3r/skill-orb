# Code Review: Section 03 — Graph Query Functions

**Reviewer:** Senior Code Review
**Date:** 2026-03-29
**Files reviewed:**
- `02-api-server/src/graph/queries.ts`
- `02-api-server/tests/graph/queries.test.ts`
- `02-api-server/src/graph/types.ts` (reference)
- `02-api-server/src/graph/builder.ts` (reference)

---

## Overall Assessment

The implementation is correct, clean, and well-aligned with the section plan. All four query functions are present, all key constraints from the plan are satisfied, and the test suite is thorough. There are no critical issues. This section is ready to proceed, with two important issues and a handful of suggestions noted below.

---

## Plan Alignment

All planned deliverables are present and behave as specified:

| Requirement | Status |
|---|---|
| Pure functions, no I/O, no async | Satisfied |
| `getFullGraph` uses passed-in `updatedAt` | Satisfied |
| `getNodeById` uses O(1) nodeIndex + adjacency map | Satisfied |
| `getSubgraph` uses conditional prefix, not unconditional | Satisfied |
| `getSubgraph` uses exact equality (`===`), not `startsWith`/`includes` | Satisfied |
| `getSubgraph` and `getTopEdges` use `new Date().toISOString()` | Satisfied |
| Node deduplication via `Set` in `getSubgraph` and `getTopEdges` | Satisfied |
| Tests: happy path, not-found, empty graph, exact-match, no-double-prefix, limit=0 | Satisfied |

---

## What Was Done Well

- The conditional prefix normalization on line 39 of `queries.ts` is the correct pattern. Using `startsWith('project:')` as the guard prevents the double-prefix bug without introducing any additional complexity.
- Using `===` equality in the `edgeList.filter` (lines 42–43) correctly prevents substring matching. This is the only safe approach given IDs like `project:c:/dev` vs `project:c:/dev/sub`.
- `getNodeById` correctly delegates to the adjacency map and gracefully falls back to an empty array via the nullish coalescing operator (`?? []`). This handles nodes that exist in `nodeIndex` but have no entries in `adjacency` — which is exactly the isolated-node scenario tested on line 85 of the test file.
- `getFullGraph` returns `graph.edgeList` directly without copying, which is consistent and intentional: callers receive the live reference but the function contract is read-only.
- The `makeWeights` helper in the test file is well-designed: it is compact, covers all `ConnectionType` variants via the `type` parameter, and avoids duplicating WeightsFile structure boilerplate across every test.

---

## Issues Found

### Important

**I1. `getNodeById` does not normalize the `nodeId` input**

`getSubgraph` handles un-prefixed IDs by prepending `project:` when necessary, but `getNodeById` performs a raw `nodeIndex.get(nodeId)` with no normalization. If a caller passes `'repo-a'` instead of `'project:repo-a'`, the function silently returns `null`. This is an inconsistency in the public API surface: two functions that both look up by project identity treat un-prefixed input differently.

Whether this is a bug depends on the intended callers. If `getNodeById` is called directly from an HTTP handler that already validates and normalizes input, the inconsistency lives at the boundary and is acceptable. If it is ever called from the same user-facing context as `getSubgraph`, it will silently fail where `getSubgraph` would succeed.

The plan does not explicitly state whether `getNodeById` should normalize, but the inconsistency should be a deliberate decision, not an oversight. This warrants a comment in the source to document the intent, and ideally a test that confirms the no-normalization behavior is expected.

**I2. `getFullGraph` returns a live reference to `graph.edgeList`**

On line 9 of `queries.ts`, `edges: graph.edgeList` assigns the array reference directly into the response object. The `InMemoryGraph` contract (documented in `types.ts`) states that `edgeList` is pre-sorted descending by weight. Any caller that mutates the returned `edges` array — sorting it differently, splicing it, etc. — will silently corrupt the shared graph state. All other query functions that rely on `edgeList` being sorted (specifically `getTopEdges`) will then return wrong results without any error.

The nodes array in `getFullGraph` does not have this problem: `Array.from(graph.nodeIndex.values())` always produces a fresh array.

This is not a current bug because nothing in the codebase mutates the returned array today, but it is a correctness time-bomb as the codebase grows. The fix is a one-character change: `edges: graph.edgeList.slice()`. This creates a shallow copy in O(n) time, which is negligible for a function that already iterates the full node map.

---

### Suggestions

**S1. The `getSubgraph` double-prefix test asserts equality of results but not the mechanism**

The test "does NOT double-prefix when id already starts with `project:`" (line 131) correctly verifies that the two call sites return the same edge IDs. However, a reader cannot tell from the test alone whether the normalization path was actually exercised. Adding a single assertion that `withPrefix.edges.length > 0` before the equality check would make the test self-documenting: if `buildGraph` ever changes the edge IDs so that neither call finds anything, the equality assertion would still pass (both return empty) while the positive-result guard would catch the regression.

**S2. The `getTopEdges` sort-order test relies on `buildGraph` preserving sort order across `Object.entries`**

The test at line 199 uses `makeWeights` with weights `5.0, 3.0, 2.0, 1.5, 1.0`. The test correctly verifies that the returned top-3 edges are in descending order and that `result.edges[0].weight === 5.0`. This works because `buildGraph` sorts `edgeList` descending by weight after construction. The test is valid.

The subtle risk is that `makeWeights` builds the `connections` record as a plain object, and `Object.entries` order in JavaScript follows insertion order for string keys. If a future test introduced numeric-like string keys (e.g., `'1'`, `'2'`) the insertion order guarantee would break. The current keys use compound strings with `||` which always sort lexicographically, so the existing tests are safe. No change is required, but be aware of this if the helper is reused with numeric keys.

**S3. No test exercises `getNodeById` on a node that is a target (not source) of edges**

The test at line 63 looks up `'project:repo-a'` which is the source of two edges. There is no test that looks up `'tool:Edit'`, which is the *target* of edges from multiple projects. The adjacency map in `buildGraph` adds edge IDs for both `source_node` and `target_node`, so the implementation handles this correctly. A test confirming target-side adjacency would eliminate any future doubt that adjacency is built bidirectionally.

**S4. `getSubgraph` comment says "project node" but the function accepts any normalized ID**

The JSDoc on line 35 reads: "Returns the subgraph of edges directly connected to a specific project node." The normalization logic on line 39 only applies the `project:` prefix if the input is not already prefixed. This means a caller could pass `'tool:Edit'` and receive edges connected to that tool node without any prefix being added. The function body is more general than its comment implies. The comment should either be narrowed to document the normalization assumption, or widened to reflect that any node ID (prefixed) works as input.

---

## Test Coverage Summary

| Test case | Covered |
|---|---|
| `getFullGraph` happy path | Yes |
| `getFullGraph` empty graph | Yes |
| `getNodeById` happy path (source node) | Yes |
| `getNodeById` not found | Yes |
| `getNodeById` isolated node (no adjacency entry) | Yes |
| `getNodeById` target-side adjacency | No (S3) |
| `getSubgraph` un-prefixed input | Yes |
| `getSubgraph` no double-prefix | Yes |
| `getSubgraph` double-prefixed input returns empty | Yes |
| `getSubgraph` exact equality (no substring match) | Yes |
| `getSubgraph` correct node collection | Yes |
| `getSubgraph` empty graph | Yes |
| `getSubgraph` no match | Yes |
| `getTopEdges` top-N in order | Yes |
| `getTopEdges` node deduplication | Yes |
| `getTopEdges` limit exceeds count | Yes |
| `getTopEdges` empty graph | Yes |
| `getTopEdges` limit=0 | Yes |
| `getFullGraph` live edge reference mutation | No (I2) |

---

## Summary of Actions Required

| ID | Severity | Action |
|---|---|---|
| I1 | Important | Decide and document whether `getNodeById` should normalize un-prefixed IDs, and add a test that locks in the chosen behavior |
| I2 | Important | Change `edges: graph.edgeList` to `edges: graph.edgeList.slice()` in `getFullGraph` to prevent shared-state mutation via returned value |
| S1 | Suggestion | Add a `expect(withPrefix.edges.length).toBeGreaterThan(0)` guard to the no-double-prefix test |
| S2 | Suggestion | Leave as-is but avoid numeric-like keys in `makeWeights` for future tests |
| S3 | Suggestion | Add a `getNodeById` test for a target-side node (e.g., look up `'tool:Edit'` and confirm it returns edges from multiple projects) |
| S4 | Suggestion | Correct or widen the JSDoc on `getSubgraph` to match the actual function behavior |
