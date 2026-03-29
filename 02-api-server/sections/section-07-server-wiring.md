# Section 07 — Server Startup and Wiring

## Overview

This is the final integration section. It wires together all components built in sections 01–06 into a functioning server process. The primary file is `src/server.ts`, which you will convert from the minimal stub created in section 01 into the complete application entry point. You will also write an end-to-end integration test in `tests/server.integration.test.ts`.

**Dependencies (must be complete before this section):**
- Section 01: Project scaffold, `src/config.ts`, Fastify stub in `src/server.ts`
- Section 03: `src/graph/queries.ts` — `getFullGraph()`
- Section 04: `src/routes/graph.ts`, `src/routes/events.ts` — all route handlers
- Section 05: `src/ws/types.ts`, `src/ws/broadcaster.ts` — `broadcast()`, `setWss()`, `ServerMessage`
- Section 06: `src/watcher/index.ts` — `startWatchers()`, `stopWatchers()`, `getEventBuffer()`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/server.ts` | Rewrite (replaces section 01 stub) |
| `tests/server.integration.test.ts` | Create new |

---

## Tests First

File: `tests/server.integration.test.ts`

Write these tests before implementing the wiring. The tests start the full server (all plugins, routes, watchers) on a random port with a temp data root. Each test gets a fresh server instance and temp directory.

```typescript
// helpers: createTempDir / removeTempDir from tests/helpers/tempDir.ts
// Use a helper that starts the server on port 0 (Fastify random port) against a given dataRoot
// After each test: stop watchers, close Fastify, remove temp dir

// Test: server starts successfully with empty data root
//   - GET /health returns 200 with { status: 'ok', uptime: <number> }

// Test: GET /graph returns empty GraphResponse on fresh server with no weights.json
//   - response body has nodes: [], edges: []

// Test: writing weights.json to temp data root triggers watcher and updates /graph
//   - write a valid fixture weights.json (at least 2 nodes, 1 edge)
//   - poll GET /graph every 100ms up to 5s
//   - when nodes.length > 0, assert response matches the fixture data

// Test: connected WebSocket client receives graph:snapshot broadcast after weights.json is written
//   - connect a ws client to ws://127.0.0.1:<port>/ws BEFORE writing the file
//   - verify the immediate on-connect snapshot (type === 'graph:snapshot', payload.nodes === [])
//   - write fixture weights.json
//   - poll for a second received message (100ms / 5s timeout)
//   - verify message.type === 'graph:snapshot' and payload.nodes.length > 0

// Test: server refuses to start when port is already in use
//   - start two server instances on the same explicit port
//   - second createServer should throw / reject with a message referencing the port

