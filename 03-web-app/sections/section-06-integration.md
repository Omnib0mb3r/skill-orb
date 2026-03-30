# section-06-integration

## Overview

End-to-end integration: verifies the full pipeline from Python server through WebSocket
to the Three.js visualization. Includes cross-component integration tests, vitest gap
coverage, and a browser smoke test.

**Depends on:** All prior sections (01–05) complete.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/__tests__/gap-coverage.test.ts` | Created — 9 tests for capAndTransform, applyEdgeColors, resetNodeColors |
| `webview/__tests__/integration.test.ts` | Created — 9 tests for nodeIndexMap, WebSocket reconnect, animation sync, empty snapshot |
| `package.json` | Modified — added `build:check` script; wired `tsc --noEmit` into `npm test` |
| `webview/voice.ts` | Modified — `SpeechRecognitionLike` interface replaces `as any`; type fixes |
| `webview/nodeActions.ts` | Modified — fixed pre-existing `number \| undefined` TS error |
| `webview/orb.ts` | Modified — fixed pre-existing `unknown[]` cast; added `LinkObject` import |

All paths: `C:\dev\tools\DevNeural\03-web-app\`

Cross-component integration (Python server → WebSocket → browser) uses the existing
`02-api-server` tests. Add a web-app-specific smoke test verifying the Vite build produces
a valid bundle.

---

## Tests First

### Gap Coverage (`webview/__tests__/gap-coverage.test.ts`)

After sections 01–05, audit for untested exported functions and cover them here:

```typescript
// capAndTransform: nodes > GRAPH_NODE_CAP caps and logs warning
// capAndTransform: pins DevNeural center node at origin (fx=0, fy=0, fz=0)
// applyEdgeColors: sets LineMaterial color from colorMap
// detectReverseQuery: returns isReverse=true for "uses X" prefix
// detectReverseQuery: returns isReverse=false for plain query
// resetNodeColors: restores all nodes to type-based default colors
```

### Integration Tests (`webview/__tests__/integration.test.ts`)

```typescript
// Test: updateGraph + setNodePositions produces nodeIndexMap entries for every node
// Test: WebSocket reconnect: after onclose, connect() is called again after 2s delay
// Test: graph:snapshot clears ephemeral edges (animation + rendering in sync)
// Test: search evaluateQuery + applySearchVisuals does not throw on empty snapshot
```

---

## Smoke Test

Manual verification checklist (documented, not automated):

1. `npm run dev` → browser opens, canvas renders, no console errors
2. With Python server stopped: status indicator shows "disconnected"
3. Start Python server: status indicator shows "connected", orb populates
4. Click a project node → GitHub URL opens in new tab
5. Type in search box → matching nodes highlight white, others dim
6. Voice button: request mic permission, speak "show all tools" → search resets to tool nodes

---

## Build Verification

```bash
npm run build
# Verify dist/ contains index.html and assets/
# Verify no TypeScript errors
```

Add to package.json scripts:
```json
"build:check": "tsc --noEmit"
```

---

## Cross-Component Integration

Refers to existing `02-api-server` tests. The web app integration is validated by:
1. Running `02-api-server` tests (Python server → WebSocket broadcast)
2. Running `03-web-app` tests (browser WebSocket → graph rendering)

No additional server-side tests needed from this section.
