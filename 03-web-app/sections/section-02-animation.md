# section-02-animation

## Overview

Implements `webview/animation.ts`: live connection glow, relativistic recency fading,
and ambient breathing. Identical in design to the archived extension's `section-08-animation`
but receives `connection:new` via browser WebSocket instead of VS Code postMessage.

**Depends on:** `section-01-scaffold` (nodes, edges, renderer all exist)

**Parallel with:** `section-03-camera-hud`, `section-04-node-actions`

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/animation.ts` | Created — full implementation |
| `webview/orb.ts` | Modified — imports and calls `registerEdges` after each graph update |
| `src/main.ts` | Modified — routes `connection:new` and `graph:snapshot` to animation module; calls `tickBreathing` each frame |

> **Note:** `getEdgeMaterials` from the edges.ts plan was omitted — animation.ts accesses materials via direct cast, which is equivalent and avoids an unused export.
> **Added:** `registerEdges` (not in original spec) required for animation module to track source→target→edgeId mappings. Called by orb.ts.
> **Added:** Node scale breathing via `nodeIndexMap` imported from nodes.ts — `tickBreathing` applies `scaleFactor` via Matrix4 decompose/recompose per frame.

All paths: `C:\dev\tools\DevNeural\03-web-app\`

---

## Tests First

**`webview/__tests__/animation.test.ts`**

### Live Connection Glow

```typescript
// Test: On connection:new, the corresponding edge material emissiveIntensity is boosted
// Test: On connection:new for a non-existent edge, an ephemeral edge is created
// Test: Ephemeral edge has weight 1.0, first_seen = Date.now(), last_seen = Date.now(), raw_count = 1
// Test: On next graph:snapshot, all active glow flags are cleared
// Test: On next graph:snapshot, all ephemeral edges are removed from the scene
```

Use `vi.setSystemTime()` to make `Date.now()` deterministic in ephemeral edge tests.

### Recency Fading (pure function)

```typescript
// Test: computeRelativeRecency([e1, e2, e3]) — most recently active edge gets score 1.0
// Test: computeRelativeRecency([e1, e2, e3]) — least recently active edge gets score 0.0
// Test: computeRelativeRecency — all edges same last_seen → all scores 1.0 (no fading)
// Test: computeRelativeRecency — single-edge graph → score 1.0 (no range → no fading)
// Test: Edge with score 1.0 has opacity 1.0
// Test: Edge with score 0.0 has opacity 0.2
// Test: Edge with score 0.5 has opacity ~0.6 (linear: 0.2 + score * 0.8)
// Test: recency uses material.opacity and does NOT modify material.emissiveIntensity
// Test: When devneural.recencyFading = false, all edges have opacity 1.0 regardless of scores
```

### Ambient Breathing (pure function)

```typescript
// Test: breathe(t=0) returns emissiveIntensity 0.0 (minimum)
// Test: breathe(t=period/2) returns emissiveIntensity ~0.4 (maximum)
// Test: breathe uses emissiveIntensity channel only — does NOT modify opacity
// Test: Node scale at breathe(t=0, nodeIndex=0) is 1.0 (base scale)
// Test: Node scale at breathe(t=5000, nodeIndex=0) differs from breathe(t=5000, nodeIndex=5)
```

---

## Implementation

### Live Connection Glow

Module-level state:
- `activeEdgeIds: Set<string>` — boosted glow state
- `ephemeralEdges: Map<string, EphemeralEdge>` — edges not yet in graph

On `connection:new`:
1. Look up edge by `source + target` in edge materials map
2. If found: add to `activeEdgeIds`, boost `material.emissiveIntensity` to `1.0`
3. If not found: create ephemeral edge (`weight: 1.0`, `first_seen: Date.now()`) + add `Line2` to scene

On next `graph:snapshot`: clear `activeEdgeIds`, remove + dispose ephemeral `Line2` objects.

### Recency Fading

```typescript
export function computeRelativeRecency(
  edges: Array<{ id: string; last_seen: number }>
): Map<string, number>
// Most recently active → score 1.0; least → score 0.0; all-equal → all 1.0

export function applyRecencyOpacity(
  edgeMaterials: Map<string, { opacity: number; transparent: boolean }>,
  recencyScores: Map<string, number>,
  fadingEnabled: boolean
): void
// material.opacity = 0.2 + score * 0.8. Runs once per snapshot, not per frame.
```

### Ambient Breathing

```typescript
export function breathe(
  elapsedMs: number,
  nodeIndex: number
): { emissiveIntensity: number; scaleFactor: number }
// emissiveIntensity: 3000ms period, range [0.0, 0.4]
//   formula: 0.2 * (1 - Math.cos(2π * elapsedMs / 3000)) / 2
// scaleFactor: 5000ms period, per-node offset = nodeIndex * 100ms
//   formula: 1.0 + 0.03 * Math.sin(2π * (elapsedMs + nodeIndex * 100) / 5000)
```

**Independence guarantee:** Breathing uses `emissiveIntensity` (edges) + `Matrix4` scale (nodes).
Recency fading uses `material.opacity`. These systems never cross-modify each other.

---

## Exported API

```typescript
export function initAnimation(scene: THREE.Scene): void
export function onConnectionNew(payload: { source: string; target: string; connectionType: string }): void
export function onSnapshot(edges: Array<{ id: string; last_seen: number }>): void
export function setRecencyFadingEnabled(enabled: boolean): void
export function tickBreathing(elapsedMs: number): void
export function computeRelativeRecency(edges: Array<{ id: string; last_seen: number }>): Map<string, number>
export function breathe(elapsedMs: number, nodeIndex: number): { emissiveIntensity: number; scaleFactor: number }
```

---

## src/main.ts Changes

```typescript
import { onConnectionNew, onSnapshot } from '../webview/animation';

// In WebSocket onmessage handler:
if (msg.type === 'connection:new') {
  onConnectionNew(msg.payload);
}
if (msg.type === 'graph:snapshot') {
  updateGraph(msg.payload);
  onSnapshot(msg.payload.edges);
}
```

Call `tickBreathing(delta * 1000)` in the animation loop.
