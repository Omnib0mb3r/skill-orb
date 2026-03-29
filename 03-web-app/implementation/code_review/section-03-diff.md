diff --git a/03-web-app/src/main.ts b/03-web-app/src/main.ts
index fbbd47f..11ca6d2 100644
--- a/03-web-app/src/main.ts
+++ b/03-web-app/src/main.ts
@@ -1,21 +1,80 @@
+import * as THREE from 'three';
 import { createScene } from '../webview/renderer';
-import { updateGraph, getGraphInstance, initOrb, updateRenderPositions } from '../webview/orb';
+import { updateGraph, getGraphInstance, initOrb, updateRenderPositions, getNodePosition } from '../webview/orb';
 import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
-import type { WsMessage } from './types';
+import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
+import { createCameraController } from '../webview/camera';
+import { createHud, setConnectionStatus, setCameraMode } from '../webview/hud';
+import { evaluateQuery } from '../webview/search';
+import type { WsMessage, GraphNode, GraphEdge } from './types';
+import type { SearchResult } from '../webview/search';
 
 const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
-const { scene, startAnimationLoop } = createScene(canvas);
+const { scene, camera, controls, startAnimationLoop } = createScene(canvas);
 
 const graphOrb = getGraphInstance();
 scene.add(graphOrb);
 
-initOrb(scene);
+const meshes = initOrb(scene);
 initAnimation(scene);
 
+// Camera controller
+const cameraController = createCameraController(camera, controls, getNodePosition);
+controls.addEventListener('start', () => cameraController.onUserInteraction());
+
+// HUD
+let lastNodes: GraphNode[] = [];
+let lastEdges: GraphEdge[] = [];
+
+function applySearchVisuals(result: SearchResult): void {
+  if (result.matchingNodeIds.size === 0) {
+    resetNodeColors(meshes, nodeIndexMap);
+    return;
+  }
+  for (const [id] of nodeIndexMap) {
+    if (result.matchingNodeIds.has(id)) {
+      setNodeColor(id, new THREE.Color(0xffffff), meshes, nodeIndexMap);
+    } else {
+      setNodeColor(id, new THREE.Color(0x222222), meshes, nodeIndexMap);
+    }
+  }
+  if (cameraController.state !== 'manual') {
+    const positions = [...result.matchingNodeIds]
+      .map(id => getNodePosition(id))
+      .filter((p): p is THREE.Vector3 => p !== null);
+    if (positions.length > 0) {
+      const centroid = positions
+        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
+        .divideScalar(positions.length);
+      const radius = Math.max(
+        ...positions.map(p => p.distanceTo(centroid)),
+        10,
+      );
+      cameraController.focusOnCluster(centroid, radius);
+    }
+  }
+}
+
+const hudElements = createHud({
+  onReturnToAuto: () => {
+    cameraController.returnToAuto();
+    setCameraMode(hudElements, cameraController.state);
+  },
+  onSearchQuery: (q) => {
+    const result = evaluateQuery(q, lastNodes, lastEdges);
+    if (q.trim() === '') {
+      resetNodeColors(meshes, nodeIndexMap);
+    } else {
+      applySearchVisuals(result);
+    }
+  },
+});
+
 startAnimationLoop((delta: number) => {
   graphOrb.tickFrame();
   updateRenderPositions();
   tickBreathing(delta * 1000);
+  cameraController.tick(delta * 1000);
 });
 
 // Browser WebSocket — connects to the DevNeural Python server
