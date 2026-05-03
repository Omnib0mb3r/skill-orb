# Section 04 — REST Routes

## Overview

This section implements all six HTTP REST route handlers for the API server. Routes are defined in `src/routes/graph.ts` and `src/routes/events.ts`, then registered in `src/server.ts`. Route handlers are stateless — they read from a shared `InMemoryGraph` reference and event buffer that are managed by server-level closures and updated by the file watcher (Section 06).

## Dependencies

This section requires:

- **Section 01** (foundation scaffold): `package.json`, `tsconfig.json`, Fastify installed, project structure in place
- **Section 02** (graph types): `GraphNode`, `GraphEdge`, `GraphResponse`, `InMemoryGraph` types from `src/graph/types.ts`; `buildGraph()` from `src/graph/builder.ts`
- **Section 03** (graph queries): `getFullGraph`, `getNodeById`, `getSubgraph`, `getTopEdges` from `src/graph/queries.ts`

The file watcher (Section 06) and full server wiring (Section 07) are NOT required to implement or test this section. Integration tests here start their own Fastify instances with pre-loaded fixture data rather than relying on chokidar.

## Files to Create or Modify

- `src/routes/graph.ts` — route handlers for `/health`, `/graph`, `/graph/node/:id`, `/graph/subgraph`, `/graph/top`
- `src/routes/events.ts` — route handler for `/events`
- `tests/routes/graph.test.ts` — integration tests for all graph endpoints
- `tests/routes/events.test.ts` — integration tests for the events endpoint

`src/server.ts` will be modified in Section 07 to mount these routes. For this section, tests create their own minimal Fastify instances.

## Background: Shared State via Closure

Route handlers receive the current `InMemoryGraph` and event buffer through a closure pattern rather than module-level globals or a dependency injection framework. The intent is:

```typescript
// Illustrative closure pattern — not the full implementation
export function registerGraphRoutes(
  app: FastifyInstance,
  getGraph: () => InMemoryGraph
): void { ... }

export function registerEventsRoutes(
  app: FastifyInstance,
  getEvents: () => LogEntry[]
): void { ... }
```

When the file watcher (Section 06) rebuilds the graph, it calls a setter that updates the reference returned by `getGraph()`. Because JavaScript's event loop is single-threaded, there are no torn reads between a watcher update and a concurrent route handler.

The event buffer is a capped array of the 1000 most recent `LogEntry` objects, stored newest-first (defined fully in Section 06). The `/events` endpoint reads from this in-memory buffer — there is no disk I/O at request time.

## Background: LogEntry Type

