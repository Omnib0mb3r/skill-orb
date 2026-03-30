diff --git a/03-web-app/src/main.ts b/03-web-app/src/main.ts
index 247a4d5..4c1984a 100644
--- a/03-web-app/src/main.ts
+++ b/03-web-app/src/main.ts
@@ -6,8 +6,15 @@ import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
 import { createCameraController } from '../webview/camera';
 import { createHud, setConnectionStatus, setCameraMode } from '../webview/hud';
 import { evaluateQuery } from '../webview/search';
+import {
+  createTooltip,
+  buildInstanceMaps,
+  buildNodeDataMap,
+  registerNodeInteractions,
+} from '../webview/nodeActions';
 import type { WsMessage, GraphNode, GraphEdge } from './types';
 import type { SearchResult } from '../webview/search';
+import type { InstanceMaps } from '../webview/nodeActions';
 
 const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
 const { scene, camera, controls, startAnimationLoop } = createScene(canvas);
@@ -24,6 +31,11 @@ const cameraController = createCameraController(camera, controls, getNodePositio
 // HUD — created before wiring controls events so listeners can reference hudElements
 let lastNodes: GraphNode[] = [];
 let lastEdges: GraphEdge[] = [];
+let lastNodeData: Map<string, GraphNode> = new Map();
+let lastInstanceMaps: InstanceMaps = { project: new Map(), tool: new Map(), skill: new Map() };
+
+const tooltip = createTooltip();
+document.body.appendChild(tooltip.getElement());
 
 function applySearchVisuals(result: SearchResult): void {
   if (result.matchingNodeIds.size === 0) {
@@ -69,6 +81,18 @@ const hudElements = createHud({
   },
 });
 
+// Node interactions
+registerNodeInteractions({
+  canvas,
+  camera,
+  meshes,
+  cameraController,
+  tooltip,
+  getNodeData: () => lastNodeData,
+  getEdgeData: () => lastEdges,
+  getInstanceMaps: () => lastInstanceMaps,
+});
+
 // Wire controls after HUD exists so the listener can reference hudElements
 controls.addEventListener('start', () => {
   cameraController.onUserInteraction();
@@ -98,6 +122,8 @@ function connect(): void {
       if (msg.type === 'graph:snapshot') {
         lastNodes = msg.payload.nodes;
         lastEdges = msg.payload.edges;
+        lastNodeData = buildNodeDataMap(lastNodes);
+        lastInstanceMaps = buildInstanceMaps(nodeIndexMap, meshes);
         updateGraph(msg.payload);
         onSnapshot(msg.payload.edges.map(e => ({
           id: e.id,
diff --git a/03-web-app/webview/__tests__/nodeActions.test.ts b/03-web-app/webview/__tests__/nodeActions.test.ts
new file mode 100644
index 0000000..d4dea1e
--- /dev/null
+++ b/03-web-app/webview/__tests__/nodeActions.test.ts
@@ -0,0 +1,166 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import * as THREE from 'three';
+import {
+  mapInstanceToNodeId,
+  deriveGitHubUrl,
+  projectToScreen,
+  createTooltip,
+  handleNodeClick,
+} from '../nodeActions';
+import type { GraphNode, GraphEdge } from '../../src/types';
+
+function makeNode(partial: Partial<GraphNode> & { id: string; type: GraphNode['type'] }): GraphNode {
+  return { label: partial.id, ...partial };
+}
+
+function makeEdge(partial: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
+  return {
+    connection_type: 'project->tool',
+    weight: 1,
+    raw_count: 1,
+    first_seen: '',
+    last_seen: '',
+    ...partial,
+  };
+}
+
+beforeEach(() => {
+  document.body.innerHTML = '';
+});
+
+afterEach(() => {
+  vi.restoreAllMocks();
+});
+
+// ── mapInstanceToNodeId ───────────────────────────────────────────────────────
+
+describe('mapInstanceToNodeId', () => {
+  it('returns correct nodeId for a known instanceIndex', () => {
+    const mesh = {} as THREE.InstancedMesh;
+    const instanceMap = new Map([[0, 'node-1'], [1, 'node-2']]);
+    expect(mapInstanceToNodeId(mesh, 0, instanceMap)).toBe('node-1');
+    expect(mapInstanceToNodeId(mesh, 1, instanceMap)).toBe('node-2');
+  });
+
+  it('returns undefined when instanceIndex is out of bounds', () => {
+    const mesh = {} as THREE.InstancedMesh;
+    const instanceMap = new Map([[0, 'node-1']]);
+    expect(mapInstanceToNodeId(mesh, 99, instanceMap)).toBeUndefined();
+  });
+});
+
+// ── deriveGitHubUrl ───────────────────────────────────────────────────────────
+
+describe('deriveGitHubUrl', () => {
+  it('strips project: prefix and prepends https:// for github.com ids', () => {
+    expect(deriveGitHubUrl('project:github.com/foo/bar')).toBe('https://github.com/foo/bar');
+  });
+
+  it('returns null for local-only ids', () => {
+    expect(deriveGitHubUrl('project:local-only')).toBeNull();
+  });
+
+  it('passes through ids that already start with http', () => {
+    expect(deriveGitHubUrl('project:https://example.com/repo')).toBe('https://example.com/repo');
+  });
+});
+
+// ── handleNodeClick ───────────────────────────────────────────────────────────
+
+describe('handleNodeClick — project node with GitHub URL', () => {
+  it('calls window.open with the derived GitHub URL', () => {
+    const openUrl = vi.fn();
+    const tooltip = createTooltip();
+    const cameraController = { onActiveProjectsChanged: vi.fn() };
+    const node = makeNode({ id: 'project:github.com/foo/bar', type: 'project', label: 'FooBar' });
+
+    handleNodeClick(node.id, node, [], { x: 0, y: 0 }, [], cameraController, tooltip, openUrl);
+
+    expect(openUrl).toHaveBeenCalledWith('https://github.com/foo/bar', '_blank');
+  });
+});
+
+describe('handleNodeClick — project node with no parseable URL', () => {
+  it('shows info in tooltip and does not call window.open', () => {
+    const openUrl = vi.fn();
+    const tooltip = createTooltip();
+    document.body.appendChild(tooltip.getElement());
+    const node = makeNode({ id: 'project:local-only', type: 'project', label: 'LocalProject' });
+
+    handleNodeClick(node.id, node, [], { x: 100, y: 50 }, [], { onActiveProjectsChanged: vi.fn() }, tooltip, openUrl);
+
+    expect(openUrl).not.toHaveBeenCalled();
+    expect(tooltip.getElement().style.display).not.toBe('none');
+  });
+});
+
+describe('handleNodeClick — tool/skill node', () => {
+  it('triggers focusOnConnected(nodeId) on camera controller', () => {
+    const onActiveProjectsChanged = vi.fn();
+    const tooltip = createTooltip();
+    const node = makeNode({ id: 'tool:playwright', type: 'tool', label: 'playwright' });
+    const connectedProjectIds = ['p1', 'p2'];
+
+    handleNodeClick(node.id, node, connectedProjectIds, { x: 0, y: 0 }, [], { onActiveProjectsChanged }, tooltip, vi.fn());
+
+    expect(onActiveProjectsChanged).toHaveBeenCalledWith(connectedProjectIds);
+  });
+});
+
+// ── projectToScreen ───────────────────────────────────────────────────────────
+
+describe('projectToScreen', () => {
+  it('Hover tooltip is positioned at screen-space projection of node 3D position', () => {
+    // Mock Vector3.project to return NDC (0,0) = canvas center
+    vi.spyOn(THREE.Vector3.prototype, 'project').mockImplementation(function (this: THREE.Vector3) {
+      this.set(0, 0, 0);
+      return this;
+    });
+
+    const worldPos = new THREE.Vector3(100, 50, 30);
+    const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
+    const mockCamera = {} as THREE.Camera;
+
+    const result = projectToScreen(worldPos, mockCamera, canvas);
+
+    // NDC (0,0) → screen center (400, 300) for 800×600 canvas
+    expect(result.x).toBeCloseTo(400);
+    expect(result.y).toBeCloseTo(300);
+  });
+});
+
+// ── tooltip ───────────────────────────────────────────────────────────────────
+
+describe('tooltip content', () => {
+  it('shows label, type, connection count, and stage if present', () => {
+    const tooltip = createTooltip();
+    document.body.appendChild(tooltip.getElement());
+    const node = makeNode({ id: 'p1', type: 'project', label: 'MyProject', stage: 'beta' });
+    const edges = [
+      makeEdge({ id: 'e1', source: 'p1', target: 't1' }),
+      makeEdge({ id: 'e2', source: 's1', target: 'p1' }),
+    ];
+
+    tooltip.show(node, edges, 100, 100);
+    const html = tooltip.getElement().innerHTML;
+
+    expect(html).toContain('MyProject');
+    expect(html).toContain('project');
+    expect(html).toContain('2'); // 2 edges involving p1
+    expect(html).toContain('beta');
+  });
+});
+
+describe('tooltip hide', () => {
+  it('is hidden on mouse-out', () => {
+    const tooltip = createTooltip();
+    document.body.appendChild(tooltip.getElement());
+    const node = makeNode({ id: 'p1', type: 'project', label: 'Test' });
+
+    tooltip.show(node, [], 100, 100);
+    expect(tooltip.getElement().style.display).not.toBe('none');
+
+    tooltip.hide();
+    expect(tooltip.getElement().style.display).toBe('none');
+  });
+});
diff --git a/03-web-app/webview/nodeActions.ts b/03-web-app/webview/nodeActions.ts
new file mode 100644
index 0000000..fd122fa
--- /dev/null
+++ b/03-web-app/webview/nodeActions.ts
@@ -0,0 +1,304 @@
+import * as THREE from 'three';
+import type { GraphNode, GraphEdge } from '../src/types';
+import type { CameraController } from './camera';
+import type { NodeRenderData } from './nodes';
+
+export interface TooltipController {
+  show(node: GraphNode, edges: GraphEdge[], x: number, y: number): void;
+  hide(): void;
+  getElement(): HTMLElement;
+}
+
+// ── Pure helper functions ─────────────────────────────────────────────────────
+
+/**
+ * Returns the nodeId associated with a given instanceIndex in an InstancedMesh,
+ * or undefined if out of range.
+ */
+export function mapInstanceToNodeId(
+  _mesh: THREE.InstancedMesh,
+  instanceIndex: number,
+  instanceMap: Map<number, string>,
+): string | undefined {
+  return instanceMap.get(instanceIndex);
+}
+
+/**
+ * Derives a navigable GitHub URL from a node ID, or null if not applicable.
+ */
+export function deriveGitHubUrl(nodeId: string): string | null {
+  const stripped = nodeId.replace(/^(project|tool|skill):/, '');
+  if (stripped.startsWith('http')) return stripped;
+  if (stripped.startsWith('github.com')) return `https://${stripped}`;
+  return null;
+}
+
+/**
+ * Projects a 3D world position to canvas pixel coordinates.
+ */
+export function projectToScreen(
+  worldPos: THREE.Vector3,
+  camera: THREE.Camera,
+  canvas: HTMLCanvasElement,
+): { x: number; y: number } {
+  const ndc = worldPos.clone().project(camera);
+  return {
+    x: (ndc.x + 1) / 2 * canvas.clientWidth,
+    y: (-ndc.y + 1) / 2 * canvas.clientHeight,
+  };
+}
+
+// ── Tooltip ───────────────────────────────────────────────────────────────────
+
+export function createTooltip(): TooltipController {
+  const el = document.createElement('div');
+  el.className = 'dn-tooltip';
+  Object.assign(el.style, {
+    position: 'absolute',
+    display: 'none',
+    pointerEvents: 'none',
+    background: 'rgba(10,10,20,0.92)',
+    border: '1px solid #333',
+    borderRadius: '6px',
+    color: '#e0e0e0',
+    fontFamily: 'monospace',
+    fontSize: '12px',
+    padding: '8px 12px',
+    lineHeight: '1.6',
+    maxWidth: '260px',
+    zIndex: '100',
+  });
+
+  return {
+    show(node: GraphNode, edges: GraphEdge[], x: number, y: number): void {
+      const connectionCount = edges.filter(e => e.source === node.id || e.target === node.id).length;
+      const url = deriveGitHubUrl(node.id);
+
+      const lines: string[] = [
+        `<strong>${node.label}</strong>`,
+        `<span style="color:#888">type:</span> ${node.type}`,
+        `<span style="color:#888">connections:</span> ${connectionCount}`,
+      ];
+      if (node.stage) {
+        lines.push(`<span style="color:#888">stage:</span> ${node.stage}`);
+      }
+      if (url) {
+        lines.push(`<a href="${url}" target="_blank" style="color:#5af;pointer-events:auto">open ↗</a>`);
+      }
+
+      el.innerHTML = lines.join('<br>');
+      el.style.left = `${Math.round(x)}px`;
+      el.style.top = `${Math.round(y)}px`;
+      el.style.display = 'block';
+    },
+
+    hide(): void {
+      el.style.display = 'none';
+    },
+
+    getElement(): HTMLElement {
+      return el;
+    },
+  };
+}
+
+// ── Click handler ─────────────────────────────────────────────────────────────
+
+/**
+ * Handles a resolved node click — dispatches based on node type.
+ * Injectable openUrl allows testing without real window.open.
+ */
+export function handleNodeClick(
+  nodeId: string,
+  node: GraphNode,
+  connectedProjectIds: string[],
+  screenPos: { x: number; y: number },
+  edges: GraphEdge[],
+  cameraController: Pick<CameraController, 'onActiveProjectsChanged'>,
+  tooltip: TooltipController,
+  openUrl: (url: string, target: string) => void,
+): void {
+  if (node.type === 'project') {
+    const url = deriveGitHubUrl(nodeId);
+    if (url) {
+      openUrl(url, '_blank');
+    } else {
+      tooltip.show(node, edges, screenPos.x, screenPos.y);
+    }
+  } else {
+    // tool or skill: focus camera on connected project nodes
+    cameraController.onActiveProjectsChanged(connectedProjectIds);
+  }
+}
+
+// ── Instance maps (per-mesh index → nodeId) ───────────────────────────────────
+
+export interface InstanceMaps {
+  project: Map<number, string>;
+  tool: Map<number, string>;
+  skill: Map<number, string>;
+}
+
+/**
+ * Inverts nodeIndexMap (nodeId → {mesh, index}) into per-mesh maps (index → nodeId).
+ * Call after each snapshot when nodeIndexMap is updated.
+ */
+export function buildInstanceMaps(
+  nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }>,
+  meshes: { projectMesh: THREE.InstancedMesh; toolMesh: THREE.InstancedMesh; skillMesh: THREE.InstancedMesh },
+): InstanceMaps {
+  const maps: InstanceMaps = { project: new Map(), tool: new Map(), skill: new Map() };
+  for (const [nodeId, { mesh, index }] of nodeIndexMap) {
+    if (mesh === meshes.projectMesh) maps.project.set(index, nodeId);
+    else if (mesh === meshes.toolMesh) maps.tool.set(index, nodeId);
+    else maps.skill.set(index, nodeId);
+  }
+  return maps;
+}
+
+// ── Event registration ────────────────────────────────────────────────────────
+
+interface RegisterDeps {
+  canvas: HTMLCanvasElement;
+  camera: THREE.Camera;
+  meshes: { projectMesh: THREE.InstancedMesh; toolMesh: THREE.InstancedMesh; skillMesh: THREE.InstancedMesh };
+  cameraController: CameraController;
+  tooltip: TooltipController;
+  getNodeData: () => Map<string, GraphNode>;
+  getEdgeData: () => GraphEdge[];
+  getInstanceMaps: () => InstanceMaps;
+}
+
+/**
+ * Wires canvas pointer events for click and hover node interactions.
+ * Not tested directly — tested through the pure helpers above.
+ */
+export function registerNodeInteractions(deps: RegisterDeps): void {
+  const { canvas, camera, meshes, cameraController, tooltip } = deps;
+  const raycaster = new THREE.Raycaster();
+  const pointer = new THREE.Vector2();
+
+  let pointerDownPos = { x: 0, y: 0 };
+
+  function getMeshList(): THREE.InstancedMesh[] {
+    return [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh];
+  }
+
+  function pointerToNDC(e: PointerEvent): void {
+    const rect = canvas.getBoundingClientRect();
+    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
+    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
+  }
+
+  function resolveHit(e: PointerEvent): { nodeId: string; node: GraphNode } | null {
+    pointerToNDC(e);
+    raycaster.setFromCamera(pointer, camera);
+    const hits = raycaster.intersectObjects(getMeshList(), false);
+    if (hits.length === 0 || hits[0].instanceId === undefined) return null;
+
+    const hit = hits[0];
+    const mesh = hit.object as THREE.InstancedMesh;
+    const maps = deps.getInstanceMaps();
+    const mapForMesh =
+      mesh === meshes.projectMesh ? maps.project :
+      mesh === meshes.toolMesh    ? maps.tool    :
+      maps.skill;
+
+    const nodeId = mapInstanceToNodeId(mesh, hit.instanceId, mapForMesh);
+    if (!nodeId) return null;
+    const node = deps.getNodeData().get(nodeId);
+    if (!node) return null;
+    return { nodeId, node };
+  }
+
+  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
+    pointerDownPos = { x: e.clientX, y: e.clientY };
+  });
+
+  canvas.addEventListener('pointerup', (e: PointerEvent) => {
+    // Skip if pointer dragged > 5px (orbit gesture)
+    const dx = e.clientX - pointerDownPos.x;
+    const dy = e.clientY - pointerDownPos.y;
+    if (Math.sqrt(dx * dx + dy * dy) > 5) return;
+
+    const hit = resolveHit(e);
+    if (!hit) return;
+
+    const edges = deps.getEdgeData();
+    const connectedProjectIds = edges
+      .filter(edge => edge.source === hit.nodeId || edge.target === hit.nodeId)
+      .flatMap(edge => {
+        const nodeData = deps.getNodeData();
+        const other = edge.source === hit.nodeId ? edge.target : edge.source;
+        const otherNode = nodeData.get(other);
+        return otherNode?.type === 'project' ? [other] : [];
+      });
+
+    const rect = canvas.getBoundingClientRect();
+    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
+
+    handleNodeClick(
+      hit.nodeId,
+      hit.node,
+      connectedProjectIds,
+      screenPos,
+      edges,
+      cameraController,
+      tooltip,
+      (url, target) => window.open(url, target),
+    );
+  });
+
+  let lastMoveTime = 0;
+  canvas.addEventListener('pointermove', (e: PointerEvent) => {
+    const now = performance.now();
+    if (now - lastMoveTime < 16) return; // ~60fps throttle
+    lastMoveTime = now;
+
+    const hit = resolveHit(e);
+    if (!hit) {
+      tooltip.hide();
+      return;
+    }
+
+    const nodePos = new THREE.Vector3();
+    // Get instance world position from matrix
+    const maps = deps.getInstanceMaps();
+    const mapForMesh =
+      hit.node.type === 'project' ? maps.project :
+      hit.node.type === 'tool'    ? maps.tool    :
+      maps.skill;
+    const mesh =
+      hit.node.type === 'project' ? meshes.projectMesh :
+      hit.node.type === 'tool'    ? meshes.toolMesh    :
+      meshes.skillMesh;
+    const idx = [...mapForMesh.entries()].find(([, id]) => id === hit.nodeId)?.[0];
+    if (idx !== undefined) {
+      const mat = new THREE.Matrix4();
+      mesh.getMatrixAt(idx, mat);
+      nodePos.setFromMatrixPosition(mat);
+    }
+
+    const rect = canvas.getBoundingClientRect();
+    const screen = projectToScreen(nodePos, camera, { clientWidth: rect.width, clientHeight: rect.height } as HTMLCanvasElement);
+
+    // Clamp to canvas bounds
+    const clampedX = Math.max(0, Math.min(rect.width - 10, screen.x));
+    const clampedY = Math.max(0, Math.min(rect.height - 10, screen.y));
+
+    tooltip.show(hit.node, deps.getEdgeData(), clampedX, clampedY);
+  });
+
+  canvas.addEventListener('pointerleave', () => {
+    tooltip.hide();
+  });
+}
+
+// ── Utility: build NodeRenderData map for snapshot ────────────────────────────
+
+export function buildNodeDataMap(nodes: GraphNode[]): Map<string, GraphNode> {
+  return new Map(nodes.map(n => [n.id, n]));
+}
+
+// Re-export NodeRenderData type for use in main.ts
+export type { NodeRenderData };