@@ -24,15 +83,23 @@ const WS_URL = 'ws://localhost:27182';
 function connect(): void {
   const ws = new WebSocket(WS_URL);
 
+  ws.onopen = () => {
+    setConnectionStatus(hudElements, 'connected');
+  };
+
   ws.onmessage = (event: MessageEvent) => {
     try {
       const msg = JSON.parse(event.data as string) as WsMessage;
       if (msg.type === 'graph:snapshot') {
+        lastNodes = msg.payload.nodes;
+        lastEdges = msg.payload.edges;
         updateGraph(msg.payload);
         onSnapshot(msg.payload.edges.map(e => ({
           id: e.id,
           last_seen: new Date(e.last_seen).getTime(),
         })));
+        setConnectionStatus(hudElements, 'connected');
+        setCameraMode(hudElements, cameraController.state);
       }
       if (msg.type === 'connection:new') {
         onConnectionNew({
@@ -47,6 +114,7 @@ function connect(): void {
   };
 
   ws.onclose = () => {
+    setConnectionStatus(hudElements, 'disconnected');
     setTimeout(connect, 2000);
   };
 }
diff --git a/03-web-app/webview/__tests__/camera.test.ts b/03-web-app/webview/__tests__/camera.test.ts
new file mode 100644
index 0000000..e777faa
--- /dev/null
+++ b/03-web-app/webview/__tests__/camera.test.ts
@@ -0,0 +1,82 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import * as THREE from 'three';
+import { createCameraController } from '../camera';
+import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
+
+function makeMocks() {
+  const camera = {
+    position: new THREE.Vector3(0, 0, 300),
+    updateProjectionMatrix: vi.fn(),
+  } as unknown as THREE.PerspectiveCamera;
+
+  const controls = {
+    target: new THREE.Vector3(0, 0, 0),
+    update: vi.fn(),
+  } as unknown as OrbitControls;
+
+  const getNodePosition = vi.fn((_id: string): THREE.Vector3 | null => null);
+
+  return { camera, controls, getNodePosition };
+}
+
+beforeEach(() => {
+  vi.clearAllMocks();
+});
+
+describe('CameraController state machine', () => {
+  it('starts in full-sphere state on init', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    expect(ctrl.state).toBe('full-sphere');
+  });
+
+  it('setActiveProjects([nodeId]) transitions camera to single-focus state', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onActiveProjectsChanged(['node-1']);
+    expect(ctrl.state).toBe('single-focus');
+  });
+
+  it('setActiveProjects([id1, id2]) transitions camera to multi-focus state', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onActiveProjectsChanged(['node-1', 'node-2']);
+    expect(ctrl.state).toBe('multi-focus');
+  });
+
+  it('setActiveProjects([]) transitions camera to full-sphere state', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onActiveProjectsChanged(['node-1']);
+    ctrl.onActiveProjectsChanged([]);
+    expect(ctrl.state).toBe('full-sphere');
+  });
+
+  it('onUserInteraction() transitions camera to manual state', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onUserInteraction();
+    expect(ctrl.state).toBe('manual');
+  });
+
+  it('returnToAuto() transitions camera to full-sphere from manual', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onUserInteraction();
+    expect(ctrl.state).toBe('manual');
+    ctrl.returnToAuto();
+    expect(ctrl.state).toBe('full-sphere');
+  });
+
+  it('camera does NOT transition from manual when setActiveProjects fires while in manual', () => {
+    const { camera, controls, getNodePosition } = makeMocks();
+    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
+    const ctrl = createCameraController(camera, controls, getNodePosition);
+    ctrl.onUserInteraction();
+    ctrl.onActiveProjectsChanged(['node-1']);
+    expect(ctrl.state).toBe('manual');
+  });
+});
diff --git a/03-web-app/webview/__tests__/hud.test.ts b/03-web-app/webview/__tests__/hud.test.ts
new file mode 100644
index 0000000..b9a25ae
--- /dev/null
+++ b/03-web-app/webview/__tests__/hud.test.ts
@@ -0,0 +1,80 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import { createHud, setConnectionStatus, setCameraMode } from '../hud';
+import type { HudCallbacks } from '../hud';
+
+function makeCallbacks(): HudCallbacks {
+  return {
+    onReturnToAuto: vi.fn(),
+    onSearchQuery: vi.fn(),
+  };
+}
+
+beforeEach(() => {
+  document.body.innerHTML = '';
+});
+
+afterEach(() => {
+  vi.useRealTimers();
+});
+
+describe('HUD container layout', () => {
+  it('container div is absolutely positioned with pointer-events: none', () => {
+    createHud(makeCallbacks());
+    const container = document.body.firstElementChild as HTMLElement;
+    expect(container.style.position).toBe('absolute');
+    expect(container.style.pointerEvents).toBe('none');
+  });
+
+  it('searchInput has pointer-events: auto', () => {
+    const elements = createHud(makeCallbacks());
+    expect(elements.searchInput.style.pointerEvents).toBe('auto');
+  });
+
+  it('returnToAutoButton has pointer-events: auto', () => {
+    const elements = createHud(makeCallbacks());
+    expect(elements.returnToAutoButton.style.pointerEvents).toBe('auto');
+  });
+
+  it('voiceButton has pointer-events: auto', () => {
+    const elements = createHud(makeCallbacks());
+    expect(elements.voiceButton.style.pointerEvents).toBe('auto');
+  });
+});
+
+describe('setConnectionStatus', () => {
+  it('setConnectionStatus(elements, "connected") sets status indicator to connected state', () => {
+    const elements = createHud(makeCallbacks());
+    setConnectionStatus(elements, 'connected');
+    expect(elements.statusIndicator.className).toContain('connected');
+    expect(elements.statusIndicator.dataset.status).toBe('connected');
+  });
+
+  it('setConnectionStatus(elements, "disconnected") sets status indicator to disconnected state', () => {
+    const elements = createHud(makeCallbacks());
+    setConnectionStatus(elements, 'disconnected');
+    expect(elements.statusIndicator.className).toContain('disconnected');
+    expect(elements.statusIndicator.dataset.status).toBe('disconnected');
+  });
+});
+
+describe('search debounce', () => {
+  it('rapid keystrokes within 150ms fire only one evaluation call', () => {
+    vi.useFakeTimers();
+    const callbacks = makeCallbacks();
+    const elements = createHud(callbacks);
+
+    elements.searchInput.value = 'a';
+    elements.searchInput.dispatchEvent(new Event('input'));
+    elements.searchInput.value = 'ab';
+    elements.searchInput.dispatchEvent(new Event('input'));
+    elements.searchInput.value = 'abc';
+    elements.searchInput.dispatchEvent(new Event('input'));
+
+    expect(callbacks.onSearchQuery).not.toHaveBeenCalled();
+
+    vi.advanceTimersByTime(200);
+
+    expect(callbacks.onSearchQuery).toHaveBeenCalledTimes(1);
+    expect(callbacks.onSearchQuery).toHaveBeenCalledWith('abc');
+  });
+});
diff --git a/03-web-app/webview/__tests__/search.test.ts b/03-web-app/webview/__tests__/search.test.ts
new file mode 100644
index 0000000..c046b13
--- /dev/null
+++ b/03-web-app/webview/__tests__/search.test.ts
@@ -0,0 +1,107 @@
+import { describe, it, expect } from 'vitest';
+import { evaluateQuery, detectReverseQuery } from '../search';
+import type { GraphNode, GraphEdge } from '../../src/types';
+
+function makeNode(partial: Partial<GraphNode> & { id: string; type: GraphNode['type'] }): GraphNode {
+  return {
+    label: partial.id,
+    ...partial,
+  };
+}
+
+function makeEdge(partial: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
+  return {
+    connection_type: 'project->tool',
+    weight: 1,
+    raw_count: 1,
+    first_seen: '2024-01-01',
+    last_seen: '2024-01-01',
+    ...partial,
+  };
+}
+
+const sampleNodes: GraphNode[] = [
+  makeNode({ id: 'p1', type: 'project', label: 'ProjectAlpha', stage: 'alpha' }),
+  makeNode({ id: 'p2', type: 'project', label: 'ProjectBeta', stage: 'beta' }),
+  makeNode({ id: 't1', type: 'tool', label: 'playwright' }),
+  makeNode({ id: 't2', type: 'tool', label: 'webpack' }),
+  makeNode({ id: 's1', type: 'skill', label: 'TypeScript' }),
+];
+
+const sampleEdges: GraphEdge[] = [
+  makeEdge({ id: 'e1', source: 'p1', target: 't1', connection_type: 'project->tool' }),
+  makeEdge({ id: 'e2', source: 'p2', target: 't2', connection_type: 'project->tool' }),
+  makeEdge({ id: 'e3', source: 'p1', target: 's1', connection_type: 'project->skill' }),
+];
+
+describe('evaluateQuery', () => {
+  it('empty query string returns all nodes and edges as matches', () => {
+    const result = evaluateQuery('', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.size).toBe(sampleNodes.length);
+    expect(result.matchingEdgeIds.size).toBe(sampleEdges.length);
+  });
+
+  it('query "tool" returns all nodes with type === "tool"', () => {
+    const result = evaluateQuery('tool', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('t1')).toBe(true);
+    expect(result.matchingNodeIds.has('t2')).toBe(true);
+    expect(result.matchingNodeIds.has('p1')).toBe(false);
+    expect(result.matchingNodeIds.has('p2')).toBe(false);
+  });
+
+  it('query matching a node label (case-insensitive substring) returns that node + connected edges', () => {
+    const result = evaluateQuery('playwright', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('t1')).toBe(true);
+    expect(result.matchingEdgeIds.has('e1')).toBe(true);
+  });
+
+  it('query matching a stage value (e.g., "beta") returns project nodes with that stage', () => {
+    const result = evaluateQuery('beta', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('p2')).toBe(true);
+    expect(result.matchingNodeIds.has('p1')).toBe(false);
+  });
+
+  it('query "project->tool" returns all edges with connection_type "project->tool"', () => {
+    const result = evaluateQuery('project->tool', sampleNodes, sampleEdges);
+    expect(result.matchingEdgeIds.has('e1')).toBe(true);
+    expect(result.matchingEdgeIds.has('e2')).toBe(true);
+    expect(result.matchingEdgeIds.has('e3')).toBe(false);
+  });
+
+  it('reverse query "uses playwright" returns project nodes connected to playwright tool node', () => {
+    const result = evaluateQuery('uses playwright', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('p1')).toBe(true);
+  });
+
+  it('unrecognized query falls back to substring match across all node labels', () => {
+    const result = evaluateQuery('TypeScript', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('s1')).toBe(true);
+    expect(result.matchingNodeIds.has('p1')).toBe(false);
+  });
+
+  it('non-matching nodes identified in result as non-matching set', () => {
+    const result = evaluateQuery('playwright', sampleNodes, sampleEdges);
+    expect(result.matchingNodeIds.has('p2')).toBe(false);
+    expect(result.matchingNodeIds.has('t2')).toBe(false);
+    expect(result.matchingNodeIds.has('s1')).toBe(false);
+  });
+});
+
+describe('detectReverseQuery', () => {
+  it('"uses playwright" → isReverse=true, target="playwright"', () => {
+    const result = detectReverseQuery('uses playwright');
+    expect(result.isReverse).toBe(true);
+    expect(result.target).toBe('playwright');
+  });
+
+  it('"connects to webpack" → isReverse=true, target="webpack"', () => {
+    const result = detectReverseQuery('connects to webpack');
+    expect(result.isReverse).toBe(true);
+    expect(result.target).toBe('webpack');
+  });
+
+  it('normal query → isReverse=false', () => {
+    const result = detectReverseQuery('playwright');
+    expect(result.isReverse).toBe(false);
+  });
+});
diff --git a/03-web-app/webview/camera.ts b/03-web-app/webview/camera.ts
index 269dc6a..ec4ffa2 100644
--- a/03-web-app/webview/camera.ts
+++ b/03-web-app/webview/camera.ts
@@ -1,2 +1,115 @@
-// Implemented in section-03-camera-hud
-export {};
+import * as THREE from 'three';
+import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
+
+export type CameraState = 'full-sphere' | 'single-focus' | 'multi-focus' | 'manual';
+
+export interface CameraController {
+  readonly state: CameraState;
+  onActiveProjectsChanged(nodeIds: string[]): void;
+  onUserInteraction(): void;
+  returnToAuto(): void;
+  focusOnCluster(centroid: THREE.Vector3, radius: number): void;
+  tick(deltaMs: number): void;
+}
+
+export function createCameraController(
+  camera: THREE.PerspectiveCamera,
+  controls: OrbitControls,
+  getNodePosition: (nodeId: string) => THREE.Vector3 | null,
+): CameraController {
+  let _state: CameraState = 'full-sphere';
+
+  // Lerp state
+  const startPos = new THREE.Vector3();
+  const startTarget = new THREE.Vector3();
+  let targetPos: THREE.Vector3 | null = null;
+  let targetLookAt: THREE.Vector3 | null = null;
+  let elapsed = 0;
+  const DURATION = 800;
+
+  // Capture initial camera position as the "full-sphere" home
+  const FULL_POS = camera.position.clone();
+  const FULL_TARGET = controls.target.clone();
+
+  function easeInOut(t: number): number {
+    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
+  }
+
+  function beginTransition(pos: THREE.Vector3, look: THREE.Vector3): void {
+    startPos.copy(camera.position);
+    startTarget.copy(controls.target);
+    targetPos = pos.clone();
+    targetLookAt = look.clone();
+    elapsed = 0;
+  }
+
+  return {
+    get state(): CameraState {
+      return _state;
+    },
+
+    onActiveProjectsChanged(nodeIds: string[]): void {
+      if (_state === 'manual') return;
+
+      if (nodeIds.length === 0) {
+        _state = 'full-sphere';
+        beginTransition(FULL_POS, FULL_TARGET);
+      } else if (nodeIds.length === 1) {
+        _state = 'single-focus';
+        const pos = getNodePosition(nodeIds[0]);
+        if (pos) {
+          const dist = FULL_POS.length() * 0.5;
+          const dir = pos.clone().normalize();
+          beginTransition(dir.multiplyScalar(dist), pos.clone());
+        } else {
+          beginTransition(FULL_POS, FULL_TARGET);
+        }
+      } else {
+        _state = 'multi-focus';
+        const positions = nodeIds
+          .map(id => getNodePosition(id))
+          .filter((p): p is THREE.Vector3 => p !== null);
+        if (positions.length > 0) {
+          const centroid = positions
+            .reduce((sum, p) => sum.add(p), new THREE.Vector3())
+            .divideScalar(positions.length);
+          beginTransition(FULL_POS.clone().multiplyScalar(0.8), centroid);
+        } else {
+          beginTransition(FULL_POS, FULL_TARGET);
+        }
+      }
+    },
+
+    onUserInteraction(): void {
+      _state = 'manual';
+      targetPos = null;
+      targetLookAt = null;
+    },
+
+    returnToAuto(): void {
+      _state = 'full-sphere';
+      beginTransition(FULL_POS, FULL_TARGET);
+    },
+
+    focusOnCluster(centroid: THREE.Vector3, radius: number): void {
+      if (_state === 'manual') return;
+      const dist = radius * 3 + 50;
+      const dir = centroid.clone().normalize();
+      if (dir.length() < 0.001) dir.set(0, 0, 1);
+      beginTransition(centroid.clone().add(dir.multiplyScalar(dist)), centroid.clone());
+    },
+
+    tick(deltaMs: number): void {
+      if (!targetPos || !targetLookAt) return;
+      elapsed += deltaMs;
+      const t = Math.min(elapsed / DURATION, 1);
+      const e = easeInOut(t);
+      camera.position.lerpVectors(startPos, targetPos, e);
+      controls.target.lerpVectors(startTarget, targetLookAt, e);
+      if (t >= 1) {
+        targetPos = null;
+        targetLookAt = null;
+      }
+    },
+  };
+}
diff --git a/03-web-app/webview/hud.ts b/03-web-app/webview/hud.ts
index 269dc6a..ebb4fd7 100644
--- a/03-web-app/webview/hud.ts
+++ b/03-web-app/webview/hud.ts
@@ -1,2 +1,192 @@
-// Implemented in section-03-camera-hud
-export {};
+import type { CameraState } from './camera';
+
+export interface HudElements {
+  statusIndicator: HTMLElement;
+  cameraToggle: HTMLElement;
+  returnToAutoButton: HTMLButtonElement;
+  searchInput: HTMLInputElement;
+  voiceButton: HTMLButtonElement;
+  legendContainer: HTMLElement;
+}
+
+export interface HudCallbacks {
+  onReturnToAuto(): void;
+  onSearchQuery(query: string): void;
+}
+
+export function createHud(callbacks: HudCallbacks): HudElements {
+  // Outer container — covers full viewport, passes through pointer events
+  const container = document.createElement('div');
+  Object.assign(container.style, {
+    position: 'absolute',
+    top: '0',
+    left: '0',
+    right: '0',
+    bottom: '0',
+    pointerEvents: 'none',
+  });
+
+  // ── Top-left: title + connection status ──────────────────────────────────────
+  const topLeft = document.createElement('div');
+  Object.assign(topLeft.style, {
+    position: 'absolute',
+    top: '12px',
+    left: '12px',
+    display: 'flex',
+    alignItems: 'center',
+    gap: '8px',
+    color: '#ffffff',
+    fontFamily: 'monospace',
+    fontSize: '13px',
+  });
+
+  const title = document.createElement('span');
+  title.textContent = 'DevNeural';
+  title.style.fontWeight = 'bold';
+
+  const statusIndicator = document.createElement('span');
+  statusIndicator.className = 'dn-status unknown';
+  statusIndicator.dataset.status = 'unknown';
+  statusIndicator.title = 'Connection status';
+  Object.assign(statusIndicator.style, {
+    display: 'inline-block',
+    width: '8px',
+    height: '8px',
+    borderRadius: '50%',
+    background: '#888',
+  });
+
+  topLeft.appendChild(title);
+  topLeft.appendChild(statusIndicator);
+
+  // ── Top-right: camera mode + return-to-auto button ───────────────────────────
+  const topRight = document.createElement('div');
+  Object.assign(topRight.style, {
+    position: 'absolute',
+    top: '12px',
+    right: '12px',
+    display: 'flex',
+    alignItems: 'center',
+    gap: '8px',
+    color: '#cccccc',
+    fontFamily: 'monospace',
+    fontSize: '12px',
+  });
+
+  const cameraToggle = document.createElement('span');
+  cameraToggle.className = 'dn-camera-mode';
+  cameraToggle.textContent = 'full-sphere';
+
+  const returnToAutoButton = document.createElement('button');
+  returnToAutoButton.textContent = 'Return to Auto';
+  returnToAutoButton.style.pointerEvents = 'auto';
+  returnToAutoButton.style.display = 'none';
+  returnToAutoButton.style.cursor = 'pointer';
+  returnToAutoButton.addEventListener('click', () => callbacks.onReturnToAuto());
+
+  topRight.appendChild(cameraToggle);
+  topRight.appendChild(returnToAutoButton);
+
+  // ── Bottom-left: legend ──────────────────────────────────────────────────────
+  const legendContainer = document.createElement('div');
+  Object.assign(legendContainer.style, {
+    position: 'absolute',
+    bottom: '12px',
+    left: '12px',
+    color: '#aaaaaa',
+    fontFamily: 'monospace',
+    fontSize: '11px',
+    lineHeight: '1.7',
+  });
+  legendContainer.innerHTML = [
+    '<b>Shapes</b>: slab = project · cube = tool · octa = skill',
+    '<b>Edge</b>: cool blue (low) → warm orange (high weight)',
+    '<b>Badges</b>: <span style="color:#f5a623">&#9679; alpha</span>',
+    ' · <span style="color:#50e3c2">&#9679; beta</span>',
+    ' · <span style="color:#7ed321">&#9679; deployed</span>',
+    ' · <span style="color:#888888">&#9679; archived</span>',
+  ].join('');
+
+  // ── Bottom-center: search input + voice button ───────────────────────────────
+  const bottomCenter = document.createElement('div');
+  Object.assign(bottomCenter.style, {
+    position: 'absolute',
+    bottom: '12px',
+    left: '50%',
+    transform: 'translateX(-50%)',
+    display: 'flex',
+    gap: '6px',
+    alignItems: 'center',
+  });
+
+  const searchInput = document.createElement('input');
+  searchInput.type = 'text';
+  searchInput.placeholder = 'Search nodes…';
+  searchInput.style.pointerEvents = 'auto';
+  searchInput.style.background = 'rgba(0,0,0,0.6)';
+  searchInput.style.color = '#ffffff';
+  searchInput.style.border = '1px solid #444';
+  searchInput.style.borderRadius = '4px';
+  searchInput.style.padding = '4px 8px';
+  searchInput.style.fontFamily = 'monospace';
+  searchInput.style.fontSize = '13px';
+  searchInput.style.width = '220px';
+
+  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
+  searchInput.addEventListener('input', () => {
+    if (debounceTimer !== null) clearTimeout(debounceTimer);
+    debounceTimer = setTimeout(() => {
+      callbacks.onSearchQuery(searchInput.value);
+    }, 150);
+  });
+
+  const voiceButton = document.createElement('button');
+  voiceButton.className = 'dn-voice-btn';
+  voiceButton.textContent = '🎤';
+  voiceButton.style.pointerEvents = 'auto';
+  voiceButton.style.cursor = 'pointer';
+  voiceButton.style.background = 'rgba(0,0,0,0.6)';
+  voiceButton.style.border = '1px solid #444';
+  voiceButton.style.borderRadius = '4px';
+  voiceButton.style.padding = '4px 8px';
+  voiceButton.setAttribute('aria-label', 'Voice search');
+
+  bottomCenter.appendChild(searchInput);
+  bottomCenter.appendChild(voiceButton);
+
+  container.appendChild(topLeft);
+  container.appendChild(topRight);
+  container.appendChild(legendContainer);
+  container.appendChild(bottomCenter);
+
+  document.body.appendChild(container);
+
+  return {
+    statusIndicator,
+    cameraToggle,
+    returnToAutoButton,
+    searchInput,
+    voiceButton,
+    legendContainer,
+  };
+}
+
+export function setConnectionStatus(
+  elements: HudElements,
+  status: 'connected' | 'disconnected' | 'unknown'
+): void {
+  elements.statusIndicator.className = `dn-status ${status}`;
+  elements.statusIndicator.dataset.status = status;
+
+  const colors: Record<string, string> = {
+    connected: '#44ff88',
+    disconnected: '#ff4444',
+    unknown: '#888888',
+  };
+  elements.statusIndicator.style.background = colors[status];
+}
+
+export function setCameraMode(elements: HudElements, state: CameraState): void {
+  elements.cameraToggle.textContent = state;
+  elements.returnToAutoButton.style.display = state === 'manual' ? 'inline-block' : 'none';
+}
diff --git a/03-web-app/webview/orb.ts b/03-web-app/webview/orb.ts
index 29e8b41..a9d996c 100644
--- a/03-web-app/webview/orb.ts
+++ b/03-web-app/webview/orb.ts
@@ -211,6 +211,19 @@ export function getGraphInstance(): ThreeForceGraph {
   return graph;
 }
 
