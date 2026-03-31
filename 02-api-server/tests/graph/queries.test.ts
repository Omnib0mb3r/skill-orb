import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import { getFullGraph, getNodeById, getSubgraph, getTopEdges } from '../../src/graph/queries.js';
import type { WeightsFile } from '../../src/graph/types.js';

const UPDATED_AT = '2024-01-01T00:00:00.000Z';

function makeWeights(
  entries: Record<
    string,
    {
      source: string;
      target: string;
      weight: number;
      type?: 'project->tool' | 'project->project' | 'project->skill' | 'tool->skill';
    }
  >
): WeightsFile {
  const connections: WeightsFile['connections'] = {};
  for (const [key, e] of Object.entries(entries)) {
    connections[key] = {
      source_node: e.source,
      target_node: e.target,
      connection_type: e.type ?? 'project->tool',
      raw_count: 1,
      weight: e.weight,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-01-01T00:00:00.000Z',
    };
  }
  return { connections, schema_version: 1, updated_at: '2025-01-01T00:00:00.000Z' };
}

const emptyWeights: WeightsFile = {
  connections: {},
  schema_version: 1,
  updated_at: '2025-01-01T00:00:00.000Z',
};

describe('getFullGraph', () => {
  it('returns all nodes and edges from a populated InMemoryGraph', () => {
    const weights = makeWeights({
      'project:github.com/user/repo-a||tool:Agent': { source: 'project:github.com/user/repo-a', target: 'tool:Agent', weight: 1.0 },
      'project:github.com/user/repo-b||tool:WebSearch': { source: 'project:github.com/user/repo-b', target: 'tool:WebSearch', weight: 0.5 },
    });
    const graph = buildGraph(weights);
    const result = getFullGraph(graph, UPDATED_AT);
    expect(result.nodes.length).toBe(graph.nodeIndex.size);
    expect(result.edges.length).toBe(graph.edgeList.length);
    expect(result.updated_at).toBe(UPDATED_AT);
  });

  it('returns { nodes: [], edges: [], updated_at } when graph is empty', () => {
    const graph = buildGraph(emptyWeights);
    const result = getFullGraph(graph, UPDATED_AT);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.updated_at).toBe(UPDATED_AT);
  });
});

describe('getNodeById', () => {
  it('returns { node, edges } for a node that exists in the graph', () => {
    const weights = makeWeights({
      'project:github.com/user/repo-a||tool:Agent': { source: 'project:github.com/user/repo-a', target: 'tool:Agent', weight: 1.0 },
      'project:github.com/user/repo-a||tool:WebSearch': { source: 'project:github.com/user/repo-a', target: 'tool:WebSearch', weight: 0.5 },
      'project:github.com/user/repo-b||tool:Agent': { source: 'project:github.com/user/repo-b', target: 'tool:Agent', weight: 0.8 },
    });
    const graph = buildGraph(weights);
    const result = getNodeById(graph, 'project:github.com/user/repo-a');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('project:github.com/user/repo-a');
    // Only edges where project:github.com/user/repo-a is source or target
    expect(result!.edges.length).toBe(2);
    for (const edge of result!.edges) {
      expect(edge.source === 'project:github.com/user/repo-a' || edge.target === 'project:github.com/user/repo-a').toBe(true);
    }
  });

  it('returns null for a nodeId that does not exist', () => {
    const graph = buildGraph(emptyWeights);
    expect(getNodeById(graph, 'project:nonexistent')).toBeNull();
  });

  it('returns edges for a node that only appears as target (not source)', () => {
    const weights = makeWeights({
      'project:github.com/user/repo-a||tool:Agent': { source: 'project:github.com/user/repo-a', target: 'tool:Agent', weight: 1.0 },
      'project:github.com/user/repo-b||tool:Agent': { source: 'project:github.com/user/repo-b', target: 'tool:Agent', weight: 0.5 },
    });
    const graph = buildGraph(weights);
    // tool:Agent only appears as target
    const result = getNodeById(graph, 'tool:Agent');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('tool:Agent');
    expect(result!.edges.length).toBe(2);
    for (const edge of result!.edges) {
      expect(edge.target).toBe('tool:Agent');
    }
  });

  it('returns node with empty edges array for isolated node', () => {
    // Build a graph then verify adjacency-based lookup handles missing adjacency entry
    const weights = makeWeights({
      'project:github.com/user/repo-a||tool:Agent': { source: 'project:github.com/user/repo-a', target: 'tool:Agent', weight: 1.0 },
    });
    const graph = buildGraph(weights);
    // Manually insert an isolated node with no adjacency entry
    graph.nodeIndex.set('skill:isolated', { id: 'skill:isolated', type: 'skill', label: 'isolated' });
    const result = getNodeById(graph, 'skill:isolated');
    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
  });
});

