# Code Review Interview: section-04-node-actions

## Auto-fixes Applied

1. **main.ts — Move buildInstanceMaps/buildNodeDataMap after updateGraph (critical ordering)**
   `nodeIndexMap` is populated inside `updateGraph → setNodePositions`. Moving the map builds to after the `updateGraph` call ensures they read populated data on the first snapshot.

2. **nodeActions.ts — createTooltip: replace innerHTML with DOM construction (XSS)**
   All tooltip content is now built with `textContent` per element and typed DOM nodes. No dynamic HTML string injection from WebSocket data. The `<a>` href is still set via attribute but `deriveGitHubUrl` is restricted to `https://` and `http://` prefixes only.

3. **nodeActions.ts — handleNodeClick: add optional applyVisuals callback**
   Tool/skill click now calls `applyVisuals?.(connectedProjectIds)` after focusing the camera. In main.ts, this is wired to `applySearchVisuals` with a synthetic SearchResult that highlights the connected project nodes.

4. **nodeActions.ts — registerNodeInteractions: eliminate O(n) reverse-map scan**
   `resolveHit` now returns `{ instanceId, hitMesh }` alongside `{ nodeId, node }`. The pointermove handler uses `hit.hitMesh.getMatrixAt(hit.instanceId, mat)` — O(1) — instead of spreading and scanning the instance map.

5. **nodeActions.ts — tooltip clamp: use tooltipEl.offsetWidth/offsetHeight**
   Changed from fixed 10px margin to `tooltipEl.offsetWidth || 270` and `tooltipEl.offsetHeight || 80`. Falls back to conservative constants in jsdom where offsetWidth returns 0.

6. **nodeActions.ts — deriveGitHubUrl: restrict to https:// and http:// only**
   Changed `startsWith('http')` to `startsWith('https://') || startsWith('http://')` to prevent data: or javascript: URLs if a node ID somehow starts with those prefixes.

7. **nodeActions.ts — removed vestigial NodeRenderData re-export**

## No User Decisions Needed

All review items were unambiguous improvements with no tradeoffs. Applied automatically.
