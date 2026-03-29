diff --git a/03-web-app/src/main.ts b/03-web-app/src/main.ts
index 3423ce2..fbbd47f 100644
--- a/03-web-app/src/main.ts
+++ b/03-web-app/src/main.ts
@@ -1,5 +1,6 @@
 import { createScene } from '../webview/renderer';
 import { updateGraph, getGraphInstance, initOrb, updateRenderPositions } from '../webview/orb';
+import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
 import type { WsMessage } from './types';
 
 const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
@@ -9,10 +10,12 @@ const graphOrb = getGraphInstance();
 scene.add(graphOrb);
 
 initOrb(scene);
+initAnimation(scene);
 
-startAnimationLoop(() => {
+startAnimationLoop((delta: number) => {
   graphOrb.tickFrame();
   updateRenderPositions();
+  tickBreathing(delta * 1000);
 });
 
 // Browser WebSocket — connects to the DevNeural Python server
@@ -26,8 +29,18 @@ function connect(): void {
       const msg = JSON.parse(event.data as string) as WsMessage;
       if (msg.type === 'graph:snapshot') {
         updateGraph(msg.payload);
+        onSnapshot(msg.payload.edges.map(e => ({
+          id: e.id,
+          last_seen: new Date(e.last_seen).getTime(),
+        })));
+      }
+      if (msg.type === 'connection:new') {
+        onConnectionNew({
+          source: msg.payload.source,
+          target: msg.payload.target,
+          connectionType: msg.payload.connection_type,
+        });
       }
-      // connection:new handler wired in section-02-animation
     } catch {
       // ignore malformed messages
     }
diff --git a/03-web-app/webview/__tests__/animation.test.ts b/03-web-app/webview/__tests__/animation.test.ts
new file mode 100644
index 0000000..b821309
--- /dev/null
+++ b/03-web-app/webview/__tests__/animation.test.ts
@@ -0,0 +1,301 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect, beforeEach } from 'vitest';
+
+// ── Mocks ─────────────────────────────────────────────────────────────────────
+
+const mockSceneAdd = vi.fn();
+const mockSceneRemove = vi.fn();
+const mockScene = { add: mockSceneAdd, remove: mockSceneRemove };
+
+vi.mock('three', async (importOriginal) => {
+  const actual = await importOriginal<typeof import('three')>();
+  return {
+    ...actual,
+    Vector2: class Vector2 {
+      x: number; y: number;
+      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
+    },
+  };
+});
+
+vi.mock('three/examples/jsm/lines/Line2.js', () => ({
+  Line2: class MockLine2 {
+    geometry: unknown;
+    material: unknown;
+    constructor(geo: unknown, mat: unknown) {
+      this.geometry = geo;
+      this.material = mat;
+    }
+    computeLineDistances() { return this; }
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
+  LineMaterial: class MockLineMaterial {
+    color = { set: vi.fn() };
+    opacity = 1.0;
+    transparent = false;
+    emissiveIntensity = 0;
+    linewidth = 1.5;
+    constructor(_params: unknown) {}
+    dispose = vi.fn();
+  },
+}));
+
+vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
+  LineGeometry: class MockLineGeometry {
+    setPositions(_arr: number[]) {}
+    dispose = vi.fn();
+  },
+}));
+
+// ── Helpers ───────────────────────────────────────────────────────────────────
+
+function makeMockLine2(
+  edgeId: string,
+  source: string,
+  target: string
+): {
+  line: { geometry: unknown; material: { opacity: number; transparent: boolean; emissiveIntensity: number; dispose: () => void }; geometry_dispose?: () => void };
+  id: string;
+  source: string;
+  target: string;
+} {
+  const material = {
+    opacity: 1.0,
+    transparent: false,
+    emissiveIntensity: 0,
+    dispose: vi.fn(),
+  };
+  const geometry = { setPositions: vi.fn(), dispose: vi.fn() };
+  const line = { geometry, material };
+  return { line: line as unknown as typeof line, id: edgeId, source, target };
+}
+
+// ── Imports (after mocks) ─────────────────────────────────────────────────────
+
+import {
+  initAnimation,
+  registerEdges,
+  onConnectionNew,
+  onSnapshot,
+  setRecencyFadingEnabled,
+  computeRelativeRecency,
+  applyRecencyOpacity,
+  breathe,
+  _resetState,
+  _getEphemeralEdges,
+  _getActiveEdgeIds,
+} from '../animation';
+
+// ── Test setup ────────────────────────────────────────────────────────────────
+
+beforeEach(() => {
+  _resetState();
+  mockSceneAdd.mockClear();
+  mockSceneRemove.mockClear();
+  vi.useRealTimers();
+});
+
+// ═══════════════════════════════════════════════════════════════════════════════
+// Live Connection Glow
+// ═══════════════════════════════════════════════════════════════════════════════
+
+describe('Live Connection Glow', () => {
+  it('on connection:new, the corresponding edge material emissiveIntensity is boosted', () => {
+    initAnimation(mockScene as unknown as import('three').Scene);
+
+    const { line, id, source, target } = makeMockLine2('e1', 'A', 'B');
+    const edgeLines = new Map([[id, line as unknown as import('three/examples/jsm/lines/Line2.js').Line2]]);
+    const edgeData = [{ id, source, target }];
+    registerEdges(edgeLines, edgeData);
+
+    onConnectionNew({ source: 'A', target: 'B', connectionType: 'import' });
+
+    expect((line.material as { emissiveIntensity: number }).emissiveIntensity).toBe(1.0);
+  });
+
+  it('on connection:new for a non-existent edge, an ephemeral edge is created', () => {
+    initAnimation(mockScene as unknown as import('three').Scene);
+    registerEdges(new Map(), []);
+
+    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });
+
+    const ephemeral = _getEphemeralEdges();
+    expect(ephemeral.size).toBe(1);
+    expect(ephemeral.has('X:Y')).toBe(true);
+  });
+
+  it('ephemeral edge has weight 1.0, first_seen = Date.now(), last_seen = Date.now(), raw_count = 1', () => {
+    vi.useFakeTimers();
+    const fixedTime = 1_700_000_000_000;
+    vi.setSystemTime(fixedTime);
+
+    initAnimation(mockScene as unknown as import('three').Scene);
+    registerEdges(new Map(), []);
+
+    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });
+
+    const entry = _getEphemeralEdges().get('X:Y')!;
+    expect(entry).toBeDefined();
+    expect(entry.data.weight).toBe(1.0);
+    expect(entry.data.first_seen).toBe(fixedTime);
+    expect(entry.data.last_seen).toBe(fixedTime);
+    expect(entry.data.raw_count).toBe(1);
+  });
+
+  it('on next graph:snapshot, all active glow flags are cleared', () => {
+    initAnimation(mockScene as unknown as import('three').Scene);
+
+    const { line, id, source, target } = makeMockLine2('e1', 'A', 'B');
+    const edgeLines = new Map([[id, line as unknown as import('three/examples/jsm/lines/Line2.js').Line2]]);
+    registerEdges(edgeLines, [{ id, source, target }]);
+
+    onConnectionNew({ source: 'A', target: 'B', connectionType: 'import' });
+    expect(_getActiveEdgeIds().size).toBe(1);
+
+    onSnapshot([{ id: 'e1', last_seen: Date.now() }]);
+    expect(_getActiveEdgeIds().size).toBe(0);
+  });
+
+  it('on next graph:snapshot, all ephemeral edges are removed from the scene', () => {
+    initAnimation(mockScene as unknown as import('three').Scene);
+    registerEdges(new Map(), []);
+
+    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });
+    expect(mockSceneAdd).toHaveBeenCalledTimes(1);
+    expect(_getEphemeralEdges().size).toBe(1);
+
+    onSnapshot([]);
+    expect(mockSceneRemove).toHaveBeenCalledTimes(1);
+    expect(_getEphemeralEdges().size).toBe(0);
+  });
+});
+
+// ═══════════════════════════════════════════════════════════════════════════════
+// Recency Fading — computeRelativeRecency
+// ═══════════════════════════════════════════════════════════════════════════════
+
+describe('computeRelativeRecency', () => {
+  it('most recently active edge gets score 1.0', () => {
+    const edges = [
+      { id: 'e1', last_seen: 1000 },
+      { id: 'e2', last_seen: 2000 },
+      { id: 'e3', last_seen: 3000 },
+    ];
+    const scores = computeRelativeRecency(edges);
+    expect(scores.get('e3')).toBe(1.0);
+  });
+
+  it('least recently active edge gets score 0.0', () => {
+    const edges = [
+      { id: 'e1', last_seen: 1000 },
+      { id: 'e2', last_seen: 2000 },
+      { id: 'e3', last_seen: 3000 },
+    ];
+    const scores = computeRelativeRecency(edges);
+    expect(scores.get('e1')).toBe(0.0);
+  });
+
+  it('all edges same last_seen → all scores 1.0 (no fading)', () => {
+    const edges = [
+      { id: 'e1', last_seen: 5000 },
+      { id: 'e2', last_seen: 5000 },
+      { id: 'e3', last_seen: 5000 },
+    ];
+    const scores = computeRelativeRecency(edges);
+    expect(scores.get('e1')).toBe(1.0);
+    expect(scores.get('e2')).toBe(1.0);
+    expect(scores.get('e3')).toBe(1.0);
+  });
+
+  it('single-edge graph → score 1.0 (no range → no fading)', () => {
+    const scores = computeRelativeRecency([{ id: 'e1', last_seen: 9999 }]);
+    expect(scores.get('e1')).toBe(1.0);
+  });
+});
+
+// ═══════════════════════════════════════════════════════════════════════════════
+// Recency Fading — applyRecencyOpacity
+// ═══════════════════════════════════════════════════════════════════════════════
+
+describe('applyRecencyOpacity', () => {
+  it('edge with score 1.0 has opacity 1.0', () => {
+    const mat = { opacity: 0, transparent: false };
+    const materials = new Map([['e1', mat]]);
+    const scores = new Map([['e1', 1.0]]);
+    applyRecencyOpacity(materials, scores, true);
+    expect(mat.opacity).toBe(1.0);
+  });
+
+  it('edge with score 0.0 has opacity 0.2', () => {
+    const mat = { opacity: 0, transparent: false };
+    const materials = new Map([['e1', mat]]);
+    const scores = new Map([['e1', 0.0]]);
+    applyRecencyOpacity(materials, scores, true);
+    expect(mat.opacity).toBeCloseTo(0.2, 5);
+  });
+
+  it('edge with score 0.5 has opacity ~0.6 (linear: 0.2 + score * 0.8)', () => {
+    const mat = { opacity: 0, transparent: false };
+    const materials = new Map([['e1', mat]]);
+    const scores = new Map([['e1', 0.5]]);
+    applyRecencyOpacity(materials, scores, true);
+    expect(mat.opacity).toBeCloseTo(0.6, 5);
+  });
+
+  it('recency uses material.opacity and does NOT modify material.emissiveIntensity', () => {
+    const mat = { opacity: 0, transparent: false, emissiveIntensity: 0.7 };
+    const materials = new Map([['e1', mat as { opacity: number; transparent: boolean }]]);
+    const scores = new Map([['e1', 0.5]]);
+    applyRecencyOpacity(materials, scores, true);
+    // emissiveIntensity must be untouched
+    expect((mat as { emissiveIntensity: number }).emissiveIntensity).toBe(0.7);
+  });
+
+  it('when recencyFading = false, all edges have opacity 1.0 regardless of scores', () => {
+    const mat1 = { opacity: 0, transparent: true };
+    const mat2 = { opacity: 0, transparent: true };
+    const materials = new Map([['e1', mat1], ['e2', mat2]]);
+    const scores = new Map([['e1', 0.0], ['e2', 0.3]]);
+    applyRecencyOpacity(materials, scores, false);
+    expect(mat1.opacity).toBe(1.0);
+    expect(mat2.opacity).toBe(1.0);
+    expect(mat1.transparent).toBe(false);
+    expect(mat2.transparent).toBe(false);
+  });
+});
+
+// ═══════════════════════════════════════════════════════════════════════════════
+// Ambient Breathing
+// ═══════════════════════════════════════════════════════════════════════════════
+
+describe('breathe', () => {
+  it('breathe(t=0) returns emissiveIntensity 0.0 (minimum)', () => {
+    const { emissiveIntensity } = breathe(0, 0);
+    expect(emissiveIntensity).toBeCloseTo(0.0, 5);
+  });
+
+  it('breathe(t=period/2 = 1500) returns emissiveIntensity ~0.4 (maximum)', () => {
+    const { emissiveIntensity } = breathe(1500, 0);
+    expect(emissiveIntensity).toBeCloseTo(0.4, 5);
+  });
+
+  it('breathe uses emissiveIntensity channel only — does NOT modify opacity', () => {
+    const result = breathe(500, 0);
+    expect(result).not.toHaveProperty('opacity');
+    expect(result).toHaveProperty('emissiveIntensity');
+    expect(result).toHaveProperty('scaleFactor');
+  });
+
+  it('node scale at breathe(t=0, nodeIndex=0) is 1.0 (base scale)', () => {
+    const { scaleFactor } = breathe(0, 0);
+    expect(scaleFactor).toBeCloseTo(1.0, 5);
+  });
+
+  it('node scale at t=5000 differs between nodeIndex=0 and nodeIndex=5', () => {
+    const r0 = breathe(5000, 0);
+    const r5 = breathe(5000, 5);
+    expect(r0.scaleFactor).not.toBeCloseTo(r5.scaleFactor, 3);
+  });
+});
diff --git a/03-web-app/webview/animation.ts b/03-web-app/webview/animation.ts
index 72ae86a..5944035 100644
--- a/03-web-app/webview/animation.ts
+++ b/03-web-app/webview/animation.ts
@@ -1,2 +1,249 @@
-// Implemented in section-02-animation through section-05-voice
-export {};
+import * as THREE from 'three';
+import { Line2 } from 'three/examples/jsm/lines/Line2.js';
+import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
+import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
+
+// ── Types ─────────────────────────────────────────────────────────────────────
+
+interface MaterialWithGlow {
+  emissiveIntensity: number;
+}
+
+interface MaterialOpacity {
+  opacity: number;
+  transparent: boolean;
+}
+
+interface EphemeralEdgeEntry {
+  line: Line2;
+  data: {
+    id: string;
+    source: string;
+    target: string;
+    weight: number;
+    first_seen: number;
+    last_seen: number;
+    raw_count: number;
+  };
+}
+
+// ── Module-level state ────────────────────────────────────────────────────────
+
+let _scene: THREE.Scene | null = null;
+let _edgeLines: Map<string, Line2> = new Map();
+let _edgeLookup: Map<string, string> = new Map(); // "source:target" → edgeId
+let _activeEdgeIds: Set<string> = new Set();
+let _ephemeralEdges: Map<string, EphemeralEdgeEntry> = new Map(); // "source:target" → entry
+let _recencyFadingEnabled = true;
+
+// ── Public API ────────────────────────────────────────────────────────────────
+
+export function initAnimation(scene: THREE.Scene): void {
+  _scene = scene;
+}
+
+/**
+ * Called by orb.ts after each graph update so animation can track active edges.
+ */
+export function registerEdges(
+  edgeLines: Map<string, Line2>,
+  edgeData: Array<{ id: string; source: string; target: string }>
+): void {
+  _edgeLines = edgeLines;
+  _edgeLookup = new Map();
+  for (const e of edgeData) {
+    _edgeLookup.set(`${e.source}:${e.target}`, e.id);
+  }
+}
+
+export function onConnectionNew(payload: {
+  source: string;
+  target: string;
+  connectionType: string;
+}): void {
+  const key = `${payload.source}:${payload.target}`;
+
+  // Boost glow on an existing edge
+  const edgeId = _edgeLookup.get(key);
+  if (edgeId !== undefined) {
+    const line = _edgeLines.get(edgeId);
+    if (line) {
+      (line.material as unknown as MaterialWithGlow).emissiveIntensity = 1.0;
+      _activeEdgeIds.add(edgeId);
+      return;
+    }
+  }
+
+  // Edge not yet in graph — create an ephemeral Line2
+  if (!_ephemeralEdges.has(key) && _scene) {
+    const now = Date.now();
+    const geometry = new LineGeometry();
+    geometry.setPositions([0, 0, 0, 0, 0, 0]);
+    const material = new LineMaterial({
+      color: 0xffffff,
+      linewidth: 2.0,
+      resolution: new THREE.Vector2(1280, 720),
+    });
+    (material as unknown as MaterialWithGlow).emissiveIntensity = 1.0;
+    const line = new Line2(geometry, material);
+    _scene.add(line);
+    _ephemeralEdges.set(key, {
+      line,
+      data: {
+        id: key,
+        source: payload.source,
+        target: payload.target,
+        weight: 1.0,
+        first_seen: now,
+        last_seen: now,
+        raw_count: 1,
+      },
+    });
+  }
+}
+
+export function onSnapshot(edges: Array<{ id: string; last_seen: number }>): void {
+  // Clear active glow flags
+  for (const edgeId of _activeEdgeIds) {
+    const line = _edgeLines.get(edgeId);
+    if (line) {
+      (line.material as unknown as MaterialWithGlow).emissiveIntensity = 0.0;
+    }
+  }
+  _activeEdgeIds.clear();
+
+  // Remove and dispose ephemeral edges
+  if (_scene) {
+    for (const entry of _ephemeralEdges.values()) {
+      _scene.remove(entry.line);
+      (entry.line.geometry as { dispose?: () => void }).dispose?.();
+      (entry.line.material as { dispose?: () => void }).dispose?.();
+    }
+  }
+  _ephemeralEdges.clear();
+
+  // Apply recency fading
+  const recencyScores = computeRelativeRecency(edges);
+  const edgeMaterials = new Map<string, MaterialOpacity>();
+  for (const [id, line] of _edgeLines) {
+    edgeMaterials.set(id, line.material as unknown as MaterialOpacity);
+  }
+  applyRecencyOpacity(edgeMaterials, recencyScores, _recencyFadingEnabled);
+}
+
+export function setRecencyFadingEnabled(enabled: boolean): void {
+  _recencyFadingEnabled = enabled;
+}
+
+export function tickBreathing(elapsedMs: number): void {
+  let index = 0;
+  for (const [edgeId, line] of _edgeLines) {
+    // Don't override active glow with breathing oscillation
+    if (!_activeEdgeIds.has(edgeId)) {
+      const { emissiveIntensity } = breathe(elapsedMs, index);
+      (line.material as unknown as MaterialWithGlow).emissiveIntensity = emissiveIntensity;
+    }
+    index++;
+  }
+}
+
+// ── Pure functions ────────────────────────────────────────────────────────────
+
+/**
+ * Computes relative recency scores [0.0, 1.0] across a set of edges.
+ * Most recently active edge → 1.0; least recently active → 0.0.
+ * All-equal or single edge → all 1.0.
+ */
+export function computeRelativeRecency(
+  edges: Array<{ id: string; last_seen: number }>
+): Map<string, number> {
+  const scores = new Map<string, number>();
+  if (edges.length === 0) return scores;
+
+  if (edges.length === 1) {
+    scores.set(edges[0].id, 1.0);
+    return scores;
+  }
+
+  const times = edges.map(e => e.last_seen);
+  const minTime = Math.min(...times);
+  const maxTime = Math.max(...times);
+  const range = maxTime - minTime;
+
+  if (range === 0) {
+    for (const e of edges) scores.set(e.id, 1.0);
+  } else {
+    for (const e of edges) {
+      scores.set(e.id, (e.last_seen - minTime) / range);
+    }
+  }
+
+  return scores;
+}
+
+/**
+ * Applies recency opacity to edge materials.
+ * opacity = 0.2 + score * 0.8. Does not touch emissiveIntensity.
+ */
+export function applyRecencyOpacity(
+  edgeMaterials: Map<string, { opacity: number; transparent: boolean }>,
+  recencyScores: Map<string, number>,
+  fadingEnabled: boolean
+): void {
+  for (const [id, material] of edgeMaterials) {
+    if (!fadingEnabled) {
+      material.opacity = 1.0;
+      material.transparent = false;
+    } else {
+      const score = recencyScores.get(id) ?? 1.0;
+      material.opacity = 0.2 + score * 0.8;
+      material.transparent = material.opacity < 1.0;
+    }
+  }
+}
+
+/**
+ * Returns emissiveIntensity and scaleFactor for a given elapsed time and node index.
+ * emissiveIntensity: 3000ms period, range [0.0, 0.4]
+ *   formula: 0.2 * (1 - cos(2π * t / 3000))
+ * scaleFactor: 5000ms period with per-node offset (nodeIndex * 100ms)
+ *   formula: 1.0 + 0.03 * sin(2π * (t + nodeIndex * 100) / 5000)
+ */
+export function breathe(
+  elapsedMs: number,
+  nodeIndex: number
+): { emissiveIntensity: number; scaleFactor: number } {
+  const emissivePeriod = 3000;
+  const scalePeriod = 5000;
+
+  const emissiveIntensity =
+    0.2 * (1 - Math.cos((2 * Math.PI * elapsedMs) / emissivePeriod));
+
+  const scaleOffset = nodeIndex * 100;
+  const scaleFactor =
+    1.0 + 0.03 * Math.sin((2 * Math.PI * (elapsedMs + scaleOffset)) / scalePeriod);
+
+  return { emissiveIntensity, scaleFactor };
+}
+
+// ── Test helpers ──────────────────────────────────────────────────────────────
+
+/** Resets all module state. Used in tests only. */
+export function _resetState(): void {
+  _scene = null;
+  _edgeLines = new Map();
+  _edgeLookup = new Map();
+  _activeEdgeIds = new Set();
+  _ephemeralEdges = new Map();
+  _recencyFadingEnabled = true;
+}
+
+/** Exposes ephemeral edge map for test assertions. */
+export function _getEphemeralEdges(): Map<string, EphemeralEdgeEntry> {
+  return _ephemeralEdges;
+}
+
+/** Exposes active edge IDs set for test assertions. */
+export function _getActiveEdgeIds(): Set<string> {
+  return _activeEdgeIds;
+}
diff --git a/03-web-app/webview/edges.ts b/03-web-app/webview/edges.ts
index 6a28ce4..935df86 100644
--- a/03-web-app/webview/edges.ts
+++ b/03-web-app/webview/edges.ts
@@ -94,6 +94,15 @@ export function updateEdgePositions(
   }
 }
 
