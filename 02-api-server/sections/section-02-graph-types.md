# Section 02 — Graph Types and Builder

## Overview

This section defines the shared TypeScript types that all other sections depend on, and implements the `buildGraph()` pure function that converts raw file data into the in-memory graph representation. Every other module — REST routes, WebSocket broadcaster, file watcher, query functions — imports from these files.

**Depends on:** section-01-foundation (project scaffold, `package.json`, `tsconfig.json`, directory structure must exist)

**Blocks:** section-03-graph-queries, section-04-rest-routes, section-05-websocket, section-06-file-watcher, section-07-server-wiring

---

## Files to Create

```
02-api-server/
├── src/
│   └── graph/
│       ├── types.ts       ← define all shared types here
│       └── builder.ts     ← implement buildGraph() here
└── tests/
    └── graph/
        └── builder.test.ts   ← write tests here
```

---

## Tests First

**File:** `C:\dev\tools\DevNeural\02-api-server\tests\graph\builder.test.ts`

Write these tests before implementing `buildGraph()`. All tests are unit tests — no I/O, no server, no temp directories.

```typescript
// Test: buildGraph with empty WeightsFile (no connections) returns empty InMemoryGraph
//   - nodeIndex.size === 0
//   - edgeList.length === 0
//   - edgeIndex.size === 0
//   - adjacency.size === 0

// Test: buildGraph with a single connection produces one edge and two nodes
//   - nodeIndex has source and target node
//   - edgeList has exactly one edge
//   - edgeIndex has that edge keyed by its id
//   - adjacency maps both nodes to [edgeId]

// Test: buildGraph with connections of all three types (project:, tool:, skill:) parses type prefix correctly
//   - each GraphNode has the correct `type` field ('project', 'tool', or 'skill')

// Test: buildGraph sorts edgeList descending by weight
//   - given three connections with weights 1.0, 3.0, 2.0 → edgeList order is [3.0, 2.0, 1.0]

// Test: buildGraph adjacency maps each node to all edges it participates in (both as source and target)
//   - a node that appears in 3 edges (as source in 2, target in 1) has 3 edge ids in its adjacency entry

// Test: buildGraph with duplicate connections (same source/target pair) produces correct edge count
//   - WeightsFile keys are unique by definition ("source||target"), so each key produces exactly one edge
```

Run with: `npm test` (vitest will discover `tests/graph/builder.test.ts` automatically).

---

## Background: WeightsFile Structure

The `WeightsFile` type originates in `01-data-layer`. **Do not import from `01-data-layer`** — re-declare the minimal subset here to avoid cross-package coupling. If `01-data-layer` is refactored, this declaration remains stable.

A `WeightsFile` object looks like:

```json
{
  "connections": {
    "project:github.com/user/repo||tool:Edit": {
      "source_node": "project:github.com/user/repo",
      "target_node": "tool:Edit",
      "connection_type": "project->tool",
      "raw_count": 12,
      "weight": 0.87,
      "first_seen": "2025-01-01T00:00:00.000Z",
      "last_seen": "2025-06-15T12:00:00.000Z"
    }
  },
  "last_updated": "2025-06-15T12:00:00.000Z",
  "version": "1.0"
}
```

Key structure details:
- `connections` is keyed by `"source||target"` strings (the `||` separator is specific to `01-data-layer`)
- Node ids use a type prefix: `project:`, `tool:`, or `skill:`
- `connection_type` is one of: `"project->tool"`, `"project->project"`, `"project->skill"`, `"tool->skill"`

---

## Type Definitions

**File:** `C:\dev\tools\DevNeural\02-api-server\src\graph\types.ts`

### `ConnectionType`

```typescript
export type ConnectionType = 'project->tool' | 'project->project' | 'project->skill' | 'tool->skill';
```

### `WeightsFileEntry`

Single connection record within `WeightsFile.connections`:

```typescript
export interface WeightsFileEntry {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}
```

### `WeightsFile`

Top-level structure of `weights.json`:

```typescript
export interface WeightsFile {
  connections: Record<string, WeightsFileEntry>;
  last_updated: string;
  version: string;
}
```

### `GraphNode`

```typescript
export interface GraphNode {
  id: string;           // e.g. "project:github.com/user/repo"
  type: 'project' | 'tool' | 'skill';
  label: string;        // the part after the prefix, e.g. "github.com/user/repo"
}
```

