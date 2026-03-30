commit bb3f776ca5aad9f30665050ae7dc9d8f989d9887
Author: Michael Collins <mcollins@onthelevelconcepts.com>
Date:   Mon Mar 30 09:57:40 2026 -0400

    Implement section 12: interaction, HUD, main wiring, and e2e test
    
    - src/orb/interaction.ts: hover/click handlers + getTopConnections
    - src/ui/hud.ts: idempotent HUD overlay with counts/label/query
    - src/main.ts: replace webview impl with new renderer+WS pipeline
    - tests/orb/interaction.test.ts: 13 tests covering hover/click/connections
    - tests/ui/hud.test.ts: 7 jsdom tests covering HUD controller
    - tests/e2e.test.ts: WIP — mock server + subprocess integration tests
    
    03-web-app: 162/162 tests pass, vite build succeeds
    e2e tests: debugging subprocess timeout in spawnSync context
    
    Plan: section-12-integration.md

diff --git a/03-web-app/src/main.ts b/03-web-app/src/main.ts
index b4f6b72..cc3108b 100644
--- a/03-web-app/src/main.ts
+++ b/03-web-app/src/main.ts
@@ -1,192 +1,194 @@
 import * as THREE from 'three';
-import { createScene } from '../webview/renderer';
-import { updateGraph, getGraphInstance, initOrb, updateRenderPositions, getNodePosition } from '../webview/orb';
-import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
-import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
-import { createCameraController } from '../webview/camera';
-import { createHud, setConnectionStatus, setCameraMode, updateVoiceButton } from '../webview/hud';
-import { evaluateQuery, detectVoiceIntent } from '../webview/search';
-import { initVoice } from '../webview/voice';
-import {
-  createTooltip,
-  buildInstanceMaps,
-  buildNodeDataMap,
-  registerNodeInteractions,
-} from '../webview/nodeActions';
-import type { WsMessage, GraphNode, GraphEdge } from './types';
-import type { SearchResult } from '../webview/search';
-import type { InstanceMaps } from '../webview/nodeActions';
-
-const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
-const { scene, camera, controls, startAnimationLoop } = createScene(canvas);
-
-const graphOrb = getGraphInstance();
-scene.add(graphOrb);
-
-const meshes = initOrb(scene);
-initAnimation(scene);
-
-// Camera controller
-const cameraController = createCameraController(camera, controls, getNodePosition);
-
-// HUD — created before wiring controls events so listeners can reference hudElements
-let lastNodes: GraphNode[] = [];
-let lastEdges: GraphEdge[] = [];
-let lastNodeData: Map<string, GraphNode> = new Map();
-let lastInstanceMaps: InstanceMaps = { project: new Map(), tool: new Map(), skill: new Map() };
-
-const tooltip = createTooltip();
-document.body.appendChild(tooltip.getElement());
-
-function applySearchVisuals(result: SearchResult): void {
-  if (result.matchingNodeIds.size === 0) {
-    resetNodeColors(meshes, nodeIndexMap);
-    return;
-  }
-  for (const [id] of nodeIndexMap) {
-    if (result.matchingNodeIds.has(id)) {
-      setNodeColor(id, new THREE.Color(0xffffff), meshes, nodeIndexMap);
-    } else {
-      // Dark blue-gray: visible but de-emphasized against near-black background
-      setNodeColor(id, new THREE.Color(0x3a3a4a), meshes, nodeIndexMap);
-    }
-  }
-  if (cameraController.state !== 'manual') {
-    const positions = [...result.matchingNodeIds]
-      .map(id => getNodePosition(id))
-      .filter((p): p is THREE.Vector3 => p !== null);
-    if (positions.length > 0) {
-      const centroid = positions
-        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
-        .divideScalar(positions.length);
-      const radius = Math.max(
-        ...positions.map(p => p.distanceTo(centroid)),
-        10,
-      );
-      cameraController.focusOnCluster(centroid, radius);
-    }
-  }
+import { initRenderer } from './orb/renderer';
+import { initHud } from './ui/hud';
+import { connect } from './ws/client';
+import { build } from './graph/builder';
+import type { BuildResult, GraphData } from './graph/builder';
+import type { SceneRef } from './ws/handlers';
+import type { GraphSnapshot } from './types';
+import { onHover, onClick } from './orb/interaction';
+import type { InteractionState } from './orb/interaction';
+import type { OrbNode } from './graph/types';
+import { getMaterialForNodeType, highlightMaterialConfig } from './orb/visuals';
+
+type AppState = BuildResult & { selectedNodeId: string | null };
+
+let currentBuild: AppState | null = null;
+
+function toGraphData(snapshot: GraphSnapshot): GraphData {
+  return {
+    nodes: snapshot.nodes.map(n => ({ id: n.id, label: n.label, type: n.type })),
+    edges: snapshot.edges.map(e => ({
+      sourceId: e.source,
+      targetId: e.target,
+      weight: e.weight,
+    })),
+  };
 }
 
-const hudElements = createHud({
-  onReturnToAuto: () => {
-    cameraController.returnToAuto();
-    setCameraMode(hudElements, cameraController.state);
-  },
-  onSearchQuery: (q) => {
-    if (q.trim() === '') {
-      resetNodeColors(meshes, nodeIndexMap);
+function applyHighlightMaterials(build: AppState): void {
+  for (const [id, mesh] of build.meshes) {
+    const node = build.nodes.get(id);
+    if (!node) continue;
+    const mat = mesh.material as THREE.MeshStandardMaterial;
+    if (build.highlightedNodeIds.has(id)) {
+      mat.color.setHex(highlightMaterialConfig.color);
+      mat.opacity = highlightMaterialConfig.opacity;
+      mat.emissiveIntensity = highlightMaterialConfig.emissiveIntensity ?? 0.6;
     } else {
-      applySearchVisuals(evaluateQuery(q, lastNodes, lastEdges));
-    }
-  },
-});
-
-// Voice search
-const voiceController = initVoice({
-  onTranscript: (text) => {
-    const intent = detectVoiceIntent(text);
-    if (intent.action === 'search' && intent.query) {
-      hudElements.searchInput.value = intent.query;
-      applySearchVisuals(evaluateQuery(intent.query, lastNodes, lastEdges));
-    } else if (intent.action === 'returnToAuto') {
-      cameraController.returnToAuto();
-      setCameraMode(hudElements, cameraController.state);
-    } else if (intent.action === 'focus' && intent.target) {
-      hudElements.searchInput.value = intent.target;
-      applySearchVisuals(evaluateQuery(intent.target, lastNodes, lastEdges));
+      const cfg = getMaterialForNodeType(node.type);
+      mat.color.setHex(cfg.color);
+      mat.opacity = cfg.opacity;
+      mat.emissiveIntensity = cfg.emissiveIntensity ?? 0.1;
     }
-  },
-  onStatusChange: (status) => updateVoiceButton(hudElements.voiceButton, status),
-});
+  }
+}
 
-if (voiceController === null) {
-  updateVoiceButton(hudElements.voiceButton, 'unavailable');
+function clearBuild(scene: THREE.Scene, b: AppState): void {
+  for (const mesh of b.meshes.values()) {
+    scene.remove(mesh);
+    mesh.geometry.dispose();
+    const mat = mesh.material;
+    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
+    else mat.dispose();
+  }
+  for (const line of b.edgeMeshes) {
+    scene.remove(line);
+    line.geometry.dispose();
+    const mat = line.material;
+    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
+    else mat.dispose();
+  }
 }
 
-hudElements.voiceButton.addEventListener('click', () => {
-  if (voiceController?.status === 'listening') voiceController.stopListening();
-  else voiceController?.startListening();
-});
-
-// Node interactions
-registerNodeInteractions({
-  canvas,
-  camera,
-  meshes,
-  cameraController,
-  tooltip,
-  getNodeData: () => lastNodeData,
-  getEdgeData: () => lastEdges,
-  getInstanceMaps: () => lastInstanceMaps,
-  applyVisuals: (connectedIds) => {
-    const result: SearchResult = {
-      matchingNodeIds: new Set(connectedIds),
-      matchingEdgeIds: new Set(
-        lastEdges
-          .filter(e => connectedIds.includes(e.source) || connectedIds.includes(e.target))
-          .map(e => e.id),
-      ),
-    };
-    applySearchVisuals(result);
-  },
-});
-
-// Wire controls after HUD exists so the listener can reference hudElements
-controls.addEventListener('start', () => {
-  cameraController.onUserInteraction();
-  setCameraMode(hudElements, cameraController.state);
-});
-
-startAnimationLoop((delta: number) => {
-  graphOrb.tickFrame();
-  updateRenderPositions();
-  tickBreathing(delta * 1000);
-  cameraController.tick(delta * 1000);
-});
-
-// Browser WebSocket — connects to the DevNeural Python server
-const WS_URL = 'ws://localhost:27182';
-
-function connect(): void {
-  const ws = new WebSocket(WS_URL);
-
-  ws.onopen = () => {
-    setConnectionStatus(hudElements, 'connected');
+function main(): void {
+  const existingCanvas = document.getElementById('devneural-canvas') as HTMLCanvasElement | null;
+  const canvas: HTMLCanvasElement = existingCanvas ?? (() => {
+    const c = document.createElement('canvas');
+    document.body.appendChild(c);
+    return c;
+  })();
+
+  const { renderer, scene, camera } = initRenderer(canvas);
+
+  const sceneRef: SceneRef = {
+    clear() {
+      if (!currentBuild) return;
+      clearBuild(scene, currentBuild);
+      currentBuild = null;
+    },
+
+    rebuild(snapshot: GraphSnapshot) {
+      sceneRef.clear();
+      const result = build(toGraphData(snapshot), scene);
+      currentBuild = { ...result, selectedNodeId: null };
+    },
+
+    addEdge(edge) {
+      if (!currentBuild) return;
+      const srcMesh = currentBuild.meshes.get(edge.source);
+      const tgtMesh = currentBuild.meshes.get(edge.target);
+      if (!srcMesh || !tgtMesh) return;
+      const lineGeo = new THREE.BufferGeometry();
+      lineGeo.setFromPoints([srcMesh.position, tgtMesh.position]);
+      const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
+      const line = new THREE.Line(lineGeo, lineMat);
+      scene.add(line);
+      currentBuild.edgeMeshes.push(line);
+      currentBuild.edges.push({ sourceId: edge.source, targetId: edge.target, weight: 1.0 });
+    },
+
+    setFocusNode(nodeId: string) {
+      if (!currentBuild) return;
+      currentBuild.focusedNodeId = nodeId;
+      const mesh = currentBuild.meshes.get(nodeId);
+      if (mesh) {
+        const mat = mesh.material as THREE.MeshStandardMaterial;
+        mat.color.setHex(highlightMaterialConfig.color);
+        mat.opacity = highlightMaterialConfig.opacity;
+        mat.emissiveIntensity = highlightMaterialConfig.emissiveIntensity ?? 0.6;
+      }
+    },
+
+    setHighlightNodes(nodeIds: string[]) {
+      if (!currentBuild) return;
+      currentBuild.highlightedNodeIds = new Set(nodeIds);
+      applyHighlightMaterials(currentBuild);
+    },
+
+    clearHighlights() {
+      if (!currentBuild) return;
+      currentBuild.highlightedNodeIds.clear();
+      currentBuild.focusedNodeId = null;
+      applyHighlightMaterials(currentBuild);
+    },
+
+    resetCamera() {
+      camera.position.set(0, 0, 20);
+      camera.lookAt(0, 0, 0);
+    },
   };
 
-  ws.onmessage = (event: MessageEvent) => {
-    try {
-      const msg = JSON.parse(event.data as string) as WsMessage;
-      if (msg.type === 'graph:snapshot') {
-        lastNodes = msg.payload.nodes;
-        lastEdges = msg.payload.edges;
-        updateGraph(msg.payload);
-        // Build maps AFTER updateGraph so nodeIndexMap is populated by setNodePositions
-        lastNodeData = buildNodeDataMap(lastNodes);
-        lastInstanceMaps = buildInstanceMaps(nodeIndexMap, meshes);
-        onSnapshot(msg.payload.edges.map(e => ({
-          id: e.id,
-          last_seen: new Date(e.last_seen).getTime(),
-        })));
-        setCameraMode(hudElements, cameraController.state);
-      }
-      if (msg.type === 'connection:new') {
-        onConnectionNew({
-          source: msg.payload.source,
-          target: msg.payload.target,
-          connectionType: msg.payload.connection_type,
-        });
+  // Raycaster for pointer events
+  const raycaster = new THREE.Raycaster();
+  const pointer = new THREE.Vector2();
+
+  function getMeshNode(clientX: number, clientY: number): OrbNode | null {
+    if (!currentBuild) return null;
+    pointer.x = (clientX / window.innerWidth) * 2 - 1;
+    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
+    raycaster.setFromCamera(pointer, camera);
+    const meshList = [...currentBuild.meshes.values()];
+    const hits = raycaster.intersectObjects(meshList);
+    if (hits.length === 0) return null;
+    const hitMesh = hits[0].object as THREE.Mesh;
+    for (const [id, mesh] of currentBuild.meshes) {
+      if (mesh === hitMesh) return currentBuild.nodes.get(id) ?? null;
+    }
+    return null;
+  }
+
+  canvas.addEventListener('pointermove', (e: PointerEvent) => {
+    const istate = currentBuild as InteractionState | null;
+    if (istate) onHover(getMeshNode(e.clientX, e.clientY), istate);
+  });
+
+  canvas.addEventListener('click', (e: MouseEvent) => {
+    const istate = currentBuild as InteractionState | null;
+    if (istate) onClick(getMeshNode(e.clientX, e.clientY), istate, camera);
+  });
+
+  initHud();
+
+  let sceneReady = false;
+
+  function animate(): void {
+    requestAnimationFrame(animate);
+    if (currentBuild) {
+      currentBuild.simulation.tick();
+      for (let i = 0; i < currentBuild.edgeMeshes.length; i++) {
+        const line = currentBuild.edgeMeshes[i];
+        const edge = currentBuild.edges[i];
+        if (!edge) continue;
+        const srcMesh = currentBuild.meshes.get(edge.sourceId);
+        const tgtMesh = currentBuild.meshes.get(edge.targetId);
+        if (!srcMesh || !tgtMesh) continue;
+        const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
+        if (posAttr) {
+          posAttr.setXYZ(0, srcMesh.position.x, srcMesh.position.y, srcMesh.position.z);
+          posAttr.setXYZ(1, tgtMesh.position.x, tgtMesh.position.y, tgtMesh.position.z);
+          posAttr.needsUpdate = true;
+        }
       }
-    } catch {
-      // ignore malformed messages
     }
-  };
+    renderer.render(scene, camera);
+  }
 
-  ws.onclose = () => {
-    setConnectionStatus(hudElements, 'disconnected');
-    setTimeout(connect, 2000);
-  };
+  animate();
+  sceneReady = true;
+
+  const ws = connect('ws://localhost:3747/ws', sceneRef, () => sceneReady);
+  ws.applyPendingSnapshot(sceneRef);
 }
 
-connect();
+main();
diff --git a/03-web-app/src/orb/interaction.ts b/03-web-app/src/orb/interaction.ts
new file mode 100644
index 0000000..d11add1
--- /dev/null
+++ b/03-web-app/src/orb/interaction.ts
@@ -0,0 +1,80 @@
+import * as THREE from 'three';
+import type { OrbNode, OrbEdge, SceneState } from '../graph/types';
+import { getMaterialForNodeType, highlightMaterialConfig } from './visuals';
+
+/** Extended SceneState with Three.js meshes and interaction selection state. */
+export interface InteractionState extends SceneState {
+  meshes: Map<string, THREE.Mesh>;
+  selectedNodeId: string | null;
+}
+
+/** Module-level tracker for the currently hovered node ID. */
+let _previousHoverNodeId: string | null = null;
+
+/** Reset hover state — exported for test cleanup. */
+export function resetHoverState(): void {
+  _previousHoverNodeId = null;
+}
+
+/**
+ * Update mesh material brightness on hover.
+ * Restores the previously hovered node's material before applying to the new target.
+ */
+export function onHover(node: OrbNode | null, state: InteractionState): void {
+  // Restore previous hover target
+  if (_previousHoverNodeId !== null) {
+    const prevMesh = state.meshes.get(_previousHoverNodeId);
+    const prevNode = state.nodes.get(_previousHoverNodeId);
+    if (prevMesh && prevNode) {
+      const mat = prevMesh.material as THREE.MeshStandardMaterial;
+      const config = state.highlightedNodeIds.has(_previousHoverNodeId)
+        ? highlightMaterialConfig
+        : getMaterialForNodeType(prevNode.type);
+      mat.opacity = config.opacity;
+      mat.emissiveIntensity = config.emissiveIntensity ?? 0.1;
+    }
+    _previousHoverNodeId = null;
+  }
+
+  if (node !== null) {
+    const mesh = state.meshes.get(node.id);
+    if (mesh) {
+      const mat = mesh.material as THREE.MeshStandardMaterial;
+      mat.opacity = 1.0;
+      mat.emissiveIntensity = 0.5;
+    }
+    _previousHoverNodeId = node.id;
+  }
+}
+
+/**
+ * Handle a click on a node or empty space.
+ * Updates selectedNodeId and points the camera toward the clicked node.
+ */
+export function onClick(
+  node: OrbNode | null,
+  state: InteractionState,
+  camera: THREE.Camera,
+): void {
+  if (node !== null) {
+    state.selectedNodeId = node.id;
+    camera.lookAt(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
+  } else {
+    state.selectedNodeId = null;
+  }
+}
+
+/**
+ * Pure function — returns the top `limit` edges connected to `node`,
+ * sorted by weight descending.
+ */
+export function getTopConnections(
+  node: OrbNode,
+  edges: OrbEdge[],
+  limit: number,
+): OrbEdge[] {
+  return edges
+    .filter(e => e.sourceId === node.id || e.targetId === node.id)
+    .sort((a, b) => b.weight - a.weight)
+    .slice(0, limit);
+}
diff --git a/03-web-app/src/ui/hud.ts b/03-web-app/src/ui/hud.ts
new file mode 100644
index 0000000..407fbff
--- /dev/null
+++ b/03-web-app/src/ui/hud.ts
@@ -0,0 +1,58 @@
+export interface HudController {
+  updateCounts(counts: { nodes: number; edges: number }): void;
+  updateProjectLabel(label: string | null): void;
+  updateLastVoiceQuery(query: string | null): void;
+}
+
+export function initHud(): HudController {
+  let container = document.getElementById('devneural-hud');
+
+  if (!container) {
+    container = document.createElement('div');
+    container.id = 'devneural-hud';
+    container.style.cssText = [
+      'position:fixed', 'top:12px', 'left:12px',
+      'background:rgba(0,0,0,0.6)', 'color:#fff',
+      'font-family:monospace', 'font-size:13px',
+      'padding:8px 12px', 'border-radius:4px',
+      'pointer-events:none', 'z-index:10',
+    ].join(';');
+
+    const counts = document.createElement('span');
+    counts.id = 'hud-counts';
+    counts.textContent = '0 nodes / 0 edges';
+    container.appendChild(counts);
+
+    container.appendChild(document.createElement('br'));
+
+    const label = document.createElement('span');
+    label.id = 'hud-label';
+    container.appendChild(label);
+
+    container.appendChild(document.createElement('br'));
+
+    const query = document.createElement('span');
+    query.id = 'hud-query';
+    query.style.display = 'none';
+    container.appendChild(query);
+
+    document.body.appendChild(container);
+  }
+
+  const countsEl = container.querySelector<HTMLSpanElement>('#hud-counts')!;
+  const labelEl = container.querySelector<HTMLSpanElement>('#hud-label')!;
+  const queryEl = container.querySelector<HTMLSpanElement>('#hud-query')!;
+
+  return {
+    updateCounts({ nodes, edges }) {
+      countsEl.textContent = `${nodes} nodes / ${edges} edges`;
+    },
+    updateProjectLabel(label) {
+      labelEl.textContent = label ?? '';
+    },
+    updateLastVoiceQuery(query) {
+      queryEl.textContent = query ?? '';
+      queryEl.style.display = query ? '' : 'none';
+    },
+  };
+}
diff --git a/03-web-app/tests/orb/interaction.test.ts b/03-web-app/tests/orb/interaction.test.ts
new file mode 100644
index 0000000..c3225a0
--- /dev/null
+++ b/03-web-app/tests/orb/interaction.test.ts
@@ -0,0 +1,223 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+
+vi.mock('three', () => ({
+  Vector3: vi.fn((x: number, y: number, z: number) => ({ x: x ?? 0, y: y ?? 0, z: z ?? 0 })),
+}));
+
+import { onHover, onClick, getTopConnections, resetHoverState } from '../../src/orb/interaction';
+import type { InteractionState } from '../../src/orb/interaction';
+import type { OrbNode, OrbEdge } from '../../src/graph/types';
+import * as THREE from 'three';
+
+function makeMesh(opacity = 0.9, emissiveIntensity = 0.1): THREE.Mesh {
+  return {
+    material: { opacity, emissiveIntensity },
+  } as unknown as THREE.Mesh;
+}
+
+function makeNode(id: string, type: OrbNode['type'] = 'skill'): OrbNode {
+  return {
+    id,
+    label: id,
+    type,
+    position: { x: 1, y: 2, z: 3 },
+    velocity: { x: 0, y: 0, z: 0 },
+  };
+}
+
+function makeState(nodeIds: string[]): InteractionState {
+  const nodes = new Map<string, OrbNode>();
+  const meshes = new Map<string, THREE.Mesh>();
+  for (const id of nodeIds) {
+    nodes.set(id, makeNode(id));
+    meshes.set(id, makeMesh());
+  }
+  return {
+    nodes,
+    meshes,
+    edges: [],
+    highlightedNodeIds: new Set(),
+    focusedNodeId: null,
+    simulationCooled: false,
+    selectedNodeId: null,
+  };
+}
+
+function makeEdge(src: string, dst: string, weight: number): OrbEdge {
+  return { sourceId: src, targetId: dst, weight };
+}
+
+describe('onHover', () => {
+  beforeEach(() => {
+    resetHoverState();
+    vi.clearAllMocks();
+  });
+
+  it('onHover(node) → mesh opacity increases to 1.0 (brighter than 0.9 default)', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };
+    expect(mat.opacity).toBe(0.9);
+
+    onHover(node, state);
+
+    expect(mat.opacity).toBe(1.0);
+  });
+
+  it('onHover(node) → emissiveIntensity increases above default 0.1', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };
+
+    onHover(node, state);
+
+    expect(mat.emissiveIntensity).toBeGreaterThan(0.1);
+  });
+
+  it('onHover(null) after hover → previous node opacity restored to default', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };
+
+    onHover(node, state);
+    expect(mat.opacity).toBe(1.0);
+
+    onHover(null, state);
+
+    expect(mat.opacity).toBe(0.9);
+  });
+
+  it('onHover(null) after hover → emissiveIntensity restored to default 0.1', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };
+
+    onHover(node, state);
+    onHover(null, state);
+
+    expect(mat.emissiveIntensity).toBe(0.1);
+  });
+
+  it('hovering a new node restores the previously hovered node', () => {
+    const state = makeState(['a', 'b']);
+    const nodeA = state.nodes.get('a')!;
+    const nodeB = state.nodes.get('b')!;
+    const matA = state.meshes.get('a')!.material as unknown as { opacity: number };
+
+    onHover(nodeA, state);
+    expect(matA.opacity).toBe(1.0);
+
+    onHover(nodeB, state); // hover b, should restore a
+    expect(matA.opacity).toBe(0.9);
+  });
+});
+
+describe('onClick', () => {
+  it('onClick(node) → selectedNodeId updated to node.id', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const camera = { lookAt: vi.fn() };
+
+    onClick(node, state, camera as unknown as THREE.Camera);
+
+    expect(state.selectedNodeId).toBe('a');
+  });
+
+  it('onClick(node) → camera.lookAt called once', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const camera = { lookAt: vi.fn() };
+
+    onClick(node, state, camera as unknown as THREE.Camera);
+
+    expect(camera.lookAt).toHaveBeenCalledTimes(1);
+  });
+
+  it('onClick(node) → camera.lookAt called with a Vector3 at node position', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const camera = { lookAt: vi.fn() };
+
+    onClick(node, state, camera as unknown as THREE.Camera);
+
+    expect(THREE.Vector3).toHaveBeenCalledWith(
+      node.position.x,
+      node.position.y,
+      node.position.z,
+    );
+  });
+
+  it('onClick(null) → selectedNodeId cleared to null', () => {
+    const state = makeState(['a']);
+    const node = state.nodes.get('a')!;
+    const camera = { lookAt: vi.fn() };
+
+    onClick(node, state, camera as unknown as THREE.Camera);
+    expect(state.selectedNodeId).toBe('a');
+
+    onClick(null, state, camera as unknown as THREE.Camera);
+    expect(state.selectedNodeId).toBeNull();
+  });
+});
+
+describe('getTopConnections', () => {
+  it('returns up to limit edges sorted by weight descending', () => {
+    const node = makeNode('a');
+    const edges: OrbEdge[] = [
+      makeEdge('a', 'b', 3),
+      makeEdge('a', 'c', 7),
+      makeEdge('a', 'd', 1),
+      makeEdge('a', 'e', 5),
+      makeEdge('a', 'f', 9),
+      makeEdge('a', 'g', 4),
+    ];
+
+    const result = getTopConnections(node, edges, 5);
+
+    expect(result).toHaveLength(5);
+    expect(result[0].weight).toBe(9);
+    expect(result[1].weight).toBe(7);
+    expect(result[2].weight).toBe(5);
+  });
+
+  it('with fewer than limit edges → returns all edges without padding', () => {
+    const node = makeNode('a');
+    const edges: OrbEdge[] = [
+      makeEdge('a', 'b', 3),
+      makeEdge('a', 'c', 7),
+    ];
+
+    const result = getTopConnections(node, edges, 5);
+
+    expect(result).toHaveLength(2);
+  });
+
+  it('only returns edges where node is an endpoint (sourceId or targetId)', () => {
+    const node = makeNode('a');
+    const edges: OrbEdge[] = [
+      makeEdge('a', 'b', 3),  // node is src
+      makeEdge('c', 'a', 5),  // node is dst
+      makeEdge('b', 'c', 7),  // node not involved
+    ];
+
+    const result = getTopConnections(node, edges, 5);
+
+    expect(result).toHaveLength(2);
+    expect(result.every(e => e.sourceId === 'a' || e.targetId === 'a')).toBe(true);
+  });
+
+  it('sorts by weight descending when node appears as both src and dst', () => {
+    const node = makeNode('x');
+    const edges: OrbEdge[] = [
+      makeEdge('x', 'a', 2),
+      makeEdge('b', 'x', 8),
+      makeEdge('x', 'c', 5),
+    ];
+
+    const result = getTopConnections(node, edges, 3);
+
+    expect(result[0].weight).toBe(8);
+    expect(result[1].weight).toBe(5);
+    expect(result[2].weight).toBe(2);
+  });
+});
diff --git a/03-web-app/tests/ui/hud.test.ts b/03-web-app/tests/ui/hud.test.ts
new file mode 100644
index 0000000..bf4cff5
--- /dev/null
+++ b/03-web-app/tests/ui/hud.test.ts
@@ -0,0 +1,64 @@
+// @vitest-environment jsdom
+import { describe, it, expect, beforeEach } from 'vitest';
+import { initHud } from '../../src/ui/hud';
+
+describe('initHud', () => {
+  beforeEach(() => {
+    document.body.innerHTML = '';
+  });
+
+  it('updateCounts({ nodes: 12, edges: 30 }) → element text reflects new values', () => {
+    const hud = initHud();
+    hud.updateCounts({ nodes: 12, edges: 30 });
+
+    expect(document.body.textContent).toContain('12');
+    expect(document.body.textContent).toContain('30');
+  });
+
+  it("updateProjectLabel('DevNeural') → element text contains 'DevNeural'", () => {
+    const hud = initHud();
+    hud.updateProjectLabel('DevNeural');
+
+    expect(document.body.textContent).toContain('DevNeural');
+  });
+
+  it("updateLastVoiceQuery → element text updated", () => {
+    const hud = initHud();
+    hud.updateLastVoiceQuery('what skills am I using?');
+
+    expect(document.body.textContent).toContain('what skills am I using?');
+  });
+
+  it('updateLastVoiceQuery(null) → last query element cleared', () => {
+    const hud = initHud();
+    hud.updateLastVoiceQuery('some query');
+    hud.updateLastVoiceQuery(null);
+
+    const queryEl = document.getElementById('hud-query') as HTMLElement;
+    expect(queryEl.textContent).toBe('');
+  });
+
+  it('initHud() returns an object with all three update methods', () => {
+    const hud = initHud();
+
+    expect(typeof hud.updateCounts).toBe('function');
+    expect(typeof hud.updateProjectLabel).toBe('function');
+    expect(typeof hud.updateLastVoiceQuery).toBe('function');
+  });
+
+  it('initHud() called twice → does not create duplicate DOM elements', () => {
+    initHud();
+    initHud();
+
+    const containers = document.querySelectorAll('#devneural-hud');
+    expect(containers).toHaveLength(1);
+  });
+
+  it('initHud() called twice → second call returns a working controller', () => {
+    initHud();
+    const hud2 = initHud();
+    hud2.updateProjectLabel('RepeatedInit');
+
+    expect(document.body.textContent).toContain('RepeatedInit');
+  });
+});
diff --git a/05-voice-interface/tests/e2e.test.ts b/05-voice-interface/tests/e2e.test.ts
new file mode 100644
index 0000000..8160288
--- /dev/null
+++ b/05-voice-interface/tests/e2e.test.ts
@@ -0,0 +1,213 @@
+import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
+import { spawnSync } from 'child_process';
+import http from 'http';
+import path from 'path';
+
+const ENTRY = path.resolve(__dirname, '../dist/index.js');
+let MOCK_PORT = 0;
+let DEVNEURAL_PORT = '';
+
+interface RecordedPost {
+  type: string;
+  payload: unknown;
+}
+
+let mockServer: http.Server;
+const recordedPosts: RecordedPost[] = [];
+
+const skillEdgesFixture = [
+  {
+    id: 'e1',
+    source: 'project:devneural',
+    target: 'skill:typescript',
+    weight: 8,
+    connection_type: 'uses',
+    raw_count: 8,
+    first_seen: '2024-01-01',
+    last_seen: '2024-03-01',
+  },
+  {
+    id: 'e2',
+    source: 'project:devneural',
+    target: 'skill:react',
+    weight: 5,
+    connection_type: 'uses',
+    raw_count: 5,
+    first_seen: '2024-01-01',
+    last_seen: '2024-03-01',
+  },
+];
+
+const graphFixture = {
+  nodes: [
+    { id: 'project:devneural', type: 'project', label: 'DevNeural' },
+    { id: 'skill:typescript', type: 'skill', label: 'TypeScript' },
+  ],
+  edges: skillEdgesFixture,
+};
+
+const subgraphFixture = {
+  nodes: [
+    { id: 'project:devneural', type: 'project', label: 'DevNeural' },
+    { id: 'skill:typescript', type: 'skill', label: 'TypeScript' },
+  ],
+  edges: [
+    {
+      id: 'e1',
+      source: 'project:devneural',
+      target: 'skill:typescript',
+      weight: 8,
+      connection_type: 'uses',
+      raw_count: 8,
+      first_seen: '2024-01-01',
+      last_seen: '2024-03-01',
+    },
+  ],
+};
+
+beforeAll(() => {
+  return new Promise<void>((resolve) => {
+    mockServer = http.createServer((req, res) => {
+      let body = '';
+      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
+      req.on('end', () => {
+        res.setHeader('Content-Type', 'application/json');
+        const url = req.url ?? '';
+
+        if (req.method === 'POST' && url === '/voice/command') {
+          try {
+            const parsed = JSON.parse(body) as RecordedPost;
+            recordedPosts.push(parsed);
+          } catch { /* ignore */ }
+          res.writeHead(200);
+          res.end('{}');
+          return;
+        }
+
+        if (req.method === 'GET' && url.startsWith('/graph/top')) {
+          res.writeHead(200);
+          res.end(JSON.stringify(skillEdgesFixture));
+          return;
+        }
+
+        if (req.method === 'GET' && url.startsWith('/graph/subgraph')) {
+          res.writeHead(200);
+          res.end(JSON.stringify(subgraphFixture));
+          return;
+        }
+
+        if (req.method === 'GET' && (url === '/graph' || url.startsWith('/graph?'))) {
+          res.writeHead(200);
+          res.end(JSON.stringify(graphFixture));
+          return;
+        }
+
+        res.writeHead(404);
+        res.end('{}');
+      });
+    });
+
+    mockServer.listen(0, () => {
+      const addr = mockServer.address() as { port: number };
+      MOCK_PORT = addr.port;
+      DEVNEURAL_PORT = String(MOCK_PORT);
+      resolve();
+    });
+  });
+});
+
+afterAll(() => {
+  return new Promise<void>((resolve) => {
+    mockServer.close(() => resolve());
+  });
+});
+
+function run(args: string[], env?: Record<string, string>) {
+  return spawnSync('node', [ENTRY, ...args], {
+    encoding: 'utf8',
+    timeout: 30000,
+    env: { ...process.env, DEVNEURAL_PORT, ...env },
+  });
+}
+
+describe('e2e: skills query with mock server', () => {
+  beforeEach(() => {
+    recordedPosts.length = 0;
+  });
+
+  it('exit code 0', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.status).toBe(0);
+  });
+
+  it('stdout is readable text (no markdown characters)', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.stdout).not.toMatch(/[*#`•\[\]_>|]/);
+  });
+
+  it('stdout contains no raw skill: node ID prefixes', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.stdout).not.toContain('skill:');
+  });
+
+  it('POST /voice/command received with type voice:highlight', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.status).toBe(0);
+    const post = recordedPosts.find(p => p.type === 'voice:highlight');
+    expect(post).toBeDefined();
+  });
+});
+
+describe('e2e: context query with mock server', () => {
+  beforeEach(() => {
+    recordedPosts.length = 0;
+  });
+
+  it('exit code 0', () => {
+    const result = run(["what's my current context"]);
+    expect(result.status).toBe(0);
+  });
+
+  it('sends voice:focus then voice:highlight (two POSTs total)', () => {
+    const result = run(["what's my current context"]);
+    expect(result.status).toBe(0);
+
+    const types = recordedPosts.map(p => p.type);
+    expect(types).toContain('voice:focus');
+    expect(types).toContain('voice:highlight');
+    expect(recordedPosts).toHaveLength(2);
+  });
+
+  it('first POST is voice:focus', () => {
+    run(["what's my current context"]);
+    expect(recordedPosts[0]?.type).toBe('voice:focus');
+  });
+
+  it('second POST is voice:highlight', () => {
+    run(["what's my current context"]);
+    expect(recordedPosts[1]?.type).toBe('voice:highlight');
+  });
+});
+
+describe('e2e: API unavailable', () => {
+  it('exit code 0 when API unreachable', () => {
+    const result = run(['what skills am I using most?'], {
+      DEVNEURAL_API_URL: 'http://localhost:19998',
+    });
+    expect(result.status).toBe(0);
+  });
+
+  it("stdout contains \"isn't running\" message", () => {
+    const result = run(['what skills am I using most?'], {
+      DEVNEURAL_API_URL: 'http://localhost:19998',
+    });
+    expect(result.stdout).toContain("isn't running");
+  });
+
+  it('path in message ends with 02-api-server/dist/server.js', () => {
+    const result = run(['what skills am I using most?'], {
+      DEVNEURAL_API_URL: 'http://localhost:19998',
+    });
+    expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
+  });
+});

