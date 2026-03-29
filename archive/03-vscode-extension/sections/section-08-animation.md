# section-08-animation

## Overview

This section implements `webview/animation.ts`, which drives all time-based visual behavior in the orb: live connection glow when edges fire in real time, relativistic recency fading that makes rarely-used edges visually recede relative to active ones, and ambient breathing that keeps the orb alive even during quiet periods.

**Dependencies:**
- `section-07-rendering` — InstancedMesh nodes and Line2 edges must exist
- `section-05-extension-host` — `connection:new` messages arrive via the extension host relay
- `section-06-threejs-scene` — the `requestAnimationFrame` loop lives in `renderer.ts`/`orb.ts`

**Parallel with:** `section-09-camera-hud` and `section-10-node-actions`.

---

## File to Create

**`C:\dev\tools\DevNeural\03-vscode-extension\webview\animation.ts`**

Minor integration changes to:
- `webview/main.ts` — route `connection:new` messages to animation module
- `webview/edges.ts` — expose edge material references

---

## Tests First

Test file: `C:\dev\tools\DevNeural\03-vscode-extension\webview\__tests__\animation.test.ts`

Run with vitest + jsdom. Three.js materials are mocked as plain objects — no WebGL context needed.

### 5.1 Live Connection Glow Tests

```typescript
// Test: On connection:new, the corresponding edge material emissiveIntensity is boosted
// Test: On connection:new for a non-existent edge, an ephemeral edge is created
// Test: Ephemeral edge has weight 1.0, first_seen = Date.now(), last_seen = Date.now(), raw_count = 1
// Test: On next graph:snapshot, all active glow flags are cleared
// Test: On next graph:snapshot, all ephemeral edges are removed from the scene
```

Use `vi.setSystemTime()` to make `Date.now()` deterministic in ephemeral edge tests.

### 5.2 Recency Fading Tests (relativistic — pure function)

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

### 5.3 Ambient Breathing Tests (pure function)

```typescript
// Test: breathe(t=0) returns emissiveIntensity 0.0 (minimum)
// Test: breathe(t=period/2) returns emissiveIntensity ~0.4 (maximum)
// Test: breathe uses emissiveIntensity channel only — does NOT modify opacity
// Test: Node scale at breathe(t=0, nodeIndex=0) is 1.0 (base scale)
// Test: Node scale at breathe(t=5000, nodeIndex=0) differs from breathe(t=5000, nodeIndex=5)
```

---

## Implementation Details

### 5.1 Live Connection Glow

Maintain module-level:
- `activeEdgeIds: Set<string>` — edges currently in boosted glow state
- `ephemeralEdges: Map<string, EphemeralEdge>` — edges not yet in the graph

The `connection:new` payload contains no weight or timestamp fields. When the message arrives:

1. Look up the edge by `source + target` in the existing edge materials map.
2. If found: add to `activeEdgeIds`, boost `material.emissiveIntensity` (to `1.0`).
3. If not found: create ephemeral edge with:
   - `weight: 1.0` (forces maximum brightness in relativistic color)
   - `first_seen: Date.now()`
   - `last_seen: Date.now()`
   - `raw_count: 1`
   - Add temporary `Line2` to scene.

On next `graph:snapshot`:
- Clear `activeEdgeIds`
- Remove all ephemeral `Line2` objects from scene, dispose their geometry/material
- Clear `ephemeralEdges`

### 5.2 Recency Fading (Relativistic)

```typescript
/**
 * Pure function. Normalizes last_seen timestamps across all edges.
 * Most recently active edge → score 1.0
 * Least recently active edge → score 0.0
 * All-equal or single-edge graphs → all scores 1.0 (no fading)
 */
export function computeRelativeRecency(
  edges: Array<{ id: string; last_seen: number }>
): Map<string, number>
```

```typescript
/**
 * Applies recency scores to edge materials.
 * Sets material.opacity = 0.2 + score * 0.8
 * Sets material.transparent = true when opacity < 1.0
 * Does NOT touch emissiveIntensity.
 * When fadingEnabled = false: sets all opacity to 1.0.
 */
export function applyRecencyOpacity(
  edgeMaterials: Map<string, { opacity: number; transparent: boolean }>,
  recencyScores: Map<string, number>,
  fadingEnabled: boolean
): void
```

`applyRecencyOpacity` runs once per snapshot (not per frame).

### 5.3 Ambient Breathing

```typescript
/**
 * Pure function — maps elapsed time to animation values.
 * Edge emissiveIntensity: 3000ms period, range [0.0, 0.4]
 *   formula: 0.2 * (1 - Math.cos(2π * elapsedMs / 3000)) / 2
 * Node scale factor: 5000ms period, per-node offset = nodeIndex * 100ms
 *   formula: 1.0 + 0.03 * Math.sin(2π * (elapsedMs + nodeIndex * 100) / 5000)
 */
export function breathe(
  elapsedMs: number,
  nodeIndex: number
): { emissiveIntensity: number; scaleFactor: number }
```

The render loop (in `renderer.ts`) calls `tickBreathing(elapsedMs: number)` each frame. `tickBreathing` calls `breathe(elapsed, i)` for each node and applies `emissiveIntensity` to edges and `scaleFactor` to node `Matrix4` scale. These values only affect `emissiveIntensity` and `Matrix4` scale — never `material.opacity`.

**Independence guarantee**: Breathing uses `emissiveIntensity` (edges) and `Matrix4` scale (nodes). Recency fading uses `material.opacity`. These two systems never cross-modify each other's properties.

---

## Exported API

```typescript
// Initialization
export function initAnimation(scene: THREE.Scene): void

// Message handlers (called from main.ts)
export function onConnectionNew(payload: { source: string; target: string; connectionType: string }): void
export function onSnapshot(edges: Array<{ id: string; last_seen: number }>): void
export function setRecencyFadingEnabled(enabled: boolean): void

// Render loop integration (called each frame)
export function tickBreathing(elapsedMs: number): void

// Pure functions (exported for testing)
export function computeRelativeRecency(
  edges: Array<{ id: string; last_seen: number }>
): Map<string, number>

export function breathe(
  elapsedMs: number,
  nodeIndex: number
): { emissiveIntensity: number; scaleFactor: number }
```

---

## main.ts routing additions

```typescript
case 'connection:new': onConnectionNew(event.data.payload); break;
case 'settingsUpdate':
  if (event.data.key === 'recencyFading') setRecencyFadingEnabled(event.data.value);
  break;
```
