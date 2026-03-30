# Section 11: WebSocket Handlers (`section-11-ws-handlers`)

## Overview

This section implements `src/ws/client.ts` and `src/ws/handlers.ts` in `03-web-app`. These modules extract and expand the inline WebSocket code currently living in `src/main.ts`, adding proper auto-reconnect logic and handling all five event types — including the three new voice events introduced in section-01-api-extensions.

**Depends on:** section-09-web-foundation (project bootstrap, `src/graph/types.ts`, `src/orb/visuals.ts`)

**Parallel with:** section-10-orb-renderer

**Blocks:** section-12-integration (wires everything into `src/main.ts` and `public/index.html`)

Tests run in `03-web-app/`.

---

## Background

The `03-web-app` Vite browser app connects to `ws://localhost:3747/ws` and receives server-push events from `02-api-server`. The full event protocol required by the voice interface includes five event types:

| Event Type | Direction | Payload |
|------------|-----------|---------|
| `graph:snapshot` | server → clients | Full graph (`nodes`, `edges`) |
| `connection:new` | server → clients | Single edge log entry |
| `voice:focus` | server → clients | `{ nodeId: string }` |
| `voice:highlight` | server → clients | `{ nodeIds: string[] }` |
| `voice:clear` | server → clients | `{}` |

Voice events arrive because the `05-voice-interface` posts them to `POST /voice/command` on the api-server, which calls `broadcast()` to push them to all connected WebSocket clients including this browser app.

---

## Files to Create/Modify

- **Create** `03-web-app/src/ws/handlers.ts`
- **Create** `03-web-app/src/ws/client.ts`
- **Modify** `03-web-app/src/types.ts` — extend `WsMessage` union with three new voice event variants
- **Create** `03-web-app/tests/ws/handlers.test.ts`

The existing `src/main.ts` WebSocket block is left intact for now; section-12-integration will rewire `main.ts` to use these new modules.

---

## Tests First

File: `03-web-app/tests/ws/handlers.test.ts`

All Three.js tests use `vi.mock('three')` at the top of the test file.

```typescript
// vi.mock('three') at top of file

// Test: graph:snapshot handler → clears scene (scene.clear called), then rebuilds (builder.build called)
// Test: connection:new handler → adds one new mesh to scene (not full rebuild, scene.clear NOT called)
// Test: voice:focus handler → sets focusedNodeId state, triggers highlight material on that node
// Test: voice:highlight handler → sets highlighted node IDs, dims all other nodes
// Test: voice:highlight with empty nodeIds → same effect as voice:clear (all nodes restored to default materials)
// Test: voice:clear handler → restores all nodes to default materials, resets camera position state
// Test: snapshot received before scene init → buffered in pendingSnapshot, applied once scene ready
// Test: WebSocket reconnect → exponential backoff delay increases between successive attempts
```

For reconnect tests, mock `WebSocket` globally and advance timers with `vi.useFakeTimers()`. Verify that the delay passed to `setTimeout` doubles on each reconnect attempt and is capped at 30 seconds.

For the `pendingSnapshot` test, simulate the handler being invoked before the scene-ready flag is set, then set the flag and confirm the snapshot is applied on the next tick.

---

## `src/types.ts` — Extend WsMessage

Add three new members to the `WsMessage` discriminated union (the existing `graph:snapshot` and `connection:new` variants are already present):

```typescript
| { type: 'voice:focus'; payload: { nodeId: string } }
| { type: 'voice:highlight'; payload: { nodeIds: string[] } }
| { type: 'voice:clear'; payload: Record<string, never> }
```

The `voice:clear` payload is typed as an empty object — `Record<string, never>` is appropriate since the server sends `{}`. No other changes to this file.

---

## `src/ws/handlers.ts`

This module exports five handler functions, one per event type, plus a `SceneRef` interface that gives the handlers access to the live Three.js scene without importing it directly (avoids circular dependency with the renderer).

### SceneRef interface

The handlers do not import Three.js scene objects directly. Instead they accept a `SceneRef` parameter — a plain object with methods that the caller (eventually `main.ts`) provides. This makes the handlers independently testable without a real Three.js context.

```typescript
interface SceneRef {
  clear(): void;
  rebuild(snapshot: GraphSnapshot): void;
  addEdge(edge: ConnectionNewPayload): void;
  setFocusNode(nodeId: string): void;
  setHighlightNodes(nodeIds: string[]): void;
  clearHighlights(): void;
}
```

### Handler functions

`handleSnapshot(scene: SceneRef, payload: GraphSnapshot, isReady: () => boolean, setPending: (s: GraphSnapshot) => void): void`
- If `isReady()` is false, call `setPending(payload)` and return.
- Otherwise: call `scene.clear()`, then `scene.rebuild(payload)`.

