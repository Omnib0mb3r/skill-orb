# section-10-node-actions

## Overview

This section implements click and hover interactions with the Three.js instanced meshes, and the extension host handlers that respond to those interactions.

**Dependencies:**
- `section-07-rendering` — InstancedMesh objects and `nodeIndexMap` must exist
- `section-05-extension-host` — postMessage channel must be in place; node registry built from last snapshot

**Parallel with:** `section-08-animation`, `section-09-camera-hud`.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/main.ts` | Add raycasting, hover tooltip, click dispatch |
| `src/extension.ts` | Add `webview.onDidReceiveMessage` handler for `nodeClick` and `openExternal` |

---

## Tests First

```
// Raycasting
// Test: Raycaster correctly maps instance index to node id in InstancedMesh
// Test: mapInstanceToNodeId returns undefined when instanceIndex is out of bounds

// Project node click
// Test: Project node click with valid localPath calls vscode.openFolder with that path
// Test: Project node click when localPath absent falls back to vscode.env.openExternal with GitHub URL
// Test: Project node click when localPath not found on disk falls back to vscode.env.openExternal

// Tool/skill node click
// Test: Tool/skill node click sends filterToConnected(nodeId) postMessage to webview

// GitHub button
// Test: GitHub button click calls vscode.env.openExternal with GitHub URL derived from node id

// Tooltip
// Test: Hover tooltip is positioned at the screen-space projection of the node's 3D position
// Test: Tooltip shows: label, type, connection count, stage (if present), last_seen
```

Test files:
- `src/__tests__/nodeActions.test.ts` — extension host side (vscode mock)
- `webview/__tests__/nodeActions.test.ts` — webview side (jsdom)

---

## Implementation: Webview Side (`webview/main.ts`)

### Instance-Index to Node-ID Mapping

```typescript
function mapInstanceToNodeId(
  mesh: THREE.InstancedMesh,
  instanceIndex: number,
  instanceMap: Map<number, string>  // instanceIndex → nodeId, per mesh
): string | undefined
```

The `instanceMap` for each mesh type is built during `graph:snapshot` processing and stored in `main.ts` module scope.

### Click Raycasting

On `canvas` `'click'` event:

1. Set up `THREE.Raycaster` against all three node `InstancedMesh` objects (project, tool, skill).
2. Disambiguate from orbit: if pointer moved >5px between `pointerdown` and `pointerup`, skip.
3. On hit: extract `instanceIndex`, look up `nodeId` via `mapInstanceToNodeId`.
4. Post to extension host: `vscode.postMessage({ type: 'nodeClick', nodeId, nodeType })`

Only the closest hit is acted on.

### Hover Raycasting

On `'pointermove'` (throttled to ~60fps via timestamp delta):

1. Run raycaster against all three node meshes.
2. On hit: project the node's 3D position to screen space, call `showTooltip(node, screenX, screenY)`.
3. On miss: call `hideTooltip()`.

### Screen-Space Projection

```typescript
function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement
): { x: number; y: number }
// Clone vector → .project(camera) → map NDC [-1,1] to canvas pixel space
```

### Tooltip HTML Element

One `<div>` created in `main.ts` or `hud.ts`, absolutely positioned, `display: none` by default, `pointer-events: none`. `showTooltip` populates innerHTML and positions via CSS `left`/`top`.

Tooltip content:
- **Label**: `node.label` (or strip prefix from `node.id`)
- **Type**: `node.type`
- **Connection count**: edges with this node as `source` or `target`
- **Stage**: shown only if `node.stage` is present
- **Last seen**: formatted as relative time (e.g., "3 days ago"), omitted if absent
- **GitHub button**: `pointer-events: auto`; sends `openExternal` message to extension host

Clamp tooltip position to keep it within canvas bounds.

### Message Format — Webview to Extension Host

```typescript
{ type: 'nodeClick', nodeId: string, nodeType: 'project' | 'tool' | 'skill' }
{ type: 'openExternal', url: string }
```

---

## Implementation: Extension Host Side (`src/extension.ts`)

### webview.onDidReceiveMessage Handler

Register during panel creation. Dispatch on `message.type`:

**`nodeClick` — project node:**
1. Look up `GraphNode` in `nodeRegistry: Map<nodeId, GraphNode>` (built from last snapshot).
2. If `node.localPath` is set: `fs.existsSync(node.localPath)`.
3. If path exists: `vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.localPath), { forceNewWindow: false })`.
4. If path absent or not found: strip `project:` prefix, prepend `https://`, call `vscode.env.openExternal(vscode.Uri.parse(url))`.

**`nodeClick` — tool/skill node:**
```typescript
panel.webview.postMessage({ type: 'filterToConnected', nodeId: message.nodeId });
```

**`openExternal`:**
```typescript
vscode.env.openExternal(vscode.Uri.parse(message.url));
```

### Node Registry Maintenance

In snapshot handling code (section-05-extension-host), add:
```typescript
nodeRegistry = new Map(snapshot.nodes.map((n: GraphNode) => [n.id, n]));
```

If `nodeRegistry` is empty at click time, log a warning and return without action.

### GitHub URL Derivation

```typescript
function deriveGitHubUrl(nodeId: string): string {
  const stripped = nodeId.replace(/^(project|tool|skill):/, '');
  return stripped.startsWith('http') ? stripped : `https://${stripped}`;
}
```

---

## Edge Cases

- **Click before first snapshot**: Node registry is empty — log warning, no action.
- **No `localPath` and no parseable URL**: Show VS Code information message: "Cannot open node — no local path or GitHub URL available."
- **Multiple mesh hits**: Use only the first intersection (lowest `distance`).
- **Tooltip off-screen**: Clamp X and Y to keep tooltip within canvas bounds using `Math.min(screenX, canvasWidth - tooltipWidth - 8)`.
