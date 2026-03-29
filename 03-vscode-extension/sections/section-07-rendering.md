# section-07-rendering

## Overview

This section implements the visual rendering layer for the DevNeural orb: instanced mesh node rendering by type and edge line rendering with relativistic color. It produces `webview/nodes.ts` and `webview/edges.ts`.

**Depends on**: `section-06-threejs-scene` (Three.js scene, OrbitControls, three-forcegraph instance, `renderer.ts`, `orb.ts` must exist).

**Blocks**: `section-08-animation`, `section-09-camera-hud`, `section-10-node-actions`.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/nodes.ts` | Create — four InstancedMesh objects for node rendering |
| `webview/edges.ts` | Create — Line2 edge rendering + relativistic color |
| `webview/renderer.ts` | Modify — add node and edge meshes to scene |
| `webview/orb.ts` | Modify — wire node/edge update callbacks |

All paths: `C:\dev\tools\DevNeural\03-vscode-extension\webview\`

---

## Tests First

Tests in `webview/__tests__/nodes.test.ts` and `webview/__tests__/edges.test.ts`. Run with vitest + jsdom. Three.js geometry creation works in jsdom without a renderer.

### nodes.test.ts

```
// Test: nodes.ts creates exactly 3 InstancedMesh objects (project, tool, skill)
// Test: nodes.ts creates 1 InstancedMesh for stage badges (TorusGeometry)
// Test: Project node InstancedMesh uses BoxGeometry with strongly unequal dimensions
// Test: Skill node InstancedMesh uses OctahedronGeometry
// Test: setNodePositions(nodes) updates Matrix4 for each instance
// Test: After setColorAt() for search highlight, instanceColor.needsUpdate is true on the InstancedMesh
// Test: Badge InstancedMesh scale is zero for nodes with no stage value
// Test: stageColor('alpha'), stageColor('beta'), stageColor('deployed'), stageColor('archived') return distinct THREE.Color values
```

### edges.test.ts

```
// Test: computeRelativeColor(edges) — all equal weights → same color for all edges
// Test: computeRelativeColor(edges) — weight 0.0 → cool blue (hue > 180)
// Test: computeRelativeColor(edges) — weight 1.0 (max) → warm red/orange (hue < 30)
// Test: computeRelativeColor(edges) — mid-range weight → cyan/green (hue 120–180)
// Test: computeRelativeColor is a pure function — same input → same output
// Test: computeRelativeColor returns Map keyed by edge id with exactly one entry per edge
```

`computeRelativeColor` is the only logic-heavy pure function in this section and requires full test coverage.

---

## Implementation: `webview/nodes.ts`

### Four InstancedMesh Objects

| Node Type | Geometry | Notes |
|-----------|----------|-------|
| `project` | `BoxGeometry(1.2, 0.15, 0.9)` | Strongly unequal — reads as a document/file |
| `tool` | `BoxGeometry(0.8, 0.8, 0.8)` | Standard cube |
| `skill` | `OctahedronGeometry(0.7)` | Diamond/crystal |
| stage badge | `TorusGeometry(0.55, 0.06, 8, 24)` | Thin ring, fourth InstancedMesh |

The badge mesh is a **fourth `InstancedMesh`**, not individual `Mesh` objects. One draw call per mesh regardless of node count.

### Key API

```typescript
export interface NodeRenderData {
  id: string;
  type: 'project' | 'tool' | 'skill';
  x: number;
  y: number;
  z: number;
  stage?: string;
}

/** Creates and returns the four InstancedMesh objects. maxNodes is the InstancedMesh count. */
export function createNodeMeshes(maxNodes: number): {
  projectMesh: THREE.InstancedMesh;
  toolMesh: THREE.InstancedMesh;
  skillMesh: THREE.InstancedMesh;
  badgeMesh: THREE.InstancedMesh;
}

/** Updates all instance matrices from force layout positions.
 *  Must set instanceMatrix.needsUpdate = true after bulk updates. */
export function setNodePositions(
  nodes: NodeRenderData[],
  meshes: ReturnType<typeof createNodeMeshes>
): void

/** Sets a node's instance color. MUST call instanceColor.needsUpdate = true afterward. */
export function setNodeColor(
  nodeId: string,
  color: THREE.Color,
  meshes: ReturnType<typeof createNodeMeshes>,
  nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }>
): void

/** Resets all node colors to their default type-based colors. */
export function resetNodeColors(
  meshes: ReturnType<typeof createNodeMeshes>,
  nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }>
): void

/** Returns the badge color for a stage string. */
export function stageColor(stage: string): THREE.Color
```

### Badge Visibility

For project nodes WITH a stage: render badge at normal scale.
For project nodes WITHOUT a stage (or non-project nodes): scale the corresponding badge instance to zero (hidden). Never skip or omit instances — just scale to zero.

### Color Update Pattern (CRITICAL)

```typescript
mesh.setColorAt(instanceIndex, color);
mesh.instanceColor!.needsUpdate = true; // REQUIRED — without this, change is silently ignored
```

Same pattern for matrix updates:
```typescript
mesh.setMatrixAt(instanceIndex, matrix);
mesh.instanceMatrix.needsUpdate = true;
```

### Node Index Map

Maintain a `Map<nodeId, { mesh: THREE.InstancedMesh; index: number }>` that maps each node's ID to its mesh and instance index. Export this for use by `section-10-node-actions` (raycasting) and `section-09-camera-hud` (search highlighting).

---

## Implementation: `webview/edges.ts`

### Relativistic Color Calculation

**This is the most important logic in this section — a pure function with full test coverage.**

```typescript
/**
 * Computes a Map<edgeId, THREE.Color> by normalizing the weight distribution
 * across all edges onto a cool-to-warm gradient.
 * If all weights are equal (zero range), returns the same mid-range color for all.
 */
