# Code Review: section-11-ws-handlers

## Critical

**1. client.ts lines 35–36 — Module-level mutable state causes test contamination and prevents multiple connections**
`reconnectDelay` and `pendingSnapshot` are module-scope singletons. Tests that trigger onclose events leave `reconnectDelay` doubled, contaminating subsequent tests. `applyPendingSnapshot` needs to be scoped per-connection.
**Fix**: Move all mutable state into the `connect()` closure; return a connection handle `{ applyPendingSnapshot }` instead of void.

## Significant

**2. client.ts lines 53–59 — `connection:new` payload manually reconstructed instead of passed through**
Manual field spread is a maintenance trap. `msg.payload` is structurally identical to `ConnectionNewPayload`.
**Fix**: Call `handleConnectionNew(scene, msg.payload)` directly.

**3. client.ts after line 43 — No `onerror` handler on WebSocket**
Unhandled `onerror` fires before `onclose` and produces console errors in production.
**Fix**: Add `ws.onerror = () => {}`.

**4. handlers.ts — `voice:clear` drops camera-reset requirement (plan lines 179–180)**
Plan specifies "Camera returns to its default (auto-orbit) position" on clear. `SceneRef` has no camera-reset method and `handleVoiceClear` doesn't call one.
**Fix**: Add `resetCamera()` to `SceneRef` interface; call it from `handleVoiceClear`.

## Minor

**5. handlers.ts — `ConnectionNewPayload` is a detached parallel type**
Not tied to the `WsMessage` union; will silently diverge if types.ts evolves.
**Fix**: Derive via `Extract<WsMessage, { type: 'connection:new' }>['payload']`.

**6. tests — `voice:clear` test doesn't assert camera state**
After adding `resetCamera()` to SceneRef, the test should assert it was called.

## Verdict
Critical fix: connection-scoped state. All others are auto-fixable.
