# Code Review: section-02-animation

## Overall Assessment: CONCERNS

---

## Issues

### MEDIUM — tickBreathing computes scaleFactor but never applies it to node meshes
`tickBreathing` iterates edges and applies emissiveIntensity, but the scaleFactor from `breathe()` is discarded. Applying it requires access to nodeIndexMap and InstancedMesh matrices. Architecture decision needed.

### MEDIUM — ephemeral edges use hardcoded 1280×720 resolution
Line 85 in animation.ts: `resolution: new THREE.Vector2(1280, 720)`. Should use `window.innerWidth/innerHeight` + resize listener, matching how edges.ts handles it. **Auto-fixable.**

### MEDIUM — getEdgeMaterials in edges.ts is never called
The function was added per the plan ("expose edge material references") but is unused — animation.ts casts `line.material` directly. Either delete it or route animation.ts through it. **Auto-fixable** (prefer: remove the dead export).

### LOW — one-frame 0.0 emissiveIntensity flash when clearing glow
`onSnapshot` sets emissiveIntensity = 0.0 on formerly-glowing edges, then tickBreathing restores it next frame. ~16ms black flash. Acceptable for now.

### LOW — fragile initialization order (latent, not a bug)
`registerEdges` has no `_scene` guard; safe because WebSocket messages arrive after `initAnimation(scene)` is called in main.ts. Acceptable for now.

---

## Auto-fixes to apply
1. Fix ephemeral edge resolution to use window dimensions + resize listener
2. Remove unused `getEdgeMaterials` export from edges.ts

## User decision needed
- Should `tickBreathing` apply `scaleFactor` to node meshes this section (by importing `nodeIndexMap` from nodes.ts)?