// Test: SIGINT triggers graceful shutdown
//   - process.emit('SIGINT') on a running server
//   - verify the server stops accepting new connections
//   - verify connected WebSocket clients receive a close frame
```

**Timing convention:** All file-watcher assertions use Promise-based polling:

```typescript
// async function pollUntil(fn: () => Promise<boolean>, intervalMs = 100, timeoutMs = 5000): Promise<void>
// Rejects with timeout error if fn() never returns true within timeoutMs.
// Do NOT use fixed sleeps (setTimeout with hardcoded delays).
```

---

## Implementation: `src/server.ts`

Replace the section 01 stub with the full wiring implementation. The startup sequence must follow this exact order:

### 1. Config Load
Call `loadConfig()` from `src/config.ts`. If validation fails, the function exits the process before anything binds.

### 2. Fastify Instance
Create a Fastify instance with `logger: true`. Bind `127.0.0.1` only (never `0.0.0.0`) — this server is localhost-only.

### 3. Shared Mutable State
Declare module-level mutable state before registering anything:

```typescript
let graph: InMemoryGraph = buildGraph({ connections: {}, last_updated: '', version: '1.0' });
```

Route handlers close over this variable. The watcher callbacks reassign it. JavaScript's single-threaded event loop guarantees no torn reads between a watcher assignment and a concurrent route handler execution.

The event buffer is managed by Section 06's `getEventBuffer()` function — route handlers call `getEventBuffer()` rather than maintaining their own copy.

### 4. Register Plugins
Register in this order (order matters for Fastify's plugin encapsulation):

1. `@fastify/cors` with `{ origin: '*' }` — must be first so CORS headers apply to all subsequent routes, including error responses
2. `@fastify/websocket` — must be registered before any WebSocket route handler

After registering `@fastify/websocket`, call `setWss(fastify.websocketServer)` from `src/ws/broadcaster.ts` to give the broadcaster access to the `WebSocketServer` instance.

### 5. Register Routes
Call the route registration functions from Section 04:
- `registerGraphRoutes(app, () => graph)`
- `registerEventsRoutes(app, getEventBuffer)`

Route handlers must NOT hold a copy of the state — they must read from the shared reference on each request so they always see the latest graph after a watcher update.

### 6. Register WebSocket Route
Register the `/ws` route using `@fastify/websocket`'s route syntax:

```typescript
fastify.get('/ws', { websocket: true }, (socket, req) => {
  // On new connection: send snapshot directly to this client only
  const snapshot = getFullGraph(graph, new Date().toISOString());
  socket.send(JSON.stringify({ type: 'graph:snapshot', payload: snapshot }));
})
```

Sending directly to the new client (not via `broadcast()`) prevents existing clients from receiving a spurious second snapshot.

### 7. Start Watchers

Call `startWatchers(...)` from `src/watcher/index.ts`.

**`onGraphChange(newGraph, isStartup)`:**
```
- graph = newGraph
- if (!isStartup): broadcast({ type: 'graph:snapshot', payload: getFullGraph(newGraph, ...) })
```

Wait — actually the `onGraphChange` callback doesn't have an `isStartup` parameter per Section 06's design. The `isStartup` flag is only on `onNewLogEntry`. The weights.json watcher never fires during startup scan (it has `ignoreInitial: true`). So `onGraphChange` always triggers a broadcast.

```typescript
startWatchers(
  path.join(config.dataRoot, 'weights.json'),
  path.join(config.dataRoot, 'logs'),
  (newGraph) => {
    graph = newGraph;
    broadcast({ type: 'graph:snapshot', payload: getFullGraph(newGraph, new Date().toISOString()) });
  },
  (entry, isStartup) => {
    // entry is already added to the buffer by startWatchers internally via getEventBuffer
    // only broadcast if this is a live event (not startup scan)
    if (!isStartup) {
      broadcast({ type: 'connection:new', payload: entry });
    }
  },
  { stabilityThreshold: 300 }
);
```

### 8. Load Initial Graph

Before binding, attempt to load an initial graph from `weights.json`:

```typescript
try {
  const raw = await fs.promises.readFile(path.join(config.dataRoot, 'weights.json'), 'utf-8');
  graph = buildGraph(JSON.parse(raw));
} catch (err) {
  // ENOENT (file doesn't exist): silent, leave graph as empty
  // SyntaxError (invalid JSON): log to stderr, leave graph as empty
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.error('Failed to load initial weights.json:', err);
  }
}
```

This is a one-time `await` call before `fastify.listen()` so the first HTTP request already gets real data if available.

### 9. Bind the Server

```typescript
await fastify.listen({ port: config.port, host: '127.0.0.1' });
```

For port collisions, Fastify's `listen()` rejects with an error. The entry-point `main()` function catches this and re-logs it with the port number before re-throwing (or calling `process.exit(1)`).

### 10. SIGINT Handler

Register exactly one `process.on('SIGINT', ...)` handler. Do NOT register `SIGTERM` — it is not reliably delivered on Windows.

Shutdown sequence:
1. `await stopWatchers()` — prevents new graph/event callbacks during shutdown
2. `await fastify.close()` — closes the HTTP server, closes all active WebSocket connections, drains in-flight requests
3. `process.exit(0)`

If `fastify.close()` throws, catch and ignore — exit 0 regardless.

---

## Exported Factory Function (for Tests)

Structure `src/server.ts` so that the wiring is in an exported async factory function. This allows integration tests to start and stop server instances programmatically.

```typescript
export async function createServer(config: ServerConfig): Promise<{
  fastify: FastifyInstance;
  port: number;
  stop: () => Promise<void>;
}>
```

The `stop()` function runs the same shutdown sequence as the SIGINT handler (stop watchers, close Fastify) but does NOT call `process.exit()` — tests must not exit the process.

The module's top-level ESM entry-point guard calls `createServer` then registers the SIGINT handler only when the file is run directly:

```typescript
// ESM entry-point guard
import { fileURLToPath } from 'url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const { fastify, port } = await createServer(config);
  process.on('SIGINT', async () => {
    await stopWatchers();
    await fastify.close();
    process.exit(0);
  });
}
```

When the module is imported by tests, the guard does not fire and no server starts automatically.

---

## Integration Test Setup Pattern

```typescript
import { createServer } from '../../src/server.js';
import { createTempDir, removeTempDir } from '../helpers/tempDir.js';
import path from 'path';
import fs from 'fs/promises';

let tempDir: string;
let server: Awaited<ReturnType<typeof createServer>>;

beforeEach(async () => {
  tempDir = await createTempDir();
  // Create logs/ subdirectory (watcher expects it to exist or be creatable)
  await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });
  server = await createServer({
    port: 0,
    dataRoot: tempDir,
  });
});

afterEach(async () => {
  await server.stop();
  await removeTempDir(tempDir);
});
```

---

## Integration Test Fixtures

The integration tests need a fixture `WeightsFile` JSON. Define it inline in the test file:

```typescript
const fixtureWeights = {
  connections: {
    "project:test-project||tool:test-tool": {
      source_node: "project:test-project",
      target_node: "tool:test-tool",
      connection_type: "project->tool",
      raw_count: 3,
      weight: 0.75,
      first_seen: "2025-01-01T00:00:00.000Z",
      last_seen: "2025-03-01T00:00:00.000Z"
    }
  },
  last_updated: "2025-03-01T00:00:00.000Z",
  version: "1.0"
};
```

Write to `path.join(tempDir, 'weights.json')` for watcher tests.

---

## Key Constraints

**Single-threaded safety.** The shared `graph` variable is reassigned atomically from the watcher callback. Because Node.js is single-threaded, a route handler reading `graph` mid-request cannot see a partially-constructed graph.

**Port 0 in tests.** Pass `port: 0` in `ServerConfig` for tests. Retrieve the actual port after `fastify.listen()` with `fastify.server.address()?.port`.

**chokidar stabilization in tests.** Pass `{ stabilityThreshold: 50 }` to `startWatchers` inside `createServer` when `config.port === 0` (test mode), or add a separate `testMode` flag to the config. This prevents tests from waiting 300ms per file write event.

**No open handles after tests.** After `server.stop()`, all watchers must be closed and the Fastify server must be fully closed. If vitest reports open handles, verify that `stopWatchers()` and `fastify.close()` are both awaited in the `stop()` function.

---

## Definition of Done

- `src/server.ts` starts cleanly with `npm run dev` against the real data root
- `GET /health` responds immediately
- `GET /graph` returns real graph data after the watcher fires
- A `ws` client connecting to `ws://127.0.0.1:3747/ws` receives a `graph:snapshot` on connect
- All integration tests in `tests/server.integration.test.ts` pass with `npm test`
- No open handles after test teardown (Fastify closed, watchers stopped, ws clients closed)
