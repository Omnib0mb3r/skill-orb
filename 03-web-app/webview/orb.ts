import * as THREE from 'three';
import ThreeForceGraph from 'three-forcegraph';
import type { NodeObject, LinkObject } from 'three-forcegraph';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { ORB_RADIUS, addResizeListener } from './renderer';
import type { GraphNode, GraphEdge, GraphSnapshot } from '../src/types';
import {
  createNodeMeshes,
  setNodePositions,
  type NodeRenderData,
} from './nodes';
import {
  computeRelativeColor,
  createEdgeLines,
  updateEdgePositions,
  type EdgeRenderData,
} from './edges';
import { registerEdges } from './animation';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export type { GraphSnapshot };

// GraphEdge already has source/target as strings; this alias clarifies intent
// (at runtime three-forcegraph mutates these to node objects, but we always pass strings)
type GraphLink = GraphEdge;

const GRAPH_NODE_CAP = 500;
const GRAPH_EDGE_CAP = 300;

const DEVNEURAL_CENTER_ID = 'project:github.com/mcollins-f6i/DevNeural';
const DEVNEURAL_CENTER_LABEL = 'DevNeural';

// ── Pure transform function (independently testable) ──────────────────────────

export function capAndTransform(
  snapshot: GraphSnapshot,
  maxEdges = GRAPH_EDGE_CAP
): {
  nodes: (GraphNode & { fx?: number; fy?: number; fz?: number })[];
  links: GraphLink[];
  wasCapped: boolean;
  originalCounts: { nodes: number; edges: number };
} {
  const originalCounts = { nodes: snapshot.nodes.length, edges: snapshot.edges.length };

  let nodes = snapshot.nodes;
  let edges = snapshot.edges;
  let wasCapped = false;

  if (snapshot.nodes.length > GRAPH_NODE_CAP) {
    const sortedEdges = [...edges].sort((a, b) => b.weight - a.weight).slice(0, maxEdges);

    const referencedIds = new Set<string>();
    for (const edge of sortedEdges) {
      referencedIds.add(edge.source);
      referencedIds.add(edge.target);
    }

    nodes = snapshot.nodes.filter(n => referencedIds.has(n.id));
    edges = sortedEdges;
    wasCapped = true;
  }

  // Pin the DevNeural center node at origin
  const transformedNodes = nodes.map(n => {
    if (n.id === DEVNEURAL_CENTER_ID || n.label === DEVNEURAL_CENTER_LABEL) {
      return { ...n, fx: 0, fy: 0, fz: 0 };
    }
    return n;
  });

  // Rename edges → links (all fields preserved)
  const links: GraphLink[] = edges.map(e => ({ ...e }));

  return { nodes: transformedNodes, links, wasCapped, originalCounts };
}

// ── Loading overlay ───────────────────────────────────────────────────────────

function showLoading(): void {
  if (!document.getElementById('devneural-loading')) {
    const div = document.createElement('div');
    div.id = 'devneural-loading';
    div.textContent = 'Building graph...';
    document.body.appendChild(div);
  }
}

function hideLoading(): void {
  document.getElementById('devneural-loading')?.remove();
}

// ── Sphere constraint force ───────────────────────────────────────────────────

interface PhysicsNode {
  id?: string | number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
}

function createSphereForce(targetRadius: number) {
  let nodes: PhysicsNode[] = [];

  function force(alpha: number): void {
    for (const node of nodes) {
      if (node.fx !== undefined) continue; // pinned node — skip

      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;
      const dist = Math.sqrt(x * x + y * y + z * z) || 1;
      const k = ((dist - targetRadius) / dist) * alpha * 0.1;
      node.vx = (node.vx ?? 0) - x * k;
      node.vy = (node.vy ?? 0) - y * k;
      node.vz = (node.vz ?? 0) - z * k;
    }
  }

  force.initialize = function (n: NodeObject[]): void {
    nodes = n as PhysicsNode[];
  };

  return force;
}

// ── Rendering state (set via initOrb) ────────────────────────────────────────

type NodeMeshes = ReturnType<typeof createNodeMeshes>;

let currentScene: THREE.Scene | null = null;
let currentMeshes: NodeMeshes | null = null;
let currentEdgeLines: Map<string, Line2> = new Map();

/**
 * Initializes the node/edge rendering layer.
 * Creates InstancedMesh objects, adds them to the scene, and stores refs for later updates.
 * Call once after createScene() before starting the animation loop.
 */
