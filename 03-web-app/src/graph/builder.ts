import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { getMaterialForNode, getMaterialForNodeType, getEdgeColor, getEdgeOpacity, getEdgeLinewidth } from '../orb/visuals';
import { generateEdgeCurve, CURVE_SEGMENTS } from './edge-curve';
import { createSimulation } from '../orb/physics';
import type { PhysicsNode, PhysicsEdge, Simulation } from '../orb/physics';
import type { SceneState, NodeType, OrbNode, OrbEdge } from './types';

export interface GraphNode {
  id: string;
  label: string;
  /** Primary type field. If absent, id prefix is used as fallback. */
  type?: NodeType;
  tags?: string[];
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
  edgeMeshes: Line2[];
  simulation: Simulation;
  infrastructureNodeIds: Set<string>;
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

/**
 * Deterministic integer seed from two node ID strings.
 * Note: order-dependent — hashEdgeSeed(a, b) !== hashEdgeSeed(b, a).
 * Edges in this graph always have a fixed sourceId/targetId from the data layer,
 * so curve shapes are consistent within and across sessions.
 */
export function hashEdgeSeed(sourceId: string, targetId: string): number {
  const str = sourceId + '|' + targetId;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9)) >>> 0;
  }
  return h;
}

/** Create a Line2 edge mesh and add it to the scene. */
export function createEdgeMesh(
  scene: THREE.Scene,
  resolution: THREE.Vector2,
  initialOpacity: number,
): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array((CURVE_SEGMENTS + 1) * 3));
  geo.setColors(new Float32Array((CURVE_SEGMENTS + 1) * 3));
  const mat = new LineMaterial({
    linewidth: 1.5,
    vertexColors: true,
    transparent: true,
    opacity: initialOpacity,
    resolution,
  });
  const line = new Line2(geo, mat);
  scene.add(line);
  return line;
}

export function build(
  graphData: GraphData,
  scene: THREE.Scene,
  resolution = new THREE.Vector2(1920, 1080),
): BuildResult {
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
      infrastructureNodeIds: new Set(),
    };
  }

  const infrastructureNodeIds = new Set<string>();
  const meshMap = new Map<string, THREE.Mesh>();
  const physicsNodes: PhysicsNode[] = [];
  const orbNodes = new Map<string, OrbNode>();

  for (const node of graphData.nodes) {
    const nodeType = node.type ?? inferType(node.id);
    const radius = NODE_RADII[nodeType] ?? NODE_RADII.tool;
    const materialConfig = getMaterialForNode(nodeType, node.tags);
    if (node.tags?.some(t => t.toLowerCase() === 'infrastructure')) {
      infrastructureNodeIds.add(node.id);
    }

    const geometry = createNodeGeometry(nodeType, radius);
    const material = new THREE.MeshStandardMaterial(materialConfig);
    const mesh = new THREE.Mesh(geometry, material);

    const initPos = randomInSphere(10);
    mesh.position.set(initPos.x, initPos.y, initPos.z);
    scene.add(mesh);
    meshMap.set(node.id, mesh);

    const sharedPos = mesh.position as unknown as { x: number; y: number; z: number };
    const velocity = { x: 0, y: 0, z: 0 };

    const physNode: PhysicsNode = { id: node.id, position: sharedPos, velocity };
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
  const edgeMeshes: Line2[] = [];

  for (const edge of graphData.edges) {
    const srcMesh = meshMap.get(edge.sourceId);
    const tgtMesh = meshMap.get(edge.targetId);
    if (!srcMesh || !tgtMesh) continue;

    const line = createEdgeMesh(scene, resolution, getEdgeOpacity(0.25));
    edgeMeshes.push(line);
    physicsEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
    orbEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: 0.25 });
  }

  recomputeEdgeHeat(orbEdges, edgeMeshes, infrastructureNodeIds);

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
    infrastructureNodeIds,
  };
}

/** Number of segments per edge line — re-exported from edge-curve for use in main.ts. */
export const N_SEGMENTS = CURVE_SEGMENTS;

