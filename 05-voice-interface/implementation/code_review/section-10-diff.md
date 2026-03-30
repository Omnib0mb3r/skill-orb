diff --git a/03-web-app/src/graph/builder.ts b/03-web-app/src/graph/builder.ts
new file mode 100644
index 0000000..53015e6
--- /dev/null
+++ b/03-web-app/src/graph/builder.ts
@@ -0,0 +1,135 @@
+import * as THREE from 'three';
+import { getMaterialForNodeType, getEdgeOpacity } from '../orb/visuals';
+import { createSimulation } from '../orb/physics';
+import type { PhysicsNode, PhysicsEdge, Simulation } from '../orb/physics';
+import type { SceneState, NodeType, OrbNode, OrbEdge } from './types';
+
+export interface GraphNode {
+  id: string;
+  label: string;
+  type: NodeType;
+}
+
+export interface GraphEdge {
+  sourceId: string;
+  targetId: string;
+  weight: number;
+}
+
+export interface GraphData {
+  nodes: GraphNode[];
+  edges: GraphEdge[];
+}
+
+export interface BuildResult extends SceneState {
+  meshes: Map<string, THREE.Mesh>;
+  edgeMeshes: THREE.Line[];
+  simulation: Simulation;
+}
+
+const NODE_RADII: Record<NodeType, number> = {
+  project: 0.6,
+  skill: 0.4,
+  tool: 0.3,
+};
+
+function inferType(id: string): NodeType {
+  if (id.startsWith('project:')) return 'project';
+  if (id.startsWith('skill:')) return 'skill';
+  return 'tool';
+}
+
+function randomInSphere(radius: number): { x: number; y: number; z: number } {
+  const theta = 2 * Math.PI * Math.random();
+  const phi = Math.acos(2 * Math.random() - 1);
+  const r = radius * Math.cbrt(Math.random());
+  return {
+    x: r * Math.sin(phi) * Math.cos(theta),
+    y: r * Math.sin(phi) * Math.sin(theta),
+    z: r * Math.cos(phi),
+  };
+}
+
+export function build(graphData: GraphData, scene: THREE.Scene): BuildResult {
+  if (graphData.nodes.length === 0 && graphData.edges.length === 0) {
+    const sim = createSimulation([], []);
+    return {
+      nodes: new Map(),
+      edges: [],
+      highlightedNodeIds: new Set(),
+      focusedNodeId: null,
+      simulationCooled: false,
+      meshes: new Map(),
+      edgeMeshes: [],
+      simulation: sim,
+    };
+  }
+
+  const meshMap = new Map<string, THREE.Mesh>();
+  const physicsNodes: PhysicsNode[] = [];
+  const orbNodes = new Map<string, OrbNode>();
+
+  for (const node of graphData.nodes) {
+    const nodeType = node.type ?? inferType(node.id);
+    const radius = NODE_RADII[nodeType] ?? NODE_RADII.tool;
+    const materialConfig = getMaterialForNodeType(nodeType);
+
+    const geometry = new THREE.SphereGeometry(radius);
+    const material = new THREE.MeshStandardMaterial(materialConfig);
+    const mesh = new THREE.Mesh(geometry, material);
+
+    const pos = randomInSphere(5);
+    mesh.position.set(pos.x, pos.y, pos.z);
+    scene.add(mesh);
+    meshMap.set(node.id, mesh);
+
+    const physNode: PhysicsNode = {
+      id: node.id,
+      position: pos,
+      velocity: { x: 0, y: 0, z: 0 },
+    };
+    physicsNodes.push(physNode);
+
+    orbNodes.set(node.id, {
+      id: node.id,
+      label: node.label,
+      type: nodeType,
+      position: pos,
+      velocity: physNode.velocity,
+    });
+  }
+
+  const physicsEdges: PhysicsEdge[] = [];
+  const orbEdges: OrbEdge[] = [];
+  const edgeMeshes: THREE.Line[] = [];
+
+  for (const edge of graphData.edges) {
+    const srcMesh = meshMap.get(edge.sourceId);
+    const tgtMesh = meshMap.get(edge.targetId);
+    if (!srcMesh || !tgtMesh) continue;
+
+    const lineGeo = new THREE.BufferGeometry();
+    lineGeo.setFromPoints([srcMesh.position, tgtMesh.position]);
+    const opacity = getEdgeOpacity(edge.weight);
+    const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity });
+    const line = new THREE.Line(lineGeo, lineMat);
+    scene.add(line);
+    edgeMeshes.push(line);
+
+    physicsEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
+    orbEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
+  }
+
+  const simulation = createSimulation(physicsNodes, physicsEdges);
+
+  return {
+    nodes: orbNodes,
+    edges: orbEdges,
+    highlightedNodeIds: new Set(),
+    focusedNodeId: null,
+    simulationCooled: false,
+    meshes: meshMap,
+    edgeMeshes,
+    simulation,
+  };
+}
diff --git a/03-web-app/src/orb/physics.ts b/03-web-app/src/orb/physics.ts
new file mode 100644
index 0000000..6bd41e8
--- /dev/null
+++ b/03-web-app/src/orb/physics.ts
@@ -0,0 +1,109 @@
+export interface PhysicsNode {
+  id: string;
+  position: { x: number; y: number; z: number };
+  velocity: { x: number; y: number; z: number };
+}
+
+export interface PhysicsEdge {
+  sourceId: string;
+  targetId: string;
+  weight: number;
+}
+
+export interface Simulation {
+  tick(): void;
+  reset(): void;
+  isCooled(): boolean;
+  nodes: PhysicsNode[];
+}
+
+const REST_LENGTH = 3;
+const SPRING_STRENGTH = 0.02;
+const REPULSION_STRENGTH = 50;
+const DAMPING = 0.85;
+const VELOCITY_THRESHOLD = 0.001;
+
+export function createSimulation(nodes: PhysicsNode[], edges: PhysicsEdge[]): Simulation {
+  let _cooled = false;
+
+  return {
+    nodes,
+
+    tick() {
+      if (_cooled) return;
+
+      // Spring forces (attraction along edges)
+      for (const edge of edges) {
+        const source = nodes.find(n => n.id === edge.sourceId);
+        const target = nodes.find(n => n.id === edge.targetId);
+        if (!source || !target) continue;
+
+        const dx = target.position.x - source.position.x;
+        const dy = target.position.y - source.position.y;
+        const dz = target.position.z - source.position.z;
+        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.1);
+        const force = (dist - REST_LENGTH) * SPRING_STRENGTH * edge.weight;
+
+        source.velocity.x += (dx / dist) * force;
+        source.velocity.y += (dy / dist) * force;
+        source.velocity.z += (dz / dist) * force;
+        target.velocity.x -= (dx / dist) * force;
+        target.velocity.y -= (dy / dist) * force;
+        target.velocity.z -= (dz / dist) * force;
+      }
+
+      // Repulsion forces (all pairs)
+      for (let i = 0; i < nodes.length; i++) {
+        for (let j = i + 1; j < nodes.length; j++) {
+          const a = nodes[i];
+          const b = nodes[j];
+          const dx = b.position.x - a.position.x;
+          const dy = b.position.y - a.position.y;
+          const dz = b.position.z - a.position.z;
+          const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.1);
+          const force = REPULSION_STRENGTH / (dist * dist);
+          const fx = (dx / dist) * force;
+          const fy = (dy / dist) * force;
+          const fz = (dz / dist) * force;
+          a.velocity.x -= fx;
+          a.velocity.y -= fy;
+          a.velocity.z -= fz;
+          b.velocity.x += fx;
+          b.velocity.y += fy;
+          b.velocity.z += fz;
+        }
+      }
+
+      // Apply damping, update positions, check cooldown
+      let allCooled = true;
+      for (const node of nodes) {
+        node.velocity.x *= DAMPING;
+        node.velocity.y *= DAMPING;
+        node.velocity.z *= DAMPING;
+        node.position.x += node.velocity.x;
+        node.position.y += node.velocity.y;
+        node.position.z += node.velocity.z;
+
+        const speed = Math.sqrt(
+          node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2,
+        );
+        if (speed >= VELOCITY_THRESHOLD) allCooled = false;
+      }
+
+      if (allCooled) _cooled = true;
+    },
+
+    reset() {
+      _cooled = false;
+      for (const node of nodes) {
+        node.velocity.x = 0;
+        node.velocity.y = 0;
+        node.velocity.z = 0;
+      }
+    },
+
+    isCooled() {
+      return _cooled;
+    },
+  };
+}
diff --git a/03-web-app/src/orb/renderer.ts b/03-web-app/src/orb/renderer.ts
new file mode 100644
index 0000000..2187202
--- /dev/null
+++ b/03-web-app/src/orb/renderer.ts
@@ -0,0 +1,33 @@
+import * as THREE from 'three';
+
+export interface RendererState {
+  scene: THREE.Scene;
+  camera: THREE.PerspectiveCamera;
+  renderer: THREE.WebGLRenderer;
+}
+
+export function initRenderer(canvas: HTMLCanvasElement): RendererState {
+  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
+  renderer.setPixelRatio(window.devicePixelRatio);
+  renderer.setSize(window.innerWidth, window.innerHeight);
+
+  const scene = new THREE.Scene();
+  scene.background = new THREE.Color(0x0d0d1a);
+
+  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
+  camera.position.z = 20;
+
+  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
+  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
+  dirLight.position.set(5, 10, 5);
+  scene.add(ambientLight);
+  scene.add(dirLight);
+
+  window.addEventListener('resize', () => {
+    camera.aspect = window.innerWidth / window.innerHeight;
+    camera.updateProjectionMatrix();
+    renderer.setSize(window.innerWidth, window.innerHeight);
+  });
+
+  return { scene, camera, renderer };
+}
diff --git a/03-web-app/tests/graph/builder.test.ts b/03-web-app/tests/graph/builder.test.ts
new file mode 100644
index 0000000..252d281
--- /dev/null
+++ b/03-web-app/tests/graph/builder.test.ts
@@ -0,0 +1,132 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+
+vi.mock('three', () => ({
+  SphereGeometry: vi.fn(),
+  MeshStandardMaterial: vi.fn(),
+  Mesh: vi.fn(() => ({
+    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
+  })),
+  BufferGeometry: vi.fn(() => ({
+    setFromPoints: vi.fn(),
+  })),
+  LineBasicMaterial: vi.fn(),
+  Line: vi.fn(),
+  Scene: vi.fn(() => ({ add: vi.fn() })),
+  AmbientLight: vi.fn(),
+  DirectionalLight: vi.fn(),
+  Color: vi.fn(),
+}));
+
+import * as THREE from 'three';
+import { build } from '../../src/graph/builder';
+import type { GraphData } from '../../src/graph/builder';
+import { getMaterialForNodeType, getEdgeOpacity } from '../../src/orb/visuals';
+
+function makeScene(): THREE.Scene {
+  return { add: vi.fn() } as unknown as THREE.Scene;
+}
+
+const projectNode = { id: 'project:foo', label: 'Foo', type: 'project' as const };
+const skillNode = { id: 'skill:bar', label: 'Bar', type: 'skill' as const };
+const toolNode = { id: 'tool:baz', label: 'Baz', type: 'tool' as const };
+
+describe('build(graphData)', () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it('calls new THREE.SphereGeometry for each node in the graph', () => {
+    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
+    build(data, makeScene());
+    expect(THREE.SphereGeometry).toHaveBeenCalledTimes(3);
+  });
+
+  it('project nodes use a larger radius than skill nodes', () => {
+    const data: GraphData = { nodes: [projectNode, skillNode], edges: [] };
+    build(data, makeScene());
+    const projectRadius = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
+    const skillRadius = vi.mocked(THREE.SphereGeometry).mock.calls[1][0] as number;
+    expect(projectRadius).toBeGreaterThan(skillRadius);
+  });
+
+  it('skill nodes use a medium radius (between project and tool)', () => {
+    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
+    build(data, makeScene());
+    const radii = vi.mocked(THREE.SphereGeometry).mock.calls.map(c => c[0] as number);
+    expect(radii[1]).toBeGreaterThan(radii[2]); // skill > tool
+    expect(radii[1]).toBeLessThan(radii[0]);    // skill < project
+  });
+
+  it('tool nodes use the smallest radius', () => {
+    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
+    build(data, makeScene());
+    const radii = vi.mocked(THREE.SphereGeometry).mock.calls.map(c => c[0] as number);
+    expect(radii[2]).toBeLessThan(radii[0]);
+    expect(radii[2]).toBeLessThan(radii[1]);
+  });
+
+  it('project nodes: MeshStandardMaterial called with a blue-tinted color config', () => {
+    const data: GraphData = { nodes: [projectNode], edges: [] };
+    build(data, makeScene());
+    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
+    expect(matArgs.color).toBe(getMaterialForNodeType('project').color);
+  });
+
+  it('skill nodes: MeshStandardMaterial called with a green-tinted color config', () => {
+    const data: GraphData = { nodes: [skillNode], edges: [] };
+    build(data, makeScene());
+    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
+    expect(matArgs.color).toBe(getMaterialForNodeType('skill').color);
+  });
+
+  it('tool nodes: MeshStandardMaterial called with an orange-tinted color config', () => {
+    const data: GraphData = { nodes: [toolNode], edges: [] };
+    build(data, makeScene());
+    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
+    expect(matArgs.color).toBe(getMaterialForNodeType('tool').color);
+  });
+
+  it('edges: LineBasicMaterial opacity is proportional to edge weight', () => {
+    const data: GraphData = {
+      nodes: [projectNode, skillNode],
+      edges: [
+        { sourceId: projectNode.id, targetId: skillNode.id, weight: 3 },
+        { sourceId: skillNode.id, targetId: projectNode.id, weight: 7 },
+      ],
+    };
+    build(data, makeScene());
+    const ops = vi.mocked(THREE.LineBasicMaterial).mock.calls.map(
+      c => (c[0] as { opacity: number }).opacity,
+    );
+    expect(ops[0]).toBeLessThan(ops[1]);
+  });
+
+  it('edge with weight=0 → opacity ≥ minimum threshold (not zero)', () => {
+    const data: GraphData = {
+      nodes: [projectNode, skillNode],
+      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 0 }],
+    };
+    build(data, makeScene());
+    const op = (vi.mocked(THREE.LineBasicMaterial).mock.calls[0][0] as { opacity: number }).opacity;
+    expect(op).toBeGreaterThanOrEqual(getEdgeOpacity(0));
+    expect(op).toBeGreaterThan(0);
+  });
+
+  it('edge with weight=10 → opacity at maximum (≤ 1.0)', () => {
+    const data: GraphData = {
+      nodes: [projectNode, skillNode],
+      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 10 }],
+    };
+    build(data, makeScene());
+    const op = (vi.mocked(THREE.LineBasicMaterial).mock.calls[0][0] as { opacity: number }).opacity;
+    expect(op).toBeLessThanOrEqual(1.0);
+  });
+
+  it('build() called with empty graph → no Three.js constructors called, no errors', () => {
+    const data: GraphData = { nodes: [], edges: [] };
+    expect(() => build(data, makeScene())).not.toThrow();
+    expect(THREE.SphereGeometry).not.toHaveBeenCalled();
+    expect(THREE.MeshStandardMaterial).not.toHaveBeenCalled();
+    expect(THREE.Mesh).not.toHaveBeenCalled();
+  });
+});
diff --git a/03-web-app/tests/orb/physics.test.ts b/03-web-app/tests/orb/physics.test.ts
new file mode 100644
index 0000000..609aa96
--- /dev/null
+++ b/03-web-app/tests/orb/physics.test.ts
@@ -0,0 +1,83 @@
+import { describe, it, expect } from 'vitest';
+import { createSimulation } from '../../src/orb/physics';
+import type { PhysicsNode, PhysicsEdge } from '../../src/orb/physics';
+
+function makeNode(id: string, x = 0, y = 0, z = 0): PhysicsNode {
+  return { id, position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } };
+}
+
+function dist(a: PhysicsNode, b: PhysicsNode): number {
+  return Math.sqrt(
+    (b.position.x - a.position.x) ** 2 +
+    (b.position.y - a.position.y) ** 2 +
+    (b.position.z - a.position.z) ** 2,
+  );
+}
+
+describe('physics simulation', () => {
+  it('simulate(nodes, edges) → each node position changes after one tick', () => {
+    const nodes = [makeNode('a', 0, 0, 0), makeNode('b', 3, 0, 0)];
+    const sim = createSimulation(nodes, []);
+    const aX0 = nodes[0].position.x;
+    const bX0 = nodes[1].position.x;
+    sim.tick();
+    const moved = nodes[0].position.x !== aX0 || nodes[1].position.x !== bX0;
+    expect(moved).toBe(true);
+  });
+
+  it('simulate with no edges → nodes repel each other (positions spread apart after N ticks)', () => {
+    const nodes = [makeNode('a', 0, 0, 0), makeNode('b', 3, 0, 0)];
+    const sim = createSimulation(nodes, []);
+    const d0 = dist(nodes[0], nodes[1]);
+    for (let i = 0; i < 10; i++) sim.tick();
+    expect(dist(nodes[0], nodes[1])).toBeGreaterThan(d0);
+  });
+
+  it('high-weight edge → connected nodes closer after N ticks than with low-weight edge', () => {
+    function runSim(weight: number): number {
+      const nodes = [makeNode('a', -5, 0, 0), makeNode('b', 5, 0, 0)];
+      const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight };
+      const sim = createSimulation(nodes, [edge]);
+      for (let i = 0; i < 60; i++) sim.tick();
+      return dist(nodes[0], nodes[1]);
+    }
+    expect(runSim(10)).toBeLessThan(runSim(1));
+  });
+
+  it('velocity threshold: after many ticks on a stable graph, all node velocities < 0.001', () => {
+    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
+    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
+    const sim = createSimulation(nodes, [edge]);
+    for (let i = 0; i < 600; i++) sim.tick();
+    for (const node of nodes) {
+      const speed = Math.sqrt(node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2);
+      expect(speed).toBeLessThan(0.001);
+    }
+  });
+
+  it('cooldown flag is set when simulation stabilizes → further tick() calls are no-ops', () => {
+    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
+    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
+    const sim = createSimulation(nodes, [edge]);
+    for (let i = 0; i < 600; i++) sim.tick();
+    expect(sim.isCooled()).toBe(true);
+    const posX = nodes[0].position.x;
+    sim.tick();
+    expect(nodes[0].position.x).toBe(posX);
+  });
+
+  it('reset() restarts the simulation: cooldown flag cleared, velocities zeroed', () => {
+    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
+    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
+    const sim = createSimulation(nodes, [edge]);
+    for (let i = 0; i < 600; i++) sim.tick();
+    expect(sim.isCooled()).toBe(true);
+    sim.reset();
+    expect(sim.isCooled()).toBe(false);
+    for (const node of nodes) {
+      expect(node.velocity.x).toBe(0);
+      expect(node.velocity.y).toBe(0);
+      expect(node.velocity.z).toBe(0);
+    }
+  });
+});
diff --git a/03-web-app/tests/orb/renderer.test.ts b/03-web-app/tests/orb/renderer.test.ts
new file mode 100644
index 0000000..2989974
--- /dev/null
+++ b/03-web-app/tests/orb/renderer.test.ts
@@ -0,0 +1,72 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+
+vi.mock('three', () => ({
+  WebGLRenderer: vi.fn(() => ({
+    setPixelRatio: vi.fn(),
+    setSize: vi.fn(),
+    render: vi.fn(),
+  })),
+  Scene: vi.fn(() => ({
+    add: vi.fn(),
+    background: null,
+  })),
+  PerspectiveCamera: vi.fn(() => ({
+    position: { z: 0 },
+    aspect: 1,
+    updateProjectionMatrix: vi.fn(),
+  })),
+  AmbientLight: vi.fn(() => ({})),
+  DirectionalLight: vi.fn(() => ({
+    position: { set: vi.fn() },
+  })),
+  Color: vi.fn(),
+}));
+
+import * as THREE from 'three';
+import { initRenderer } from '../../src/orb/renderer';
+
+describe('initRenderer(canvas)', () => {
+  let canvas: HTMLCanvasElement;
+
+  beforeEach(() => {
+    vi.clearAllMocks();
+    canvas = {} as HTMLCanvasElement;
+    vi.stubGlobal('window', {
+      devicePixelRatio: 1,
+      innerWidth: 1024,
+      innerHeight: 768,
+      addEventListener: vi.fn(),
+    });
+  });
+
+  it('returns an object with scene, camera, renderer properties', () => {
+    const state = initRenderer(canvas);
+    expect(state).toHaveProperty('scene');
+    expect(state).toHaveProperty('camera');
+    expect(state).toHaveProperty('renderer');
+  });
+
+  it('scene is a THREE.Scene instance (constructor called once)', () => {
+    initRenderer(canvas);
+    expect(THREE.Scene).toHaveBeenCalledTimes(1);
+  });
+
+  it('camera is a THREE.PerspectiveCamera instance', () => {
+    initRenderer(canvas);
+    expect(THREE.PerspectiveCamera).toHaveBeenCalledTimes(1);
+  });
+
+  it('renderer is a THREE.WebGLRenderer instance constructed with the provided canvas', () => {
+    initRenderer(canvas);
+    expect(THREE.WebGLRenderer).toHaveBeenCalledTimes(1);
+    expect(THREE.WebGLRenderer).toHaveBeenCalledWith(expect.objectContaining({ canvas }));
+  });
+
+  it('lights: at least one AmbientLight and one DirectionalLight added to scene', () => {
+    initRenderer(canvas);
+    expect(THREE.AmbientLight).toHaveBeenCalledTimes(1);
+    expect(THREE.DirectionalLight).toHaveBeenCalledTimes(1);
+    const sceneMock = vi.mocked(THREE.Scene).mock.results[0].value as { add: ReturnType<typeof vi.fn> };
+    expect(sceneMock.add).toHaveBeenCalledTimes(2);
+  });
+});
