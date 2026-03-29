# Code Review Interview: section-03-camera-hud

## Auto-fixes Applied

1. **search.ts — type query edge filter `&&` → `||`**
   Edge filter for type queries now correctly includes edges where *either* endpoint matches the type, not both. Fixes zero-edge results for `evaluateQuery('tool', ...)`.

2. **camera.ts — `controls.update()` after lerp**
   Added `controls.update()` call at end of each `tick()` frame while a transition is in progress. Ensures OrbitControls orientation updates immediately after programmatic target changes.

3. **main.ts — `setCameraMode` on user interaction**
   `controls.addEventListener('start', ...)` now calls `setCameraMode(hudElements, cameraController.state)` after `onUserInteraction()`, so the HUD label updates to 'manual' and the "Return to Auto" button appears.

4. **main.ts — removed redundant `setConnectionStatus` on snapshot**
   `ws.onopen` handles the initial 'connected' state. The snapshot handler no longer re-fires it.

5. **main.ts — reordered to avoid forward-reference**
   `hudElements` is now created before `controls.addEventListener` so the listener closure can safely reference it.

6. **main.ts — non-matching color 0x222222 → 0x3a3a4a**
   Background will be near-black deep space. 0x222222 would make non-matching nodes invisible. Changed to dark blue-gray 0x3a3a4a — visible but clearly de-emphasized against dark background, preserving the "searching for something specific" contrast.

## User Decisions

**Node click → camera focus:** Deferred to section-04-node-actions. Click interaction requires raycasting against InstancedMesh, which is an action/interaction concern, not a camera-wiring concern.

**Non-matching visual (opacity 0.2 vs color):** User confirmed the background will be very dark (near-black space depth). Using `0x3a3a4a` (dark blue-gray) instead of opacity 0.2, since InstancedMesh per-instance opacity is complex and a near-black color appropriately dims nodes without making them invisible against the dark scene.
