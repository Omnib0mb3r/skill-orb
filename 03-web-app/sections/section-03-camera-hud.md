# section-03-camera-hud

## Overview

Implements the context-aware camera state machine (`webview/camera.ts`), HTML HUD overlay
(`webview/hud.ts`), and search/filter module (`webview/search.ts`).

In the web app, `setActiveProjects` is driven by user click events (clicking a project node
focuses it) rather than VS Code's "open folder" state. WebSocket connection status is derived
directly from the WebSocket lifecycle in `src/main.ts`.

**Depends on:** `section-01-scaffold`, `section-02-animation`

**Blocks:** `section-05-voice` (HUD mic button must exist)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/camera.ts` | Create — camera state machine |
| `webview/hud.ts` | Create — HTML HUD overlay |
| `webview/search.ts` | Create — pure query matching |
| `src/main.ts` | Modify — wire camera, HUD, search, OrbitControls 'start' event |

---

## Tests First

### Camera State Machine (`webview/__tests__/camera.test.ts`)

```typescript
// Test: camera starts in full-sphere state on init
// Test: setActiveProjects([nodeId]) transitions camera to single-focus state
// Test: setActiveProjects([id1, id2]) transitions camera to multi-focus state
// Test: setActiveProjects([]) transitions camera to full-sphere state
// Test: onUserInteraction() transitions camera to manual state
// Test: returnToAuto() transitions camera to full-sphere from manual
// Test: camera does NOT transition from manual to auto when setActiveProjects fires while in manual
```

### HUD (`webview/__tests__/hud.test.ts`)

```typescript
// Test: HUD container div is absolutely positioned with pointer-events: none
// Test: Individual interactive HUD elements (buttons, inputs) have pointer-events: auto
// Test: setConnectionStatus(elements, 'connected') sets status indicator to connected state
// Test: setConnectionStatus(elements, 'disconnected') sets status indicator to disconnected state
```

### Search (`webview/__tests__/search.test.ts`)

```typescript
// Test: Empty query string returns all nodes and edges as matches
// Test: Query "tool" returns all nodes with type === "tool"
// Test: Query matching a node label (case-insensitive substring) returns that node + connected edges
// Test: Query matching a stage value (e.g., "beta") returns project nodes with that stage
// Test: Query "project->tool" returns all edges with connection_type "project->tool"
// Test: Reverse query "uses playwright" → project nodes connected to "playwright" tool node
// Test: Unrecognized query falls back to substring match across all node labels
// Test: Non-matching nodes identified in result as non-matching set
// Test: Search debounce: rapid keystrokes within 150ms fire only one evaluation call
```

---

## Camera State Machine (`webview/camera.ts`)

Four states:

| State | Trigger | Behavior |
|---|---|---|
| `full-sphere` | initial / `setActiveProjects([])` / `returnToAuto()` | Wide-angle, full orb visible |
| `single-focus` | `setActiveProjects([oneId])` | Orbits to face active node, zooms |
| `multi-focus` | `setActiveProjects([id1, id2, ...])` | Pulls back to frame all active |
| `manual` | User mouse/orbit event (OrbitControls 'start') | Tracks user, ignores setActiveProjects |

Smooth transitions: lerp camera position + OrbitControls target over 800ms ease-in-out.

```typescript
export type CameraState = 'full-sphere' | 'single-focus' | 'multi-focus' | 'manual';

export interface CameraController {
  readonly state: CameraState;
  onActiveProjectsChanged(nodeIds: string[]): void;
  onUserInteraction(): void;
  returnToAuto(): void;
  focusOnCluster(centroid: THREE.Vector3, radius: number): void;
  tick(deltaMs: number): void;
}

export function createCameraController(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  getNodePosition: (nodeId: string) => THREE.Vector3 | null,
): CameraController;
```

---

## HUD Overlay (`webview/hud.ts`)

DOM layer on top of the canvas, no frameworks.

Outer container: `position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none`

| Region | Position | Contents |
|---|---|---|
| Top-left | `top: 12px; left: 12px` | "DevNeural" title, WebSocket status dot |
| Top-right | `top: 12px; right: 12px` | Camera mode label, "Return to Auto" button |
| Bottom-left | `bottom: 12px; left: 12px` | Legend (shapes, color gradient, stage badges) |
| Bottom-center | `bottom: 12px; left: 50%; transform: translateX(-50%)` | Search `<input>` + mic `<button>` |

```typescript
export interface HudElements {
  statusIndicator: HTMLElement;
  cameraToggle: HTMLElement;
  returnToAutoButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  voiceButton: HTMLButtonElement;  // wired in section-05
  legendContainer: HTMLElement;
}

export interface HudCallbacks {
  onReturnToAuto(): void;
  onSearchQuery(query: string);  // debounced 150ms
}

export function createHud(callbacks: HudCallbacks): HudElements;
export function setConnectionStatus(elements: HudElements, status: 'connected' | 'disconnected' | 'unknown'): void;
export function setCameraMode(elements: HudElements, state: CameraState): void;
```

### Legend Content

The bottom-left legend should document all visual elements:
- **Shapes**: slab rectangle = project, cube = tool, octahedron = skill
- **Edge color**: cool blue (low weight) → warm orange (high weight)
- **Stage badges**: amber ring = alpha, cyan = beta, green = deployed, grey = archived

---

## Search (`webview/search.ts`)

Pure module — no Three.js references. Match criteria (unioned):

1. Empty query → all nodes and edges match
2. Type match: `"project"`, `"tool"`, `"skill"`
3. Stage match: `"alpha"`, `"beta"`, `"deployed"`, `"archived"`, `"sandbox"`, `"revision-needed"`
4. Connection type: `"project->tool"`, etc.
5. Reverse query: prefix `"uses "` or `"connects to "` → strip prefix, find nodes connected to target
6. Label substring (case-insensitive) — fallback

```typescript
export interface SearchResult {
  matchingNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

export function evaluateQuery(query: string, nodes: GraphNode[], edges: GraphEdge[]): SearchResult;
export function detectReverseQuery(query: string): { isReverse: boolean; target: string };
```

Visual effects applied by `src/main.ts`: matching nodes → white color; non-matching → opacity 0.2.
If result non-empty and camera not in `manual`: call `focusOnCluster(centroid, radius)`.

---

## src/main.ts Changes

```typescript
// Wire camera controller
const cameraController = createCameraController(camera, controls, getNodePosition);
controls.addEventListener('start', () => cameraController.onUserInteraction());
cameraController.tick(delta * 1000);  // in animation loop

// Wire HUD
const hudElements = createHud({
  onReturnToAuto: () => cameraController.returnToAuto(),
  onSearchQuery: (q) => applySearchVisuals(evaluateQuery(q, lastNodes, lastEdges)),
});

// Update HUD on snapshot
setConnectionStatus(hudElements, 'connected');
setCameraMode(hudElements, cameraController.state);

// WebSocket onclose → setConnectionStatus(hudElements, 'disconnected')
```

`getNodePosition` should read from `nodeIndexMap` + the current force positions from
`graph.graphData()`.
