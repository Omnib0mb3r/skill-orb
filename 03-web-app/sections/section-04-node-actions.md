# section-04-node-actions

## Overview

Click and hover interactions with the Three.js instanced meshes. Purely in-browser — no
VS Code extension host. Project node click opens the project's GitHub URL in a new tab
(or shows a tooltip with the local path for local-only repos). Tool/skill click focuses
the camera on connected nodes.

**Depends on:** `section-01-scaffold` (nodeIndexMap), `section-03-camera-hud` (camera + HUD)

**Parallel with:** `section-02-animation`, `section-03-camera-hud`

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/main.ts` (effectively `src/main.ts`) | Add raycasting, hover tooltip, click handler |

All paths: `C:\dev\tools\DevNeural\03-web-app\`

No extension host side — all interaction handled in the browser.

---

## Tests First

**`webview/__tests__/nodeActions.test.ts`**

```typescript
// Raycasting
// Test: mapInstanceToNodeId returns correct nodeId for a known instanceIndex
// Test: mapInstanceToNodeId returns undefined when instanceIndex is out of bounds

// Project node click
// Test: Project node click with GitHub URL calls window.open with that URL
// Test: Project node click when id has no parseable URL shows info in tooltip

// Tool/skill node click
// Test: Tool/skill node click triggers focusOnConnected(nodeId) on camera controller

// Tooltip
// Test: Hover tooltip is positioned at screen-space projection of node's 3D position
// Test: Tooltip shows: label, type, connection count, stage (if present)
// Test: Tooltip is hidden on mouse-out
```

---

## Implementation

### Instance-Index to Node-ID Mapping

```typescript
function mapInstanceToNodeId(
  mesh: THREE.InstancedMesh,
  instanceIndex: number,
  instanceMap: Map<number, string>  // instanceIndex → nodeId, per mesh
): string | undefined
```

The `instanceMap` is built from `nodeIndexMap` during each snapshot and stored in module scope.

### Click Raycasting

On canvas `'click'` event:
1. Set up `THREE.Raycaster` against all three node InstancedMesh objects (project, tool, skill)
2. Disambiguate from orbit: if pointer moved >5px between pointerdown and pointerup, skip
3. On hit: extract `instanceIndex`, look up `nodeId`
4. Dispatch click action based on `node.type`

**Project node click:**
- Derive GitHub URL: `nodeId.replace(/^project:/, 'https://')` (strip prefix)
- If URL is valid: `window.open(url, '_blank')`
- If no parseable URL: show info in tooltip ("No URL available")

**Tool/skill node click:**
- Call `cameraController.onActiveProjectsChanged(connectedProjectIds)` to focus camera
- Highlight connected nodes via `evaluateQuery`

### Hover Raycasting

On `'pointermove'` (throttled to ~60fps via timestamp delta):
1. Run raycaster against all three node meshes
2. On hit: project node 3D position to screen space, call `showTooltip(node, screenX, screenY)`
3. On miss: `hideTooltip()`

### Screen-Space Projection

```typescript
function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement
): { x: number; y: number }
// Clone vector → .project(camera) → map NDC [-1,1] to canvas pixel space
```

### Tooltip

One `<div>` created once, absolutely positioned, `display: none` by default,
`pointer-events: none`. `showTooltip` populates and positions it.

Content:
- **Label**: `node.label`
- **Type**: `node.type`
- **Connection count**: edges with this node as source or target
- **Stage**: shown only if `node.stage` is present
- **GitHub link**: `<a>` tag if URL derivable

Clamp tooltip position to keep within canvas bounds.

### GitHub URL Derivation

```typescript
function deriveGitHubUrl(nodeId: string): string | null {
  const stripped = nodeId.replace(/^(project|tool|skill):/, '');
  if (stripped.startsWith('github.com') || stripped.startsWith('http')) {
    return stripped.startsWith('http') ? stripped : `https://${stripped}`;
  }
  return null;
}
```

---

## Edge Cases

- **Click before first snapshot**: node registry empty — no action
- **No parseable URL**: show tooltip with label only, no GitHub link
- **Multiple mesh hits**: use only first intersection (lowest distance)
- **Tooltip off-screen**: clamp X/Y to keep within canvas bounds
