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

  // Edge color rules:
  //  - project→skill/tool: use the skill/tool's count of project connections
  //  - project→project:    use the project's count of P→P connections only
  //    (skill connections do not inflate a project's P→P color)
  // Both normalized against the same max so a project with 2 P→P connections
  // is as warm as a skill used by 2 projects.
  const MIN_COLOR_WEIGHT = 0.35;
  const skillDegree = new Map<string, number>();
  const ppDegree    = new Map<string, number>();
  for (const edge of graphData.edges) {
    const isPP = edge.sourceId.startsWith('project:') && edge.targetId.startsWith('project:');
    if (isPP) {
      ppDegree.set(edge.sourceId, (ppDegree.get(edge.sourceId) ?? 0) + 1);
      ppDegree.set(edge.targetId, (ppDegree.get(edge.targetId) ?? 0) + 1);
    } else {
      const stId = !edge.targetId.startsWith('project:') ? edge.targetId : edge.sourceId;
      skillDegree.set(stId, (skillDegree.get(stId) ?? 0) + 1);
    }
  }
  const maxSkillDegree = Math.max(0, ...skillDegree.values());
  const maxPPDegree    = Math.max(0, ...ppDegree.values());
  const maxColorDegree = Math.max(maxSkillDegree, maxPPDegree);

  for (const edge of graphData.edges) {
    const srcMesh = meshMap.get(edge.sourceId);
    const tgtMesh = meshMap.get(edge.targetId);
    if (!srcMesh || !tgtMesh) continue;

    const isPP = edge.sourceId.startsWith('project:') && edge.targetId.startsWith('project:');
    const edgeDegree = isPP
      ? Math.max(ppDegree.get(edge.sourceId) ?? 0, ppDegree.get(edge.targetId) ?? 0)
      : skillDegree.get(!edge.targetId.startsWith('project:') ? edge.targetId : edge.sourceId) ?? 0;
    const normalized = maxColorDegree > 0 ? edgeDegree / maxColorDegree : 0;
    const colorWeight = MIN_COLOR_WEIGHT + normalized * (1 - MIN_COLOR_WEIGHT);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setFromPoints([srcMesh.position, tgtMesh.position]);
    const color = getEdgeColor(colorWeight);
    const opacity = getEdgeOpacity(colorWeight);
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.Line(lineGeo, lineMat);
    scene.add(line);
    edgeMeshes.push(line);

    physicsEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
    orbEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: colorWeight });
  }

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