### `GraphEdge`

```typescript
export interface GraphEdge {
  id: string;             // the "source||target" key string
  source: string;         // source node id
  target: string;         // target node id
  connection_type: ConnectionType;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}
```

### `GraphResponse`

```typescript
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}
```

### `InMemoryGraph`

```typescript
export interface InMemoryGraph {
  /** O(1) lookup by node id */
  nodeIndex: Map<string, GraphNode>;
  /** All edges, sorted descending by weight at build time */
  edgeList: GraphEdge[];
  /** O(1) lookup by edge id (the "source||target" key) */
  edgeIndex: Map<string, GraphEdge>;
  /** Maps node id → list of edge ids the node participates in (as source or target) */
  adjacency: Map<string, string[]>;
}
```

---

## Implementation: `buildGraph()`

**File:** `C:\dev\tools\DevNeural\02-api-server\src\graph\builder.ts`

This is a **pure function** with no I/O, no side effects, and no external dependencies beyond `./types`.

### Function signature

```typescript
import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge } from './types.js';

/**
 * Converts a WeightsFile into an InMemoryGraph.
 * Pure function — no I/O. Safe to call with an empty WeightsFile.
 */
export function buildGraph(weights: WeightsFile): InMemoryGraph;
```

### Algorithm (implement in this order)

1. Initialize four empty collections: `nodeIndex`, `edgeList`, `edgeIndex`, `adjacency`.

2. Iterate over `Object.entries(weights.connections)`. For each `[key, entry]`:
   - The `key` is the edge id (e.g. `"project:github.com/user/repo||tool:Edit"`).
   - Create a `GraphEdge` using the key as `id` and the entry fields directly.
   - Add the edge to `edgeList` and `edgeIndex`.
   - For `source_node` and `target_node`, call a helper to parse or create the `GraphNode` if it does not already exist in `nodeIndex`.
   - Update `adjacency` for both the source node id and the target node id, appending the edge id.

3. After iterating all entries, sort `edgeList` in place descending by `weight`.

4. Return the four collections as an `InMemoryGraph`.

### Node parsing helper

Extract the node `type` and `label` from the node id by splitting on the first `:`. The prefix before the first `:` is the type. The remainder (after the first `:`) is the label. This handles ids like `project:github.com/user/repo` correctly — the label is `github.com/user/repo`, not just `github.com`.

Node types are exactly `'project'`, `'tool'`, or `'skill'`. Any other prefix in practice would be a data corruption issue — handling it (e.g., defaulting type to `'skill'`) is acceptable but not required in MVP.

### Edge cases handled

- **Empty `weights.connections`**: `Object.entries` returns `[]`; the loop body never executes; all four collections remain empty. Return them as-is. No error.
- **Same node appearing in multiple edges**: `nodeIndex` deduplication prevents duplicate `GraphNode` entries. Check `nodeIndex.has(id)` before creating.
- **Adjacency for both endpoints**: both `source_node` and `target_node` get the edge id appended to their adjacency list.

---

## Dependency Notes for Downstream Sections

- **Section 03 (Graph Queries):** imports `InMemoryGraph`, `GraphNode`, `GraphEdge`, `GraphResponse` from `./types.js` and `buildGraph` from `./builder.js`.
- **Section 04 (REST Routes):** imports `GraphResponse` and `InMemoryGraph` from `../graph/types.js`.
- **Section 05 (WebSocket):** imports `GraphResponse` from `../graph/types.js` to type the `graph:snapshot` payload.
- **Section 06 (File Watcher):** imports `buildGraph` from `../graph/builder.js` and `WeightsFile` from `../graph/types.js`.

All imports use the `.js` extension (ESM convention in TypeScript with `"moduleResolution": "NodeNext"`).

---

## Acceptance Criteria

1. `npm run build` compiles with no TypeScript errors.
2. All six tests in `tests/graph/builder.test.ts` pass.
3. `InMemoryGraph`, `GraphNode`, `GraphEdge`, `GraphResponse`, `WeightsFile`, `ConnectionType` are all exported from `src/graph/types.ts`.
4. `buildGraph` is exported from `src/graph/builder.ts`.
5. An empty `WeightsFile` input produces an `InMemoryGraph` with all four collections empty and no thrown exception.
6. Three connections with weights `1.0`, `3.0`, `2.0` produce an `edgeList` ordered `[3.0, 2.0, 1.0]`.