The `LogEntry` type originates in `01-data-layer`. Re-declare the minimal subset needed here (do not import from `01-data-layer`'s dist) to avoid cross-package coupling. A `LogEntry` has at minimum: `tool_use_id: string`, `connection_type: string`, `source_node: string`, `target_node: string`, `timestamp: string`. Declare this type in `src/routes/events.ts` or in `src/graph/types.ts`, consistent with how `WeightsFile` is handled in Section 02.

## Endpoints

### GET /health

Returns a liveness check response. Does not depend on graph data.

Response shape: `{ status: "ok", uptime: number }` where `uptime` is `process.uptime()`.

Always returns HTTP 200. Used by consumers (VS Code panel, session hook) to verify the server is reachable before attempting WebSocket connection.

### GET /graph

Calls `getFullGraph(graph, new Date().toISOString())` and returns the `GraphResponse`.

If the graph is empty (weights.json has not been written yet or data root is missing), returns `{ nodes: [], edges: [], updated_at: <iso-string> }` with HTTP 200. Never returns 404.

### GET /graph/node/:id

URL-decodes the `:id` path parameter before lookup (use `decodeURIComponent`). Calls `getNodeById(graph, decodedId)`.

- Found: HTTP 200 with `{ node: GraphNode, edges: GraphEdge[] }`
- Not found: HTTP 404 with `{ error: "Node not found" }`

### GET /graph/subgraph

Reads the `?project=` query parameter. Returns HTTP 400 with `{ error: "Missing required query parameter: project" }` if absent or empty.

Calls `getSubgraph(graph, projectParam)`. The normalization logic (prepend `project:` if not already present, no double-prefix) lives inside `getSubgraph` (Section 03) — the route handler passes the raw param value through.

Returns `GraphResponse` with HTTP 200. Returns an empty `GraphResponse` (not 404) if the project id has no edges.

### GET /graph/top

Reads the `?limit=` query parameter. Default: 10. Maximum: 100. Clamp to range `[1, 100]` — if the parsed value exceeds 100, use 100; if below 1 or not a valid integer, use the default of 10.

Calls `getTopEdges(graph, clampedLimit)`. Returns `GraphResponse` with HTTP 200.

### GET /events

Reads the `?limit=` query parameter. Default: 50. Maximum: 500. Clamp to range `[1, 500]` — if the parsed value exceeds 500, use 500; if below 1 or not a valid integer, use the default of 50.

Reads from the in-memory event buffer (newest-first). Returns the first `limit` entries from the buffer.

Response shape: `{ events: LogEntry[], total: number }` where `total` is the full buffer size before slicing (not the slice length).

Returns HTTP 200 always. Returns `{ events: [], total: 0 }` when the buffer is empty.

## CORS

`@fastify/cors` is registered with `origin: '*'` in Section 07. For tests in this section, register CORS on the test Fastify instance directly so CORS header assertions pass without requiring the full server wiring.

The `Access-Control-Allow-Origin: *` header must appear on all responses.

## Tests

### File: `tests/routes/graph.test.ts`

Integration tests. Each test (or describe block) starts a real Fastify instance on a random port (`fastify.listen({ port: 0 })`), pre-loads a fixture `InMemoryGraph` (built with `buildGraph()` from fixture data, no temp directories or chokidar required), registers CORS and the graph routes, runs assertions via `fastify.inject()`, then closes the server in `afterEach`.

```typescript
// GET /health
// Test: returns 200 with { status: 'ok', uptime: <number> }

// GET /graph
// Test: returns 200 with empty GraphResponse when graph is empty (no weights.json scenario)
// Test: returns 200 with populated GraphResponse when fixture graph is loaded
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
```

### File: `tests/routes/events.test.ts`

```typescript
// GET /events
// Test: returns 200 with { events: [], total: 0 } when event buffer is empty
// Test: returns events in newest-first order (first element is most recent)
// Test: ?limit=5 returns at most 5 events (when buffer has more)
// Test: ?limit=600 is clamped to max 500
// Test: total reflects full buffer size, not slice size
// Test: response reads from in-memory buffer (no disk I/O — buffer is pre-populated in test setup)
```

### Test Setup Pattern

For each test file, build a minimal fixture graph in `beforeEach`:

```typescript
// Illustrative fixture setup — adapt as needed
const fixtureWeights = {
  connections: {
    "project:github.com/user/repo||tool:Bash": {
      source_node: "project:github.com/user/repo",
      target_node: "tool:Bash",
      connection_type: "project->tool",
      raw_count: 5,
      weight: 0.8,
      first_seen: "2025-01-01T00:00:00Z",
      last_seen: "2025-03-01T00:00:00Z"
    }
  },
  last_updated: "2025-03-01T00:00:00Z",
  version: "1.0"
};

const graph = buildGraph(fixtureWeights);

const app = fastify();
await app.register(cors, { origin: '*' });
registerGraphRoutes(app, () => graph);
await app.ready();
```

---

## Actual Implementation Notes

**Files created:**
- `src/routes/graph.ts` — registerGraphRoutes with /health, /graph, /graph/node/:id, /graph/subgraph, /graph/top
- `src/routes/events.ts` — registerEventsRoutes with /events; LogEntry type declared here
- `tests/routes/graph.test.ts` — 19 tests, all passing
- `tests/routes/events.test.ts` — 9 tests, all passing

**Dependency fix:** Upgraded @fastify/cors from v9 to v11 (v9 requires Fastify 4.x; project uses Fastify 5.x).

**Deviations from plan:** None. All 6 endpoints implemented as specified.

**Additional tests added (code review):**
- `?project=` empty string → 400 (not just missing param)
- Invalid/zero `?limit=` fallback tests for both /graph/top and /events
- CORS header assertion in events.test.ts
- 101-edge fixture for /graph/top clamping test (proves 200→100, not just ≤fixture size)

**Known issue for section 07:** `src/server.ts` scaffold has a conflicting `/health` route without `uptime`. Will remove when wiring up routes in section 07.

---

## Implementation Notes

- **Fastify route registration**: Use Fastify's typed route options. Query string params are accessed via `request.query` (typed as a record). Path params via `request.params`.
- **Limit parsing**: `parseInt(request.query.limit, 10)`. If `isNaN` or `<= 0`, fall back to default. Clamp upper bound with `Math.min`.
- **URL decoding**: Apply `decodeURIComponent` to `:id` before passing to `getNodeById`. Fastify may partially decode some characters but not all; explicit decoding is safer.
- **No Zod validation on these routes**: Zod validation is used for WebSocket messages (Section 05). REST query params are validated with simple `if` checks and `parseInt` — no schema plugin needed.
- **Reply serialization**: Return plain objects — Fastify serializes them to JSON with the correct `Content-Type: application/json` header automatically.
- **Error handling**: Route handlers do not need try/catch for the query functions (they are pure, no I/O, no throws). The only expected failure paths are missing params (400) and node not found (404).
