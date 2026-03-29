# Code Review: section-04-node-actions

## Overall Assessment: CONCERNS — fix required before ship

---

## Issues

### HIGH — buildInstanceMaps called before updateGraph: first snapshot always broken

`main.ts` calls `buildNodeDataMap` and `buildInstanceMaps` BEFORE `updateGraph`. The `nodeIndexMap` is populated INSIDE `updateGraph → setNodePositions`. On every first snapshot both maps are empty → every click/hover silently no-ops. Lines must move to after `updateGraph`.

### HIGH — XSS via innerHTML with unsanitized WebSocket data

`nodeActions.ts` line 327: `el.innerHTML = lines.join('<br>')`. `node.label`, `node.type`, `node.stage`, and the `<a href>` URL all come from the unauthenticated WebSocket. Fix by constructing DOM nodes with `textContent` per field.

---

### MEDIUM — evaluateQuery not called on tool/skill click (spec feature dropped)

Plan: "Highlight connected nodes via `evaluateQuery`". `handleNodeClick` calls only `onActiveProjectsChanged`. No node colors are changed. Fix by adding an optional `applyVisuals` callback.

### MEDIUM — O(n) reverse-map scan in pointermove hot path

`nodeActions.ts` line 513: spreads the entire instance map and scans it on every `pointermove`. The `instanceId` is already available from the raycaster hit. Thread it through `resolveHit`'s return value.

### MEDIUM — Tooltip clamp uses 10px margin for 260px-wide element

Lines 524–525 clamp with `rect.width - 10`. The tooltip overflows on any hover near right/bottom edge. Use `el.offsetWidth` / `el.offsetHeight` or a larger constant.

### MEDIUM — Tooltip position:absolute on body drifts on scroll

Minor for now (app is full-viewport) — defer to later.

---

### LOW — `_mesh` parameter dead weight in mapInstanceToNodeId
### LOW — NodeRenderData re-export has no consumers
### LOW — buildInstanceMaps else-fallback silently corrupts skill map

---

## Auto-fixes to apply
1. Move buildInstanceMaps/buildNodeDataMap to after updateGraph in main.ts
2. Replace innerHTML with DOM construction in createTooltip (XSS)
3. Add `applyVisuals` optional callback to handleNodeClick; wire in main.ts
4. Thread instanceId through resolveHit to eliminate O(n) scan
5. Increase tooltip clamp margin
6. Remove NodeRenderData re-export
