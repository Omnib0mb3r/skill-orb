# 02-api-server — TDD Plan

Tests to write **before** implementing each section. Framework: vitest (matching 01-data-layer). Helpers: `tests/helpers/tempDir.ts` with `createTempDir()` / `removeTempDir()`.

---

## Section 01 — Foundation Scaffold

No automated test file for this section. Smoke tests:
- `npm run dev` starts without error and prints bound port
- `npm run build` compiles with no TypeScript errors
- `npm test` runs (zero tests pass, which is acceptable at this stage)

Config validation smoke checks (manual):
- Start with `PORT=abc` → clear error message, process exits non-zero
- Start with `PORT=99999` → clear error message, process exits non-zero
- Start with default config → server binds successfully

---

## Section 02 — Graph Types and Builder

File: `tests/graph/builder.test.ts`

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
//   - each GraphNode has the correct `type` field

// Test: buildGraph sorts edgeList descending by weight
//   - given three connections with weights 1.0, 3.0, 2.0 → edgeList order is [3.0, 2.0, 1.0]

// Test: buildGraph adjacency maps each node to all edges it participates in (both as source and target)

// Test: buildGraph with duplicate connections (same source/target pair) produces correct edge count
//   - (behavior defined by WeightsFile structure — each key is unique)
```

---

## Section 03 — Graph Query Functions

File: `tests/graph/queries.test.ts`

```typescript
// Test: getFullGraph returns all nodes and edges from InMemoryGraph
//   - nodes array length matches nodeIndex.size
//   - edges array length matches edgeList.length
//   - updated_at matches the passed string

// Test: getFullGraph on empty graph returns { nodes: [], edges: [], updated_at: <string> }

// Test: getNodeById returns node and all its edges when node exists
//   - edges array contains only edges where source === nodeId OR target === nodeId
//   - uses edgeIndex for lookup (O(1) path)

// Test: getNodeById returns null when node does not exist

// Test: getSubgraph with exact project id (no prefix) returns matching nodes and edges
//   - prefix 'project:' is prepended automatically

// Test: getSubgraph with already-prefixed id 'project:foo' does NOT double-prefix to 'project:project:foo'

// Test: getSubgraph returns only edges where source or target exactly equals the normalized id
//   - 'project:c:/dev' does NOT match 'project:c:/dev/bridger-tests' (exact match only)

// Test: getSubgraph on empty graph returns empty GraphResponse

// Test: getTopEdges returns top N edges by weight from pre-sorted edgeList
//   - returned edges are in descending weight order
//   - only nodes referenced by the top edges are included

// Test: getTopEdges when limit exceeds total edge count returns all edges (no error)

// Test: getTopEdges returns only nodes appearing in the returned edges (not all graph nodes)
```

---

## Section 04 — REST Routes

File: `tests/routes/graph.test.ts` and `tests/routes/events.test.ts`

Start a real Fastify instance on a random port with a temp data root for each test group.

```typescript
// GET /health
// Test: returns 200 with { status: 'ok', uptime: <number> }

// GET /graph
// Test: returns 200 with empty GraphResponse when data root is empty (no weights.json)
// Test: returns 200 with populated GraphResponse when weights.json contains fixture data
// Test: response includes CORS header Access-Control-Allow-Origin: *

// GET /graph/node/:id
// Test: returns 200 with { node, edges } for a known node id
// Test: returns 404 with { error: 'Node not found' } for an unknown node id
// Test: URL-decodes the :id parameter (e.g. 'project:c%3A/dev' → 'project:c:/dev')

// GET /graph/subgraph
// Test: returns 400 when ?project= param is missing
// Test: returns 200 with matching nodes/edges for a known project id
// Test: returns 200 with empty GraphResponse for a project id that has no edges

// GET /graph/top
// Test: returns 200 with default limit of 10 edges
// Test: ?limit=3 returns at most 3 edges
// Test: ?limit=200 is clamped to max 100
// Test: returns 200 with empty GraphResponse when graph is empty

