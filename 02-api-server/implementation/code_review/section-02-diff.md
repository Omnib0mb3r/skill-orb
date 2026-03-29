diff --git a/02-api-server/src/graph/builder.ts b/02-api-server/src/graph/builder.ts
new file mode 100644
index 0000000..b314948
--- /dev/null
+++ b/02-api-server/src/graph/builder.ts
@@ -0,0 +1,50 @@
+import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge } from './types.js';
+
+function parseNode(id: string): GraphNode {
+  const colonIdx = id.indexOf(':');
+  const prefix = id.slice(0, colonIdx);
+  const label = id.slice(colonIdx + 1);
+  const type = (prefix === 'project' || prefix === 'tool' || prefix === 'skill')
+    ? prefix
+    : 'skill';
+  return { id, type, label };
+}
+
+export function buildGraph(weights: WeightsFile): InMemoryGraph {
+  const nodeIndex = new Map<string, GraphNode>();
+  const edgeList: GraphEdge[] = [];
+  const edgeIndex = new Map<string, GraphEdge>();
+  const adjacency = new Map<string, string[]>();
+
+  for (const [key, entry] of Object.entries(weights.connections)) {
+    const edge: GraphEdge = {
+      id: key,
+      source: entry.source_node,
+      target: entry.target_node,
+      connection_type: entry.connection_type,
+      raw_count: entry.raw_count,
+      weight: entry.weight,
+      first_seen: entry.first_seen,
+      last_seen: entry.last_seen,
+    };
+
+    edgeList.push(edge);
+    edgeIndex.set(key, edge);
+
+    for (const nodeId of [entry.source_node, entry.target_node]) {
+      if (!nodeIndex.has(nodeId)) {
+        nodeIndex.set(nodeId, parseNode(nodeId));
+      }
+      const adj = adjacency.get(nodeId);
+      if (adj) {
+        adj.push(key);
+      } else {
+        adjacency.set(nodeId, [key]);
+      }
+    }
+  }
+
+  edgeList.sort((a, b) => b.weight - a.weight);
+
+  return { nodeIndex, edgeList, edgeIndex, adjacency };
+}
diff --git a/02-api-server/src/graph/types.ts b/02-api-server/src/graph/types.ts
new file mode 100644
index 0000000..cc1eaa5
--- /dev/null
+++ b/02-api-server/src/graph/types.ts
@@ -0,0 +1,55 @@
+export type ConnectionType =
+  | 'project->tool'
+  | 'project->project'
+  | 'project->skill'
+  | 'tool->skill';
+
+export interface WeightsFileEntry {
+  source_node: string;
+  target_node: string;
+  connection_type: ConnectionType;
+  raw_count: number;
+  weight: number;
+  first_seen: string;
+  last_seen: string;
+}
+
+export interface WeightsFile {
+  connections: Record<string, WeightsFileEntry>;
+  last_updated: string;
+  version: string;
+}
+
+export interface GraphNode {
+  id: string;
+  type: 'project' | 'tool' | 'skill';
+  label: string;
+}
+
+export interface GraphEdge {
+  id: string;
+  source: string;
+  target: string;
+  connection_type: ConnectionType;
+  raw_count: number;
+  weight: number;
+  first_seen: string;
+  last_seen: string;
+}
+
+export interface GraphResponse {
+  nodes: GraphNode[];
+  edges: GraphEdge[];
+  updated_at: string;
+}
+
+export interface InMemoryGraph {
+  /** O(1) lookup by node id */
+  nodeIndex: Map<string, GraphNode>;
+  /** All edges, sorted descending by weight at build time */
+  edgeList: GraphEdge[];
+  /** O(1) lookup by edge id (the "source||target" key) */
+  edgeIndex: Map<string, GraphEdge>;
+  /** Maps node id → list of edge ids the node participates in (as source or target) */
+  adjacency: Map<string, string[]>;
+}
diff --git a/02-api-server/tests/graph/builder.test.ts b/02-api-server/tests/graph/builder.test.ts
new file mode 100644
index 0000000..a12f658
--- /dev/null
+++ b/02-api-server/tests/graph/builder.test.ts
@@ -0,0 +1,182 @@
+import { describe, it, expect } from 'vitest';
+import { buildGraph } from '../../src/graph/builder.js';
+import type { WeightsFile } from '../../src/graph/types.js';
+
+const emptyWeights: WeightsFile = {
+  connections: {},
+  last_updated: '2025-01-01T00:00:00.000Z',
+  version: '1.0',
+};
+
+describe('buildGraph', () => {
+  it('returns empty InMemoryGraph for empty WeightsFile', () => {
+    const graph = buildGraph(emptyWeights);
+    expect(graph.nodeIndex.size).toBe(0);
+    expect(graph.edgeList.length).toBe(0);
+    expect(graph.edgeIndex.size).toBe(0);
+    expect(graph.adjacency.size).toBe(0);
+  });
+
+  it('builds one edge and two nodes from a single connection', () => {
+    const weights: WeightsFile = {
+      connections: {
+        'project:github.com/user/repo||tool:Edit': {
+          source_node: 'project:github.com/user/repo',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 5,
+          weight: 0.75,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-06-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-06-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    const graph = buildGraph(weights);
+    expect(graph.nodeIndex.size).toBe(2);
+    expect(graph.edgeList.length).toBe(1);
+    expect(graph.edgeIndex.size).toBe(1);
+    expect(graph.edgeIndex.has('project:github.com/user/repo||tool:Edit')).toBe(true);
+    expect(graph.adjacency.has('project:github.com/user/repo')).toBe(true);
+    expect(graph.adjacency.has('tool:Edit')).toBe(true);
+  });
+
+  it('parses node type prefix correctly for project, tool, and skill', () => {
+    const weights: WeightsFile = {
+      connections: {
+        'project:my-repo||tool:Write': {
+          source_node: 'project:my-repo',
+          target_node: 'tool:Write',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 0.5,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+        'project:my-repo||skill:gsd': {
+          source_node: 'project:my-repo',
+          target_node: 'skill:gsd',
+          connection_type: 'project->skill',
+          raw_count: 2,
+          weight: 0.6,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-01-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    const graph = buildGraph(weights);
+    expect(graph.nodeIndex.get('project:my-repo')?.type).toBe('project');
+    expect(graph.nodeIndex.get('tool:Write')?.type).toBe('tool');
+    expect(graph.nodeIndex.get('skill:gsd')?.type).toBe('skill');
+    expect(graph.nodeIndex.get('project:my-repo')?.label).toBe('my-repo');
+    expect(graph.nodeIndex.get('tool:Write')?.label).toBe('Write');
+    expect(graph.nodeIndex.get('skill:gsd')?.label).toBe('gsd');
+  });
+
+  it('sorts edgeList descending by weight', () => {
+    const weights: WeightsFile = {
+      connections: {
+        'project:a||tool:Edit': {
+          source_node: 'project:a',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 1.0,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+        'project:a||tool:Write': {
+          source_node: 'project:a',
+          target_node: 'tool:Write',
+          connection_type: 'project->tool',
+          raw_count: 3,
+          weight: 3.0,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+        'project:a||tool:Bash': {
+          source_node: 'project:a',
+          target_node: 'tool:Bash',
+          connection_type: 'project->tool',
+          raw_count: 2,
+          weight: 2.0,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-01-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    const graph = buildGraph(weights);
+    expect(graph.edgeList.map((e) => e.weight)).toEqual([3.0, 2.0, 1.0]);
+  });
+
+  it('adjacency maps each node to all edges it participates in', () => {
+    const weights: WeightsFile = {
+      connections: {
+        'project:a||tool:Edit': {
+          source_node: 'project:a',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 0.5,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+        'project:a||tool:Write': {
+          source_node: 'project:a',
+          target_node: 'tool:Write',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 0.6,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+        'project:b||tool:Edit': {
+          source_node: 'project:b',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 0.7,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-01-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    const graph = buildGraph(weights);
+    // project:a is source in 2 edges
+    expect(graph.adjacency.get('project:a')).toHaveLength(2);
+    // tool:Edit is target in 2 edges (from project:a and project:b)
+    expect(graph.adjacency.get('tool:Edit')).toHaveLength(2);
+    // tool:Write is target in 1 edge
+    expect(graph.adjacency.get('tool:Write')).toHaveLength(1);
+  });
+
+  it('node ids with colons in value parse label correctly', () => {
+    // "project:github.com/user/repo" → type=project, label=github.com/user/repo
+    const weights: WeightsFile = {
+      connections: {
+        'project:github.com/user/repo||tool:Edit': {
+          source_node: 'project:github.com/user/repo',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 0.5,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-01-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    const graph = buildGraph(weights);
+    const node = graph.nodeIndex.get('project:github.com/user/repo');
+    expect(node?.type).toBe('project');
+    expect(node?.label).toBe('github.com/user/repo');
+  });
+});
