# Code Review: section-06-integration

## Overall Assessment: CONCERNS — test quality and a few structural issues

---

## Issues

### HIGH — nodeActions.ts fix is dead code (redundant guard)

The added `if (hit.instanceId === undefined) return null;` at line 240 is unreachable — line 230 already guards this before `hit` is assigned. Should use a type assertion (`hit.instanceId as number`) at the call site instead.

### HIGH — ThreeForceGraph mock in integration.test.ts missing `onFinishUpdate`

orb.ts line 208 calls `graph.onFinishUpdate(...)` at module evaluation time. integration.test.ts mock omits it; gap-coverage.test.ts correctly includes it. Any future integration test importing `../orb` will throw at module load time.

### MEDIUM — capAndTransform test only covers node-count cap, not edge-cap path

The GRAPH_EDGE_CAP=300 (edge count cap when nodes >500) is never exercised. `originalCounts.edges` is never asserted.

### MEDIUM — resetNodeColors null assertion masks failures

`m.projectMesh.instanceColor!.needsUpdate` — if `setNodePositions` didn't call `setColorAt`, this crashes with TypeError instead of a clean test failure.

### MEDIUM — graph:snapshot animation test doesn't assert scene.remove

The test verifies `_getEphemeralEdges().size === 0` but doesn't assert `mockScene.remove` was called.

### MEDIUM — WebSocket reconnect test doesn't test application code

The inline `connect()` function in the test is not imported from `main.ts`. Reconnect regression in main.ts won't be caught.

### LOW — voice.ts `as any` cast is too wide

Silences all compiler checks for `recognition`. A minimal local interface for the 5 used properties would be safer.

### LOW — evaluateQuery tests in integration.test.ts are mislabeled

They test a single module with empty inputs, not cross-module integration.

### LOW — build:check not wired into test pipeline

The `tsc --noEmit` script exists but isn't called by `npm test`.

### LOW — Mock duplication with divergent Line2.dispose

MockInstancedMesh copy-pasted into both test files. Line2 mock in gap-coverage.test.ts has no `dispose` method while integration.test.ts adds one.
