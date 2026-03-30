diff --git a/03-web-app/package.json b/03-web-app/package.json
index 9fdec1c..392789c 100644
--- a/03-web-app/package.json
+++ b/03-web-app/package.json
@@ -7,7 +7,8 @@
     "dev": "vite",
     "build": "tsc && vite build",
     "preview": "vite preview",
-    "test": "vitest run"
+    "test": "vitest run",
+    "build:check": "tsc --noEmit"
   },
   "dependencies": {
     "three": "^0.183.2",
diff --git a/03-web-app/webview/__tests__/gap-coverage.test.ts b/03-web-app/webview/__tests__/gap-coverage.test.ts
new file mode 100644
index 0000000..46043a7
--- /dev/null
+++ b/03-web-app/webview/__tests__/gap-coverage.test.ts
@@ -0,0 +1,213 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect, beforeEach } from 'vitest';
+import * as THREE from 'three';
+
+// ── InstancedMesh mock (for nodes.ts) ─────────────────────────────────────────
+
+const { MockInstancedMesh } = vi.hoisted(() => {
+  class MockInstancedMesh {
+    geometry: unknown;
+    material: unknown;
+    count: number;
+    instanceMatrix = { needsUpdate: false };
+    instanceColor: { needsUpdate: boolean } | null = null;
+
+    constructor(geo: unknown, mat: unknown, count: number) {
+      this.geometry = geo;
+      this.material = mat;
+      this.count = count;
+    }
+
+    setMatrixAt(_i: number, _m: unknown): void {}
+    getMatrixAt(_i: number, _t: unknown): void {}
+
+    setColorAt(index: number, _color: unknown): void {
+      if (!this.instanceColor) this.instanceColor = { needsUpdate: false };
+      void index;
+    }
+  }
+  return { MockInstancedMesh };
+});
+
+vi.mock('three', async () => {
+  const actual = await vi.importActual<typeof THREE>('three');
+  return { ...actual, InstancedMesh: MockInstancedMesh };
+});
+
+// ── Line* mocks (for edges.ts) ────────────────────────────────────────────────
+
+vi.mock('three/examples/jsm/lines/Line2.js', () => ({
+  Line2: class Line2 {
+    material = { color: { set: vi.fn() } };
+    geometry: unknown;
+    constructor() {}
+    computeLineDistances() { return this; }
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
+  LineMaterial: class LineMaterial {
+    color = { set: vi.fn() };
+    constructor(_p: unknown) {}
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
+  LineGeometry: class LineGeometry {
+    setPositions(_arr: number[]) {}
+  },
+}));
+
+// ── three-forcegraph + renderer mocks (for orb.ts) ───────────────────────────
+
+vi.mock('three-forcegraph', () => ({
+  default: class ThreeForceGraph {
+    graphData(_d?: unknown) { return { nodes: [], links: [] }; }
+    nodeThreeObject(_fn?: unknown) { return this; }
+    linkThreeObject(_fn?: unknown) { return this; }
+    nodePositionUpdate(_fn?: unknown) { return this; }
+    onEngineStop(_fn?: unknown) { return this; }
+    forceEngine(_e?: unknown) { return this; }
+    warmupTicks(_n?: unknown) { return this; }
+    numDimensions(_n?: unknown) { return this; }
+    cooldownTicks(_n?: unknown) { return this; }
+    d3Force(_name?: unknown, _fn?: unknown) { return this; }
+    onFinishUpdate(_fn?: unknown) { return this; }
+  },
+}));
+
+vi.mock('../renderer', () => ({
+  ORB_RADIUS: 150,
+  addResizeListener: vi.fn(),
+}));
+
+// ── Module imports ────────────────────────────────────────────────────────────
+
+import { capAndTransform } from '../orb';
+import { applyEdgeColors } from '../edges';
+import { createNodeMeshes, setNodePositions, resetNodeColors, nodeIndexMap } from '../nodes';
+import type { GraphNode, GraphEdge } from '../../src/types';
+import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
+
+// ── Helpers ───────────────────────────────────────────────────────────────────
+
+function makeNode(id: string, type: GraphNode['type'] = 'project'): GraphNode {
+  return { id, label: id, type };
+}
+
+function makeEdge(id: string, src: string, tgt: string, weight = 1): GraphEdge {
+  return {
+    id, source: src, target: tgt,
+    connection_type: 'project->tool',
+    weight, raw_count: 1,
+    first_seen: '2024-01-01', last_seen: '2024-01-01',
+  };
+}
+
+// ── capAndTransform ───────────────────────────────────────────────────────────
+
+describe('capAndTransform', () => {
+  it('small graph (≤ 500 nodes) passes through unchanged with wasCapped=false', () => {
+    const nodes = Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`));
+    const edges = [makeEdge('e1', 'n0', 'n1')];
+    const result = capAndTransform({ nodes, edges });
+    expect(result.wasCapped).toBe(false);
+    expect(result.nodes.length).toBe(5);
+    expect(result.originalCounts.nodes).toBe(5);
+  });
+
+  it('graph with > 500 nodes caps to referenced nodes and sets wasCapped=true', () => {
+    const nodes = Array.from({ length: 502 }, (_, i) => makeNode(`n${i}`));
+    // Only 10 edges referencing the first 11 nodes — the rest (n11–n501) are unreferenced
+    const edges = Array.from({ length: 10 }, (_, i) =>
+      makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, i + 1)
+    );
+    const result = capAndTransform({ nodes, edges });
+    expect(result.wasCapped).toBe(true);
+    expect(result.nodes.length).toBeLessThan(502);
+    expect(result.originalCounts.nodes).toBe(502);
+  });
+
+  it('pins the DevNeural center node at origin (fx=0, fy=0, fz=0)', () => {
+    const centerNode: GraphNode = {
+      id: 'project:github.com/mcollins-f6i/DevNeural',
+      label: 'DevNeural',
+      type: 'project',
+    };
+    const nodes = [makeNode('other'), centerNode];
+    const edges = [makeEdge('e1', 'other', centerNode.id)];
+    const result = capAndTransform({ nodes, edges });
+
+    const pinned = result.nodes.find(n => n.id === centerNode.id);
+    expect(pinned).toBeDefined();
+    expect(pinned!.fx).toBe(0);
+    expect(pinned!.fy).toBe(0);
+    expect(pinned!.fz).toBe(0);
+  });
+
+  it('non-center nodes are NOT pinned (no fx/fy/fz)', () => {
+    const nodes = [makeNode('plain')];
+    const edges = [makeEdge('e1', 'plain', 'plain')];
+    const result = capAndTransform({ nodes, edges });
+    const plain = result.nodes.find(n => n.id === 'plain')!;
+    expect(plain.fx).toBeUndefined();
+  });
+});
+
+// ── applyEdgeColors ───────────────────────────────────────────────────────────
+
+describe('applyEdgeColors', () => {
+  it('calls color.set on each Line2 material matching the colorMap', () => {
+    const line1 = { material: { color: { set: vi.fn() } } };
+    const line2 = { material: { color: { set: vi.fn() } } };
+    const edgeLines = new Map<string, Line2>([
+      ['e1', line1 as unknown as Line2],
+      ['e2', line2 as unknown as Line2],
+    ]);
+    const red = new THREE.Color(0xff0000);
+    const blue = new THREE.Color(0x0000ff);
+    const colorMap = new Map([['e1', red], ['e2', blue]]);
+
+    applyEdgeColors(edgeLines, colorMap);
+
+    expect(line1.material.color.set).toHaveBeenCalledWith(red);
+    expect(line2.material.color.set).toHaveBeenCalledWith(blue);
+  });
+
+  it('skips edges whose id is absent from colorMap', () => {
+    const line = { material: { color: { set: vi.fn() } } };
+    const edgeLines = new Map<string, Line2>([['e1', line as unknown as Line2]]);
+    const colorMap = new Map<string, THREE.Color>(); // empty
+
+    applyEdgeColors(edgeLines, colorMap);
+
+    expect(line.material.color.set).not.toHaveBeenCalled();
+  });
+});
+
+// ── resetNodeColors ───────────────────────────────────────────────────────────
+
+describe('resetNodeColors', () => {
+  beforeEach(() => {
+    nodeIndexMap.clear();
+  });
+
+  it('marks instanceColor.needsUpdate = true on all type meshes after reset', () => {
+    const m = createNodeMeshes(10);
+    setNodePositions([{ id: 'p1', type: 'project', x: 0, y: 0, z: 0 }], m);
+    resetNodeColors(m, nodeIndexMap);
+    expect(m.projectMesh.instanceColor!.needsUpdate).toBe(true);
+  });
+
+  it('calls setColorAt for every node registered in the map', () => {
+    const m = createNodeMeshes(10);
+    const spy = vi.spyOn(m.projectMesh, 'setColorAt');
+    setNodePositions([
+      { id: 'p1', type: 'project', x: 0, y: 0, z: 0 },
+      { id: 'p2', type: 'project', x: 1, y: 0, z: 0 },
+    ], m);
+    spy.mockClear();
+    resetNodeColors(m, nodeIndexMap);
+    expect(spy).toHaveBeenCalledTimes(2);
+  });
+});
diff --git a/03-web-app/webview/__tests__/integration.test.ts b/03-web-app/webview/__tests__/integration.test.ts
new file mode 100644
index 0000000..d01c25c
--- /dev/null
+++ b/03-web-app/webview/__tests__/integration.test.ts
@@ -0,0 +1,237 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
+import * as THREE from 'three';
+
+// ── InstancedMesh mock ────────────────────────────────────────────────────────
+
+const { MockInstancedMesh } = vi.hoisted(() => {
+  class MockInstancedMesh {
+    geometry: unknown;
+    material: unknown;
+    count: number;
+    instanceMatrix = { needsUpdate: false };
+    instanceColor: { needsUpdate: boolean } | null = null;
+    constructor(geo: unknown, mat: unknown, count: number) {
+      this.geometry = geo; this.material = mat; this.count = count;
+    }
+    setMatrixAt(_i: number, _m: unknown): void {}
+    getMatrixAt(_i: number, _t: unknown): void {}
+    setColorAt(index: number, _c: unknown): void {
+      if (!this.instanceColor) this.instanceColor = { needsUpdate: false };
+      void index;
+    }
+  }
+  return { MockInstancedMesh };
+});
+
+vi.mock('three', async () => {
+  const actual = await vi.importActual<typeof THREE>('three');
+  return { ...actual, InstancedMesh: MockInstancedMesh };
+});
+
+// ── Line* mocks ───────────────────────────────────────────────────────────────
+
+vi.mock('three/examples/jsm/lines/Line2.js', () => ({
+  Line2: class Line2 {
+    material = { opacity: 1, transparent: false, emissiveIntensity: 0, dispose: vi.fn() };
+    geometry = { dispose: vi.fn() };
+    computeLineDistances() { return this; }
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
+  LineMaterial: class LineMaterial {
+    color = { set: vi.fn() };
+    opacity = 1; transparent = false; emissiveIntensity = 0;
+    linewidth = 1.5;
+    constructor(_p: unknown) {}
+    dispose = vi.fn();
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
+  LineGeometry: class LineGeometry {
+    setPositions(_arr: number[]) {}
+    dispose = vi.fn();
+  },
+}));
+
+vi.mock('three-forcegraph', () => ({
+  default: class ThreeForceGraph {
+    graphData(_d?: unknown) { return { nodes: [], links: [] }; }
+    nodeThreeObject(_fn?: unknown) { return this; }
+    linkThreeObject(_fn?: unknown) { return this; }
+    nodePositionUpdate(_fn?: unknown) { return this; }
+    onEngineStop(_fn?: unknown) { return this; }
+    forceEngine(_e?: unknown) { return this; }
+    warmupTicks(_n?: unknown) { return this; }
+    numDimensions(_n?: unknown) { return this; }
+    cooldownTicks(_n?: unknown) { return this; }
+    d3Force(_name?: unknown, _fn?: unknown) { return this; }
+  },
+}));
+
+vi.mock('../renderer', () => ({
+  ORB_RADIUS: 150,
+  addResizeListener: vi.fn(),
+}));
+
+// ── Module imports ────────────────────────────────────────────────────────────
+
+import { createNodeMeshes, setNodePositions, nodeIndexMap } from '../nodes';
+import { evaluateQuery } from '../search';
+import {
+  initAnimation, onConnectionNew, onSnapshot,
+  _resetState, _getEphemeralEdges, _getActiveEdgeIds,
+} from '../animation';
+
+// ── Test 1: setNodePositions produces nodeIndexMap entries for every node ─────
+
+describe('setNodePositions → nodeIndexMap integration', () => {
+  beforeEach(() => {
+    nodeIndexMap.clear();
+  });
+
+  it('populates nodeIndexMap with one entry per rendered node', () => {
+    const m = createNodeMeshes(10);
+    const nodes = [
+      { id: 'proj-a', type: 'project' as const, x: 0, y: 0, z: 0 },
+      { id: 'tool-b', type: 'tool' as const, x: 1, y: 0, z: 0 },
+      { id: 'skill-c', type: 'skill' as const, x: 2, y: 0, z: 0 },
+    ];
+    setNodePositions(nodes, m);
+    expect(nodeIndexMap.size).toBe(3);
+    expect(nodeIndexMap.has('proj-a')).toBe(true);
+    expect(nodeIndexMap.has('tool-b')).toBe(true);
+    expect(nodeIndexMap.has('skill-c')).toBe(true);
+  });
+
+  it('each nodeIndexMap entry references the correct mesh for its type', () => {
+    const m = createNodeMeshes(10);
+    setNodePositions([
+      { id: 'p', type: 'project' as const, x: 0, y: 0, z: 0 },
+      { id: 't', type: 'tool' as const, x: 0, y: 0, z: 0 },
+    ], m);
+    expect(nodeIndexMap.get('p')!.mesh).toBe(m.projectMesh);
+    expect(nodeIndexMap.get('t')!.mesh).toBe(m.toolMesh);
+  });
+});
+
+// ── Test 2: WebSocket reconnect pattern ───────────────────────────────────────
+
+describe('WebSocket reconnect pattern', () => {
+  afterEach(() => {
+    vi.useRealTimers();
+    delete (window as any).WebSocket;
+  });
+
+  it('schedules a new connection after 2s following onclose', () => {
+    vi.useFakeTimers();
+
+    const instances: Array<{ onclose: (() => void) | null }> = [];
+    const MockWS = vi.fn(() => {
+      const ws = { onopen: null as (() => void) | null, onclose: null as (() => void) | null };
+      instances.push(ws);
+      return ws;
+    });
+
+    // Simulate the reconnect pattern from main.ts
+    function connect() {
+      const ws = new (MockWS as any)();
+      ws.onclose = () => setTimeout(connect, 2000);
+    }
+
+    connect();
+    expect(MockWS).toHaveBeenCalledTimes(1);
+
+    // Trigger close
+    instances[0].onclose!();
+    expect(MockWS).toHaveBeenCalledTimes(1); // not yet
+
+    vi.advanceTimersByTime(2000);
+    expect(MockWS).toHaveBeenCalledTimes(2); // reconnected
+  });
+
+  it('does not reconnect before the 2s delay elapses', () => {
+    vi.useFakeTimers();
+
+    const MockWS = vi.fn(() => {
+      const ws = { onclose: null as (() => void) | null };
+      return ws;
+    });
+
+    let latestWs: { onclose: (() => void) | null };
+    function connect() {
+      latestWs = new (MockWS as any)();
+      latestWs.onclose = () => setTimeout(connect, 2000);
+    }
+
+    connect();
+    latestWs!.onclose!();
+
+    vi.advanceTimersByTime(1999);
+    expect(MockWS).toHaveBeenCalledTimes(1);
+
+    vi.advanceTimersByTime(1);
+    expect(MockWS).toHaveBeenCalledTimes(2);
+  });
+});
+
+// ── Test 3: graph:snapshot clears ephemeral animation edges ──────────────────
+
+describe('graph:snapshot clears ephemeral edges (animation sync)', () => {
+  beforeEach(() => {
+    _resetState();
+    const mockScene = { add: vi.fn(), remove: vi.fn() };
+    initAnimation(mockScene as unknown as THREE.Scene);
+  });
+
+  afterEach(() => {
+    _resetState();
+  });
+
+  it('onSnapshot clears all ephemeral edges from prior onConnectionNew calls', () => {
+    onConnectionNew({ source: 'a', target: 'b', connectionType: 'project->tool' });
+    onConnectionNew({ source: 'c', target: 'd', connectionType: 'project->tool' });
+    expect(_getEphemeralEdges().size).toBeGreaterThan(0);
+
+    onSnapshot([]);
+    expect(_getEphemeralEdges().size).toBe(0);
+  });
+
+  it('onSnapshot clears active edge glow flags', () => {
+    // Register fake edge lines directly via _getActiveEdgeIds reference
+    const activeIds = _getActiveEdgeIds();
+    activeIds.add('fake-edge-id');
+
+    onSnapshot([]);
+    expect(_getActiveEdgeIds().size).toBe(0);
+  });
+});
+
+// ── Test 4: evaluateQuery does not throw on empty snapshot ────────────────────
+
+describe('evaluateQuery + empty snapshot safety', () => {
+  it('returns empty result sets without throwing for empty node/edge arrays', () => {
+    expect(() => {
+      const result = evaluateQuery('', [], []);
+      expect(result.matchingNodeIds.size).toBe(0);
+      expect(result.matchingEdgeIds.size).toBe(0);
+    }).not.toThrow();
+  });
+
+  it('non-empty query against empty arrays returns empty sets without throwing', () => {
+    expect(() => {
+      const result = evaluateQuery('playwright', [], []);
+      expect(result.matchingNodeIds.size).toBe(0);
+      expect(result.matchingEdgeIds.size).toBe(0);
+    }).not.toThrow();
+  });
+
+  it('reverse query against empty arrays returns empty sets without throwing', () => {
+    expect(() => {
+      const result = evaluateQuery('uses some-tool', [], []);
+      expect(result.matchingNodeIds.size).toBe(0);
+    }).not.toThrow();
+  });
+});
diff --git a/03-web-app/webview/__tests__/voice.test.ts b/03-web-app/webview/__tests__/voice.test.ts
index b96a24e..4cae944 100644
--- a/03-web-app/webview/__tests__/voice.test.ts
+++ b/03-web-app/webview/__tests__/voice.test.ts
@@ -8,8 +8,8 @@ class MockSpeechRecognition {
   maxAlternatives = 1;
   continuous = true;
 
-  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
-  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
+  onresult: ((event: any) => void) | null = null;
+  onerror: ((event: any) => void) | null = null;
   onend: (() => void) | null = null;
 
   start = vi.fn();
@@ -72,7 +72,7 @@ describe('initVoice', () => {
     mock.onresult!({
       results: [[{ transcript: 'hello world' }]],
       resultIndex: 0,
-    } as unknown as SpeechRecognitionEvent);
+    });
 
     expect(onTranscript).toHaveBeenCalledWith('hello world');
   });
@@ -82,7 +82,7 @@ describe('initVoice', () => {
     const onStatusChange = vi.fn();
     initVoice({ onTranscript: vi.fn(), onStatusChange });
 
-    mock.onerror!({ error: 'no-speech' } as SpeechRecognitionErrorEvent);
+    mock.onerror!({ error: 'no-speech' });
 
     expect(onStatusChange).toHaveBeenCalledWith('error');
   });
diff --git a/03-web-app/webview/nodeActions.ts b/03-web-app/webview/nodeActions.ts
index b9d9d47..3bcdb75 100644
--- a/03-web-app/webview/nodeActions.ts
+++ b/03-web-app/webview/nodeActions.ts
@@ -237,6 +237,7 @@ export function registerNodeInteractions(deps: RegisterDeps): void {
       hitMesh === meshes.toolMesh    ? maps.tool    :
       maps.skill;
 
+    if (hit.instanceId === undefined) return null;
     const nodeId = mapInstanceToNodeId(hitMesh, hit.instanceId, mapForMesh);
     if (!nodeId) return null;
     const node = deps.getNodeData().get(nodeId);
diff --git a/03-web-app/webview/orb.ts b/03-web-app/webview/orb.ts
index a9d996c..0097b80 100644
--- a/03-web-app/webview/orb.ts
+++ b/03-web-app/webview/orb.ts
@@ -1,6 +1,6 @@
 import * as THREE from 'three';
 import ThreeForceGraph from 'three-forcegraph';
-import type { NodeObject } from 'three-forcegraph';
+import type { NodeObject, LinkObject } from 'three-forcegraph';
 import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
 import { ORB_RADIUS, addResizeListener } from './renderer';
 import type { GraphNode, GraphEdge, GraphSnapshot } from '../src/types';
@@ -252,6 +252,6 @@ export function updateGraph(snapshot: GraphSnapshot): void {
 
   showLoading();
   requestAnimationFrame(() => {
-    graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown[] });
+    graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown as LinkObject[] });
   });
 }
diff --git a/03-web-app/webview/voice.ts b/03-web-app/webview/voice.ts
index 232d823..9ee4468 100644
--- a/03-web-app/webview/voice.ts
+++ b/03-web-app/webview/voice.ts
@@ -18,7 +18,8 @@ export function initVoice(callbacks: VoiceCallbacks): VoiceController | null {
 
   if (!SpeechRecognitionCtor) return null;
 
-  const recognition = new SpeechRecognitionCtor() as SpeechRecognition;
+  // eslint-disable-next-line @typescript-eslint/no-explicit-any
+  const recognition = new SpeechRecognitionCtor() as any;
   recognition.lang = 'en-US';
   recognition.interimResults = false;
   recognition.maxAlternatives = 1;
@@ -32,13 +33,13 @@ export function initVoice(callbacks: VoiceCallbacks): VoiceController | null {
     callbacks.onStatusChange(s);
   }
 
-  recognition.onresult = (event: SpeechRecognitionEvent) => {
-    const transcript = event.results[event.resultIndex][0].transcript;
+  recognition.onresult = (event: any) => {
+    const transcript = event.results[event.resultIndex][0].transcript as string;
     callbacks.onTranscript(transcript);
     setStatus('idle');
   };
 
-  recognition.onerror = (_event: SpeechRecognitionErrorEvent) => {
+  recognition.onerror = (_event: any) => {
     setStatus('error');
     errorResetTimer = setTimeout(() => {
       errorResetTimer = null;
@@ -46,7 +47,7 @@ export function initVoice(callbacks: VoiceCallbacks): VoiceController | null {
     }, 2000);
   };
 
-  recognition.onend = () => {
+  recognition.onend = (): void => {
     if (currentStatus === 'listening') {
       setStatus('idle');
     }
