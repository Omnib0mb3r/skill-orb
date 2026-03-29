# Code Review: section-03-camera-hud

## Overall Assessment: CONCERNS

---

## Issues

### HIGH — onActiveProjectsChanged never wired to any click event in main.ts

The camera state machine's `onActiveProjectsChanged` method is the sole entry point for `single-focus` and `multi-focus` states, but `main.ts` never registers a click handler on project node meshes to call it. The plan explicitly states "setActiveProjects is driven by user click events (clicking a project node focuses it)." Those two states are permanently unreachable at runtime. This is the most critical gap — the camera section's primary interactive feature does not work.

### HIGH — setCameraMode never called when camera enters 'manual' state

The OrbitControls `'start'` event calls `cameraController.onUserInteraction()`, which sets `_state = 'manual'`, but `main.ts` never calls `setCameraMode(hudElements, cameraController.state)` at that point. The HUD label stays stale and the `returnToAutoButton` stays hidden while the camera is in manual mode. `setCameraMode` is only called inside `ws.onmessage` and inside `onReturnToAuto`. The "Return to Auto" button never appears after user orbit.

### MEDIUM — Type query edge filter uses AND instead of OR (search.ts)

```typescript
edges.filter(e => matchingNodeIds.has(e.source) && matchingNodeIds.has(e.target))
```

For a query of `"tool"`, this requires *both* endpoints to be tool nodes. Tool→tool edges don't exist in a typical graph, so zero edges are returned. Every other branch (stage match, label fallback) correctly uses `||`. This should be `||`.

### MEDIUM — applySearchVisuals resets colors on zero-result (main.ts)

When `result.matchingNodeIds.size === 0`, the code calls `resetNodeColors` and returns. A zero-result search should dim *all* nodes, not reset them to defaults.

### MEDIUM — getNodePosition uses O(n) Array.find every call (orb.ts)

`getNodePosition` does `graphData.nodes.find(n => ...)` on every invocation. The plan says "should read from `nodeIndexMap` + the current force positions." Using `nodeIndexMap` would give O(1) lookup.

### LOW — tick() does not call controls.update() after lerping target (camera.ts)

After `controls.target.lerpVectors(...)`, `controls.update()` is not called. With OrbitControls the orientation does not update until an explicit `update()`. Standard practice: call `controls.update()` whenever target is programmatically changed.

### LOW — setConnectionStatus called redundantly on every snapshot (main.ts)

`setConnectionStatus(hudElements, 'connected')` fires on every `graph:snapshot`. The `ws.onopen` handler already handles this.

---

## Test Coverage Gaps

1. **camera.test.ts has no tick() test.** The lerp transition is completely untested.
2. **hud.test.ts has no setCameraMode test.** No coverage for returnToAutoButton visibility.
3. **search.test.ts: 'connects to' prefix not tested through evaluateQuery end-to-end.**
4. **Type query edge coverage test is missing** (would have caught the AND/OR bug).

---

## Summary

**Auto-fix:**
- Change type-query edge filter in search.ts from `&&` to `||`
- Add `controls.update()` at end of `tick()` transition in camera.ts
- Remove redundant `setConnectionStatus` call from snapshot handler in main.ts
- Fix `setCameraMode` not being called when user interaction starts

**Ask user:**
- Should node click → `onActiveProjectsChanged` be wired in this section or a later section?
- Non-matching visual: opacity 0.2 (spec) vs. flat color 0x222222 (implementation)?
