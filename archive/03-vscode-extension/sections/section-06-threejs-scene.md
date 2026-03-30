# section-06-threejs-scene

## Implementation Status: COMPLETE

**Commit**: (see deep_implement_config.json)

### Actual files created/modified
| File | Action |
|------|--------|
| `webview/renderer.ts` | Created — full implementation |
| `webview/orb.ts` | Created — full implementation |
| `webview/main.ts` | Updated — wired up scene + message routing |
| `webview/__tests__/renderer.test.ts` | Created — 4 tests |
| `webview/__tests__/orb.test.ts` | Created — 9 tests (incl. pinning + no-throw) |
| `package.json` / `package-lock.json` | Updated — added jsdom + @types/jsdom dev deps |

### Deviations from plan
- **Force engine**: Used `d3` instead of `ngraph`. ngraph's physics API does not expose per-tick force hooks needed for custom velocity injection (no `onSimulationTick` equivalent). `d3Force()` with `ForceFn.initialize()` provides exactly this. The spec explicitly allows this fallback.
- **`capAndTransform` includes center node pinning**: Added `fx=fy=fz=0` on DevNeural center node within the pure transform. Spec placed this under sphere constraint but the function is tested for it explicitly.

### Test count: 72 total (9 new webview tests + 63 existing)

## Overview

This section implements the Three.js scene foundation and the three-forcegraph orb layout. It produces `webview/renderer.ts` and `webview/orb.ts`. These are the bedrock of the 3D visualization — every subsequent rendering, animation, and camera section builds on top of them.

**Depends on**: `section-04-scaffold` (project scaffold, npm deps installed including `three`, `three-forcegraph`).

**Blocks**: `section-07-rendering` (nodes.ts and edges.ts require the scene and graph instance).

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/renderer.ts` | Create — Three.js scene bootstrap |
| `webview/orb.ts` | Create — three-forcegraph integration, sphere constraint |
| `webview/main.ts` | Modify stub — wire up scene + message routing |

All paths: `C:\dev\tools\DevNeural\03-vscode-extension\webview\`

---

## Tests First

Tests live in `webview/__tests__/renderer.test.ts` and `webview/__tests__/orb.test.ts`. Run with vitest + jsdom. Mock WebGL — no actual rendering.

### renderer.test.ts

```
// Test: Renderer is created with antialiasing option
// Test: Camera starts at distance that frames a sphere of radius ORB_RADIUS
// Test: OrbitControls are created with enableDamping: true
// Test: ResizeObserver callback updates renderer size and camera aspect ratio
```

### orb.test.ts

```
// Test: updateGraph({ nodes: [], edges: [] }) does not throw
// Test: Server edges are renamed to links before passing to graphData (edges key absent in input)
// Test: Edge id is preserved in the link object after renaming
// Test: Graph size cap: if snapshot has >500 nodes, only top 300 edges (by weight) are loaded
// Test: When graph is capped, a warning is emitted with original counts vs cap threshold
// Test: Loading overlay is shown before warmupTicks, removed after onFinishUpdate fires
```

The graph transformation logic (rename edges→links, size cap) must be extracted as a pure function for independent testing without any Three.js instance.

---

## renderer.ts — Scene Bootstrap

```typescript
export const ORB_RADIUS = 120; // shared constant for sphere framing

export function createScene(canvas: HTMLCanvasElement): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  startAnimationLoop(onTick: (delta: number) => void): void;
}
```

### WebGLRenderer

```typescript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
```

### Camera

`PerspectiveCamera` with 75° FOV. Initial camera distance frames a sphere of `ORB_RADIUS`:

```typescript
const distance = ORB_RADIUS / Math.sin((75 / 2) * (Math.PI / 180));
camera.position.set(0, 0, distance);
```

### OrbitControls

```typescript
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
```

### Lighting

```typescript
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(50, 50, 50);
scene.add(dirLight);
```

### FogExp2

```typescript
scene.fog = new THREE.FogExp2(0x0a0a0f, 0.003);
```

Dark color matches the VS Code dark theme panel background. Low density — softens distant nodes without obscuring nearby content.

### ResizeObserver

```typescript
new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(canvas);
```

### Animation Loop

```typescript
function startAnimationLoop(onTick: (delta: number) => void): void {
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const delta = clock.getDelta();
    controls.update();
    onTick(delta);
    renderer.render(scene, camera);
  }
  frame();
}
```

---

## orb.ts — three-forcegraph Integration

```typescript
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Transforms and loads a snapshot into the force graph. */
export function updateGraph(snapshot: GraphSnapshot): void;

