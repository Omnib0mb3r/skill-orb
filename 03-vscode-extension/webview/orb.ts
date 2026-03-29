import ThreeForceGraph from 'three-forcegraph';
import type { NodeObject } from 'three-forcegraph';
import { ORB_RADIUS } from './renderer';
import type { GraphNode, GraphEdge, GraphSnapshot } from '../src/types';

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

export function updateGraph(snapshot: GraphSnapshot): void {
  const { nodes, links, wasCapped, originalCounts } = capAndTransform(snapshot);

  if (wasCapped) {
    console.warn(
      `DevNeural: graph capped. Showing ${links.length} edges (of ${originalCounts.edges}) ` +
        `and ${nodes.length} nodes (of ${originalCounts.nodes})`
    );
  }

  showLoading();
  requestAnimationFrame(() => {
    graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown[] });
  });
}
