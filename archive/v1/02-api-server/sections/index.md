<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-foundation
section-02-graph-types
section-03-graph-queries
section-04-rest-routes
section-05-websocket
section-06-file-watcher
section-07-server-wiring
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-foundation | — | all | Yes |
| section-02-graph-types | 01 | 03, 04, 05, 06, 07 | No |
| section-03-graph-queries | 02 | 04, 07 | Yes |
| section-04-rest-routes | 02, 03 | 07 | Yes |
| section-05-websocket | 02 | 07 | Yes |
| section-06-file-watcher | 02 | 07 | Yes |
| section-07-server-wiring | 03, 04, 05, 06 | — | No |

## Execution Order

1. section-01-foundation (no dependencies)
2. section-02-graph-types (after 01)
3. section-03-graph-queries, section-04-rest-routes, section-05-websocket, section-06-file-watcher (parallel after 02)
4. section-07-server-wiring (after 03, 04, 05, 06)

## Section Summaries

### section-01-foundation
Project scaffold: `package.json` (`"type": "module"`, ESM), `tsconfig.json`, `vitest.config.ts`, all npm dependencies, `src/config.ts` with PORT validation and fail-fast behavior, minimal Fastify server stub, `npm run dev` and `npm test` scripts.

### section-02-graph-types
All shared TypeScript types (`GraphNode`, `GraphEdge`, `GraphResponse`, `InMemoryGraph` with `nodeIndex`, `edgeList`, `edgeIndex`, `adjacency`), re-declared `WeightsFile` type, and `buildGraph()` pure function in `src/graph/builder.ts`. Unit tests: empty graph, single connection, all three node types, weight sort order.

### section-03-graph-queries
Query functions in `src/graph/queries.ts`: `getFullGraph`, `getNodeById` (O(1) via `edgeIndex`), `getSubgraph` (exact match + normalization, no double-prefix), `getTopEdges` (slice of pre-sorted edgeList). Unit tests: happy path, not-found, empty graph, exact-match verification, no-double-prefix test.

### section-04-rest-routes
All 6 REST route handlers: `GET /health`, `GET /graph`, `GET /graph/node/:id`, `GET /graph/subgraph`, `GET /graph/top`, `GET /events`. Routes read from shared `InMemoryGraph` reference and event buffer passed via closure. Integration tests: real Fastify on random port, fixture data, all 6 endpoints, CORS headers, limit clamping.

### section-05-websocket
WebSocket message types (`src/ws/types.ts`): `ServerMessage` Zod discriminated union with `graph:snapshot` and `connection:new`. Broadcaster (`src/ws/broadcaster.ts`): `broadcast()`, `getClientCount()`. WebSocket route (`/ws`): sends immediate `graph:snapshot` on connect. Tests: snapshot on connect, broadcast to multiple clients, no send to closed clients.

### section-06-file-watcher
`src/watcher/index.ts`: chokidar v4 (ESM) watchers for `weights.json` and `logs/`. In-memory event buffer (capped 1000 entries, newest-first). Async `fs.promises.readFile` for weights. Per-file byte offset tracking for JSONL. Startup scan populates buffer without broadcasting. `unlink` on `weights.json` reverts to empty graph. Tests: offset tracking, deletion handling, buffer cap, startup scan vs live events, Promise-based polling (100ms/5s).

### section-07-server-wiring
Full `src/server.ts` wiring: register `@fastify/cors` (`origin: '*'`), `@fastify/websocket`, all routes, WebSocket route, file watchers with graph update + broadcast callbacks, initial graph load, `SIGINT` graceful shutdown (SIGTERM skipped — unreliable on Windows). End-to-end integration test: empty start → write fixture → poll for graph update → assert WebSocket client received broadcast.