/** Called by main.ts to get the ThreeForceGraph instance for scene.add. */
export function getGraphInstance(): ThreeForceGraph;
```

### Setup

```typescript
import ThreeForceGraph from 'three-forcegraph';
const graph = new ThreeForceGraph();
graph.forceEngine('ngraph');
```

### Graph Size Cap (pure function — testable independently)

```typescript
export function capAndTransform(snapshot: GraphSnapshot, maxEdges = 300): {
  nodes: GraphNode[];
  links: (GraphEdge & { source: string; target: string })[];
  wasCapped: boolean;
  originalCounts: { nodes: number; edges: number };
}
```

Logic:
1. If `snapshot.nodes.length <= 500`, use all. Otherwise:
   - Sort edges by `weight` descending, take first `maxEdges`
   - Collect all node IDs referenced as source/target in those edges
   - Filter nodes to only those IDs
   - Set `wasCapped = true`
2. Rename `edges` → `links` (all fields preserved, including `id`)

### Warmup and Loading Overlay

Create a `<div id="devneural-loading">Building graph...</div>` in the DOM before calling `warmupTicks`. Remove it in the `onFinishUpdate` callback:

```typescript
function showLoading(): void { /* create overlay div if not exists */ }
function hideLoading(): void { /* remove overlay div if exists */ }

graph.warmupTicks(150);
graph.onFinishUpdate(() => hideLoading());
```

Use `requestAnimationFrame` to paint the overlay before warmup begins:
```typescript
showLoading();
requestAnimationFrame(() => {
  graph.graphData(transformed);
});
```

### Sphere Constraint

Apply a custom force via ngraph's `onSimulationTick` callback (or equivalent hook) that pulls nodes toward `ORB_RADIUS`. The DevNeural center node (project node with `id === 'project:github.com/mcollins-f6i/DevNeural'` or the node with label "DevNeural" — check `devneural.json` for the exact ID) is pinned at origin with `fx = fy = fz = 0`.

Check `three-forcegraph` and `ngraph.forcelayout` API for the correct hook name — it may be `d3ReheatSimulation`, a custom force listener, or an iteration callback. If ngraph's API does not directly support custom force application per-tick, fall back to using `d3-force` engine with a custom radial force.

### Exports

`orb.ts` exports: `updateGraph`, `getGraphInstance`, `capAndTransform` (for testing).

---

## main.ts Integration

Extend `webview/main.ts` to:

1. On DOM ready, call `createScene(canvas)` from `renderer.ts`
2. Call `getGraphInstance()` from `orb.ts` and `scene.add(graph)`
3. Start the animation loop: `startAnimationLoop(delta => { graph.tickFrame(); })`
4. Handle `graph:snapshot` postMessage → `updateGraph(payload)`
5. Handle `setActiveProjects` postMessage → pass to camera module (section-09)

```typescript
import { createScene, ORB_RADIUS } from './renderer';
import { updateGraph, getGraphInstance } from './orb';

const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
const { scene, startAnimationLoop } = createScene(canvas);
scene.add(getGraphInstance());
startAnimationLoop(delta => { getGraphInstance().tickFrame(); });

window.addEventListener('message', (event: MessageEvent) => {
  const { type, payload } = event.data;
  switch (type) {
    case 'graph:snapshot': updateGraph(payload); break;
    // additional cases added in later sections
  }
});
```

---

## Key Constraints

- **`ORB_RADIUS` is a shared constant**: Both `renderer.ts` (camera framing) and `orb.ts` (sphere constraint) must reference the same value.
- **Edge `id` preservation**: Renaming `edges` → `links` must preserve all edge fields.
- **warmupTicks is synchronous**: Loading overlay must be in the DOM before `warmupTicks` is called.
- **Size cap logic must be a pure function**: Extract `capAndTransform` so unit tests can call it without any Three.js instance.
- **ngraph + sphere constraint**: Verify the correct API before implementing. If ngraph's `forcelayout` doesn't support per-tick custom forces, switch to d3-force engine with a custom radial force plugin.
