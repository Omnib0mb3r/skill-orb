# Code Review Interview: section-11-ws-handlers

## Auto-fixes Applied

### Fix 1: Move mutable state into connect() closure, return handle (CRITICAL)
`reconnectDelay` and `pendingSnapshot` moved from module scope into the `connect()` closure.
`connect()` now returns `{ applyPendingSnapshot }` instead of void. Tests updated accordingly.

### Fix 2: Pass msg.payload directly to handleConnectionNew
Replace manual field spread with direct pass. TypeScript structural compatibility enforces safety.

### Fix 3: Add ws.onerror = () => {}
Silent error suppression prevents unhandled browser error events.

### Fix 4: Add resetCamera() to SceneRef, call from handleVoiceClear
Implements the plan's camera-reset requirement on voice:clear.

### Fix 5: Derive ConnectionNewPayload from WsMessage union
Uses `Extract<WsMessage, { type: 'connection:new' }>['payload']` to tie types together.

### Fix 6: Add resetCamera assertion to voice:clear test

## Let Go
- Plan return type was `void` for connect(); changing to connection handle is intentional deviation for correctness.
