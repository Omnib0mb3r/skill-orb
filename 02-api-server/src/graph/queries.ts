import type { InMemoryGraph, GraphNode, GraphEdge, GraphResponse } from './types.js';

/**
 * Serializes the entire InMemoryGraph into a GraphResponse suitable for the
 * GET /graph REST endpoint.
 */
export function getFullGraph(graph: InMemoryGraph, updatedAt: string): GraphResponse {
  return {
    nodes: Array.from(graph.nodeIndex.values()),
    edges: graph.edgeList.slice(),
    updated_at: updatedAt,
  };
}

/**
 * Looks up a single node and all edges it participates in.
 *
 * @param nodeId - The full node id string including prefix (e.g. 'project:github.com/user/repo').
 *   Unlike getSubgraph, no prefix normalization is performed — callers must pass the full id.
 */
export function getNodeById(
  graph: InMemoryGraph,
  nodeId: string
): { node: GraphNode; edges: GraphEdge[] } | null {
  const node = graph.nodeIndex.get(nodeId);
  if (!node) return null;

  const edgeIds = graph.adjacency.get(nodeId) ?? [];
  const edges: GraphEdge[] = [];
  for (const edgeId of edgeIds) {
    const edge = graph.edgeIndex.get(edgeId);
    if (edge) edges.push(edge);
  }

  return { node, edges };
}

/**
 * Returns the subgraph of edges directly connected to a specific project node.
 */
export function getSubgraph(graph: InMemoryGraph, projectId: string): GraphResponse {
  const normalizedId = projectId.startsWith('project:') ? projectId : `project:${projectId}`;

  const matchedEdges = graph.edgeList.filter(
    (edge) => edge.source === normalizedId || edge.target === normalizedId
  );

  const nodeIds = new Set<string>();
  for (const edge of matchedEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const node = graph.nodeIndex.get(id);
    if (node) nodes.push(node);
  }

  return {
    nodes,
    edges: matchedEdges,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Returns the top N edges by weight from the pre-sorted edge list.
 */
export function getTopEdges(graph: InMemoryGraph, limit: number): GraphResponse {
  const topEdges = graph.edgeList.slice(0, limit);

  const nodeIds = new Set<string>();
  for (const edge of topEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const node = graph.nodeIndex.get(id);
    if (node) nodes.push(node);
  }

  return {
    nodes,
    edges: topEdges,
    updated_at: new Date().toISOString(),
  };
}
