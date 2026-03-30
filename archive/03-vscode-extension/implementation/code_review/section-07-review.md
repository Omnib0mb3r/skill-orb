# Code Review: section-07-rendering

## MUST FIX

### 1. Stale ghost nodes when snapshot shrinks (nodes.ts:100–142)
`setNodePositions` only iterates the current `nodes` array. When a later snapshot has fewer nodes than the previous call, slots from `nodes.length` up to the prior high-water mark are never zeroed. Those slots retain the last-written matrix and render as floating ghost geometry. The spec (Critical Correctness #3) explicitly requires: 'Scale unused instances to zero instead of reducing count.' The zero-initialization in `createNodeMeshes` is a one-time setup; `setNodePositions` must track and zero any surplus slots on every call.

### 2. `addResizeListener` exported but never wired to LineMaterial (renderer.ts:10, edges.ts:57–64)
The plan requires LineMaterial resolution be updated on resize. `createEdgeLines` snapshots `window.innerWidth/innerHeight` at construction time only. On webview resize all LineMaterial uniforms are stale and line thickness renders incorrectly. `initOrb` must call `addResizeListener` after building edge lines and update each material's `resolution` property on resize. This is a silent visual regression invisible to the test suite.

### 3. `computeRelativeColor` zero-range behavior contradicts spec (edges.ts:325, plan lines 151 vs 158)
The plan docstring says 'returns the same mid-range color for all' (plan line 151); the algorithm step says 'use normalized = 1.0 for all' (plan line 158). These produce different colors. The implementation follows normalized=1.0 (warm end) and the edges.ts docstring was silently rewritten to match, masking the contradiction. The existing test only checks that all edges share the same color, not which color. A specific hue-range assertion is required and the decision must be documented.

## CONSIDER

### 4. `nodeIndexMap` is a module-level mutable singleton (nodes.ts:13)
Populated as a side effect of `setNodePositions` and exported globally. Sections 09 and 10 will depend on it. Any caller invoking `setNodePositions` — including test scaffolding — silently corrupts the shared state. The map should be returned from `setNodePositions` rather than written to a module-level export.

### 5. `_meshes` parameter in `setNodeColor` is dead (nodes.ts:156)
The function ignores its `meshes` argument entirely, relying only on the index map's embedded mesh reference. Section-10 callers will pass a meshes object that is silently discarded. Either remove the parameter from the public signature or use it.

### 6. `resetNodeColors` omits `badgeMesh` from `instanceColor.needsUpdate` loop (nodes.ts:177–179)
The flush loop iterates only `[projectMesh, toolMesh, skillMesh]`, skipping `badgeMesh`. This is inconsistent with `setNodePositions` which always flushes all four meshes. Any future path that resets badge colors through this function will silently drop the GPU update.

### 7. `computeLineDistances()` called every animation frame (edges.ts:92)
Recomputes arc-length tables for dash patterns per edge per frame. Dashing is not enabled. The call belongs only in `createEdgeLines` after initial geometry creation, not in the per-frame `updateEdgePositions` path.

## NITPICK

### 8. `resetNodeColors` has no test
Exported, plan-specified function with zero coverage. The nodes.test.ts fixture infrastructure already supports it.

### 9. Per-frame heap allocation in `updateRenderPositions` hot path (orb.ts:177–181)
A new Map and one new THREE.Vector3 per live node is allocated every animation frame. At 500 nodes and 60fps this is 30,000 allocations per second. Pre-allocated persistent structures would eliminate this GC pressure.