// GET /events
// Test: returns 200 with { events: [], total: 0 } when event buffer is empty
// Test: returns events in newest-first order
// Test: ?limit=5 returns at most 5 events
// Test: ?limit=600 is clamped to max 500
// Test: response reads from in-memory buffer (no disk I/O after server startup)
```

---

## Section 05 — WebSocket and Broadcaster

File: `tests/ws/broadcast.test.ts`

```typescript
// Test: connecting a ws client to /ws immediately receives a graph:snapshot message
//   - message has type === 'graph:snapshot'
//   - payload matches current InMemoryGraph

// Test: graph:snapshot payload is a valid GraphResponse (nodes[], edges[], updated_at string)

// Test: calling broadcast({ type: 'graph:snapshot', payload }) sends the message to all OPEN clients
//   - connect 2 clients, call broadcast once, both receive the message

// Test: broadcast does not send to CLOSED or CLOSING clients

// Test: getClientCount returns correct count as clients connect and disconnect

// Test: broadcaster serializes the message only once regardless of client count
//   (verify via spy on JSON.stringify or message content equality check)
```

---

## Section 06 — File Watcher and Event Buffer

File: `tests/watcher/watcher.test.ts` (unit tests using temp directories)

```typescript
// weights.json watcher tests:
// Test: onGraphChange is called when weights.json is written to a temp data root
//   - poll every 100ms, timeout 5s

// Test: onGraphChange is called with a correctly-parsed InMemoryGraph on change

// Test: onGraphChange is called with an empty graph when weights.json is deleted (unlink)

// Test: watcher handles weights.json not existing at startup (watches parent, fires on add)

// Test: watcher retains last valid graph when weights.json contains invalid JSON (parse error)
//   - write valid weights.json → verify graph loaded
//   - write invalid weights.json → verify onGraphChange NOT called again (or called with same graph)

// logs/ directory watcher tests:
// Test: onNewLogEntry is called for each line in an existing JSONL file on startup (startup scan)
//   - 3 lines in fixture file → 3 calls

// Test: after startup scan, appending 2 new lines to the JSONL file fires onNewLogEntry exactly 2 times
//   - offset tracking prevents re-emitting already-seen lines

// Test: onNewLogEntry is called for each line in a brand-new JSONL file added to logs/

// Test: invalid JSON lines in JSONL are skipped without crashing (log and continue)

// Event buffer tests:
// Test: event buffer holds at most 1000 entries; adding entry 1001 drops oldest
// Test: entries in buffer are stored newest-first
// Test: startup scan populates buffer from existing log files but does NOT call broadcast

// stopWatchers test:
// Test: stopWatchers prevents further callbacks after being called
```

---

## Section 07 — Server Startup and Wiring

File: `tests/server.integration.test.ts`

End-to-end integration tests. Start full server on random port with temp data root.

```typescript
// Test: server starts successfully with empty data root
//   - GET /health returns 200

// Test: GET /graph returns empty GraphResponse on a fresh server with no weights.json

// Test: writing weights.json to temp data root triggers watcher and updates graph
//   - poll GET /graph every 100ms (up to 5s) until nodes.length > 0
//   - verify response matches fixture data

// Test: connected WebSocket client receives graph:snapshot broadcast after weights.json is written
//   - connect ws client before writing file
//   - poll for received message (100ms / 5s timeout)
//   - verify message.type === 'graph:snapshot' and payload has nodes

// Test: server on port already in use exits with a clear error message (port collision)

// Test: SIGINT triggers graceful shutdown
//   - server process exits cleanly
//   - WebSocket connections are closed before exit
```

---

## Testing Conventions Summary

- **vitest** as the test runner
- **temp directories** via `tests/helpers/tempDir.ts` in `beforeEach`/`afterEach`
- **real Fastify instances** on random ports for integration tests
- **real `ws` clients** for WebSocket tests (no mocking the WebSocket layer)
- **chokidar `awaitWriteFinish` set to 50ms** in test mode via env var or config override
- **file watcher timing**: Promise-based polling (100ms interval, 5-second timeout) — never fixed sleeps
- **no mocking chokidar** in integration tests — write real files to temp dirs
