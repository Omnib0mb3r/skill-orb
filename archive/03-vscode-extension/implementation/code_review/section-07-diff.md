diff --git a/03-vscode-extension/webview/__tests__/edges.test.ts b/03-vscode-extension/webview/__tests__/edges.test.ts
new file mode 100644
index 0000000..a073da9
--- /dev/null
+++ b/03-vscode-extension/webview/__tests__/edges.test.ts
@@ -0,0 +1,115 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect } from 'vitest';
+
+// Mock Line classes to prevent JSM import side-effects in the test environment
+vi.mock('three/examples/jsm/lines/Line2.js', () => ({
+  Line2: class Line2 {
+    geometry: unknown;
+    material: unknown;
+    constructor(geo: unknown, mat: unknown) {
+      this.geometry = geo;
+      this.material = mat;
+    }
+    computeLineDistances() { return this; }
+  },
+}));
+vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
+  LineMaterial: class LineMaterial {
+    color = { set: vi.fn() };
+    constructor(_params: unknown) {}
+  },
+}));
+vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
+  LineGeometry: class LineGeometry {
+    setPositions(_arr: number[]) {}
+  },
+}));
+
+import { computeRelativeColor } from '../edges';
+
+// ── computeRelativeColor ──────────────────────────────────────────────────────
+
+describe('computeRelativeColor', () => {
+  it('all equal weights return the same color for all edges', () => {
+    const edges = [
+      { id: 'e1', weight: 0.5 },
+      { id: 'e2', weight: 0.5 },
+      { id: 'e3', weight: 0.5 },
+    ];
+    const result = computeRelativeColor(edges);
+
+    const hsl1 = { h: 0, s: 0, l: 0 };
+    const hsl2 = { h: 0, s: 0, l: 0 };
+    result.get('e1')!.getHSL(hsl1);
+    result.get('e2')!.getHSL(hsl2);
+    expect(hsl1.h).toBeCloseTo(hsl2.h, 5);
+    expect(hsl1.s).toBeCloseTo(hsl2.s, 5);
+    expect(hsl1.l).toBeCloseTo(hsl2.l, 5);
+  });
+
+  it('weight 0.0 (min) maps to cool blue — hue > 180 degrees', () => {
+    const edges = [
+      { id: 'e1', weight: 0.0 },
+      { id: 'e2', weight: 1.0 },
+    ];
+    const result = computeRelativeColor(edges);
+    const hsl = { h: 0, s: 0, l: 0 };
+    result.get('e1')!.getHSL(hsl);
+    expect(hsl.h * 360).toBeGreaterThan(180);
+  });
+
+  it('weight 1.0 (max) maps to warm red/orange — hue < 30 degrees', () => {
+    const edges = [
+      { id: 'e1', weight: 0.0 },
+      { id: 'e2', weight: 1.0 },
+    ];
+    const result = computeRelativeColor(edges);
+    const hsl = { h: 0, s: 0, l: 0 };
+    result.get('e2')!.getHSL(hsl);
+    expect(hsl.h * 360).toBeLessThan(30);
+  });
+
+  it('mid-range weight maps to cyan/green — hue between 120 and 180 degrees', () => {
+    const edges = [
+      { id: 'e1', weight: 0.0 },
+      { id: 'mid', weight: 0.5 },
+      { id: 'e3', weight: 1.0 },
+    ];
+    const result = computeRelativeColor(edges);
+    const hsl = { h: 0, s: 0, l: 0 };
+    result.get('mid')!.getHSL(hsl);
+    const hueDegrees = hsl.h * 360;
+    expect(hueDegrees).toBeGreaterThanOrEqual(120);
+    expect(hueDegrees).toBeLessThanOrEqual(180);
+  });
+
+  it('is a pure function — same input always produces same output', () => {
+    const edges = [
+      { id: 'e1', weight: 0.3 },
+      { id: 'e2', weight: 0.7 },
+    ];
+    const r1 = computeRelativeColor(edges);
+    const r2 = computeRelativeColor(edges);
+
+    const hsl1 = { h: 0, s: 0, l: 0 };
+    const hsl2 = { h: 0, s: 0, l: 0 };
+    r1.get('e1')!.getHSL(hsl1);
+    r2.get('e1')!.getHSL(hsl2);
+    expect(hsl1.h).toBeCloseTo(hsl2.h, 5);
+    expect(hsl1.s).toBeCloseTo(hsl2.s, 5);
+    expect(hsl1.l).toBeCloseTo(hsl2.l, 5);
+  });
+
+  it('returns Map keyed by edge id with exactly one entry per edge', () => {
+    const edges = [
+      { id: 'e1', weight: 0.1 },
+      { id: 'e2', weight: 0.5 },
+      { id: 'e3', weight: 0.9 },
+    ];
+    const result = computeRelativeColor(edges);
+    expect(result.size).toBe(3);
+    expect(result.has('e1')).toBe(true);
+    expect(result.has('e2')).toBe(true);
+    expect(result.has('e3')).toBe(true);
+  });
+});
diff --git a/03-vscode-extension/webview/__tests__/nodes.test.ts b/03-vscode-extension/webview/__tests__/nodes.test.ts
new file mode 100644
index 0000000..ac8f355
--- /dev/null
+++ b/03-vscode-extension/webview/__tests__/nodes.test.ts
@@ -0,0 +1,160 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect } from 'vitest';
+import * as THREE from 'three';
+
+// Hoist MockInstancedMesh so vi.mock factory can reference it without temporal dead zone
+const { MockInstancedMesh } = vi.hoisted(() => {
+  class MockInstancedMesh {
+    geometry: unknown;
+    material: unknown;
+    count: number;
+    instanceMatrix: { needsUpdate: boolean } = { needsUpdate: false };
+    instanceColor: { needsUpdate: boolean } | null = null;
+    private _matrices = new Map<number, number[]>();
+
+    constructor(geo: unknown, mat: unknown, count: number) {
+      this.geometry = geo;
+      this.material = mat;
+      this.count = count;
+    }
+
+    setMatrixAt(index: number, matrix: { elements: ArrayLike<number> }): void {
+      this._matrices.set(index, Array.from(matrix.elements));
+    }
+
+    getMatrixAt(index: number, target: { fromArray: (arr: number[]) => void }): void {
+      const stored = this._matrices.get(index);
+      if (stored) target.fromArray(stored);
+    }
+
+    setColorAt(index: number, _color: unknown): void {
+      if (!this.instanceColor) this.instanceColor = { needsUpdate: false };
+      void index;
+    }
+  }
+  return { MockInstancedMesh };
+});
+
+// Replace only InstancedMesh; keep all real Three.js classes for geometry, math, etc.
+vi.mock('three', async () => {
+  const actual = await vi.importActual<typeof THREE>('three');
+  return { ...actual, InstancedMesh: MockInstancedMesh };
+});
+
+import {
+  createNodeMeshes,
+  setNodePositions,
+  setNodeColor,
+  stageColor,
+  nodeIndexMap,
+  type NodeRenderData,
+} from '../nodes';
+
+// ── createNodeMeshes ──────────────────────────────────────────────────────────
+
+describe('createNodeMeshes', () => {
+  it('creates exactly 3 distinct non-badge InstancedMesh objects (project, tool, skill)', () => {
+    const m = createNodeMeshes(10);
+    expect(m.projectMesh).toBeInstanceOf(MockInstancedMesh);
+    expect(m.toolMesh).toBeInstanceOf(MockInstancedMesh);
+    expect(m.skillMesh).toBeInstanceOf(MockInstancedMesh);
+    expect(m.projectMesh).not.toBe(m.toolMesh);
+    expect(m.toolMesh).not.toBe(m.skillMesh);
+    expect(m.skillMesh).not.toBe(m.projectMesh);
+  });
+
+  it('creates 1 InstancedMesh for stage badges distinct from type meshes', () => {
+    const m = createNodeMeshes(10);
+    expect(m.badgeMesh).toBeInstanceOf(MockInstancedMesh);
+    expect(m.badgeMesh).not.toBe(m.projectMesh);
+    expect(m.badgeMesh).not.toBe(m.toolMesh);
+    expect(m.badgeMesh).not.toBe(m.skillMesh);
+  });
+
+  it('project InstancedMesh uses BoxGeometry with strongly unequal dimensions', () => {
+    const m = createNodeMeshes(10);
+    expect(m.projectMesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
+    const geo = m.projectMesh.geometry as THREE.BoxGeometry;
+    const { width, height, depth } = geo.parameters;
+    const dims = [width, height, depth];
+    const ratio = Math.max(...dims) / Math.min(...dims);
+    // 1.2 / 0.15 = 8 — strongly unequal
+    expect(ratio).toBeGreaterThan(4);
+  });
+
+  it('skill InstancedMesh uses OctahedronGeometry', () => {
+    const m = createNodeMeshes(10);
+    expect(m.skillMesh.geometry).toBeInstanceOf(THREE.OctahedronGeometry);
+  });
+});
+
+// ── setNodePositions ──────────────────────────────────────────────────────────
+
+describe('setNodePositions', () => {
+  it('updates Matrix4 for each instance and sets instanceMatrix.needsUpdate', () => {
+    const m = createNodeMeshes(10);
+    const nodes: NodeRenderData[] = [
+      { id: 'p1', type: 'project', x: 1, y: 2, z: 3 },
+      { id: 't1', type: 'tool', x: 4, y: 5, z: 6 },
+    ];
+    setNodePositions(nodes, m);
+
+    expect(m.projectMesh.instanceMatrix.needsUpdate).toBe(true);
+    expect(m.toolMesh.instanceMatrix.needsUpdate).toBe(true);
+
+    // Verify the project node got the right position
+    const mat = new THREE.Matrix4();
+    (m.projectMesh as unknown as InstanceType<typeof MockInstancedMesh>).getMatrixAt(0, mat);
+    const pos = new THREE.Vector3();
+    const quat = new THREE.Quaternion();
+    const scale = new THREE.Vector3();
+    mat.decompose(pos, quat, scale);
+    expect(pos.x).toBeCloseTo(1);
+    expect(pos.y).toBeCloseTo(2);
+    expect(pos.z).toBeCloseTo(3);
+    expect(scale.x).toBeCloseTo(1);
+  });
+
+  it('badge InstancedMesh scale is zero for project node with no stage', () => {
+    const m = createNodeMeshes(10);
+    const nodes: NodeRenderData[] = [{ id: 'p1', type: 'project', x: 5, y: 5, z: 5 }];
+    setNodePositions(nodes, m);
+
+    // Access stored elements directly — avoids fromArray/decompose roundtrip
+    // makeScale(0,0,0) elements: te[0]=0 (sx), te[5]=0 (sy), te[10]=0 (sz)
+    const stored = (m.badgeMesh as any)._matrices.get(0) as number[] | undefined;
+    expect(stored).toBeDefined();
+    expect(stored![0]).toBeCloseTo(0);   // te[0] = sx
+    expect(stored![5]).toBeCloseTo(0);   // te[5] = sy
+    expect(stored![10]).toBeCloseTo(0);  // te[10] = sz
+  });
+});
+
+// ── setNodeColor ──────────────────────────────────────────────────────────────
+
+describe('setNodeColor', () => {
+  it('sets instanceColor.needsUpdate to true after call', () => {
+    const m = createNodeMeshes(10);
+    setNodePositions([{ id: 'a', type: 'project', x: 0, y: 0, z: 0 }], m);
+
+    setNodeColor('a', new THREE.Color(0xffffff), m, nodeIndexMap);
+
+    expect(m.projectMesh.instanceColor).not.toBeNull();
+    expect(m.projectMesh.instanceColor!.needsUpdate).toBe(true);
+  });
+});
+
+// ── stageColor ────────────────────────────────────────────────────────────────
+
+describe('stageColor', () => {
+  it('returns distinct THREE.Color values for alpha, beta, deployed, archived', () => {
+    const stages = ['alpha', 'beta', 'deployed', 'archived'];
+    const colors = stages.map(stageColor);
+
+    colors.forEach(c => expect(c).toBeInstanceOf(THREE.Color));
+
+    // All four must be visually distinct (different hex values)
+    const hexes = colors.map(c => c.getHex());
+    expect(new Set(hexes).size).toBe(4);
+  });
+});
diff --git a/03-vscode-extension/webview/edges.ts b/03-vscode-extension/webview/edges.ts
index 9809c11..521d565 100644
--- a/03-vscode-extension/webview/edges.ts
+++ b/03-vscode-extension/webview/edges.ts
@@ -1,2 +1,106 @@
-// Implemented in section-07-rendering
-export {};
+import * as THREE from 'three';
+import { Line2 } from 'three/examples/jsm/lines/Line2.js';
+import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
+import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
+
+export interface EdgeRenderData {
+  id: string;
+  source: string;
+  target: string;
+  weight: number;
+}
+
+/**
+ * Normalizes the weight distribution across all edges onto a cool-to-warm gradient.
+ * If all weights are equal (zero range), every edge gets the warm end (normalized = 1.0).
+ * Pure function — no side effects, same input always produces the same output.
+ */
+export function computeRelativeColor(
+  edges: Array<{ id: string; weight: number }>
+): Map<string, THREE.Color> {
+  const result = new Map<string, THREE.Color>();
+  if (edges.length === 0) return result;
+
+  const weights = edges.map(e => e.weight);
+  const minWeight = Math.min(...weights);
+  const maxWeight = Math.max(...weights);
+  const range = maxWeight - minWeight;
+
+  for (const edge of edges) {
+    // Zero range → all equal, spec says use normalized = 1.0
+    const normalized = range === 0 ? 1.0 : (edge.weight - minWeight) / range;
+
+    // Cool-to-warm hue interpolation: 240° (blue) → 15° (orange/red)
+    const hue = 240 / 360 + normalized * (15 / 360 - 240 / 360);
+    const saturation = 0.8 + normalized * (0.9 - 0.8);
+    const lightness = 0.6 + normalized * (0.55 - 0.6);
+
+    result.set(edge.id, new THREE.Color().setHSL(hue, saturation, lightness));
+  }
+
+  return result;
+}
+
+/** Creates one Line2 per edge using the provided color map. */
+export function createEdgeLines(
+  edges: EdgeRenderData[],
+  colorMap: Map<string, THREE.Color>
+): Map<string, Line2> {
+  const lines = new Map<string, Line2>();
+
+  for (const edge of edges) {
+    const color = colorMap.get(edge.id) ?? new THREE.Color(0x888888);
+
+    const geometry = new LineGeometry();
+    geometry.setPositions([0, 0, 0, 0, 0, 0]);
+
+    const material = new LineMaterial({
+      color: color.getHex(),
+      linewidth: 1.5,
+      resolution: new THREE.Vector2(
+        typeof window !== 'undefined' ? window.innerWidth : 1280,
+        typeof window !== 'undefined' ? window.innerHeight : 720
+      ),
+    });
+
+    const line = new Line2(geometry, material);
+    line.computeLineDistances();
+    lines.set(edge.id, line);
+  }
+
+  return lines;
+}
+
+/** Updates Line2 geometry positions from the current force layout node positions. */
+export function updateEdgePositions(
+  edgeLines: Map<string, Line2>,
+  edges: EdgeRenderData[],
+  nodePositions: Map<string, THREE.Vector3>
+): void {
+  for (const edge of edges) {
+    const line = edgeLines.get(edge.id);
+    if (!line) continue;
+
+    const src = nodePositions.get(edge.source);
+    const dst = nodePositions.get(edge.target);
+    if (!src || !dst) continue;
+
+    (line.geometry as LineGeometry).setPositions([
+      src.x, src.y, src.z,
+      dst.x, dst.y, dst.z,
+    ]);
+    line.computeLineDistances();
+  }
+}
+
+/** Applies new colors to existing Line2 materials. */
+export function applyEdgeColors(
+  edgeLines: Map<string, Line2>,
+  colorMap: Map<string, THREE.Color>
+): void {
+  for (const [id, line] of edgeLines) {
+    const color = colorMap.get(id);
+    if (!color) continue;
+    (line.material as LineMaterial).color.set(color);
+  }
+}
diff --git a/03-vscode-extension/webview/main.ts b/03-vscode-extension/webview/main.ts
index cd70916..fa68cb9 100644
--- a/03-vscode-extension/webview/main.ts
+++ b/03-vscode-extension/webview/main.ts
@@ -1,14 +1,19 @@
 import { createScene } from './renderer';
-import { updateGraph, getGraphInstance } from './orb';
+import { updateGraph, getGraphInstance, initOrb, updateRenderPositions } from './orb';
 import type { GraphSnapshot } from '../src/types';
 
 const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
 const { scene, startAnimationLoop } = createScene(canvas);
-const graphOrb = getGraphInstance();
 
+const graphOrb = getGraphInstance();
 scene.add(graphOrb);
+
+// Initialize instanced mesh rendering and add node meshes to scene
+initOrb(scene);
+
 startAnimationLoop(() => {
   graphOrb.tickFrame();
+  updateRenderPositions();
 });
 
 window.addEventListener('message', (event: MessageEvent) => {
diff --git a/03-vscode-extension/webview/nodes.ts b/03-vscode-extension/webview/nodes.ts
index 9809c11..76221b1 100644
--- a/03-vscode-extension/webview/nodes.ts
+++ b/03-vscode-extension/webview/nodes.ts
@@ -1,2 +1,180 @@
-// Implemented in section-07-rendering
-export {};
+import * as THREE from 'three';
+
+export interface NodeRenderData {
+  id: string;
+  type: 'project' | 'tool' | 'skill';
+  x: number;
+  y: number;
+  z: number;
+  stage?: string;
+}
+
+// Module-level index map — populated by setNodePositions, consumed by section-09/10
+export const nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }> = new Map();
+
+// HSL tuples [hue, saturation, lightness] for stage badge colors (all visually distinct)
+const STAGE_COLORS: Record<string, [number, number, number]> = {
+  alpha:    [0.083, 0.95, 0.60],   // amber/gold
+  beta:     [0.556, 0.85, 0.65],   // cyan
+  deployed: [0.333, 0.90, 0.55],   // green
+  archived: [0.000, 0.00, 0.45],   // neutral grey (achromatic)
+};
+
+const DEFAULT_NODE_COLORS: Record<string, THREE.Color> = {
+  project: new THREE.Color(0x3388ff),
+  tool:    new THREE.Color(0x33cc77),
+  skill:   new THREE.Color(0xff7733),
+};
+
+/** Returns the badge color for a stage string. */
+export function stageColor(stage: string): THREE.Color {
+  const hsl = STAGE_COLORS[stage];
+  if (!hsl) return new THREE.Color(0x888888);
+  return new THREE.Color().setHSL(hsl[0], hsl[1], hsl[2]);
+}
+
+/**
+ * Creates the four InstancedMesh objects used for node rendering.
+ * maxNodes is the upper bound for all instance counts.
+ * All instances are initialized to zero-scale (invisible) until setNodePositions is called.
+ */
+export function createNodeMeshes(maxNodes: number): {
+  projectMesh: THREE.InstancedMesh;
+  toolMesh: THREE.InstancedMesh;
+  skillMesh: THREE.InstancedMesh;
+  badgeMesh: THREE.InstancedMesh;
+} {
+  const mat = new THREE.MeshPhongMaterial();
+
+  const projectMesh = new THREE.InstancedMesh(
+    new THREE.BoxGeometry(1.2, 0.15, 0.9),
+    mat.clone(),
+    maxNodes
+  );
+  const toolMesh = new THREE.InstancedMesh(
+    new THREE.BoxGeometry(0.8, 0.8, 0.8),
+    mat.clone(),
+    maxNodes
+  );
+  const skillMesh = new THREE.InstancedMesh(
+    new THREE.OctahedronGeometry(0.7),
+    mat.clone(),
+    maxNodes
+  );
+  const badgeMesh = new THREE.InstancedMesh(
+    new THREE.TorusGeometry(0.55, 0.06, 8, 24),
+    mat.clone(),
+    maxNodes
+  );
+
+  // Initialize all slots to zero scale (invisible)
+  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
+  for (let i = 0; i < maxNodes; i++) {
+    projectMesh.setMatrixAt(i, zeroMatrix);
+    toolMesh.setMatrixAt(i, zeroMatrix);
+    skillMesh.setMatrixAt(i, zeroMatrix);
+    badgeMesh.setMatrixAt(i, zeroMatrix);
+  }
+  projectMesh.instanceMatrix.needsUpdate = true;
+  toolMesh.instanceMatrix.needsUpdate = true;
+  skillMesh.instanceMatrix.needsUpdate = true;
+  badgeMesh.instanceMatrix.needsUpdate = true;
+
+  return { projectMesh, toolMesh, skillMesh, badgeMesh };
+}
+
+/**
+ * Updates all instance matrices from force layout positions.
+ * Uses a global index per node so all four meshes share the same slot numbering.
+ * Populates nodeIndexMap with the mesh and index for each node id.
+ */
+export function setNodePositions(
+  nodes: NodeRenderData[],
+  meshes: ReturnType<typeof createNodeMeshes>
+): void {
+  nodeIndexMap.clear();
+
+  const dummy = new THREE.Object3D();
+  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
+
+  nodes.forEach((node, globalIndex) => {
+    // Build visible node matrix at the node's force position
+    dummy.position.set(node.x, node.y, node.z);
+    dummy.scale.set(1, 1, 1);
+    dummy.rotation.set(0, 0, 0);
+    dummy.updateMatrix();
+    const nodeMatrix = dummy.matrix.clone();
+
+    // Show only the correct type mesh for this slot; zero the others
+    let nodeMesh: THREE.InstancedMesh;
+    if (node.type === 'project') {
+      nodeMesh = meshes.projectMesh;
+      meshes.projectMesh.setMatrixAt(globalIndex, nodeMatrix);
+      meshes.toolMesh.setMatrixAt(globalIndex, zeroMatrix);
+      meshes.skillMesh.setMatrixAt(globalIndex, zeroMatrix);
+    } else if (node.type === 'tool') {
+      nodeMesh = meshes.toolMesh;
+      meshes.projectMesh.setMatrixAt(globalIndex, zeroMatrix);
+      meshes.toolMesh.setMatrixAt(globalIndex, nodeMatrix);
+      meshes.skillMesh.setMatrixAt(globalIndex, zeroMatrix);
+    } else {
+      nodeMesh = meshes.skillMesh;
+      meshes.projectMesh.setMatrixAt(globalIndex, zeroMatrix);
+      meshes.toolMesh.setMatrixAt(globalIndex, zeroMatrix);
+      meshes.skillMesh.setMatrixAt(globalIndex, nodeMatrix);
+    }
+
+    // Default type color
+    nodeMesh.setColorAt(globalIndex, DEFAULT_NODE_COLORS[node.type]);
+
+    // Badge: visible only for project nodes that have a stage
+    if (node.type === 'project' && node.stage) {
+      dummy.position.set(node.x, node.y + 0.65, node.z);
+      dummy.scale.set(1, 1, 1);
+      dummy.updateMatrix();
+      meshes.badgeMesh.setMatrixAt(globalIndex, dummy.matrix.clone());
+      meshes.badgeMesh.setColorAt(globalIndex, stageColor(node.stage));
+    } else {
+      meshes.badgeMesh.setMatrixAt(globalIndex, zeroMatrix);
+    }
+
+    nodeIndexMap.set(node.id, { mesh: nodeMesh, index: globalIndex });
+  });
+
+  // Bulk needsUpdate after all writes
+  const all = [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh, meshes.badgeMesh];
+  for (const m of all) {
+    m.instanceMatrix.needsUpdate = true;
+    if (m.instanceColor) m.instanceColor.needsUpdate = true;
+  }
+}
+
+/** Sets a node's instance color. MUST call instanceColor.needsUpdate = true — this function does it. */
+export function setNodeColor(
+  nodeId: string,
+  color: THREE.Color,
+  _meshes: ReturnType<typeof createNodeMeshes>,
+  map: Map<string, { mesh: THREE.InstancedMesh; index: number }>
+): void {
+  const entry = map.get(nodeId);
+  if (!entry) return;
+  entry.mesh.setColorAt(entry.index, color);
+  entry.mesh.instanceColor!.needsUpdate = true;
+}
+
+/** Resets all node colors to their default type-based colors. */
+export function resetNodeColors(
+  meshes: ReturnType<typeof createNodeMeshes>,
+  map: Map<string, { mesh: THREE.InstancedMesh; index: number }>
+): void {
+  for (const { mesh, index } of map.values()) {
+    const type =
+      mesh === meshes.projectMesh ? 'project' :
+      mesh === meshes.toolMesh    ? 'tool'    :
+      'skill';
+    mesh.setColorAt(index, DEFAULT_NODE_COLORS[type]);
+  }
+  for (const m of [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh]) {
+    if (m.instanceColor) m.instanceColor.needsUpdate = true;
+  }
+}
diff --git a/03-vscode-extension/webview/orb.ts b/03-vscode-extension/webview/orb.ts
index 5131463..bdf63c4 100644
--- a/03-vscode-extension/webview/orb.ts
+++ b/03-vscode-extension/webview/orb.ts
@@ -1,7 +1,20 @@
+import * as THREE from 'three';
 import ThreeForceGraph from 'three-forcegraph';
 import type { NodeObject } from 'three-forcegraph';
+import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
 import { ORB_RADIUS } from './renderer';
 import type { GraphNode, GraphEdge, GraphSnapshot } from '../src/types';
+import {
+  createNodeMeshes,
+  setNodePositions,
+  type NodeRenderData,
+} from './nodes';
+import {
+  computeRelativeColor,
+  createEdgeLines,
+  updateEdgePositions,
+  type EdgeRenderData,
+} from './edges';
 
 export type { GraphSnapshot };
 
@@ -113,6 +126,73 @@ function createSphereForce(targetRadius: number) {
   return force;
 }
 
+// ── Rendering state (set via initOrb) ────────────────────────────────────────
+
+type NodeMeshes = ReturnType<typeof createNodeMeshes>;
+
+let currentScene: THREE.Scene | null = null;
+let currentMeshes: NodeMeshes | null = null;
+let currentEdgeLines: Map<string, Line2> = new Map();
+
+/**
+ * Initializes the node/edge rendering layer.
+ * Creates InstancedMesh objects, adds them to the scene, and stores refs for later updates.
+ * Call once after createScene() before starting the animation loop.
+ */
+export function initOrb(scene: THREE.Scene): NodeMeshes {
+  currentScene = scene;
+  const meshes = createNodeMeshes(GRAPH_NODE_CAP);
+  currentMeshes = meshes;
+  scene.add(meshes.projectMesh, meshes.toolMesh, meshes.skillMesh, meshes.badgeMesh);
+  return meshes;
+}
+
+/**
+ * Updates instanced node positions and edge geometry from the current force layout.
+ * Call once per animation frame after graph.tickFrame().
+ */
+export function updateRenderPositions(): void {
+  if (!currentMeshes) return;
+
+  const graphData = graph.graphData() as { nodes: NodeObject[]; links: unknown[] };
+  const physNodes = graphData.nodes as Array<NodeObject & GraphNode & { x?: number; y?: number; z?: number }>;
+
+  const renderNodes: NodeRenderData[] = physNodes
+    .filter(n => n.x !== undefined)
+    .map(n => ({
+      id: String(n.id),
+      type: n.type ?? 'skill',
+      x: n.x as number,
+      y: n.y as number,
+      z: n.z as number,
+      stage: n.stage,
+    }));
+
+  if (renderNodes.length > 0) {
+    setNodePositions(renderNodes, currentMeshes);
+  }
+
+  if (currentEdgeLines.size > 0) {
+    const nodePositions = new Map<string, THREE.Vector3>();
+    for (const n of physNodes) {
+      if (n.x !== undefined) {
+        nodePositions.set(String(n.id), new THREE.Vector3(n.x, n.y ?? 0, n.z ?? 0));
+      }
+    }
+    const edgeRenderData: EdgeRenderData[] = (graphData.links as Array<Record<string, unknown>>).map(l => ({
+      id: String(l['id']),
+      source: typeof l['source'] === 'object' && l['source'] !== null
+        ? String((l['source'] as Record<string, unknown>)['id'])
+        : String(l['source']),
+      target: typeof l['target'] === 'object' && l['target'] !== null
+        ? String((l['target'] as Record<string, unknown>)['id'])
+        : String(l['target']),
+      weight: typeof l['weight'] === 'number' ? l['weight'] : 1,
+    }));
+    updateEdgePositions(currentEdgeLines, edgeRenderData, nodePositions);
+  }
+}
+
 // ── Graph instance (module-level singleton) ───────────────────────────────────
 // Uses d3 engine (not ngraph): ngraph's physics API does not expose per-tick force
 // hooks for custom velocity injection. d3Force() provides this via ForceFn.initialize().
@@ -139,6 +219,14 @@ export function updateGraph(snapshot: GraphSnapshot): void {
     );
   }
 
+  // Rebuild edge lines if the scene is active
+  if (currentScene) {
+    currentEdgeLines.forEach(line => currentScene!.remove(line));
+    const colorMap = computeRelativeColor(links);
+    currentEdgeLines = createEdgeLines(links, colorMap);
+    currentEdgeLines.forEach(line => currentScene!.add(line));
+  }
+
   showLoading();
   requestAnimationFrame(() => {
     graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown[] });
diff --git a/03-vscode-extension/webview/renderer.ts b/03-vscode-extension/webview/renderer.ts
index 27d5edd..2f6d623 100644
--- a/03-vscode-extension/webview/renderer.ts
+++ b/03-vscode-extension/webview/renderer.ts
@@ -3,6 +3,14 @@ import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
 
 export const ORB_RADIUS = 120;
 
+type ResizeCallback = (width: number, height: number) => void;
+const resizeListeners: ResizeCallback[] = [];
+
+/** Register a callback that fires whenever the canvas is resized. Used by LineMaterial. */
+export function addResizeListener(cb: ResizeCallback): void {
+  resizeListeners.push(cb);
+}
+
 export function createScene(canvas: HTMLCanvasElement): {
   scene: THREE.Scene;
   camera: THREE.PerspectiveCamera;
@@ -35,6 +43,7 @@ export function createScene(canvas: HTMLCanvasElement): {
     renderer.setSize(w, h);
     camera.aspect = w / h;
     camera.updateProjectionMatrix();
+    resizeListeners.forEach(cb => cb(w, h));
   }).observe(canvas);
 
   function startAnimationLoop(onTick: (delta: number) => void): void {
