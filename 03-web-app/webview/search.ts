import type { GraphNode, GraphEdge } from '../src/types';

export interface SearchResult {
  matchingNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

const KNOWN_TYPES = new Set(['project', 'tool', 'skill']);
const KNOWN_STAGES = new Set([
  'alpha', 'beta', 'deployed', 'archived', 'sandbox', 'revision-needed',
]);

export function detectReverseQuery(query: string): { isReverse: boolean; target: string } {
  const lower = query.toLowerCase().trim();
  if (lower.startsWith('uses ')) {
    return { isReverse: true, target: lower.slice(5).trim() };
  }
  if (lower.startsWith('connects to ')) {
    return { isReverse: true, target: lower.slice(12).trim() };
  }
  return { isReverse: false, target: '' };
}

export function evaluateQuery(
  query: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): SearchResult {
  const trimmed = query.trim();

  // 1. Empty query → all match
  if (trimmed === '') {
    return {
      matchingNodeIds: new Set(nodes.map(n => n.id)),
      matchingEdgeIds: new Set(edges.map(e => e.id)),
    };
  }

  const lower = trimmed.toLowerCase();

  // 2. Node type match
  if (KNOWN_TYPES.has(lower)) {
    const matchingNodeIds = new Set(nodes.filter(n => n.type === lower).map(n => n.id));
    const matchingEdgeIds = new Set(
      edges
        .filter(e => matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
        .map(e => e.id),
    );
    return { matchingNodeIds, matchingEdgeIds };
  }

  // 3. Stage match
  if (KNOWN_STAGES.has(lower)) {
    const matchingNodeIds = new Set(nodes.filter(n => n.stage === lower).map(n => n.id));
    const matchingEdgeIds = new Set(
      edges
        .filter(e => matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
        .map(e => e.id),
    );
    return { matchingNodeIds, matchingEdgeIds };
  }

  // 4. Connection type match
  const edgesByType = edges.filter(e => e.connection_type.toLowerCase() === lower);
  if (edgesByType.length > 0) {
    const matchingEdgeIds = new Set(edgesByType.map(e => e.id));
    const matchingNodeIds = new Set<string>();
    for (const e of edgesByType) {
      matchingNodeIds.add(e.source);
      matchingNodeIds.add(e.target);
    }
    return { matchingNodeIds, matchingEdgeIds };
  }

  // 5. Reverse query: "uses <target>" / "connects to <target>"
  const { isReverse, target } = detectReverseQuery(trimmed);
  if (isReverse) {
    const targetNodes = nodes.filter(n => n.label.toLowerCase().includes(target));
    const targetIds = new Set(targetNodes.map(n => n.id));
    const connectedEdges = edges.filter(e => targetIds.has(e.source) || targetIds.has(e.target));
    const matchingEdgeIds = new Set(connectedEdges.map(e => e.id));
    const matchingNodeIds = new Set<string>();
    for (const e of connectedEdges) {
      const srcNode = nodes.find(n => n.id === e.source);
      const tgtNode = nodes.find(n => n.id === e.target);
      if (srcNode?.type === 'project') matchingNodeIds.add(srcNode.id);
      if (tgtNode?.type === 'project') matchingNodeIds.add(tgtNode.id);
    }
    targetIds.forEach(id => matchingNodeIds.add(id));
    return { matchingNodeIds, matchingEdgeIds };
  }

  // 6. Label substring fallback (case-insensitive)
  const matchingNodeIds = new Set(
    nodes.filter(n => n.label.toLowerCase().includes(lower)).map(n => n.id),
  );
  const matchingEdgeIds = new Set(
    edges
      .filter(e => matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
      .map(e => e.id),
  );
  return { matchingNodeIds, matchingEdgeIds };
}
