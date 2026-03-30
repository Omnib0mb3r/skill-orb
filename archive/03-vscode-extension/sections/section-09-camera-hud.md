# section-09-camera-hud

## Overview

This section implements the context-aware camera state machine, the HTML HUD overlay, and the search/filter module. It spans `webview/camera.ts`, `webview/hud.ts`, and `webview/search.ts`.

**Dependencies:**
- `section-07-rendering` — InstancedMesh objects for search highlight mutations
- `section-05-extension-host` — `setActiveProjects` postMessages consumed by camera

**Blocks:** `section-11-voice` (HUD mic button and search module must exist), `section-12-integration`.

---

## Files to Create

| File | Action |
|------|--------|
| `webview/camera.ts` | Create — camera state machine |
| `webview/hud.ts` | Create — HTML HUD overlay |
| `webview/search.ts` | Create — pure query matching and color operations |
| `webview/main.ts` | Modify — add `setActiveProjects` and `connectionStatus` message routing |

All paths: `C:\dev\tools\DevNeural\03-vscode-extension\webview\`

---

## Tests First

### Camera State Machine Tests

```
// Test: camera starts in full-sphere state when activeProjects is empty
// Test: setActiveProjects([nodeId]) transitions camera to single-focus state
// Test: setActiveProjects([id1, id2]) transitions camera to multi-focus state
// Test: manual orbit interaction transitions camera to manual state
// Test: "Return to Auto" button event transitions camera back to full-sphere state
// Test: camera does NOT transition from manual to auto when setActiveProjects fires while in manual
```

### HUD Tests

```
// Test: HUD container div is absolutely positioned with pointer-events: none
// Test: Individual interactive HUD elements (buttons, inputs) have pointer-events: auto
// Test: WebSocket status indicator updates to "connected" on graph:snapshot receipt
// Test: WebSocket status indicator updates to "disconnected" on connectionStatus message
```

### Search Tests

```
// Test: Empty query string returns all nodes and edges as matches (nothing dimmed)
// Test: Query "tool" returns all nodes with type === "tool"
// Test: Query matching a node label (case-insensitive substring) returns that node and connected edges
// Test: Query matching a stage tag value (e.g., "beta") returns project nodes with that tag
// Test: Query "project->tool" returns all edges with connection_type "project->tool"
// Test: Reverse query "uses playwright" → project nodes connected to the "playwright" tool node
// Test: Unrecognized query falls back to substring match across all node labels
// Test: Non-matching nodes have InstancedMesh opacity reduced to 0.2
// Test: Matching nodes have InstancedMesh color set to white (r=1, g=1, b=1)
// Test: After instanceColor mutation, instanceColor.needsUpdate is set to true
// Test: Search debounce: rapid keystrokes within 150ms fire only one search evaluation call
```

---

## Part 6: Camera State Machine (`webview/camera.ts`)

Four named states:

| State | Trigger | Behavior |
|---|---|---|
| `full-sphere` | `setActiveProjects([])` or initial | Wide-angle, full orb visible |
| `single-focus` | `setActiveProjects([oneId])` | Orbits to face active node, zooms to show it + neighbors |
| `multi-focus` | `setActiveProjects([id1, id2, ...])` | Pulls back to frame all active nodes |
| `manual` | Any user mouse/orbit event | Tracks user; ignores `setActiveProjects` |

**Transitions:**
- `setActiveProjects` moves between `full-sphere`, `single-focus`, `multi-focus` based on array length. Does NOT exit `manual`.
- User mouse/orbit event → `manual` (via OrbitControls `'start'` event listener)
- "Return to Auto" button → `full-sphere`

**Smooth transitions**: Lerp camera position and OrbitControls target over 800ms ease-in-out.

**Module interface:**

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

## Part 7: HUD Overlay (`webview/hud.ts`)

The HUD is a pure DOM layer rendered on top of the canvas. No frameworks. The outer container:

```css
position: absolute; top: 0; left: 0; right: 0; bottom: 0;
pointer-events: none;
```

Interactive elements override with `pointer-events: auto`.

**HUD regions:**

| Region | Position | Contents |
|---|---|---|
| Top-left | `absolute; top: 12px; left: 12px` | "DevNeural" title, WebSocket status dot |
| Top-right | `absolute; top: 12px; right: 12px` | Camera mode label, "Return to Auto" button |
| Bottom-left | `absolute; bottom: 12px; left: 12px` | Legend (shapes, color gradient, badge symbols) |
| Bottom-center | `absolute; bottom: 12px; left: 50%; transform: translateX(-50%)` | Search `<input>` + mic `<button>` (wired in section-11) |

```typescript
export interface HudElements {
  statusIndicator: HTMLElement;
  cameraToggle: HTMLElement;
  returnToAutoButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  voiceButton: HTMLButtonElement;   // wired in section-11
  legendContainer: HTMLElement;
}

export interface HudCallbacks {
  onReturnToAuto(): void;
  onSearchQuery(query: string): void;  // debounced 150ms
}

export function createHud(callbacks: HudCallbacks): HudElements;
export function setConnectionStatus(elements: HudElements, status: 'connected' | 'disconnected' | 'unknown'): void;
export function setCameraMode(elements: HudElements, state: CameraState): void;
```

Search debounce: standard `setTimeout(150ms)` pattern in the input event listener, reset on each keystroke.

---

## Part 7.2: Search (`webview/search.ts`)

Pure module — no Three.js references. `main.ts` applies visual mutations (InstancedMesh color changes) based on returned result sets.

**Match criteria (unioned):**

1. Empty query → all nodes and edges match
2. Type match: `"project"`, `"tool"`, `"skill"`
3. Stage/tag match: `"alpha"`, `"beta"`, `"deployed"`, `"archived"`, `"sandbox"`, `"revision-needed"`
4. Connection type: `"project->tool"`, etc.
5. Reverse query: prefix `"uses "` or `"connects to "` → strip prefix, find nodes connected to labeled target
6. Label substring (case-insensitive) — fallback

```typescript
export interface SearchResult {
  matchingNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

export function evaluateQuery(
  query: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): SearchResult;

export function detectReverseQuery(query: string): { isReverse: boolean; target: string };
```

**Visual effects** (applied by `main.ts` using results):
- Matching nodes → set InstancedMesh instance color to white (`rgb(1,1,1)`); set `instanceColor.needsUpdate = true`
- Non-matching nodes → reduce opacity to `0.2`
- If result is non-empty and camera is not in `manual`: call `cameraController.focusOnCluster(centroid, radius)`

---

## main.ts routing additions

```typescript
case 'setActiveProjects':
  cameraController.onActiveProjectsChanged(event.data.nodeIds);
  break;

case 'connectionStatus':
  setConnectionStatus(hudElements, event.data.status);
  break;

case 'filterToConnected':
  // Relay from tool/skill node click (section-10)
  const result = evaluateQuery(`connected:${event.data.nodeId}`, nodes, edges);
  applySearchVisuals(result);
  break;
```

Also wire OrbitControls `'start'` event:
```typescript
controls.addEventListener('start', () => cameraController.onUserInteraction());
```