export function computeRelativeColor(
  edges: Array<{ id: string; weight: number }>
): Map<string, THREE.Color>
```

Algorithm:
1. Find `minWeight` and `maxWeight`
2. For each edge: `normalized = (weight - minWeight) / (maxWeight - minWeight)`
   - If all weights are equal (range is zero): use `normalized = 1.0` for all
3. Map normalized value to color via `THREE.Color.setHSL`:
   - `normalized = 0.0` → cool blue: `hsl(240/360, 0.8, 0.6)`
   - `normalized = 0.5` → cyan/green: `hsl(160/360, 0.7, 0.5)`
   - `normalized = 1.0` → warm orange/red: `hsl(15/360, 0.9, 0.55)`
   - Interpolate hue linearly: `hue = lerp(240/360, 15/360, normalized)` then wrap
4. Return `Map<edgeId, Color>`

### Edge Geometry

Use `Line2` from `three/examples/jsm/lines/Line2` with `LineMaterial` (not `LineBasicMaterial`). Uniform line thickness. One `Line2` per edge.

```typescript
export interface EdgeRenderData {
  id: string;
  source: string;
  target: string;
  weight: number;
}

/** Creates Line2 objects for given edges with provided colors. */
export function createEdgeLines(
  edges: EdgeRenderData[],
  colorMap: Map<string, THREE.Color>
): Map<string, Line2>

/** Updates Line2 geometry positions from current node positions.
 *  Call each frame after force simulation tick. */
export function updateEdgePositions(
  edgeLines: Map<string, Line2>,
  edges: EdgeRenderData[],
  nodePositions: Map<string, THREE.Vector3>
): void

/** Applies new colors to existing Line2 materials. */
export function applyEdgeColors(
  edgeLines: Map<string, Line2>,
  colorMap: Map<string, THREE.Color>
): void
```

### Line2 Requirements

- Always pair `Line2` with `LineMaterial` (not `LineBasicMaterial`)
- `LineMaterial` requires `resolution: new THREE.Vector2(width, height)` — update on resize
- `LineGeometry` positions are set with `setPositions([x1, y1, z1, x2, y2, z2])`

---

## Integration with scene

Integration went into `orb.ts` and `main.ts` (not `renderer.ts`) to avoid pulling InstancedMesh into the renderer test mock.

`renderer.ts` was modified to add an `addResizeListener` callback system so `LineMaterial` resolution can be updated on webview resize without importing Three.js meshes into the renderer module.

`orb.ts` received:
- `initOrb(scene)` — creates meshes, adds all 4 to scene, stores refs
- `updateRenderPositions()` — called each frame after `graph.tickFrame()`, updates node matrices and edge positions
- `updateGraph()` modified — rebuilds edge lines on snapshot, wires `addResizeListener` for LineMaterial resolution

`main.ts` wires: `initOrb(scene)` once, then `updateRenderPositions()` in the animation loop.

---

## Critical Correctness Details

1. **`instanceColor.needsUpdate = true`**: Must be set after every `setColorAt` call. Silent failure otherwise.
2. **`instanceMatrix.needsUpdate = true`**: Must be set after every `setMatrixAt` call.
3. **InstancedMesh count**: The `count` parameter is a maximum. Scale unused instances to zero instead of reducing count. Implemented with `prevNodeCount` high-water mark — zeros slots `nodes.length..prevNodeCount-1` on each `setNodePositions` call.
4. **Line2 + LineMaterial pairing**: Always use `LineMaterial`, never `LineBasicMaterial`.
5. **Pure function tests**: All `computeRelativeColor` tests must pass before visual integration.

---

## Deviations from Plan (Code Review Fixes)

- **Ghost nodes**: Added `prevNodeCount` module-level high-water mark to `nodes.ts`; zeros surplus slots on snapshot shrink.
- **Zero-range color**: `computeRelativeColor` uses `normalized = 1.0` (warm orange) when all weights equal, not "mid-range". Documented as authoritative intent.
- **`addResizeListener` wired**: `updateGraph` now calls `addResizeListener` after rebuilding edge lines so LineMaterial resolution tracks resize.
- **`resetNodeColors` badge flush**: Added `badgeMesh` to the `instanceColor.needsUpdate` loop for consistency with `setNodePositions`.
- **`computeLineDistances` placement**: Removed from `updateEdgePositions` (was running per frame unnecessarily); only called in `createEdgeLines` at construction time.
- **`nodeIndexMap` singleton**: Kept as module-level export per spec requirement for sections 09/10.
- **`_meshes` dead parameter**: Kept with underscore prefix per spec for section-10 signature compatibility.

## Actual Files Created/Modified

| File | Action |
|------|--------|
| `webview/nodes.ts` | Created — 194 lines |
| `webview/edges.ts` | Created — 108 lines |
| `webview/renderer.ts` | Modified — added resize listener mechanism |
| `webview/orb.ts` | Modified — added initOrb, updateRenderPositions, wired edge rebuild |
| `webview/main.ts` | Modified — wired initOrb + updateRenderPositions |
| `webview/__tests__/nodes.test.ts` | Created — 8 tests |
| `webview/__tests__/edges.test.ts` | Created — 6 tests |

**Test count:** 14 tests, all passing.
