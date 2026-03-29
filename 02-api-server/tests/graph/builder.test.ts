import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import type { WeightsFile } from '../../src/graph/types.js';

const emptyWeights: WeightsFile = {
  schema_version: 1,
  updated_at: '2025-01-01T00:00:00.000Z',
  connections: {},
};

describe('buildGraph', () => {
  it('returns empty InMemoryGraph for empty WeightsFile', () => {
    const graph = buildGraph(emptyWeights);
    expect(graph.nodeIndex.size).toBe(0);
    expect(graph.edgeList.length).toBe(0);
    expect(graph.edgeIndex.size).toBe(0);
    expect(graph.adjacency.size).toBe(0);
  });

  it('builds one edge and two nodes from a single connection', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||tool:Edit': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 5,
          weight: 0.75,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-06-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-06-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.nodeIndex.size).toBe(2);
    expect(graph.edgeList.length).toBe(1);
    expect(graph.edgeIndex.size).toBe(1);
    expect(graph.edgeIndex.has('project:github.com/user/repo||tool:Edit')).toBe(true);
    expect(graph.adjacency.has('project:github.com/user/repo')).toBe(true);
    expect(graph.adjacency.has('tool:Edit')).toBe(true);
  });

  it('parses node type prefix correctly for project, tool, and skill', () => {
    const weights: WeightsFile = {
      connections: {
        'project:my-repo||tool:Write': {
          source_node: 'project:my-repo',
          target_node: 'tool:Write',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:my-repo||skill:gsd': {
          source_node: 'project:my-repo',
          target_node: 'skill:gsd',
          connection_type: 'project->skill',
          raw_count: 2,
          weight: 0.6,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.nodeIndex.get('project:my-repo')?.type).toBe('project');
    expect(graph.nodeIndex.get('tool:Write')?.type).toBe('tool');
    expect(graph.nodeIndex.get('skill:gsd')?.type).toBe('skill');
    expect(graph.nodeIndex.get('project:my-repo')?.label).toBe('my-repo');
    expect(graph.nodeIndex.get('tool:Write')?.label).toBe('Write');
    expect(graph.nodeIndex.get('skill:gsd')?.label).toBe('gsd');
  });

  it('sorts edgeList descending by weight', () => {
    const weights: WeightsFile = {
      connections: {
        'project:a||tool:Edit': {
          source_node: 'project:a',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:a||tool:Write': {
          source_node: 'project:a',
          target_node: 'tool:Write',
          connection_type: 'project->tool',
          raw_count: 3,
          weight: 3.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:a||tool:Bash': {
          source_node: 'project:a',
          target_node: 'tool:Bash',
          connection_type: 'project->tool',
          raw_count: 2,
          weight: 2.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.edgeList.map((e) => e.weight)).toEqual([3.0, 2.0, 1.0]);
  });

  it('adjacency maps each node to all edges it participates in as source and target', () => {
    // project:a: source in 2 edges (→tool:Edit, →tool:Write), target in 1 edge (project:b→project:a) = 3 total
    const weights: WeightsFile = {
      connections: {
        'project:a||tool:Edit': {
          source_node: 'project:a',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:a||tool:Write': {
          source_node: 'project:a',
          target_node: 'tool:Write',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.6,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:b||project:a': {
          source_node: 'project:b',
          target_node: 'project:a',
          connection_type: 'project->project',
          raw_count: 1,
          weight: 0.7,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    // project:a: source in 2 + target in 1 = 3 total
    expect(graph.adjacency.get('project:a')).toHaveLength(3);
    // project:b: source in 1 edge only
    expect(graph.adjacency.get('project:b')).toHaveLength(1);
    // tool:Write: target in 1 edge only
    expect(graph.adjacency.get('tool:Write')).toHaveLength(1);
  });

  it('each unique WeightsFile key produces exactly one edge', () => {
    // WeightsFile.connections keys are unique by definition — no deduplication needed,
    // but each key must map to exactly one edge in edgeList and edgeIndex.
    const weights: WeightsFile = {
      connections: {
        'project:a||tool:Edit': {
          source_node: 'project:a',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 5,
          weight: 0.8,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:a||tool:Write': {
          source_node: 'project:a',
          target_node: 'tool:Write',
          connection_type: 'project->tool',
          raw_count: 3,
          weight: 0.6,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.edgeList.length).toBe(2);
    expect(graph.edgeIndex.size).toBe(2);
    expect(graph.edgeIndex.has('project:a||tool:Edit')).toBe(true);
    expect(graph.edgeIndex.has('project:a||tool:Write')).toBe(true);
  });

  it('node ids with colons in value parse label correctly', () => {
    // "project:github.com/user/repo" → type=project, label=github.com/user/repo
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||tool:Edit': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    const node = graph.nodeIndex.get('project:github.com/user/repo');
    expect(node?.type).toBe('project');
    expect(node?.label).toBe('github.com/user/repo');
  });
});
