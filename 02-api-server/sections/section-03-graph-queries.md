# Section 03 — Graph Query Functions

## Overview

This section implements `src/graph/queries.ts`, a module containing four pure query functions that operate on the `InMemoryGraph` structure built by Section 02. These functions are the core read-path logic for all REST routes and contain no I/O or side effects.

**Dependencies:** Section 02 (`src/graph/types.ts`, `src/graph/builder.ts`) must be complete before this section can be implemented or tested. Sections 04 and 07 depend on this section.

**Files to create:**
- `c:\dev\tools\DevNeural\02-api-server\src\graph\queries.ts`
- `c:\dev\tools\DevNeural\02-api-server\tests\graph\queries.test.ts`

---

## Tests First

File: `c:\dev\tools\DevNeural\02-api-server\tests\graph\queries.test.ts`

These tests use the `buildGraph` function from Section 02 as a test fixture factory — no mock data structure needs to be constructed by hand. Import `buildGraph` from `src/graph/builder.ts` and `getFullGraph`, `getNodeById`, `getSubgraph`, `getTopEdges` from `src/graph/queries.ts`.

The test file should use `describe` blocks grouping the four functions:

```typescript
// describe('getFullGraph', () => {

//   Test: returns all nodes and edges from a populated InMemoryGraph
//     - build a graph with 2 connections (4 nodes if all distinct, or fewer with overlap)
//     - call getFullGraph(graph, '2024-01-01T00:00:00.000Z')
//     - result.nodes.length === graph.nodeIndex.size
//     - result.edges.length === graph.edgeList.length
//     - result.updated_at === '2024-01-01T00:00:00.000Z'

//   Test: returns { nodes: [], edges: [], updated_at: <string> } when graph is empty
//     - build from empty WeightsFile
//     - result.nodes and result.edges are both empty arrays

// })

// describe('getNodeById', () => {

//   Test: returns { node, edges } for a node that exists in the graph
//     - edges array contains only edges where source === nodeId OR target === nodeId
//     - edges are retrieved via edgeIndex (verify no edge with a different node id is present)

//   Test: returns null for a nodeId that does not exist

// })

// describe('getSubgraph', () => {

//   Test: accepts an unprefixed id and prepends 'project:' automatically
//     - build a graph that includes 'project:github.com/user/repo'
//     - call getSubgraph(graph, 'github.com/user/repo')
//     - result includes the expected edges

//   Test: does NOT double-prefix when id already starts with 'project:'
//     - call getSubgraph(graph, 'project:github.com/user/repo')
//     - result is the same as above (same edges)
//     - calling with 'project:project:github.com/user/repo' should return empty (no match)

//   Test: returns only edges where source OR target exactly equals the normalized project id
//     - 'project:c:/dev' must NOT match edges for 'project:c:/dev/bridger-tests'
//     - exact string equality, not prefix matching

//   Test: collects only the nodes referenced by the matched edges (not all graph nodes)

//   Test: returns empty GraphResponse when graph is empty

//   Test: returns empty GraphResponse when no edges match the normalized id

// })

// describe('getTopEdges', () => {

//   Test: returns the top N edges by weight in descending order
//     - edgeList is pre-sorted at build time, so this is a slice
//     - verify first edge has higher or equal weight than second

//   Test: returns only the nodes referenced by the returned edges (not all nodes)
//     - build a graph with 5 edges across many nodes, request top 2
//     - result.nodes contains exactly the nodes from those 2 edges

//   Test: when limit exceeds total edge count, returns all edges without error
//     - 3 edges in graph, limit=10 → result.edges.length === 3

//   Test: returns empty GraphResponse when graph is empty and limit is any positive integer

// })
```

---

## Implementation

File: `c:\dev\tools\DevNeural\02-api-server\src\graph\queries.ts`

This module is a pure function module — no imports from Node.js standard library, no async code, no file I/O. Import only the types from `src/graph/types.ts`.

### Function: `getFullGraph`

```typescript
/**
 * Serializes the entire InMemoryGraph into a GraphResponse suitable for the
 * GET /graph REST endpoint.
 *
 * @param graph - The current in-memory graph state.
 * @param updatedAt - ISO 8601 string representing when the graph was last loaded
 *   from weights.json. Pass `new Date().toISOString()` for an empty/initial graph.
 * @returns GraphResponse with all nodes (from nodeIndex) and all edges (from edgeList).
 */
export function getFullGraph(graph: InMemoryGraph, updatedAt: string): GraphResponse
```

- Spread or `Array.from(graph.nodeIndex.values())` for the nodes array.
- Use `graph.edgeList` directly (it is already sorted descending by weight at build time).
- The `updated_at` field is passed in, not computed here.

### Function: `getNodeById`

```typescript
/**
 * Looks up a single node and all edges it participates in.
 *
 * @param graph - The current in-memory graph state.
 * @param nodeId - The full node id string (e.g. 'project:github.com/user/repo').
 * @returns Object with the node and its edges, or null if the node does not exist.
 */
export function getNodeById(
  graph: InMemoryGraph,
  nodeId: string
): { node: GraphNode; edges: GraphEdge[] } | null
```

