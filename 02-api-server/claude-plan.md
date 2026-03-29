# 02-api-server — Implementation Plan

---

## What We Are Building

A lightweight Node.js/TypeScript HTTP + WebSocket server that reads the graph data produced by the DevNeural data layer (`01-data-layer`) and serves it to all DevNeural consumers. The server is a **read-only observer** — it never writes to the data root. Its two jobs are: serve REST queries about the graph, and push real-time updates to connected WebSocket clients whenever the underlying data changes.

The server bridges the gap between the file-based data layer (weights.json + daily JSONL logs) and the visual/intelligent consumers that need to query or subscribe to that data: a Three.js VS Code panel, a session-start intelligence hook, a voice interface, and a NotebookLM integration.

---

## Architecture Overview

The server is a single Node.js process that runs persistently on port 3747 (`127.0.0.1` only). It binds a Fastify HTTP server with a WebSocket upgrade handled by `@fastify/websocket` on the same port — HTTP and WebSocket traffic share a single listener. On startup, it loads `weights.json` into an in-memory graph representation and scans existing log files into an in-memory event buffer. Two chokidar file watchers run continuously: one on `weights.json`, one on the `logs/` directory. When `weights.json` changes, the in-memory graph is rebuilt and a full snapshot is broadcast to all connected WebSocket clients. When new log lines appear, individual `connection:new` events are broadcast.

The internal graph is a plain in-memory structure (Maps and Sets) — no graph database, no external graph library in the MVP. At the expected scale (dozens to low thousands of nodes), this fits in under 1MB of heap and gives sub-millisecond lookup times.

---

## Technology Stack

**Framework:** Fastify (not Express, not Hono). Rationale: `@fastify/websocket` shares the HTTP port with no extra server management; Fastify's plugin system means authentication hooks, logging, and validation all apply equally to HTTP and WebSocket routes. For this fixed Node.js/Windows deployment, Fastify's Node-native design is a direct advantage.

**Module system:** ESM (`"type": "module"` in package.json). The API server is a standalone long-running process — it is never `require()`'d by hook scripts. Using ESM is consistent with modern Node.js and required by chokidar v4. This differs intentionally from `01-data-layer`, which uses CommonJS because it is imported by the Claude Code hook runner.

**File watching:** chokidar v4 (not `fs.watch`). `fs.watch` on Windows coalesces events, emits rename vs. replace ambiguously, and produces duplicate callbacks. chokidar normalizes these into clean `add`/`change`/`unlink` events. The `awaitWriteFinish` option with a 300ms stabilization threshold is used for `weights.json` — `01-data-layer` uses atomic writes (write to temp file + `fs.rename`), and the stabilization window ensures the watcher fires only after the rename completes at the OS level, not on the intermediate temp file creation event.

**WebSocket:** `ws` accessed via `@fastify/websocket`. Socket.IO is not used (unnecessary protocol overhead for a controlled localhost consumer). Message schemas use Zod discriminated unions for both compile-time type safety and runtime validation.

**Graph storage:** In-memory adjacency list using `Map` and `Set`. No third-party graph library in MVP. The `WeightsFile` structure (keyed by `"source||target"` strings) is unpacked into a proper node/edge representation at load time. Graph is rebuilt from scratch on each file change — at this scale, a full rebuild takes under 1ms.

**CORS:** `@fastify/cors` with `origin: '*'`. The VS Code extension's Three.js panel runs in a webview with origin `vscode-webview://`, which will be rejected without CORS headers. Localhost-only binding makes `origin: '*'` safe.

**Testing:** vitest (same as `01-data-layer`). Tests follow the same pattern: temp directories for I/O tests, vitest's built-in mock system for file watcher unit tests, and real Fastify server instances on random ports for integration tests.

---

## Project Structure