=== FIXES ===
diff --git a/05-voice-interface/src/formatter/orb-events.ts b/05-voice-interface/src/formatter/orb-events.ts
index 4231b75..86ca8ae 100644
--- a/05-voice-interface/src/formatter/orb-events.ts
+++ b/05-voice-interface/src/formatter/orb-events.ts
@@ -30,6 +30,7 @@ async function postEvent(type: string, payload: unknown): Promise<void> {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ type, payload }),
+      signal: AbortSignal.timeout(5000),
     });
   } catch {
     // Swallow all errors — orb events are best-effort
diff --git a/05-voice-interface/src/index.ts b/05-voice-interface/src/index.ts
index b1f5ce6..bb9be50 100644
--- a/05-voice-interface/src/index.ts
+++ b/05-voice-interface/src/index.ts
@@ -36,7 +36,7 @@ async function main(): Promise<void> {
     output = `I couldn't reach the AI assistant, but here's what I could parse locally: ${text}`;
   }
 
-  sendOrbEvents(parsed, apiResult?.data ?? null).catch(() => { /* best-effort */ });
+  await sendOrbEvents(parsed, apiResult?.data ?? null).catch(() => { /* best-effort */ });
   process.stdout.write(output + '\n');
 }
 
diff --git a/05-voice-interface/tests/e2e.test.ts b/05-voice-interface/tests/e2e.test.ts
index 8160288..0ce039d 100644
--- a/05-voice-interface/tests/e2e.test.ts
+++ b/05-voice-interface/tests/e2e.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
-import { spawnSync } from 'child_process';
+import { spawn } from 'child_process';
 import http from 'http';
 import path from 'path';
 
