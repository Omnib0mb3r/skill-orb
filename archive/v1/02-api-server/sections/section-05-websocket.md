# Section 05 — WebSocket and Broadcaster

## Overview

This section implements the WebSocket layer: message type definitions, the broadcast infrastructure, and the WebSocket route that sends an immediate snapshot to newly connected clients. It depends on Section 02 (graph types and `InMemoryGraph`) and is consumed by Section 07 (server wiring).

**Dependencies:**
- Section 01 (foundation scaffold): project structure, `package.json`, `tsconfig.json`, vitest config
- Section 02 (graph types): `GraphResponse`, `InMemoryGraph`, `LogEntry` types from `src/graph/types.ts`

**Blocks:** Section 07 (server wiring) imports `broadcast` and registers the `/ws` route.

---

## Files to Create

```
src/ws/types.ts
src/ws/broadcaster.ts
tests/ws/broadcast.test.ts
```

---

## Tests First

File: `tests/ws/broadcast.test.ts`

Start a real Fastify server instance on a random port (`0`) for each test. Use the `ws` npm package to connect test clients. The server must have `@fastify/websocket` registered and the `/ws` route active.

```typescript
// Test: connecting a ws client to /ws immediately receives a graph:snapshot message
//   - message has type === 'graph:snapshot'
//   - payload matches current InMemoryGraph serialized as GraphResponse

// Test: graph:snapshot payload is a valid GraphResponse
//   - payload has nodes (array), edges (array), updated_at (ISO string)

// Test: calling broadcast({ type: 'graph:snapshot', payload }) sends the message to all OPEN clients
//   - connect 2 clients, call broadcast() once, both clients receive the message

// Test: broadcast does not send to CLOSED or CLOSING clients
//   - connect a client, close it, call broadcast(), no error is thrown and closed client receives nothing

// Test: getClientCount returns correct count as clients connect and disconnect
//   - 0 before any connections
//   - 1 after first client connects
//   - 2 after second client connects
//   - back to 1 after one disconnects (allow a tick for the close event to propagate)

// Test: broadcaster serializes the message only once regardless of client count
//   - connect 2 clients, verify the same serialized string is sent to both
//     rather than re-serializing per client
```

Use Promise-based helpers to await WebSocket messages. Never use fixed sleeps. A helper like:

```typescript
function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.once('error', reject);
  });
}
```

Keep tests independent: create and close a fresh Fastify instance in `beforeEach`/`afterEach`.

---

## Implementation Details

### `src/ws/types.ts`

Define the `ServerMessage` discriminated union using Zod. The Zod schema serves two purposes: compile-time TypeScript types (via `z.infer`) and runtime validation of any inbound client messages (which are ignored in MVP but should be parseable).

Two message variants:

| `type` field | `payload` type | When sent |
|---|---|---|
| `graph:snapshot` | `GraphResponse` | On client connect and on every `weights.json` change |
| `connection:new` | `LogEntry` | When a new JSONL line appears in `logs/` |

`GraphResponse` and `LogEntry` come from `src/graph/types.ts`. Define the `ServerMessage` Zod schema in terms of `z.object({ ... })` inline shapes matching those types.

Export:
- `ServerMessageSchema` — the Zod discriminated union
- `ServerMessage` — the inferred TypeScript type (`z.infer<typeof ServerMessageSchema>`)

Stub signature:

```typescript
// src/ws/types.ts
import { z } from 'zod';

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('graph:snapshot'), payload: /* GraphResponse shape */ }),
  z.object({ type: z.literal('connection:new'), payload: /* LogEntry shape */ }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
```

### `src/ws/broadcaster.ts`

Maintains a module-level reference to the `WebSocketServer` (`wss`) instance provided by `@fastify/websocket`. Exposes three exports:

**`setWss(server: WebSocketServer): void`** — called once during server startup (Section 07) after `@fastify/websocket` is registered. Stores the reference.

**`broadcast(msg: ServerMessage): void`** — serializes `msg` to JSON **once**, then iterates `wss.clients` and sends the serialized string to every client whose `readyState === WebSocket.OPEN`. Clients in `CONNECTING`, `CLOSING`, or `CLOSED` states are skipped silently.

**`getClientCount(): number`** — returns `wss.clients.size`. Returns 0 if `wss` has not been set yet.

The `WebSocketServer` type is `import { WebSocketServer } from 'ws'`. The `@fastify/websocket` plugin exposes the underlying `ws` server as `fastify.websocketServer`.

Key detail: serialize once, not per client:

```typescript
// src/ws/broadcaster.ts — stub
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from './types.js';

let wss: WebSocketServer | null = null;

export function setWss(server: WebSocketServer): void { /* store reference */ }

export function broadcast(msg: ServerMessage): void {
  // serialize ONCE here
  // iterate wss.clients, send only to OPEN
}

export function getClientCount(): number { /* wss?.clients.size ?? 0 */ }
```

### WebSocket Route (to be registered in `src/server.ts` in Section 07)

The `/ws` route is registered in `src/server.ts` but its behavior is defined here so Section 05 is self-contained. When Section 07 wires the server, the route must:

1. Use `@fastify/websocket` route syntax: `fastify.get('/ws', { websocket: true }, handler)`
2. The handler receives a `WebSocket` connection object
3. On new connection: send a `graph:snapshot` directly to the new client (not `broadcast()` which would send to all existing clients too). Use `socket.send(JSON.stringify({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) }))`.
4. On close: the `ws` library automatically removes the closed socket from `wss.clients` — no manual cleanup needed.

For the tests in this section, you will need a minimal server fixture that registers the plugin and the `/ws` route with a test graph. The test setup does not need to involve the file watcher — just pass a fixed `InMemoryGraph` into the route closure.

---

## Background Context

**Why a single serialization:** The message content does not vary per client, so per-client serialization would be wasteful and potentially inconsistent.

**Why `readyState === WebSocket.OPEN` check:** The `ws` library does not guarantee that `wss.clients` contains only fully open connections. A client that closed between the start of the loop and the send attempt would throw without the guard.

**No debounce needed:** The chokidar `awaitWriteFinish` stabilization window (300ms in production, 50ms in tests) coalesces rapid successive writes into a single `change` event. The broadcaster does not need its own debounce or rate limiter at this scale.

**`connection:new` events** are sent from the file watcher (Section 06) by calling `broadcast({ type: 'connection:new', payload: entry })`. The broadcaster does not know whether a message is a snapshot or a new connection — it just serializes and sends whatever `ServerMessage` it receives.

**Inbound messages from clients** are ignored in the MVP. The `ServerMessageSchema` is defined now so that the format is documented and future bidirectional features have a type-safe foundation. If you add a `ws.on('message', ...)` handler in the route, it should parse with `ServerMessageSchema.safeParse` and log unrecognized messages at debug level without throwing.

---

## Dependency Notes

- `src/graph/types.ts` must exist (Section 02) before implementing `src/ws/types.ts`, because `ServerMessage` payload types reference `GraphResponse` and `LogEntry`.
- `src/ws/broadcaster.ts` does not import from `src/watcher/` or `src/routes/` — it is a pure send utility. The watcher (Section 06) and server wiring (Section 07) import from the broadcaster, not the other way around.
- The `ws` package is already listed as a dev dependency in `package.json` from Section 01. `@fastify/websocket` bundles its own `ws` instance — use the types from `ws` but let `@fastify/websocket` manage the actual WebSocket server lifecycle.
