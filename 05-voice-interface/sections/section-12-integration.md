# Section 12: Integration [IMPLEMENTED]

## Overview

The final section wires everything together. It implements the remaining files in `03-web-app` that have not been built yet — `src/orb/interaction.ts`, `src/ui/hud.ts`, `src/main.ts`, and `public/index.html` — and adds end-to-end tests that exercise the full pipeline from a `/voice` query through to a visible web-app handler event.

**Depends on:**
- section-08-entry-point — `05-voice-interface/dist/index.js` must be built and working
- section-10-orb-renderer — renderer, physics, graph builder in place
- section-11-ws-handlers — WebSocket client and all five event handlers in place

**Blocks:** nothing — this is the terminal section.

Tests run in **both** `03-web-app/` (interaction, HUD unit tests) and `05-voice-interface/` (end-to-end subprocess test with mocked 02-api-server).

---

## Files Created/Modified

```
03-web-app/src/orb/interaction.ts          (new)
03-web-app/src/ui/hud.ts                   (new)
03-web-app/src/main.ts                     (replaced old webview-based implementation)
03-web-app/index.html                      (already existed at project root — Vite default location)
03-web-app/tests/orb/interaction.test.ts   (new — 13 tests)
03-web-app/tests/ui/hud.test.ts            (new — 7 tests, jsdom environment)
05-voice-interface/src/formatter/orb-events.ts  (modified — added AbortSignal.timeout(5000))
05-voice-interface/src/index.ts            (modified — await sendOrbEvents; send voice:clear on clarification)
05-voice-interface/tests/e2e.test.ts       (new — 14 tests, async spawn pattern)
```

