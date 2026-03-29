import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge, ProjectRegistry } from './types.js';

function parseNode(id: string, registry?: ProjectRegistry): GraphNode {
  const colonIdx = id.indexOf(':');
  const prefix = id.slice(0, colonIdx);
  const label = id.slice(colonIdx + 1);
  const type = (prefix === 'project' || prefix === 'tool' || prefix === 'skill')
    ? prefix
    : 'skill';
  const node: GraphNode = { id, type, label };
  if (type === 'project' && registry) {
    const meta = registry.get(id);
    if (meta) {
      node.stage = meta.stage;
      node.tags = meta.tags;
      node.localPath = meta.localPath;
    }
  }
  return node;
}

export function buildGraph(weights: WeightsFile, registry?: ProjectRegistry): InMemoryGraph {
  const nodeIndex = new Map<string, GraphNode>();
  const edgeList: GraphEdge[] = [];
  const edgeIndex = new Map<string, GraphEdge>();
  const adjacency = new Map<string, string[]>();

  for (const [key, entry] of Object.entries(weights.connections)) {
    const edge: GraphEdge = {
      id: key,
      source: entry.source_node,
      target: entry.target_node,
      connection_type: entry.connection_type,
      raw_count: entry.raw_count,
      weight: entry.weight,
      first_seen: entry.first_seen,
      last_seen: entry.last_seen,
    };

    edgeList.push(edge);
    edgeIndex.set(key, edge);

    for (const nodeId of [entry.source_node, entry.target_node]) {
      if (!nodeIndex.has(nodeId)) {
        nodeIndex.set(nodeId, parseNode(nodeId, registry));
      }
      const adj = adjacency.get(nodeId);
      if (adj) {
        adj.push(key);
      } else {
        adjacency.set(nodeId, [key]);
      }
    }
  }

  edgeList.sort((a, b) => b.weight - a.weight);

  return { nodeIndex, edgeList, edgeIndex, adjacency };
}
