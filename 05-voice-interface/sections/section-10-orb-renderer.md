# Section 10: Orb Renderer

## Overview

This section implements three modules in `03-web-app/src/`:

- `src/orb/renderer.ts` — Three.js canvas, scene, camera, and lights setup
- `src/orb/physics.ts` — force-directed layout simulation with cool-down
- `src/graph/builder.ts` — converts `GraphData` from the API into Three.js mesh constructor calls

**Depends on:** section-09-web-foundation (project scaffolding, `src/graph/types.ts` with `OrbNode`/`OrbEdge`/`SceneState`, `src/orb/visuals.ts` with material config factory and edge opacity mapping).

**Blocks:** section-12-integration (final wiring in `src/main.ts`).

**Parallelizable with:** section-11-ws-handlers.

Tests run in `03-web-app/` using `npm test`.

---

## Background

The `03-web-app` is a browser application that visualizes the DevNeural connection graph as an interactive Three.js 3D force visualization. The renderer, physics simulation, and graph builder work together:

1. `builder.ts` converts raw graph data (node list + edge list from the API) into Three.js `Mesh` and `Line` objects placed in the scene.
2. `renderer.ts` holds the Three.js `WebGLRenderer`, `Scene`, `PerspectiveCamera`, and lights. It is initialized before the WebSocket client connects to prevent a race condition where a `graph:snapshot` arrives before the scene is ready.
3. `physics.ts` implements a frame-by-frame force simulation that runs inside the Three.js `requestAnimationFrame` loop. Once node velocities fall below 0.001 units/frame the simulation cools down and stops iterating — preventing continuous CPU use on a stable layout.

The Three.js build target is ESNext (browser). The project uses Vite for bundling (`vite.config.ts` already exists from section-09). All Three.js imports are **mocked** in tests via `vi.mock('three')` because WebGL is not available in the test environment.

---

## Tests First

Tests live in `03-web-app/tests/`. All Three.js tests require `vi.mock('three')` at the top of each test file.

### `tests/graph/builder.test.ts`

```typescript
vi.mock('three');

describe('build(graphData)', () => {
  // calls new THREE.SphereGeometry for each node in the graph
  // project nodes use a larger radius than skill nodes
  // skill nodes use a medium radius
  // tool nodes use a smaller radius (smallest of three)
  // project nodes: MeshStandardMaterial called with a blue-tinted color config
  // skill nodes: MeshStandardMaterial called with a green-tinted color config
  // tool nodes: MeshStandardMaterial called with an orange-tinted color config
  // edges: LineBasicMaterial opacity is proportional to edge weight (higher weight → higher opacity)
  // edge with weight=0 → opacity ≥ minimum threshold (not zero — still visible)
  // edge with weight=10 → opacity at maximum (≤ 1.0)
  // build() called with empty graph (no nodes, no edges) → no Three.js constructors called, no errors
});
```

The test verifies constructor call counts and arguments, not WebGL rendering. After `build(graphData)` runs, check that `THREE.SphereGeometry` was called N times (once per node), that `THREE.MeshStandardMaterial` was called with the correct color per node type (sourced from `visuals.getMaterialForNodeType()`), and that `THREE.LineBasicMaterial` was called with opacity values derived from `visuals.getEdgeOpacity(weight)`.

### `tests/orb/physics.test.ts`

```typescript
describe('physics simulation', () => {
  // simulate(nodes, edges) → each node's position changes after one tick
  // simulate with no edges → nodes repel each other (positions spread apart after N ticks)
  // simulate with high-weight edge → connected nodes are closer together after N ticks
  //   than nodes connected by a low-weight edge (spring force proportional to weight)
  // velocity threshold: after many ticks on a stable graph, all node velocities < 0.001
  // cooldown flag is set when simulation stabilizes → further tick() calls are no-ops
  // reset() restarts the simulation: cooldown flag cleared, velocities zeroed
});
```

Physics tests do **not** mock Three.js — the physics module works on plain JS objects (position vectors, velocity vectors). Node positions can be represented as `{ x, y, z }` objects rather than `THREE.Vector3`.

### `tests/orb/renderer.test.ts` (minimal)