**Deviations from plan:**
- `public/index.html` → actual path is `03-web-app/index.html` (Vite root convention, not public/)
- `getTopConnections(node, edges: OrbEdge[], limit)` uses flat edge array instead of `GraphData` — simpler and more composable; not called in production code
- `main.ts` adapted to actual section-10/11 exported APIs (`connect()`, `SceneRef`, no `buildHandlers` factory, no `animate` export)
- HUD controller created but not wired to WS events (WS handler API doesn't expose HUD callback points without deeper changes to section-11)
- e2e tests use async `spawn` instead of `spawnSync` — `spawnSync` blocks the Node.js event loop, preventing the in-process mock HTTP server from responding to the subprocess
- `voice:clear` event now sent for clarification/unknown intent (fix to original design — plan intended this, implementation missed it)
- Raycasting uses `canvas.getBoundingClientRect()` instead of `window.innerWidth/Height` for correctness in non-fullscreen contexts

---

## Background

At this point every subsystem exists independently:

- `02-api-server` exposes `POST /voice/command` and broadcasts `voice:*` events over WebSocket
- `05-voice-interface` parses a query, calls the REST API, formats a text response, and fires orb events
- `03-web-app` has a renderer, physics simulation, graph builder, and five WebSocket event handlers

This section adds the three remaining `03-web-app` modules, then validates that the whole chain works together.

### Initialization Order

The most critical constraint in `main.ts` is initialization order. The Three.js renderer and scene **must** be fully constructed before the WebSocket client connects. A snapshot arriving before the scene is initialized would crash. The `pendingSnapshot` buffer in `ws/client.ts` (section-11) handles the hot-reload race condition, but the primary defense is setup order in `main.ts`.

The sequence:

1. Create renderer (canvas, scene, camera, lights)
2. Register interaction handlers on the canvas
3. Initialize HUD with initial zero counts
4. Start the animation loop (`requestAnimationFrame`)
5. **Then** create the WebSocket client and connect

Only after step 4 is the scene reference safe to write into.

---

## Tests First

### `03-web-app/tests/orb/interaction.test.ts`

Three.js is mocked via `vi.mock('three')`.

```typescript
// vi.mock('three') at top of file

// Test: onHover(node) → node.material opacity increases (brighter than default)
// Test: onHover(null) → all nodes reset to default material opacity
// Test: onClick(node) → selectedNodeId state updated to node.id
// Test: onClick(node) → camera animates toward selected node
//   (mock camera.position.lerp was called or camera.lookAt target updated)
// Test: onClick(null) → selectedNodeId cleared
// Test: getTopConnections(node, graph, 5) → returns up to 5 edges sorted by weight descending
// Test: getTopConnections(node, graph, 5) → with fewer than 5 edges → returns all edges without padding
// Test: getTopConnections(node, graph, 5) → only returns edges where node is an endpoint (src or dst)
```

### `03-web-app/tests/ui/hud.test.ts`

HUD operates on plain DOM — no Three.js involvement.

```typescript
// Test: updateCounts({ nodes: 12, edges: 30 }) → element text reflects new values
// Test: updateProjectLabel('DevNeural') → element text contains 'DevNeural'
// Test: updateLastVoiceQuery('what skills am I using?') → element text updated
// Test: updateLastVoiceQuery(null) → last query element cleared or hidden
// Test: initHud() → returns an object with all four update methods
// Test: initHud() called twice → does not create duplicate DOM elements
//   (idempotent: finds existing container by ID rather than always appending)
```

### `05-voice-interface/tests/e2e.test.ts`

This is the end-to-end integration test. It spins up a lightweight HTTP server on port 3747 to play the role of 02-api-server, then invokes the built `dist/index.js` as a subprocess and verifies the full chain.

```typescript
import { spawnSync } from 'child_process';
import http from 'http';
import path from 'path';

const ENTRY = path.resolve(__dirname, '../dist/index.js');

// beforeAll: start mock HTTP server on port 3747
//   GET /graph/top?limit=100  → returns fixture edge list with skill edges
//   GET /graph                → returns fixture graph with labeled nodes
//   GET /graph/subgraph       → returns fixture subgraph
//   POST /voice/command       → records received body, returns 200
// afterAll: close mock server

// Test: node dist/index.js "what skills am I using most?"
//   → exit code 0
//   → stdout is readable text (no markdown)
//   → stdout contains no raw node IDs (e.g., no 'skill:' prefix visible to user)
//   → POST /voice/command was received by mock server
//   → POST body has type 'voice:highlight'

// Test: node dist/index.js "what's my current context"
//   → exit code 0
//   → POST /voice/command received with type 'voice:focus' (first call)
//   → POST /voice/command received with type 'voice:highlight' (second call)
//   → exactly 2 POST calls to /voice/command (get_context sends two in sequence)

// Test: node dist/index.js "unknown gibberish xyzzy"
//   → exit code 0
//   → stdout contains clarification or hedging message
//   → POST /voice/command received with type 'voice:clear' (unknown intent)

// Test: mock server stopped, node dist/index.js "what skills am I using?"
//   → exit code 0
//   → stdout contains "isn't running" message
//   → path in message ends with "02-api-server/dist/server.js" (relative resolution)
```

---

## Implementation: `src/orb/interaction.ts`

Handles mouse hover and click on Three.js mesh objects. Receives the scene state from `main.ts` by reference.

Key exports:

```typescript
export function onHover(node: OrbNode | null, sceneState: SceneState): void;
export function onClick(node: OrbNode | null, sceneState: SceneState, camera: THREE.Camera): void;
export function getTopConnections(node: OrbNode, graph: GraphData, limit: number): GraphEdge[];
```

Behavior:

- `onHover(node, sceneState)`: When `node` is non-null, sets that node's mesh material to the hover material (brighter). Restores the previous hover target to its default or voice-highlight state. Track the previous hover target to avoid re-scanning all nodes on every mouse move.
- `onClick(node, sceneState, camera)`: Updates `sceneState.selectedNodeId`. Calls `camera.lookAt(node.mesh.position)` and begins a smooth camera approach by setting a target position in `sceneState`. The animation loop in `main.ts` resolves the lerp each frame.
- `getTopConnections(node, graph, limit)`: Pure function. Filters `graph.edges` to those where `edge.src === node.id || edge.dst === node.id`, sorts by `edge.weight` descending, returns first `limit` entries. No Three.js dependency — safe to test without mocking.

Raycasting (mapping mouse coordinates to a Three.js mesh) is done in `main.ts` using `THREE.Raycaster` and the registered `pointermove` / `click` event listeners. The raycaster result (an `OrbNode` reference or null) is passed into these functions. This keeps `interaction.ts` free of DOM event plumbing.

---

## Implementation: `src/ui/hud.ts`

A plain HTML overlay positioned over the canvas with `position: fixed`. Implemented as a module that creates and manages a `<div id="devneural-hud">` element.

Key exports:

```typescript
export interface HudController {
  updateCounts(counts: { nodes: number; edges: number }): void;
  updateProjectLabel(label: string | null): void;
  updateLastVoiceQuery(query: string | null): void;
}

export function initHud(): HudController;
```

Behavior:

- `initHud()` is idempotent: checks for an existing `#devneural-hud` element before creating one. If found, re-uses it. Returns a controller object.
- The HUD contains three labeled spans: one for node/edge counts, one for project label, one for last voice query.
- `updateLastVoiceQuery(null)` hides or clears the last query span.
- The HUD updates are called from `ws/handlers.ts` when voice events arrive (the handler passes the query text from the event payload if present, or a derived label from the intent type).
- Styling is inline: semi-transparent dark background, white text, top-left corner. No external CSS file required — self-contained.

The HUD does not interact with Three.js at all. It only touches the DOM.

---

## Implementation: `src/main.ts`

The application entry point for the browser. Imported by `public/index.html` via a `<script type="module">` tag. Vite resolves the import during build.

```typescript
import { initRenderer } from './orb/renderer';
import { initHud } from './ui/hud';
import { createWsClient } from './ws/client';
import { buildHandlers } from './ws/handlers';
import { onHover, onClick } from './orb/interaction';
import * as THREE from 'three';

async function main() {
  // 1. Renderer (scene, camera, lights, canvas appended to document.body)
  const { renderer, scene, camera, animate } = initRenderer();

  // 2. Register pointer events for interaction
  //    raycaster picks OrbNode from sceneState
  //    calls onHover / onClick

  // 3. HUD
  const hud = initHud();

  // 4. Start animation loop
  animate();

  // 5. WebSocket — only after scene is ready
  const handlers = buildHandlers(scene, camera, hud);
  const ws = createWsClient('ws://localhost:3747/ws', handlers);
  ws.connect();
}

main();
```

The `animate()` function (from `renderer.ts`) calls `requestAnimationFrame` recursively. It runs the physics tick each frame (via `physics.tick(sceneState)`) and resolves any pending camera lerp from `onClick`.

**Note:** If the actual exported signatures from sections 10 and 11 differ from the signatures assumed here (e.g., `initRenderer()` returns different fields, or `buildHandlers` has a different signature), update `main.ts` to match — do not change sections 10 or 11 to match this section.

---

## Implementation: `public/index.html`

Minimal HTML shell. Vite injects the module script automatically when building.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DevNeural</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #0a0a0f; overflow: hidden; }
    </style>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Vite's dev server and `vite build` both process `src/main.ts` through TypeScript and bundle it.

---

## `vite build` Verification

After implementing all files, run `vite build` in `03-web-app/`. A successful build is a required gate before the end-to-end test. Common failure modes to watch for:

- Three.js tree-shaking warnings — not errors, acceptable
- TypeScript errors in `main.ts` from `animate()` return type — `initRenderer` must export the `animate` function with the correct signature
- Missing `document` references in `hud.ts` during Node.js test runs — guard with `typeof document !== 'undefined'` checks or use `vitest`'s jsdom environment scoped to the HUD test file only

---

## End-to-End Verification Checklist

1. Run `npm run build` in `05-voice-interface/` — confirms `dist/index.js` is current
2. Run `npm test` in `05-voice-interface/` — all tests including `e2e.test.ts` pass
3. Run `npm test` in `03-web-app/` — all tests including `interaction.test.ts` and `hud.test.ts` pass
4. Run `vite build` in `03-web-app/` — `dist/` directory emitted, no TypeScript errors
5. Start `02-api-server` locally
6. Open `03-web-app/dist/index.html` in a browser (or `vite preview`)
7. Run a voice query in a Claude Code session in the DevNeural repo
8. Confirm: text response appears in Claude chat, orb highlights nodes in the browser

Steps 5–8 are manual smoke tests; they are not automated. The automated gate is steps 1–4.
