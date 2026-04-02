import * as THREE from 'three';
import { getMaterialForNodeType, getEdgeColor, getEdgeOpacity } from '../orb/visuals';
import { createSimulation } from '../orb/physics';
import type { PhysicsNode, PhysicsEdge, Simulation } from '../orb/physics';
import type { SceneState, NodeType, OrbNode, OrbEdge } from './types';

export interface GraphNode {
  id: string;
  label: string;
  /** Primary type field. If absent, id prefix is used as fallback. */
  type?: NodeType;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BuildResult extends SceneState {
  meshes: Map<string, THREE.Mesh>;
  edgeMeshes: THREE.Line[];
  simulation: Simulation;
}

const NODE_RADII: Record<NodeType, number> = {
  project: 1.8,
  skill:   1.2,
  tool:    0.9,
};

function inferType(id: string): NodeType {
  if (id.startsWith('project:')) return 'project';
  if (id.startsWith('skill:')) return 'skill';
  return 'tool';
}

/**
 * Different geometry per node type so they are visually distinct at a glance:
 *  project → sphere  (familiar, central hub shape)
 *  skill   → octahedron  (diamond / gem — knowledge)
 *  tool    → box  (cube — a physical tool)
 */
function createNodeGeometry(type: NodeType, r: number): THREE.BufferGeometry {
  switch (type) {
    case 'project': return new THREE.SphereGeometry(r, 20, 20);
    case 'skill':   return new THREE.OctahedronGeometry(r * 1.1);
    case 'tool':    return new THREE.BoxGeometry(r * 1.5, r * 1.5, r * 1.5);
    default:        return new THREE.SphereGeometry(r, 12, 12);
  }
}

function randomInSphere(radius: number): { x: number; y: number; z: number } {
  const theta = 2 * Math.PI * Math.random();
  const phi = Math.acos(2 * Math.random() - 1);
  const r = radius * Math.cbrt(Math.random());
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.sin(phi) * Math.sin(theta),
    z: r * Math.cos(phi),
  };
}

export function build(graphData: GraphData, scene: THREE.Scene): BuildResult {
  if (graphData.nodes.length === 0 && graphData.edges.length === 0) {
    const sim = createSimulation([], []);
    return {
      nodes: new Map(),
      edges: [],
      highlightedNodeIds: new Set(),
      focusedNodeId: null,
      simulationCooled: false,
      meshes: new Map(),
      edgeMeshes: [],
      simulation: sim,
    };
  }

  const meshMap = new Map<string, THREE.Mesh>();
  const physicsNodes: PhysicsNode[] = [];
  const orbNodes = new Map<string, OrbNode>();

  for (const node of graphData.nodes) {
    const nodeType = node.type ?? inferType(node.id);
    const radius = NODE_RADII[nodeType] ?? NODE_RADII.tool;
    const materialConfig = getMaterialForNodeType(nodeType);

    const geometry = createNodeGeometry(nodeType, radius);
    const material = new THREE.MeshStandardMaterial(materialConfig);
    const mesh = new THREE.Mesh(geometry, material);

    const initPos = randomInSphere(10);
    mesh.position.set(initPos.x, initPos.y, initPos.z);
    scene.add(mesh);
    meshMap.set(node.id, mesh);

    // Share mesh.position so physics mutations are reflected in the Three.js mesh
    const sharedPos = mesh.position as unknown as { x: number; y: number; z: number };
    const velocity = { x: 0, y: 0, z: 0 };

    const physNode: PhysicsNode = {
      id: node.id,
      position: sharedPos,
      velocity,
    };
    physicsNodes.push(physNode);

    orbNodes.set(node.id, {
      id: node.id,
      label: node.label,
      type: nodeType,
      position: sharedPos,
      velocity,
    });
  }

  const physicsEdges: PhysicsEdge[] = [];
  const orbEdges: OrbEdge[] = [];
  const edgeMeshes: THREE.Line[] = [];

  for (const edge of graphData.edges) {
    const srcMesh = meshMap.get(edge.sourceId);
    const tgtMesh = meshMap.get(edge.targetId);
    if (!srcMesh || !tgtMesh) continue;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N_SEGMENTS + 1) * 3), 3));
    lineGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array((N_SEGMENTS + 1) * 3), 3));
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: getEdgeOpacity(0.25) });
    const line = new THREE.Line(lineGeo, lineMat);
    scene.add(line);
    edgeMeshes.push(line);

    physicsEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
    orbEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: 0.25 });
  }

  recomputeEdgeHeat(orbEdges, edgeMeshes);

  const simulation = createSimulation(physicsNodes, physicsEdges);

  return {
    nodes: orbNodes,
    edges: orbEdges,
    highlightedNodeIds: new Set(),
    focusedNodeId: null,
    simulationCooled: false,
    meshes: meshMap,
    edgeMeshes,
    simulation,
  };
}

/** Number of segments per edge line — more segments = smoother heat dissipation gradient. */
export const N_SEGMENTS = 8;

/** Power applied to the dissipation curve. t^HEAT_POWER keeps heat near the source longer. */
const HEAT_POWER = 2;

/**
 * Assigns per-vertex colors to each edge using a heat-dissipation curve.
 * Heat is generated at the hotter endpoint (more connections) and dissipates
 * toward the cooler endpoint. The t^HEAT_POWER curve keeps the hot color
 * concentrated near the source and drops quickly toward the cold end.
 * Also sets edge.weight to the average heat for the opacity pulse.
 */
export function recomputeEdgeHeat(edges: OrbEdge[], edgeMeshes: THREE.Line[]): void {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }
  let maxDeg = 0;
  for (const d of degree.values()) if (d > maxDeg) maxDeg = d;

  const c = new THREE.Color();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const mesh = edgeMeshes[i];
    if (!mesh) continue;

    const srcDeg = degree.get(edge.sourceId) ?? 1;
    const tgtDeg = degree.get(edge.targetId) ?? 1;
    const srcHeat = maxDeg <= 1 ? 0.25 : 0.25 + ((srcDeg - 1) / (maxDeg - 1)) * 0.75;
    const tgtHeat = maxDeg <= 1 ? 0.25 : 0.25 + ((tgtDeg - 1) / (maxDeg - 1)) * 0.75;

    edge.weight = (srcHeat + tgtHeat) / 2;

    const colorAttr = mesh.geometry.attributes['color'] as THREE.BufferAttribute;
    if (!colorAttr) continue;

    // Hot end is whichever node has more connections — heat flows from there
    const hotFirst = srcDeg >= tgtDeg;
    const hotHeat  = hotFirst ? srcHeat : tgtHeat;
    const coldHeat = hotFirst ? tgtHeat : srcHeat;

    for (let v = 0; v <= N_SEGMENTS; v++) {
      // t=0 at hot end, t=1 at cold end — direction depends on which node is hotter
      const t = hotFirst ? v / N_SEGMENTS : (N_SEGMENTS - v) / N_SEGMENTS;
      const heat = hotHeat + (coldHeat - hotHeat) * Math.pow(t, HEAT_POWER);
      c.set(getEdgeColor(heat));
      colorAttr.setXYZ(v, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  }
}

