diff --git a/02-api-server/src/graph/queries.ts b/02-api-server/src/graph/queries.ts
new file mode 100644
index 0000000..554b9d6
--- /dev/null
+++ b/02-api-server/src/graph/queries.ts
@@ -0,0 +1,87 @@
+import type { InMemoryGraph, GraphNode, GraphEdge, GraphResponse } from './types.js';
+
+/**
+ * Serializes the entire InMemoryGraph into a GraphResponse suitable for the
+ * GET /graph REST endpoint.
+ */
+export function getFullGraph(graph: InMemoryGraph, updatedAt: string): GraphResponse {
+  return {
+    nodes: Array.from(graph.nodeIndex.values()),
+    edges: graph.edgeList,
+    updated_at: updatedAt,
+  };
+}
+
+/**
+ * Looks up a single node and all edges it participates in.
+ */
+export function getNodeById(
+  graph: InMemoryGraph,
+  nodeId: string
+): { node: GraphNode; edges: GraphEdge[] } | null {
+  const node = graph.nodeIndex.get(nodeId);
+  if (!node) return null;
+
+  const edgeIds = graph.adjacency.get(nodeId) ?? [];
+  const edges: GraphEdge[] = [];
+  for (const edgeId of edgeIds) {
+    const edge = graph.edgeIndex.get(edgeId);
+    if (edge) edges.push(edge);
+  }
+
+  return { node, edges };
+}
+
+/**
+ * Returns the subgraph of edges directly connected to a specific project node.
+ */
+export function getSubgraph(graph: InMemoryGraph, projectId: string): GraphResponse {
+  const normalizedId = projectId.startsWith('project:') ? projectId : `project:${projectId}`;
+
+  const matchedEdges = graph.edgeList.filter(
+    (edge) => edge.source === normalizedId || edge.target === normalizedId
+  );
+
+  const nodeIds = new Set<string>();
+  for (const edge of matchedEdges) {
+    nodeIds.add(edge.source);
+    nodeIds.add(edge.target);
+  }
+
+  const nodes: GraphNode[] = [];
+  for (const id of nodeIds) {
+    const node = graph.nodeIndex.get(id);
+    if (node) nodes.push(node);
+  }
+
+  return {
+    nodes,
+    edges: matchedEdges,
+    updated_at: new Date().toISOString(),
+  };
+}
+
+/**
+ * Returns the top N edges by weight from the pre-sorted edge list.
+ */
+export function getTopEdges(graph: InMemoryGraph, limit: number): GraphResponse {
+  const topEdges = graph.edgeList.slice(0, limit);
+
+  const nodeIds = new Set<string>();
+  for (const edge of topEdges) {
+    nodeIds.add(edge.source);
+    nodeIds.add(edge.target);
+  }
+
+  const nodes: GraphNode[] = [];
+  for (const id of nodeIds) {
+    const node = graph.nodeIndex.get(id);
+    if (node) nodes.push(node);
+  }
+
+  return {
+    nodes,
+    edges: topEdges,
+    updated_at: new Date().toISOString(),
+  };
+}
diff --git a/02-api-server/tests/graph/queries.test.ts b/02-api-server/tests/graph/queries.test.ts
new file mode 100644
index 0000000..49a0741
--- /dev/null
+++ b/02-api-server/tests/graph/queries.test.ts
@@ -0,0 +1,242 @@
+import { describe, it, expect } from 'vitest';
+import { buildGraph } from '../../src/graph/builder.js';
+import { getFullGraph, getNodeById, getSubgraph, getTopEdges } from '../../src/graph/queries.js';
+import type { WeightsFile } from '../../src/graph/types.js';
+
+const UPDATED_AT = '2024-01-01T00:00:00.000Z';
+
+function makeWeights(
+  entries: Record<
+    string,
+    {
+      source: string;
+      target: string;
+      weight: number;
+      type?: 'project->tool' | 'project->project' | 'project->skill' | 'tool->skill';
+    }
+  >
+): WeightsFile {
+  const connections: WeightsFile['connections'] = {};
+  for (const [key, e] of Object.entries(entries)) {
+    connections[key] = {
+      source_node: e.source,
+      target_node: e.target,
+      connection_type: e.type ?? 'project->tool',
+      raw_count: 1,
+      weight: e.weight,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-01-01T00:00:00.000Z',
+    };
+  }
+  return { connections, last_updated: '2025-01-01T00:00:00.000Z', version: '1.0' };
+}
+
+const emptyWeights: WeightsFile = {
+  connections: {},
+  last_updated: '2025-01-01T00:00:00.000Z',
+  version: '1.0',
+};
+
+describe('getFullGraph', () => {
+  it('returns all nodes and edges from a populated InMemoryGraph', () => {
+    const weights = makeWeights({
+      'project:repo-a||tool:Edit': { source: 'project:repo-a', target: 'tool:Edit', weight: 1.0 },
+      'project:repo-b||tool:Write': { source: 'project:repo-b', target: 'tool:Write', weight: 0.5 },
+    });
+    const graph = buildGraph(weights);
+    const result = getFullGraph(graph, UPDATED_AT);
+    expect(result.nodes.length).toBe(graph.nodeIndex.size);
+    expect(result.edges.length).toBe(graph.edgeList.length);
+    expect(result.updated_at).toBe(UPDATED_AT);
+  });
+
+  it('returns { nodes: [], edges: [], updated_at } when graph is empty', () => {
+    const graph = buildGraph(emptyWeights);
+    const result = getFullGraph(graph, UPDATED_AT);
+    expect(result.nodes).toEqual([]);
+    expect(result.edges).toEqual([]);
+    expect(result.updated_at).toBe(UPDATED_AT);
+  });
+});
+
+describe('getNodeById', () => {
+  it('returns { node, edges } for a node that exists in the graph', () => {
+    const weights = makeWeights({
+      'project:repo-a||tool:Edit': { source: 'project:repo-a', target: 'tool:Edit', weight: 1.0 },
+      'project:repo-a||tool:Write': { source: 'project:repo-a', target: 'tool:Write', weight: 0.5 },
+      'project:repo-b||tool:Edit': { source: 'project:repo-b', target: 'tool:Edit', weight: 0.8 },
+    });
+    const graph = buildGraph(weights);
+    const result = getNodeById(graph, 'project:repo-a');
+    expect(result).not.toBeNull();
+    expect(result!.node.id).toBe('project:repo-a');
+    // Only edges where project:repo-a is source or target
+    expect(result!.edges.length).toBe(2);
+    for (const edge of result!.edges) {
+      expect(edge.source === 'project:repo-a' || edge.target === 'project:repo-a').toBe(true);
+    }
+  });
+
+  it('returns null for a nodeId that does not exist', () => {
+    const graph = buildGraph(emptyWeights);
+    expect(getNodeById(graph, 'project:nonexistent')).toBeNull();
+  });
+
+  it('returns node with empty edges array for isolated node', () => {
+    // Build a graph then verify adjacency-based lookup handles missing adjacency entry
+    const weights = makeWeights({
+      'project:a||tool:Edit': { source: 'project:a', target: 'tool:Edit', weight: 1.0 },
+    });
+    const graph = buildGraph(weights);
+    // Manually insert an isolated node with no adjacency entry
+    graph.nodeIndex.set('skill:isolated', { id: 'skill:isolated', type: 'skill', label: 'isolated' });
+    const result = getNodeById(graph, 'skill:isolated');
+    expect(result).not.toBeNull();
+    expect(result!.edges).toEqual([]);
+  });
+});
+
+describe('getSubgraph', () => {
+  const weights = makeWeights({
+    'project:github.com/user/repo||tool:Edit': {
+      source: 'project:github.com/user/repo',
+      target: 'tool:Edit',
+      weight: 1.0,
+    },
+    'project:github.com/user/repo||skill:gsd': {
+      source: 'project:github.com/user/repo',
+      target: 'skill:gsd',
+      weight: 0.8,
+      type: 'project->skill',
+    },
+    'project:github.com/user/other||tool:Bash': {
+      source: 'project:github.com/user/other',
+      target: 'tool:Bash',
+      weight: 0.5,
+    },
+  });
+
+  it('accepts an unprefixed id and prepends "project:" automatically', () => {
+    const graph = buildGraph(weights);
+    const result = getSubgraph(graph, 'github.com/user/repo');
+    expect(result.edges.length).toBe(2);
+    for (const edge of result.edges) {
+      expect(
+        edge.source === 'project:github.com/user/repo' ||
+        edge.target === 'project:github.com/user/repo'
+      ).toBe(true);
+    }
+  });
+
+  it('does NOT double-prefix when id already starts with "project:"', () => {
+    const graph = buildGraph(weights);
+    const withPrefix = getSubgraph(graph, 'project:github.com/user/repo');
+    const withoutPrefix = getSubgraph(graph, 'github.com/user/repo');
+    expect(withPrefix.edges.length).toBe(withoutPrefix.edges.length);
+    expect(withPrefix.edges.map((e) => e.id).sort()).toEqual(
+      withoutPrefix.edges.map((e) => e.id).sort()
+    );
+  });
+
+  it('does not match double-prefixed id "project:project:..."', () => {
+    const graph = buildGraph(weights);
+    const result = getSubgraph(graph, 'project:project:github.com/user/repo');
+    expect(result.edges).toEqual([]);
+  });
+
+  it('uses exact string equality — project:c:/dev does not match project:c:/dev/sub', () => {
+    const pathWeights = makeWeights({
+      'project:c:/dev||tool:Edit': { source: 'project:c:/dev', target: 'tool:Edit', weight: 1.0 },
+      'project:c:/dev/sub||tool:Write': {
+        source: 'project:c:/dev/sub',
+        target: 'tool:Write',
+        weight: 0.5,
+      },
+    });
+    const graph = buildGraph(pathWeights);
+    const result = getSubgraph(graph, 'project:c:/dev');
+    expect(result.edges.length).toBe(1);
+    expect(result.edges[0].source).toBe('project:c:/dev');
+  });
+
+  it('collects only the nodes referenced by the matched edges', () => {
+    const graph = buildGraph(weights);
+    const result = getSubgraph(graph, 'github.com/user/repo');
+    const nodeIds = new Set(result.nodes.map((n) => n.id));
+    for (const edge of result.edges) {
+      expect(nodeIds.has(edge.source)).toBe(true);
+      expect(nodeIds.has(edge.target)).toBe(true);
+    }
+    // Should not include nodes from unmatched edges
+    expect(nodeIds.has('project:github.com/user/other')).toBe(false);
+    expect(nodeIds.has('tool:Bash')).toBe(false);
+  });
+
+  it('returns empty GraphResponse when graph is empty', () => {
+    const graph = buildGraph(emptyWeights);
+    const result = getSubgraph(graph, 'github.com/user/repo');
+    expect(result.edges).toEqual([]);
+    expect(result.nodes).toEqual([]);
+  });
+
+  it('returns empty GraphResponse when no edges match the normalized id', () => {
+    const graph = buildGraph(weights);
+    const result = getSubgraph(graph, 'project:nonexistent');
+    expect(result.edges).toEqual([]);
+    expect(result.nodes).toEqual([]);
+  });
+});
+
+describe('getTopEdges', () => {
+  const weights = makeWeights({
+    'project:a||tool:Edit': { source: 'project:a', target: 'tool:Edit', weight: 5.0 },
+    'project:b||tool:Write': { source: 'project:b', target: 'tool:Write', weight: 3.0 },
+    'project:c||skill:gsd': { source: 'project:c', target: 'skill:gsd', weight: 2.0, type: 'project->skill' },
+    'project:d||tool:Bash': { source: 'project:d', target: 'tool:Bash', weight: 1.5 },
+    'project:e||tool:Read': { source: 'project:e', target: 'tool:Read', weight: 1.0 },
+  });
+
+  it('returns the top N edges by weight in descending order', () => {
+    const graph = buildGraph(weights);
+    const result = getTopEdges(graph, 3);
+    expect(result.edges.length).toBe(3);
+    expect(result.edges[0].weight).toBeGreaterThanOrEqual(result.edges[1].weight);
+    expect(result.edges[1].weight).toBeGreaterThanOrEqual(result.edges[2].weight);
+    expect(result.edges[0].weight).toBe(5.0);
+  });
+
+  it('returns only the nodes referenced by the returned edges', () => {
+    const graph = buildGraph(weights);
+    const result = getTopEdges(graph, 2);
+    expect(result.edges.length).toBe(2);
+    const nodeIds = new Set(result.nodes.map((n) => n.id));
+    for (const edge of result.edges) {
+      expect(nodeIds.has(edge.source)).toBe(true);
+      expect(nodeIds.has(edge.target)).toBe(true);
+    }
+    // Nodes from edges 3–5 should not appear
+    expect(nodeIds.has('project:c')).toBe(false);
+    expect(nodeIds.has('project:d')).toBe(false);
+    expect(nodeIds.has('project:e')).toBe(false);
+  });
+
+  it('returns all edges when limit exceeds total edge count', () => {
+    const graph = buildGraph(weights);
+    const result = getTopEdges(graph, 100);
+    expect(result.edges.length).toBe(5);
+  });
+
+  it('returns empty GraphResponse when graph is empty', () => {
+    const graph = buildGraph(emptyWeights);
+    const result = getTopEdges(graph, 10);
+    expect(result.edges).toEqual([]);
+    expect(result.nodes).toEqual([]);
+  });
+
+  it('returns empty GraphResponse when limit is 0', () => {
+    const graph = buildGraph(weights);
+    const result = getTopEdges(graph, 0);
+    expect(result.edges).toEqual([]);
+    expect(result.nodes).toEqual([]);
+  });
+});