/** Power applied to the dissipation curve. t^HEAT_POWER keeps heat near the source longer. */
const HEAT_POWER = 2;

/**
 * Assigns per-vertex colors and linewidth to each Line2 edge using heat-dissipation.
 * Heat flows from the hotter endpoint (more connections) to the cooler endpoint.
 * Also sets edge.weight to average heat for the opacity pulse.
 */
export function recomputeEdgeHeat(
  edges: OrbEdge[],
  edgeMeshes: Line2[],
  infrastructureNodeIds?: Set<string>,
): void {
  const infra = infrastructureNodeIds ?? new Set<string>();

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }

  // Max degree excludes infrastructure nodes so they don't compress the heat scale
  let maxDeg = 0;
  for (const [id, d] of degree.entries()) {
    if (!infra.has(id) && d > maxDeg) maxDeg = d;
  }

  const c = new THREE.Color();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const mesh = edgeMeshes[i];
    if (!mesh) continue;

    const srcIsInfra = infra.has(edge.sourceId);
    const tgtIsInfra = infra.has(edge.targetId);

    const srcDeg = degree.get(edge.sourceId) ?? 1;
    const tgtDeg = degree.get(edge.targetId) ?? 1;

    // Compute base heat for non-infrastructure endpoints
    const heatOf = (deg: number): number =>
      maxDeg <= 1 ? 0.25 : 0.25 + ((deg - 1) / (maxDeg - 1)) * 0.75;

    // Infrastructure endpoints mirror the real project endpoint's heat,
    // so edges touching infrastructure take on the connected project's color.
    let srcHeat: number;
    let tgtHeat: number;
    if (srcIsInfra && tgtIsInfra) {
      srcHeat = tgtHeat = 0.28; // infra-to-infra: always cool
    } else if (srcIsInfra) {
      tgtHeat = heatOf(tgtDeg);
      srcHeat = tgtHeat; // src mirrors tgt — solid color from the real project
    } else if (tgtIsInfra) {
      srcHeat = heatOf(srcDeg);
      tgtHeat = srcHeat; // tgt mirrors src
    } else {
      srcHeat = heatOf(srcDeg);
      tgtHeat = heatOf(tgtDeg);
    }

    edge.weight = (srcHeat + tgtHeat) / 2;

    const geo = mesh.geometry as LineGeometry;
    const mat = mesh.material as LineMaterial;

    const colors = new Float32Array((N_SEGMENTS + 1) * 3);
    const hotFirst = srcDeg >= tgtDeg;
    const hotHeat  = hotFirst ? srcHeat : tgtHeat;
    const coldHeat = hotFirst ? tgtHeat : srcHeat;

    for (let v = 0; v <= N_SEGMENTS; v++) {
      const t = hotFirst ? v / N_SEGMENTS : (N_SEGMENTS - v) / N_SEGMENTS;
      const heat = hotHeat + (coldHeat - hotHeat) * Math.pow(t, HEAT_POWER);
      c.set(getEdgeColor(heat));
      colors[v * 3]     = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setColors(colors);

    mat.linewidth = getEdgeLinewidth(edge.weight);
  }
}

/**
 * Update edge curve positions each animation frame.
 * Reads live node positions (physics-updated) and applies organic curve + drift.
 *
 * @param driftTime  Slowly-advancing time value (pass performance.now()/1000 * 0.3)
 */
export function updateEdgeDrift(
  driftTime: number,
  edges: OrbEdge[],
  edgeMeshes: Line2[],
  meshes: Map<string, THREE.Mesh>,
): void {
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const mesh = edgeMeshes[i];
    if (!mesh || !edge) continue;
    const src = meshes.get(edge.sourceId);
    const tgt = meshes.get(edge.targetId);
    if (!src || !tgt) continue;

    const seed = hashEdgeSeed(edge.sourceId, edge.targetId);
    const positions = generateEdgeCurve(
      src.position.x, src.position.y, src.position.z,
      tgt.position.x, tgt.position.y, tgt.position.z,
      seed,
      driftTime,
    );
    (mesh.geometry as LineGeometry).setPositions(positions);
  }
}