+/**
+ * Returns the current Three.js world position of a node by ID, or null if unknown.
+ * Reads live force-layout positions from the graph data each call.
+ */
+export function getNodePosition(nodeId: string): THREE.Vector3 | null {
+  const graphData = graph.graphData() as {
+    nodes: Array<NodeObject & { x?: number; y?: number; z?: number }>;
+  };
+  const node = graphData.nodes.find(n => String((n as Record<string, unknown>)['id']) === nodeId);
+  if (!node || node.x === undefined) return null;
+  return new THREE.Vector3(node.x, node.y ?? 0, node.z ?? 0);
+}
+
 export function updateGraph(snapshot: GraphSnapshot): void {
   const { nodes, links, wasCapped, originalCounts } = capAndTransform(snapshot);
 
diff --git a/03-web-app/webview/search.ts b/03-web-app/webview/search.ts
index 269dc6a..4cc2fc3 100644
--- a/03-web-app/webview/search.ts
+++ b/03-web-app/webview/search.ts
@@ -1,2 +1,103 @@
-// Implemented in section-03-camera-hud
-export {};
+import type { GraphNode, GraphEdge } from '../src/types';
+
+export interface SearchResult {
+  matchingNodeIds: Set<string>;
+  matchingEdgeIds: Set<string>;
+}
+
+const KNOWN_TYPES = new Set(['project', 'tool', 'skill']);
+const KNOWN_STAGES = new Set([
+  'alpha', 'beta', 'deployed', 'archived', 'sandbox', 'revision-needed',
+]);
+
+export function detectReverseQuery(query: string): { isReverse: boolean; target: string } {
+  const lower = query.toLowerCase().trim();
+  if (lower.startsWith('uses ')) {
+    return { isReverse: true, target: lower.slice(5).trim() };
+  }
+  if (lower.startsWith('connects to ')) {
+    return { isReverse: true, target: lower.slice(12).trim() };
+  }
+  return { isReverse: false, target: '' };
+}
+
+export function evaluateQuery(
+  query: string,
+  nodes: GraphNode[],
+  edges: GraphEdge[],
+): SearchResult {
+  const trimmed = query.trim();
+
+  // 1. Empty query → all match
+  if (trimmed === '') {
+    return {
+      matchingNodeIds: new Set(nodes.map(n => n.id)),
+      matchingEdgeIds: new Set(edges.map(e => e.id)),
+    };
+  }
+
+  const lower = trimmed.toLowerCase();
+
+  // 2. Node type match
+  if (KNOWN_TYPES.has(lower)) {
+    const matchingNodeIds = new Set(nodes.filter(n => n.type === lower).map(n => n.id));
+    const matchingEdgeIds = new Set(
+      edges
+        .filter(e => matchingNodeIds.has(e.source) && matchingNodeIds.has(e.target))
+        .map(e => e.id),
+    );
+    return { matchingNodeIds, matchingEdgeIds };
+  }
+
+  // 3. Stage match
+  if (KNOWN_STAGES.has(lower)) {
+    const matchingNodeIds = new Set(nodes.filter(n => n.stage === lower).map(n => n.id));
+    const matchingEdgeIds = new Set(
+      edges
+        .filter(e => matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
+        .map(e => e.id),
+    );
+    return { matchingNodeIds, matchingEdgeIds };
+  }
+
+  // 4. Connection type match
+  const edgesByType = edges.filter(e => e.connection_type.toLowerCase() === lower);
+  if (edgesByType.length > 0) {
+    const matchingEdgeIds = new Set(edgesByType.map(e => e.id));
+    const matchingNodeIds = new Set<string>();
+    for (const e of edgesByType) {
+      matchingNodeIds.add(e.source);
+      matchingNodeIds.add(e.target);
+    }
+    return { matchingNodeIds, matchingEdgeIds };
+  }
+
+  // 5. Reverse query: "uses <target>" / "connects to <target>"
+  const { isReverse, target } = detectReverseQuery(trimmed);
+  if (isReverse) {
+    const targetNodes = nodes.filter(n => n.label.toLowerCase().includes(target));
+    const targetIds = new Set(targetNodes.map(n => n.id));
+    const connectedEdges = edges.filter(e => targetIds.has(e.source) || targetIds.has(e.target));
+    const matchingEdgeIds = new Set(connectedEdges.map(e => e.id));
+    const matchingNodeIds = new Set<string>();
+    for (const e of connectedEdges) {
+      const srcNode = nodes.find(n => n.id === e.source);
+      const tgtNode = nodes.find(n => n.id === e.target);
+      if (srcNode?.type === 'project') matchingNodeIds.add(srcNode.id);
+      if (tgtNode?.type === 'project') matchingNodeIds.add(tgtNode.id);
+    }
+    targetIds.forEach(id => matchingNodeIds.add(id));
+    return { matchingNodeIds, matchingEdgeIds };
+  }
+
+  // 6. Label substring fallback (case-insensitive)
+  const matchingNodeIds = new Set(
+    nodes.filter(n => n.label.toLowerCase().includes(lower)).map(n => n.id),
+  );
+  const matchingEdgeIds = new Set(
+    edges
+      .filter(e => matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
+      .map(e => e.id),
+  );
+  return { matchingNodeIds, matchingEdgeIds };
+}