```
02-api-server/
├── src/
│   ├── server.ts          — Fastify app factory and startup entry point
│   ├── config.ts          — ServerConfig interface, env var loading, validation
│   ├── graph/
│   │   ├── types.ts       — GraphNode, GraphEdge, GraphResponse, InMemoryGraph
│   │   ├── builder.ts     — WeightsFile → InMemoryGraph (pure, no I/O)
│   │   └── queries.ts     — subgraph, top-N, node-by-id lookups against InMemoryGraph
│   ├── routes/
│   │   ├── graph.ts       — REST route handlers for /graph, /graph/node/:id, /graph/subgraph, /graph/top
│   │   └── events.ts      — REST route handler for /events (reads from in-memory event buffer)
│   ├── ws/
│   │   ├── types.ts       — ServerMessage discriminated union (Zod schema + TS type)
│   │   └── broadcaster.ts — broadcast(), wss reference management
│   └── watcher/
│       └── index.ts       — chokidar setup, change handlers, event buffer, watcher lifecycle
├── tests/
│   ├── helpers/
│   │   └── tempDir.ts     — createTempDir / removeTempDir (same pattern as 01-data-layer)
│   ├── graph/
│   │   ├── builder.test.ts
│   │   └── queries.test.ts
│   ├── routes/
│   │   ├── graph.test.ts
│   │   └── events.test.ts
│   └── ws/
│       └── broadcast.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Section Breakdown

### Section 01 — Foundation Scaffold

Set up the project: `package.json` (with `"type": "module"`), `tsconfig.json`, `vitest.config.ts`. Install all dependencies (fastify, @fastify/websocket, @fastify/cors, chokidar, zod, typescript, vitest, tsx, @types/node). Create the directory structure. Define the `ServerConfig` interface and env var loading in `src/config.ts`.

**Config validation:** `PORT` must parse as a valid integer in range 1–65535 (default: 3747). `DEVNEURAL_DATA_ROOT` must be a non-empty string (default: `C:/dev/data/skill-connections` — this default is intentionally machine-specific and Windows-only; override via env var for portability). Invalid config fails fast at startup with a clear error message before the server binds.

**Scripts in package.json:**
- `npm start` — `node dist/server.js` (compiled output)
- `npm run dev` — `tsx --watch src/server.ts` (auto-restart on source change during development)
- `npm run build` — `tsc`
- `npm test` — `vitest run`

Write a minimal `src/server.ts` that creates a Fastify instance and listens on the configured port. Verify the project scaffolds, compiles, and starts with no errors.

No test file for this section — the smoke test is `npm run dev` printing the bound port.

### Section 02 — Graph Types and Builder

Define all shared TypeScript types in `src/graph/types.ts`:

- `GraphNode` — `{ id: string; type: 'project' | 'tool' | 'skill'; label: string }`
- `GraphEdge` — `{ id: string; source: string; target: string; connection_type: ConnectionType; raw_count: number; weight: number; first_seen: string; last_seen: string }`
- `GraphResponse` — `{ nodes: GraphNode[]; edges: GraphEdge[]; updated_at: string }`
- `InMemoryGraph` — internal structure with:
  - `nodeIndex: Map<string, GraphNode>` — O(1) lookup by node id
  - `edgeList: GraphEdge[]` — all edges, sorted descending by weight at build time
  - `edgeIndex: Map<string, GraphEdge>` — O(1) lookup by edge id
  - `adjacency: Map<string, string[]>` — maps node id → list of edge ids the node participates in

Implement `buildGraph(weights: WeightsFile): InMemoryGraph` in `src/graph/builder.ts`. This is a pure function with no I/O. It iterates `weights.connections`, extracts node ids from `source_node` and `target_node`, parses the type prefix (`project:`, `tool:`, `skill:`), populates `nodeIndex`, builds `edgeList` sorted descending by weight, populates `edgeIndex`, and populates `adjacency` (each node maps to the edge ids it participates in). An empty `WeightsFile` (no connections) produces an empty graph with no error.

The `WeightsFile` type is the same type used by `01-data-layer`. Rather than importing from `01-data-layer`'s dist, re-declare the minimal subset needed here (the two interfaces and the ConnectionType union). This avoids a cross-package coupling that would break if `01-data-layer` is refactored.

Tests: unit tests for `buildGraph` covering an empty weights file, a single connection, multiple connections of all three types, and the output sort order.

### Section 03 — Graph Query Functions

Implement `src/graph/queries.ts` with three query functions operating on `InMemoryGraph`:

**`getFullGraph(graph: InMemoryGraph, updatedAt: string): GraphResponse`** — serializes the full graph into the REST response shape. Collects all nodes from `nodeIndex` and all edges from `edgeList`.

**`getNodeById(graph: InMemoryGraph, nodeId: string): { node: GraphNode; edges: GraphEdge[] } | null`** — looks up a node by id in `nodeIndex`. Returns the node plus all edges it participates in: use `adjacency` to get edge ids, then `edgeIndex` for O(1) edge retrieval. Returns `null` if not found.

**`getSubgraph(graph: InMemoryGraph, projectId: string): GraphResponse`** — returns all nodes and edges where the edge's source or target **exactly equals** the normalized project node id. Normalization: if `projectId` already starts with `project:`, use it as-is; otherwise prepend `project:`. This prevents double-prefixing (e.g., `project:project:foo`). Exact match only — no prefix/substring matching. The `projectId` parameter may come from a URL query string like `?project=github.com/user/repo`.

**`getTopEdges(graph: InMemoryGraph, limit: number): GraphResponse`** — returns the top `limit` edges by weight (descending). Since `edgeList` is already sorted at build time, this is a simple slice. Collects only the nodes referenced by those edges.

Tests: one test per function covering the happy path, edge cases (not-found, empty graph, limit > total edges), and correct node extraction for subgraph/top. Include a test that passes `project:github.com/user/repo` (already prefixed) to `getSubgraph` and verifies it does not double-prefix.

### Section 04 — REST Routes

Register all HTTP routes in `src/routes/graph.ts` and `src/routes/events.ts`, mounted in `src/server.ts`.

**`GET /health`** — returns `{ status: "ok", uptime: process.uptime() }`. Used by consumers to check if the server is running before attempting WebSocket connection.

**`GET /graph`** — calls `getFullGraph()` on the current in-memory graph. Returns `GraphResponse`. If the graph is empty (data root has no weights.json yet), returns `{ nodes: [], edges: [], updated_at: new Date().toISOString() }` with 200 OK — never 404.

**`GET /graph/node/:id`** — URL-decodes `:id`, calls `getNodeById()`. Returns `{ node, edges }` or `404 { error: "Node not found" }`.

**`GET /graph/subgraph`** — reads `?project=` query param (required). Returns 400 if missing. Calls `getSubgraph()`. Returns `GraphResponse`.

**`GET /graph/top`** — reads `?limit=` query param (default 10, max 100). Calls `getTopEdges()`. Returns `GraphResponse`.

**`GET /events`** — reads `?limit=` query param (default 50, max 500). Returns the most recent log entries from the in-memory event buffer (see Section 06 for buffer definition). Returns `{ events: LogEntry[]; total: number }` (entries are newest-first). This endpoint reads from memory, not from disk.

Route handlers hold no state themselves — they receive the current `InMemoryGraph` and event buffer via a shared mutable reference managed by a server-level closure. When chokidar rebuilds the graph or adds log entries, the references are updated; subsequent requests use the new state.

Tests: integration tests using a real Fastify instance bound to a random port, with a temp data root populated with fixture JSON. Tests cover all 6 endpoints, including the empty-graph 200 response, the 404 for unknown nodes, the limit clamping for /top and /events, and the CORS header presence on responses.

### Section 05 — WebSocket and Broadcaster

Implement the WebSocket message types and broadcast infrastructure.

**`src/ws/types.ts`** defines the `ServerMessage` discriminated union using Zod:
- `{ type: 'graph:snapshot'; payload: GraphResponse }` — full graph, sent on connect and on every weights.json change
- `{ type: 'connection:new'; payload: LogEntry }` — individual log entry, sent when a new line appears in the log files

The Zod schema is used for runtime validation of any inbound messages from clients (which are ignored in the MVP, but the schema documents the expected format for future bidirectional use).

**`src/ws/broadcaster.ts`** maintains a reference to the `WebSocketServer` instance from `@fastify/websocket` and exposes a `broadcast(msg: ServerMessage): void` function. The function serializes the message once and iterates `wss.clients`, sending only to `OPEN` connections. It exposes a `getClientCount(): number` for health/diagnostic use.

The WebSocket route (`GET /ws`, upgraded to WebSocket) is registered in `src/server.ts` using Fastify's websocket route syntax. On new connection, it immediately sends a `graph:snapshot` with the current graph state. On close, the client is automatically removed from `wss.clients` by the `ws` library.

**Note on burst writes:** The chokidar `awaitWriteFinish` 300ms stabilization window provides natural throttling — if multiple writes arrive within the window, a single `change` event fires. No additional debounce is needed at the current scale.

Tests: start a Fastify server on a random port, connect a `ws` client, verify the immediate snapshot on connect, simulate a graph update by calling the broadcaster directly, verify the client receives the new snapshot.

### Section 06 — File Watcher and Event Buffer

Implement `src/watcher/index.ts` which creates and manages both chokidar watchers and the in-memory event buffer. This module exports a `startWatchers(dataRoot, onGraphChange, onNewLogEntry)` function and a `stopWatchers()` function for clean shutdown.

**In-memory event buffer:**
A capped array of the 1000 most recent `LogEntry` objects, stored newest-first. When a new entry arrives from the log watcher, it is prepended; if the array exceeds 1000, the oldest entry is dropped. On server restart, the buffer is repopulated during the startup scan (see below). `GET /events` reads from this buffer — no disk I/O at request time.

**weights.json watcher:**
Watches `<dataRoot>/weights.json` with `awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }` and `ignoreInitial: true`. On `change`: read `weights.json` using `fs.promises.readFile` (async — no blocking), parse JSON, call `onGraphChange(newGraph)`. On `unlink` (file deleted while running): revert to an empty graph and call `onGraphChange(emptyGraph)`. Handles the case where `weights.json` does not yet exist at startup by watching the parent directory for an `add` event, then switching to a file watcher once it appears.

**logs/ directory watcher:**
Watches `<dataRoot>/logs` with `depth: 0`, `ignoreInitial: false` (so existing files are processed at startup). Maintains a `Map<string, number>` of `filePath → lastByteOffset` to track how far into each JSONL file has been consumed. On `add` (new file) or `change` (new bytes appended): read from the last known offset to the end of the file using `fs.promises.read`, parse each complete line as a `LogEntry`, advance the offset, and call `onNewLogEntry(entry)` for each new entry.

**Startup scan:** On startup, the watcher processes all existing log files from byte offset 0 to populate the in-memory event buffer. These entries are added to the buffer but are NOT broadcast as WebSocket events (they are historical data). Only entries arriving after startup are broadcast as `connection:new` events.

**Important:** Offsets are in-memory only — they do not survive server restarts. This is intentional and acceptable: on each restart, the startup scan re-reads all log files into the event buffer (at current data volumes, this takes well under 1 second). The buffer is always fresh after startup.

**Note on log entry multiplicity:** A single tool invocation may produce multiple log entries with the same `tool_use_id` but different `connection_type` values (one `project->tool` entry and one `project->project` entry, for example). The watcher emits one `connection:new` event per log line — this is correct behavior. Deduplication by `tool_use_id` is the consumer's responsibility, not the server's.

Error handling: if `weights.json` parse fails, log to stderr and retain the last valid graph. If a JSONL line fails to parse, log and skip — do not crash.

Tests: unit tests using temp directories. Create a temp data root, write fixture files, start watchers, verify callbacks fire. Test the partial-read / offset tracking: write 3 lines to a JSONL file, verify 3 callbacks; append 2 more, verify only 2 new callbacks. Test `weights.json` deletion: verify `onGraphChange` is called with an empty graph. Use Promise-based event awaiting (poll every 100ms, timeout at 5 seconds) — not fixed sleeps — to handle Windows filesystem event latency.

### Section 07 — Server Startup and Wiring

Wire everything together in `src/server.ts`. The startup sequence:

1. Load and validate `ServerConfig` from env vars (fail fast if invalid)
2. Create the Fastify instance with pino logging
3. Register `@fastify/cors` with `origin: '*'`
4. Register `@fastify/websocket`
5. Register routes (graph + events handlers)
6. Register WebSocket route (`/ws`)
7. Start file watchers with callbacks that (a) update the shared `InMemoryGraph` reference and (b) broadcast to WebSocket clients
8. Load the initial graph from `weights.json` (or empty graph if file absent)
9. Bind the server to `127.0.0.1:<port>`
10. Log the bound address

**Shutdown:** Register `process.on('SIGINT', ...)` for Ctrl+C handling: close the Fastify server (closes all WS connections), stop chokidar watchers, exit 0. Note: `SIGTERM` is not reliably delivered on Windows — do not register it. Since the server is read-only and holds no write locks, abrupt termination via `taskkill` is safe and produces no data loss.

The shared graph state is managed by a single mutable `let graph: InMemoryGraph` in `server.ts`. Route handlers close over this reference. The watcher callback atomically replaces it (`graph = newGraph`). JavaScript's single-threaded event loop guarantees no torn reads between the watcher update and a concurrent route handler.

Tests: end-to-end integration test — start the full server, verify `/health`, verify `/graph` returns an empty graph, write a fixture `weights.json` to the temp data root, poll every 100ms (up to 5 seconds) for the chokidar watcher to fire, verify `/graph` returns the updated graph and a connected WebSocket client received the `graph:snapshot` broadcast.

---

## Testing Strategy

All tests use vitest. The pattern mirrors `01-data-layer`:

- **Unit tests** (sections 02, 03, 06): pure functions or functions with mocked I/O. No server or network.
- **Integration tests** (sections 04, 05, 07): real Fastify server on a random port, real WebSocket clients, temp data root with fixture files.
- **No mocks for chokidar in integration tests**: tests write actual files to the temp dir and assert on callbacks. chokidar's `awaitWriteFinish` threshold is set lower in test mode (50ms stabilization) to keep tests fast.
- **File watcher timing**: use Promise-based polling (100ms interval, 5-second timeout) rather than fixed sleeps. This handles Windows filesystem event latency reliably without flakiness.

A `tests/helpers/tempDir.ts` module (same as `01-data-layer`) provides `createTempDir()` and `removeTempDir()` for `beforeEach`/`afterEach` cleanup.

---

## Key Constraints and Edge Cases

**The server is read-only.** It holds no lock on `weights.json` and never writes to the data root. If the hook runner (`01-data-layer`) and the API server read `weights.json` at the same time, the atomic write guarantee from `write-file-atomic` means the server either reads the previous complete file or the new complete file — never a partial one. The `awaitWriteFinish` 300ms stabilization window adds further safety by waiting for the rename to complete at the OS level before reading.

**Consumer cwd vs. project id for subgraph queries.** The 04-session-intelligence hook will query `GET /graph/subgraph?project=<something>` at session start. The "something" is the project's canonical id (e.g. `github.com/Omnib0mb3r/DevNeural`), not the raw `cwd`. The hook should resolve the project id itself (using the same logic as `01-data-layer`'s `resolveProjectIdentity`) before calling the API. The API server does not do cwd resolution — it only knows graph node ids.

**Port collision.** If port 3747 is in use when the server starts, Fastify will throw and the process will exit. The error message should clearly state the port. No automatic port selection — consumers need a stable address.

**Empty data root.** The server must start successfully even if `C:/dev/data/skill-connections/` does not exist or is empty. All REST endpoints return empty responses; WebSocket clients receive an empty `graph:snapshot` on connect. The file watchers gracefully handle a missing directory by watching the parent or retrying after a delay.

**Large `tool_input` in log entries.** Log entries from `Write` or `Edit` operations store the full file contents in `tool_input`. When serving `GET /events`, the server returns these from the in-memory buffer as-is. The 1000-entry buffer cap limits unbounded memory growth. Future optimization: add a `?stripped=true` query param that omits `tool_input` from the response. Not in MVP scope.