```typescript
vi.mock('three');

describe('initRenderer(canvas)', () => {
  // returns an object with scene, camera, renderer properties
  // scene is a THREE.Scene instance (constructor called once)
  // camera is a THREE.PerspectiveCamera instance
  // renderer is a THREE.WebGLRenderer instance constructed with the provided canvas
  // lights: at least one AmbientLight and one DirectionalLight added to scene
});
```

The renderer test is minimal — it just verifies the setup calls are made. No animation loop testing needed here.

---

## Implementation

### File: `C:\dev\tools\DevNeural\03-web-app\src\orb\renderer.ts`

Exports a single `initRenderer(canvas: HTMLCanvasElement): RendererState` function.

`RendererState` is a plain object type:

```typescript
interface RendererState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}
```

Setup steps inside `initRenderer`:

1. Create `new THREE.WebGLRenderer({ canvas, antialias: true })` and call `renderer.setPixelRatio(window.devicePixelRatio)` and `renderer.setSize(window.innerWidth, window.innerHeight)`.
2. Create `new THREE.Scene()`. Set `scene.background` to a dark color (e.g., `new THREE.Color(0x0d0d1a)`).
3. Create `new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)`. Position the camera at `z = 20`.
4. Add an `AmbientLight` (soft white, intensity ~0.4) and a `DirectionalLight` (white, intensity ~0.8) positioned at `(5, 10, 5)`. Both go into `scene`.
5. Add a `window.addEventListener('resize', ...)` handler that updates `camera.aspect`, calls `camera.updateProjectionMatrix()`, and `renderer.setSize(...)`.

Return `{ scene, camera, renderer }`.

This function is called once from `src/main.ts` (section-12). It does not start the animation loop — the animation loop is started separately in `main.ts` so the WebSocket client can be initialized first.

### File: `C:\dev\tools\DevNeural\03-web-app\src\orb\physics.ts`

Implements a simple per-frame force-directed simulation. The module does not import Three.js directly — it operates on plain position/velocity data so it can be tested without WebGL.

Key types:

```typescript
interface PhysicsNode {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

interface PhysicsEdge {
  sourceId: string;
  targetId: string;
  weight: number; // 0.0–10.0
}
```

Exports:

```typescript
function createSimulation(nodes: PhysicsNode[], edges: PhysicsEdge[]): Simulation
```

`Simulation` interface:

```typescript
interface Simulation {
  tick(): void;         // advance one frame; no-op if cooled down
  reset(): void;        // clear cooldown, zero velocities
  isCooled(): boolean;  // true when all velocities < 0.001
  nodes: PhysicsNode[]; // mutable — positions updated in-place
}
```

Force rules applied each `tick()`:

- **Spring force** (attraction): For each edge, compute the vector from source to target. Apply a force proportional to `(distance - restLength) * springStrength * weight` pulling each endpoint toward the other. `restLength` is a constant (e.g., 3 units). `springStrength` is a constant (e.g., 0.02).
- **Repulsion**: For every pair of nodes, apply a repulsion force proportional to `repulsionStrength / distance^2` pushing them apart. `repulsionStrength` ~50. Cap minimum distance at 0.1 to avoid division-by-zero.
- **Damping**: After applying forces, multiply each node's velocity by `damping` (e.g., 0.85) before adding to position.
- **Cool-down check**: After updating positions, check if all node velocities have magnitude < 0.001. If so, set internal `_cooled = true`.

`tick()` should be a no-op if `_cooled` is true.

`reset()` clears `_cooled` and zeroes all velocities. Called whenever new nodes are added (e.g., on `connection:new` WebSocket event).

The simulation runs in 3D (x, y, z positions). Initial positions are set by the caller (builder places them randomly in a sphere of radius 5).

### File: `C:\dev\tools\DevNeural\03-web-app\src\graph\builder.ts`

Exports:

```typescript
function build(graphData: GraphData, scene: THREE.Scene): SceneState
```

Where `GraphData` is the raw API response shape, and `SceneState` is defined in `src/graph/types.ts` (section-09).

The `GraphData` type mirrors the API response:

```typescript
interface GraphNode {
  id: string;       // e.g., 'project:github.com/user/repo'
  label: string;    // display name
  type: 'project' | 'skill' | 'tool';
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
  weight: number;   // 0.0–10.0
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

Build steps:

1. For each node, call `visuals.getMaterialForNodeType(node.type)` to get the color config. Instantiate `new THREE.SphereGeometry(radius)` where radius depends on type: project=0.6, skill=0.4, tool=0.3. Instantiate `new THREE.MeshStandardMaterial({ color, ... })`. Create `new THREE.Mesh(geometry, material)`. Position the mesh at a random point within a sphere of radius 5. Add to `scene`.

2. For each edge, look up source and target meshes. Compute a line between their positions using `THREE.BufferGeometry` with `setFromPoints([src.position, tgt.position])`. Call `visuals.getEdgeOpacity(edge.weight)` for the opacity. Instantiate `new THREE.LineBasicMaterial({ transparent: true, opacity })`. Create `new THREE.Line(geometry, material)`. Add to `scene`.

3. Build `PhysicsNode[]` from the mesh positions (share the same position object so physics updates affect the mesh).

4. Return a `SceneState` containing the node ID → mesh map, the edge meshes array, and the `Simulation` instance (created via `createSimulation(physicsNodes, physicsEdges)`).

If `graphData` is empty (no nodes, no edges), return an empty `SceneState` without calling any Three.js constructors.

---

## Node Type Detection

The `node.type` field is the primary source of truth. If for any reason it is absent, fall back to the `node.id` prefix: `project:` → project, `skill:` → skill, `tool:` → tool, anything else → tool (safest visual default).

---

## Integration Notes

- `renderer.ts` does not import `builder.ts` or `physics.ts` — they are wired together in `src/main.ts` (section-12).
- The `SceneState` returned by `build()` is stored in a module-level variable in `main.ts` so WebSocket handlers (section-11) can reference it when highlighting nodes.
- When `connection:new` arrives, the handler calls `build()` for just the new edge (or adds the edge mesh directly), then calls `simulation.reset()` to restart the layout.
- The animation loop in `main.ts` calls `simulation.tick()` each frame and then `renderer.render(scene, camera)`. When `simulation.isCooled()` returns true, `tick()` is a no-op.

---

## Dependency Summary

| Dependency | What this section uses |
|---|---|
| section-09-web-foundation | `OrbNode`, `OrbEdge`, `SceneState` types from `src/graph/types.ts`; `getMaterialForNodeType()`, `getEdgeOpacity()` from `src/orb/visuals.ts` |
| `three` npm package | `Scene`, `PerspectiveCamera`, `WebGLRenderer`, `SphereGeometry`, `MeshStandardMaterial`, `Mesh`, `BufferGeometry`, `LineBasicMaterial`, `Line`, `AmbientLight`, `DirectionalLight`, `Color` |

No changes to `package.json` are needed — `three` and `@types/three` are already in dependencies from section-09.

---

## File Checklist

- `C:\dev\tools\DevNeural\03-web-app\src\orb\renderer.ts` — created
- `C:\dev\tools\DevNeural\03-web-app\src\orb\physics.ts` — created
- `C:\dev\tools\DevNeural\03-web-app\src\graph\builder.ts` — created
- `C:\dev\tools\DevNeural\03-web-app\tests\graph\builder.test.ts` — created (12 tests)
- `C:\dev\tools\DevNeural\03-web-app\tests\orb\physics.test.ts` — created (6 tests)
- `C:\dev\tools\DevNeural\03-web-app\tests\orb\renderer.test.ts` — created (5 tests)

## Implementation Deviations

- `GraphNode.type` is optional (`type?: NodeType`) to support the plan's id-prefix fallback for real-world API data.
- `build()` returns `BuildResult` (extends `SceneState`) rather than plain `SceneState`; adds `meshes`, `edgeMeshes`, `simulation` fields needed by section-12.
- `mesh.position` (Three.js `Vector3`) is used directly as `PhysicsNode.position` so physics mutations immediately affect the rendered mesh.
- `createSimulation` pre-builds a `Map<string, PhysicsNode>` for O(1) spring-force lookups instead of O(N) `find`.
- Factory form `vi.mock('three', () => ({...}))` used in tests to provide position mocks; physics tests have no Three.js mock.