@@ -122,11 +122,23 @@ afterAll(() => {
   });
 });
 
-function run(args: string[], env?: Record<string, string>) {
-  return spawnSync('node', [ENTRY, ...args], {
-    encoding: 'utf8',
-    timeout: 30000,
-    env: { ...process.env, DEVNEURAL_PORT, ...env },
+function run(args: string[], env?: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
+  return new Promise((resolve) => {
+    let stdout = '';
+    let stderr = '';
+    const child = spawn('node', [ENTRY, ...args], {
+      env: { ...process.env, DEVNEURAL_PORT, ...env },
+    });
+    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
+    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
+    const timer = setTimeout(() => {
+      child.kill();
+      resolve({ status: null, stdout, stderr });
+    }, 15000);
+    child.on('close', (code) => {
+      clearTimeout(timer);
+      resolve({ status: code, stdout, stderr });
+    });
   });
 }
 
@@ -135,23 +147,23 @@ describe('e2e: skills query with mock server', () => {
     recordedPosts.length = 0;
   });
 
-  it('exit code 0', () => {
-    const result = run(['what skills am I using most?']);
+  it('exit code 0', async () => {
+    const result = await run(['what skills am I using most?']);
     expect(result.status).toBe(0);
   });
 
-  it('stdout is readable text (no markdown characters)', () => {
-    const result = run(['what skills am I using most?']);
+  it('stdout is readable text (no markdown characters)', async () => {
+    const result = await run(['what skills am I using most?']);
     expect(result.stdout).not.toMatch(/[*#`•\[\]_>|]/);
   });
 
-  it('stdout contains no raw skill: node ID prefixes', () => {
-    const result = run(['what skills am I using most?']);
+  it('stdout contains no raw skill: node ID prefixes', async () => {
+    const result = await run(['what skills am I using most?']);
     expect(result.stdout).not.toContain('skill:');
   });
 
-  it('POST /voice/command received with type voice:highlight', () => {
-    const result = run(['what skills am I using most?']);
+  it('POST /voice/command received with type voice:highlight', async () => {
+    const result = await run(['what skills am I using most?']);
     expect(result.status).toBe(0);
     const post = recordedPosts.find(p => p.type === 'voice:highlight');
     expect(post).toBeDefined();
@@ -163,13 +175,13 @@ describe('e2e: context query with mock server', () => {
     recordedPosts.length = 0;
   });
 
-  it('exit code 0', () => {
-    const result = run(["what's my current context"]);
+  it('exit code 0', async () => {
+    const result = await run(["what's my current context"]);
     expect(result.status).toBe(0);
   });
 
-  it('sends voice:focus then voice:highlight (two POSTs total)', () => {
-    const result = run(["what's my current context"]);
+  it('sends voice:focus then voice:highlight (two POSTs total)', async () => {
+    const result = await run(["what's my current context"]);
     expect(result.status).toBe(0);
 
     const types = recordedPosts.map(p => p.type);
@@ -178,34 +190,34 @@ describe('e2e: context query with mock server', () => {
     expect(recordedPosts).toHaveLength(2);
   });
 
-  it('first POST is voice:focus', () => {
-    run(["what's my current context"]);
+  it('first POST is voice:focus', async () => {
+    await run(["what's my current context"]);
     expect(recordedPosts[0]?.type).toBe('voice:focus');
   });
 
-  it('second POST is voice:highlight', () => {
-    run(["what's my current context"]);
+  it('second POST is voice:highlight', async () => {
+    await run(["what's my current context"]);
     expect(recordedPosts[1]?.type).toBe('voice:highlight');
   });
 });
 
 describe('e2e: API unavailable', () => {
-  it('exit code 0 when API unreachable', () => {
-    const result = run(['what skills am I using most?'], {
+  it('exit code 0 when API unreachable', async () => {
+    const result = await run(['what skills am I using most?'], {
       DEVNEURAL_API_URL: 'http://localhost:19998',
     });
     expect(result.status).toBe(0);
   });
 
-  it("stdout contains \"isn't running\" message", () => {
-    const result = run(['what skills am I using most?'], {
+  it("stdout contains \"isn't running\" message", async () => {
+    const result = await run(['what skills am I using most?'], {
       DEVNEURAL_API_URL: 'http://localhost:19998',
     });
     expect(result.stdout).toContain("isn't running");
   });
 
-  it('path in message ends with 02-api-server/dist/server.js', () => {
-    const result = run(['what skills am I using most?'], {
+  it('path in message ends with 02-api-server/dist/server.js', async () => {
+    const result = await run(['what skills am I using most?'], {
       DEVNEURAL_API_URL: 'http://localhost:19998',
     });
     expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