- Look up `nodeId` in `graph.nodeIndex`. Return `null` immediately if not found.
- Retrieve the edge id list from `graph.adjacency.get(nodeId)` (may be undefined for isolated nodes — treat as empty array).
- For each edge id, retrieve the `GraphEdge` via `graph.edgeIndex.get(edgeId)`. Collect into array.
- O(1) node lookup + O(degree) edge retrieval — no linear scan.

### Function: `getSubgraph`

```typescript
/**
 * Returns the subgraph of edges directly connected to a specific project node.
 *
 * @param graph - The current in-memory graph state.
 * @param projectId - Project identifier. If it does not already start with 'project:',
 *   the prefix is prepended. If it already has the prefix, it is used as-is
 *   (prevents double-prefixing like 'project:project:foo').
 * @returns GraphResponse with matching edges and only the nodes those edges reference.
 *   Returns an empty response if no edges match or the graph is empty.
 */
export function getSubgraph(graph: InMemoryGraph, projectId: string): GraphResponse
```

**Normalization rule (critical — prevents double-prefix bug):**
```typescript
const normalizedId = projectId.startsWith('project:') ? projectId : `project:${projectId}`;
```

- Filter `graph.edgeList` where `edge.source === normalizedId || edge.target === normalizedId`.
- **Exact string equality only.** `'project:c:/dev'` must not match `'project:c:/dev/bridger-tests'`.
- From the matched edges, collect the unique set of source and target node ids (using a `Set<string>`), then retrieve each from `graph.nodeIndex`.
- Set `updated_at` to `new Date().toISOString()`.

### Function: `getTopEdges`

```typescript
/**
 * Returns the top N edges by weight from the pre-sorted edge list.
 *
 * @param graph - The current in-memory graph state.
 * @param limit - Maximum number of edges to return. Since edgeList is sorted
 *   descending at build time, this is a simple Array.prototype.slice.
 * @returns GraphResponse with the top edges and only the nodes those edges reference.
 *   If limit exceeds the total edge count, all edges are returned.
 */
export function getTopEdges(graph: InMemoryGraph, limit: number): GraphResponse
```

- `const topEdges = graph.edgeList.slice(0, limit)` — safe when `limit > edgeList.length`.
- From `topEdges`, collect the unique set of source and target node ids (using a `Set<string>`), then retrieve each from `graph.nodeIndex`.
- Set `updated_at` to `new Date().toISOString()`.

---

## Key Constraints and Edge Cases

**No double-prefix in `getSubgraph`:** The `projectId` parameter arrives from a URL query string (e.g. `?project=github.com/user/repo`). Graph node ids stored internally always have the `project:` prefix. The normalization must use a conditional prepend, not an unconditional one. A consumer that passes an already-prefixed id (e.g. from a cached value) must get the same result as one that passes the bare id.

**Exact match in `getSubgraph`:** The filter is `===` string equality against `edge.source` and `edge.target`. No `.startsWith()`, no `.includes()`, no prefix truncation. The project path `c:/dev` has subprojects at `c:/dev/bridger-tests`, `c:/dev/tools`, etc. A subgraph query for `project:c:/dev` must return only the edges where `project:c:/dev` is an endpoint, not all edges touching any project under `c:/dev/`.

**`getTopEdges` with limit 0:** A limit of 0 returns an empty GraphResponse. `Array.slice(0, 0)` returns `[]`. This is valid behavior.

**Node deduplication in `getSubgraph` and `getTopEdges`:** Both functions collect nodes from edges. A node may appear as source in one edge and target in another. Use a `Set<string>` to collect unique node ids before retrieving from `nodeIndex`.

**`updated_at` field ownership:** `getFullGraph` receives `updatedAt` as a parameter (the timestamp of the last `weights.json` load, managed externally). `getSubgraph` and `getTopEdges` set it to `new Date().toISOString()` since they are derived views with no separate timestamp.

---

---

## Actual Implementation Notes

**Files created:**
- `src/graph/queries.ts` — 4 pure query functions
- `tests/graph/queries.test.ts` — 25 tests, all passing

**Deviations from plan:**
- `getFullGraph` returns `graph.edgeList.slice()` instead of `graph.edgeList` directly to prevent callers mutating the shared pre-sorted array (code review fix I2)
- Added JSDoc to `getNodeById` clarifying that callers must pass the full prefixed node id (unlike `getSubgraph`, no normalization is applied)

**Additional tests added (code review):**
- `getNodeById` → "returns edges for a node that only appears as target (not source)"
- `getSubgraph` → "does not match double-prefixed id 'project:project:...'" + positive guard on no-double-prefix test

---

## What This Section Does NOT Do

- No file I/O or async operations.
- No HTTP request/response handling (that is Section 04).
- No limit clamping (e.g. max 100 for `/top`) — clamping happens in the route handler in Section 04.
- No graph mutations or writes.
- No parsing of `WeightsFile` — that is `buildGraph` in Section 02.