`handleConnectionNew(scene: SceneRef, payload: ConnectionNewPayload): void`
- Calls `scene.addEdge(payload)`. Does NOT call `scene.clear()`.

`handleVoiceFocus(scene: SceneRef, payload: { nodeId: string }): void`
- Calls `scene.setFocusNode(payload.nodeId)`.

`handleVoiceHighlight(scene: SceneRef, payload: { nodeIds: string[] }): void`
- If `payload.nodeIds.length === 0`, calls `scene.clearHighlights()` (protocol invariant: empty highlight array = clear).
- Otherwise calls `scene.setHighlightNodes(payload.nodeIds)`.

`handleVoiceClear(scene: SceneRef): void`
- Calls `scene.clearHighlights()`.

The `handleVoiceHighlight` empty-array guard is the key protocol invariant: the voice handler in `05-voice-interface` sends `voice:highlight` with an empty array for the "no results" case, expecting the orb to reset to default view. Both the voice side and the browser side must agree on this behavior.

---

## `src/ws/client.ts`

This module manages the WebSocket lifecycle: connection, message dispatch, and auto-reconnect.

### Reconnect logic

Use exponential backoff starting at 1 second, doubling on each failed attempt, capped at 30 seconds. A `reconnectDelay` variable tracks the current delay. Reset it to the initial value (1 second) on successful connection (`onopen`).

```typescript
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
```

### pendingSnapshot buffer

A `pendingSnapshot: GraphSnapshot | null` module-level variable holds a snapshot that arrived before the scene was initialized. The client accepts an `isSceneReady: () => boolean` callback. When a snapshot arrives and `isSceneReady()` returns false, it is stored in `pendingSnapshot`. The caller is responsible for calling `applyPendingSnapshot(scene)` once the scene is ready.

`applyPendingSnapshot(scene: SceneRef): void` — if `pendingSnapshot` is not null, calls `handleSnapshot(scene, pendingSnapshot, () => true, () => {})`, then sets `pendingSnapshot = null`.

### connect function

```typescript
function connect(
  url: string,
  scene: SceneRef,
  isSceneReady: () => boolean,
): void
```

Creates a `new WebSocket(url)`. Wires `onopen`, `onmessage`, and `onclose`.

`onmessage`: Parse `event.data` as JSON, switch on `msg.type`, dispatch to the appropriate handler. Wrap in try/catch and ignore malformed messages silently.

`onclose`: Schedule `setTimeout(() => connect(url, scene, isSceneReady), reconnectDelay)`, then double `reconnectDelay` (capped at `MAX_RECONNECT_DELAY_MS`).

The URL to connect to is `ws://localhost:3747/ws`. This is the port where `02-api-server` runs its WebSocket server.

---

## State Management Notes

The handlers in `handlers.ts` are pure functions — they take a `SceneRef` and a payload and call methods on `SceneRef`. They carry no module-level state of their own. The `pendingSnapshot` buffer lives in `client.ts` as the connection manager's responsibility.

The `SceneRef` implementation is provided by `src/orb/renderer.ts` (section-10-orb-renderer). In tests, it is a plain mock object with `vi.fn()` methods.

The `focusedNodeId` and `highlightedNodeIds` state used by `handleVoiceFocus` and `handleVoiceHighlight` is maintained inside the `SceneRef` implementation (renderer), not in the handlers. The handlers call methods on `SceneRef`; the renderer updates its own internal state and applies materials accordingly.

---

## Visual Behavior Specified by Handlers

These behaviors are specified here so the renderer implementation in section-10 can be validated against them. The handlers determine when these visual states are triggered; the renderer determines how they look.

- `voice:focus`: The target node's material switches to the highlight material (brighter, different color). Camera state is set to center on that node.
- `voice:highlight` with non-empty array: Named nodes use highlight material; all other nodes use the dimmed material.
- `voice:highlight` with empty array or `voice:clear`: All nodes return to their default material. Camera returns to its default (auto-orbit) position.
- `connection:new`: One new edge mesh is added. The force simulation restarts (velocity threshold reset) to accommodate the new node if it didn't exist yet.

---

## Implementation Checklist

1. Extend `src/types.ts` with the three new voice event variants on `WsMessage`.
2. Create `src/ws/handlers.ts` with the `SceneRef` interface and five handler functions.
3. Create `src/ws/client.ts` with reconnect backoff, `pendingSnapshot` buffer, and the `connect()` function.
4. Write `tests/ws/handlers.test.ts` with `vi.mock('three')` and tests for all eight test cases listed above.
5. Verify `npm test` passes in `03-web-app/`.