export function initOrb(scene: THREE.Scene): NodeMeshes {
  currentScene = scene;
  const meshes = createNodeMeshes(GRAPH_NODE_CAP);
  currentMeshes = meshes;
  scene.add(meshes.projectMesh, meshes.toolMesh, meshes.skillMesh, meshes.badgeMesh);
  return meshes;
}

/**
 * Updates instanced node positions and edge geometry from the current force layout.
 * Call once per animation frame after graph.tickFrame().
 */
export function updateRenderPositions(): void {
  if (!currentMeshes) return;

  const graphData = graph.graphData() as { nodes: NodeObject[]; links: unknown[] };
  const physNodes = graphData.nodes as Array<NodeObject & GraphNode & { x?: number; y?: number; z?: number }>;

  const renderNodes: NodeRenderData[] = physNodes
    .filter(n => n.x !== undefined)
    .map(n => ({
      id: String(n.id),
      type: n.type ?? 'skill',
      x: n.x as number,
      y: n.y as number,
      z: n.z as number,
      stage: n.stage,
    }));

  if (renderNodes.length > 0) {
    setNodePositions(renderNodes, currentMeshes);
  }

  if (currentEdgeLines.size > 0) {
    const nodePositions = new Map<string, THREE.Vector3>();
    for (const n of physNodes) {
      if (n.x !== undefined) {
        nodePositions.set(String(n.id), new THREE.Vector3(n.x, n.y ?? 0, n.z ?? 0));
      }
    }
    const edgeRenderData: EdgeRenderData[] = (graphData.links as Array<Record<string, unknown>>).map(l => ({
      id: String(l['id']),
      source: typeof l['source'] === 'object' && l['source'] !== null
        ? String((l['source'] as Record<string, unknown>)['id'])
        : String(l['source']),
      target: typeof l['target'] === 'object' && l['target'] !== null
        ? String((l['target'] as Record<string, unknown>)['id'])
        : String(l['target']),
      weight: typeof l['weight'] === 'number' ? l['weight'] : 1,
    }));
    updateEdgePositions(currentEdgeLines, edgeRenderData, nodePositions);
  }
}

// ── Graph instance (module-level singleton) ───────────────────────────────────
// Uses d3 engine (not ngraph): ngraph's physics API does not expose per-tick force
// hooks for custom velocity injection. d3Force() provides this via ForceFn.initialize().
// The spec explicitly allows this as the fallback when ngraph lacks the capability.

const graph = new ThreeForceGraph()
  .forceEngine('d3')
  .warmupTicks(150);

graph.d3Force('sphere', createSphereForce(ORB_RADIUS) as Parameters<typeof graph.d3Force>[1]);
graph.onFinishUpdate(() => hideLoading());

export function getGraphInstance(): ThreeForceGraph {
  return graph;
}

/**
 * Returns the current Three.js world position of a node by ID, or null if unknown.
 * Reads live force-layout positions from the graph data each call.
 */
export function getNodePosition(nodeId: string): THREE.Vector3 | null {
  const graphData = graph.graphData() as {
    nodes: Array<NodeObject & { x?: number; y?: number; z?: number }>;
  };
  const node = graphData.nodes.find(n => String((n as Record<string, unknown>)['id']) === nodeId);
  if (!node || node.x === undefined) return null;
  return new THREE.Vector3(node.x, node.y ?? 0, node.z ?? 0);
}

export function updateGraph(snapshot: GraphSnapshot): void {
  const { nodes, links, wasCapped, originalCounts } = capAndTransform(snapshot);

  if (wasCapped) {
    console.warn(
      `DevNeural: graph capped. Showing ${links.length} edges (of ${originalCounts.edges}) ` +
        `and ${nodes.length} nodes (of ${originalCounts.nodes})`
    );
  }

  // Rebuild edge lines if the scene is active
  if (currentScene) {
    currentEdgeLines.forEach(line => currentScene!.remove(line));
    const colorMap = computeRelativeColor(links);
    currentEdgeLines = createEdgeLines(links, colorMap);
    currentEdgeLines.forEach(line => currentScene!.add(line));
    registerEdges(currentEdgeLines, links.map(l => ({ id: l.id, source: l.source, target: l.target })));

    // Wire LineMaterial resolution updates so line thickness stays correct on resize
    addResizeListener((w, h) => {
      currentEdgeLines.forEach(line => {
        (line.material as LineMaterial).resolution.set(w, h);
      });
    });
  }

  showLoading();
  requestAnimationFrame(() => {
    graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown as LinkObject[] });
  });
}