describe('getSubgraph', () => {
  const weights = makeWeights({
    'project:github.com/user/repo||tool:Agent': {
      source: 'project:github.com/user/repo',
      target: 'tool:Agent',
      weight: 1.0,
    },
    'project:github.com/user/repo||skill:gsd': {
      source: 'project:github.com/user/repo',
      target: 'skill:gsd',
      weight: 0.8,
      type: 'project->skill',
    },
    'project:github.com/user/other||tool:WebSearch': {
      source: 'project:github.com/user/other',
      target: 'tool:WebSearch',
      weight: 0.5,
    },
  });

  it('accepts an unprefixed id and prepends "project:" automatically', () => {
    const graph = buildGraph(weights);
    const result = getSubgraph(graph, 'github.com/user/repo');
    expect(result.edges.length).toBe(2);
    for (const edge of result.edges) {
      expect(
        edge.source === 'project:github.com/user/repo' ||
        edge.target === 'project:github.com/user/repo'
      ).toBe(true);
    }
  });

  it('does NOT double-prefix when id already starts with "project:"', () => {
    const graph = buildGraph(weights);
    const withPrefix = getSubgraph(graph, 'project:github.com/user/repo');
    const withoutPrefix = getSubgraph(graph, 'github.com/user/repo');
    // Both should return the same non-empty result
    expect(withPrefix.edges.length).toBeGreaterThan(0);
    expect(withPrefix.edges.length).toBe(withoutPrefix.edges.length);
    expect(withPrefix.edges.map((e) => e.id).sort()).toEqual(
      withoutPrefix.edges.map((e) => e.id).sort()
    );
  });

  it('does not match double-prefixed id "project:project:..."', () => {
    const graph = buildGraph(weights);
    const result = getSubgraph(graph, 'project:project:github.com/user/repo');
    expect(result.edges).toEqual([]);
  });

  it('uses exact string equality — project:github.com/user/repo does not match project:github.com/user/repo-sub', () => {
    const pathWeights = makeWeights({
      'project:github.com/user/repo||tool:Agent': { source: 'project:github.com/user/repo', target: 'tool:Agent', weight: 1.0 },
      'project:github.com/user/repo-sub||tool:WebSearch': {
        source: 'project:github.com/user/repo-sub',
        target: 'tool:WebSearch',
        weight: 0.5,
      },
    });
    const graph = buildGraph(pathWeights);
    const result = getSubgraph(graph, 'project:github.com/user/repo');
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].source).toBe('project:github.com/user/repo');
  });

  it('collects only the nodes referenced by the matched edges', () => {
    const graph = buildGraph(weights);
    const result = getSubgraph(graph, 'github.com/user/repo');
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    // Should not include nodes from unmatched edges
    expect(nodeIds.has('project:github.com/user/other')).toBe(false);
    expect(nodeIds.has('tool:WebSearch')).toBe(false);
  });

  it('returns empty GraphResponse when graph is empty', () => {
    const graph = buildGraph(emptyWeights);
    const result = getSubgraph(graph, 'github.com/user/repo');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
  });

  it('returns empty GraphResponse when no edges match the normalized id', () => {
    const graph = buildGraph(weights);
    const result = getSubgraph(graph, 'project:nonexistent');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
  });
});

describe('getTopEdges', () => {
  const weights = makeWeights({
    'project:github.com/user/repo-a||tool:Agent': { source: 'project:github.com/user/repo-a', target: 'tool:Agent', weight: 5.0 },
    'project:github.com/user/repo-b||tool:WebSearch': { source: 'project:github.com/user/repo-b', target: 'tool:WebSearch', weight: 3.0 },
    'project:github.com/user/repo-c||skill:gsd': { source: 'project:github.com/user/repo-c', target: 'skill:gsd', weight: 2.0, type: 'project->skill' },
    'project:github.com/user/repo-d||tool:Agent': { source: 'project:github.com/user/repo-d', target: 'tool:Agent', weight: 1.5 },
    'project:github.com/user/repo-e||tool:WebSearch': { source: 'project:github.com/user/repo-e', target: 'tool:WebSearch', weight: 1.0 },
  });

  it('returns the top N edges by weight in descending order', () => {
    const graph = buildGraph(weights);
    const result = getTopEdges(graph, 3);
    expect(result.edges.length).toBe(3);
    expect(result.edges[0].weight).toBeGreaterThanOrEqual(result.edges[1].weight);
    expect(result.edges[1].weight).toBeGreaterThanOrEqual(result.edges[2].weight);
    expect(result.edges[0].weight).toBe(5.0);
  });

  it('returns only the nodes referenced by the returned edges', () => {
    const graph = buildGraph(weights);
    const result = getTopEdges(graph, 2);
    expect(result.edges.length).toBe(2);
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    // Nodes from edges 3–5 should not appear
    expect(nodeIds.has('project:github.com/user/repo-c')).toBe(false);
    expect(nodeIds.has('project:github.com/user/repo-d')).toBe(false);
    expect(nodeIds.has('project:github.com/user/repo-e')).toBe(false);
  });

  it('returns all edges when limit exceeds total edge count', () => {
    const graph = buildGraph(weights);
    const result = getTopEdges(graph, 100);
    expect(result.edges.length).toBe(5);
  });

  it('returns empty GraphResponse when graph is empty', () => {
    const graph = buildGraph(emptyWeights);
    const result = getTopEdges(graph, 10);
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
  });

  it('returns empty GraphResponse when limit is 0', () => {
    const graph = buildGraph(weights);
    const result = getTopEdges(graph, 0);
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
  });
});