+/** Returns a map of edge ID → LineMaterial for animation module use. */
+export function getEdgeMaterials(edgeLines: Map<string, Line2>): Map<string, LineMaterial> {
+  const materials = new Map<string, LineMaterial>();
+  for (const [id, line] of edgeLines) {
+    materials.set(id, line.material as LineMaterial);
+  }
+  return materials;
+}
+
 /** Applies new colors to existing Line2 materials. */
 export function applyEdgeColors(
   edgeLines: Map<string, Line2>,
diff --git a/03-web-app/webview/orb.ts b/03-web-app/webview/orb.ts
index 258614c..29e8b41 100644
--- a/03-web-app/webview/orb.ts
+++ b/03-web-app/webview/orb.ts
@@ -15,6 +15,7 @@ import {
   updateEdgePositions,
   type EdgeRenderData,
 } from './edges';
+import { registerEdges } from './animation';
 import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
 
 export type { GraphSnapshot };
@@ -226,6 +227,7 @@ export function updateGraph(snapshot: GraphSnapshot): void {
     const colorMap = computeRelativeColor(links);
     currentEdgeLines = createEdgeLines(links, colorMap);
     currentEdgeLines.forEach(line => currentScene!.add(line));
+    registerEdges(currentEdgeLines, links.map(l => ({ id: l.id, source: l.source, target: l.target })));
 
     // Wire LineMaterial resolution updates so line thickness stays correct on resize
     addResizeListener((w, h) => {
