import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import { getFullGraph } from '../../src/graph/queries.js';
import { ServerMessageSchema } from '../../src/ws/types.js';
import type { WeightsFile, ProjectRegistry, ProjectMeta } from '../../src/graph/types.js';

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
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
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
    expect(graph.edgeIndex.has('project:github.com/user/repo||skill:deep-plan')).toBe(true);
    expect(graph.adjacency.has('project:github.com/user/repo')).toBe(true);
    expect(graph.adjacency.has('skill:deep-plan')).toBe(true);
  });

  it('parses node type prefix correctly for project, tool, and skill', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/my-repo||tool:Agent': {
          source_node: 'project:github.com/user/my-repo',
          target_node: 'tool:Agent',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/my-repo||skill:gsd': {
          source_node: 'project:github.com/user/my-repo',
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
    expect(graph.nodeIndex.get('project:github.com/user/my-repo')?.type).toBe('project');
    expect(graph.nodeIndex.get('tool:Agent')?.type).toBe('tool');
    expect(graph.nodeIndex.get('skill:gsd')?.type).toBe('skill');
    expect(graph.nodeIndex.get('project:github.com/user/my-repo')?.label).toBe('github.com/user/my-repo');
    expect(graph.nodeIndex.get('tool:Agent')?.label).toBe('Agent');
    expect(graph.nodeIndex.get('skill:gsd')?.label).toBe('gsd');
  });

  it('sorts edgeList descending by weight', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1,
          weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:deep-implement': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-implement',
          connection_type: 'project->skill',
          raw_count: 3,
          weight: 3.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||tool:Agent': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Agent',
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
    // repo-b must also be an active source (non-p→p edge) so the p→p edge passes the filter
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo-a||tool:Agent': {
          source_node: 'project:github.com/user/repo-a',
          target_node: 'tool:Agent',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo-a||skill:deep-plan': {
          source_node: 'project:github.com/user/repo-a',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1,
          weight: 0.6,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo-b||skill:deep-plan': {
          source_node: 'project:github.com/user/repo-b',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1,
          weight: 0.4,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo-b||project:github.com/user/repo-a': {
          source_node: 'project:github.com/user/repo-b',
          target_node: 'project:github.com/user/repo-a',
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
    // repo-a: source in 2 edges (tool:Agent, skill:deep-plan) + target in 1 (repo-b→repo-a) = 3 total
    expect(graph.adjacency.get('project:github.com/user/repo-a')).toHaveLength(3);
    // repo-b: source in 2 edges (skill:deep-plan, repo-a p→p)
    expect(graph.adjacency.get('project:github.com/user/repo-b')).toHaveLength(2);
    // skill:deep-plan: target in 2 edges (repo-a and repo-b both connect to it)
    expect(graph.adjacency.get('skill:deep-plan')).toHaveLength(2);
  });

  it('each unique WeightsFile key produces exactly one edge', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 5,
          weight: 0.8,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:deep-implement': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-implement',
          connection_type: 'project->skill',
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
    expect(graph.edgeIndex.has('project:github.com/user/repo||skill:deep-plan')).toBe(true);
    expect(graph.edgeIndex.has('project:github.com/user/repo||skill:deep-implement')).toBe(true);
  });

  it('node ids with colons in value parse label correctly', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
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

// ── Filtering ─────────────────────────────────────────────────────────────────

describe('buildGraph filtering', () => {
  it('drops excluded tools (Bash, Edit, Write, Read, Glob, Grep)', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||tool:Bash': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Bash',
          connection_type: 'project->tool',
          raw_count: 1, weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||tool:Edit': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 1, weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||tool:Write': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Write',
          connection_type: 'project->tool',
          raw_count: 1, weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||tool:Agent': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Agent',
          connection_type: 'project->tool',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    // Only Agent survives
    expect(graph.edgeList.length).toBe(1);
    expect(graph.nodeIndex.has('tool:Bash')).toBe(false);
    expect(graph.nodeIndex.has('tool:Edit')).toBe(false);
    expect(graph.nodeIndex.has('tool:Write')).toBe(false);
    expect(graph.nodeIndex.has('tool:Agent')).toBe(true);
  });

  it('drops project nodes that are not real github.com repos', () => {
    const weights: WeightsFile = {
      connections: {
        'project:c:/local/path||skill:deep-plan': {
          source_node: 'project:c:/local/path',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:${templateVar}||skill:deep-plan': {
          source_node: 'project:${templateVar}',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.8,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.edgeList.length).toBe(1);
    expect(graph.nodeIndex.has('project:c:/local/path')).toBe(false);
    expect(graph.nodeIndex.has('project:github.com/user/repo')).toBe(true);
  });

  it('drops section-NN skill nodes and unknown-skill', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:section-01': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:section-01',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:unknown-skill': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:unknown-skill',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:deep-plan': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.8,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.edgeList.length).toBe(1);
    expect(graph.nodeIndex.has('skill:section-01')).toBe(false);
    expect(graph.nodeIndex.has('skill:unknown-skill')).toBe(false);
    expect(graph.nodeIndex.has('skill:deep-plan')).toBe(true);
  });

  it('normalizes namespaced skills and de-duplicates resulting edges', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:deep-plan:section-writer': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan:section-writer',
          connection_type: 'project->skill',
          raw_count: 3, weight: 0.7,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-04-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:deep-plan:opus-plan-reviewer': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:deep-plan:opus-plan-reviewer',
          connection_type: 'project->skill',
          raw_count: 2, weight: 0.9,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-06-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-06-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    // Both collapse to skill:deep-plan — should produce a single merged edge
    expect(graph.edgeList.length).toBe(1);
    const edge = graph.edgeList[0];
    expect(edge.source).toBe('project:github.com/user/repo');
    expect(edge.target).toBe('skill:deep-plan');
    // raw_count merged (3+2=5), weight takes max (0.9), last_seen takes latest
    expect(edge.raw_count).toBe(5);
    expect(edge.weight).toBe(0.9);
    expect(edge.last_seen).toBe('2025-06-01T00:00:00.000Z');
    // Single merged node for deep-plan
    expect(graph.nodeIndex.has('skill:deep-plan')).toBe(true);
    expect(graph.nodeIndex.has('skill:deep-plan:section-writer')).toBe(false);
  });

  it('normalizes gsd-* sub-agents to skill:gsd', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo||skill:gsd-planner': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:gsd-planner',
          connection_type: 'project->skill',
          raw_count: 1, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo||skill:gsd-executor': {
          source_node: 'project:github.com/user/repo',
          target_node: 'skill:gsd-executor',
          connection_type: 'project->skill',
          raw_count: 2, weight: 0.6,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    expect(graph.edgeList.length).toBe(1);
    expect(graph.nodeIndex.has('skill:gsd')).toBe(true);
    expect(graph.nodeIndex.has('skill:gsd-planner')).toBe(false);
    expect(graph.nodeIndex.has('skill:gsd-executor')).toBe(false);
  });

  it('drops project→project edges where target is URL-mentioned but never an active source', () => {
    const weights: WeightsFile = {
      connections: {
        // DevNeural actively uses Claude (appears as source of a skill connection)
        'project:github.com/user/devneural||skill:deep-plan': {
          source_node: 'project:github.com/user/devneural',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 5, weight: 0.8,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        // Jarvis only appears because its URL was mentioned in a prompt — never the source
        'project:github.com/user/devneural||project:github.com/other/jarvis': {
          source_node: 'project:github.com/user/devneural',
          target_node: 'project:github.com/other/jarvis',
          connection_type: 'project->project',
          raw_count: 1, weight: 0.3,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    // Only the skill edge remains; jarvis edge is dropped (jarvis never a source)
    expect(graph.edgeList.length).toBe(1);
    expect(graph.nodeIndex.has('project:github.com/other/jarvis')).toBe(false);
    expect(graph.nodeIndex.has('skill:deep-plan')).toBe(true);
  });

  it('keeps project→project edges when both projects are active sources', () => {
    const weights: WeightsFile = {
      connections: {
        'project:github.com/user/repo-a||skill:deep-plan': {
          source_node: 'project:github.com/user/repo-a',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 2, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo-b||skill:deep-plan': {
          source_node: 'project:github.com/user/repo-b',
          target_node: 'skill:deep-plan',
          connection_type: 'project->skill',
          raw_count: 2, weight: 0.5,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
        'project:github.com/user/repo-a||project:github.com/user/repo-b': {
          source_node: 'project:github.com/user/repo-a',
          target_node: 'project:github.com/user/repo-b',
          connection_type: 'project->project',
          raw_count: 1, weight: 0.4,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    const graph = buildGraph(weights);
    // All 3 edges kept; both projects are active sources
    expect(graph.edgeList.length).toBe(3);
    expect(graph.nodeIndex.has('project:github.com/user/repo-a')).toBe(true);
    expect(graph.nodeIndex.has('project:github.com/user/repo-b')).toBe(true);
  });
});

// ── ProjectRegistry enrichment ────────────────────────────────────────────────

const projectWeights: WeightsFile = {
  connections: {
    'project:github.com/user/repo||tool:Agent': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Agent',
      connection_type: 'project->tool',
      raw_count: 5,
      weight: 0.8,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-06-01T00:00:00.000Z',
    },
    'project:github.com/user/repo||skill:gsd': {
      source_node: 'project:github.com/user/repo',
      target_node: 'skill:gsd',
      connection_type: 'project->skill',
      raw_count: 2,
      weight: 0.5,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-06-01T00:00:00.000Z',
    },
  },
  schema_version: 1,
  updated_at: '2025-06-01T00:00:00.000Z',
};

const repoMeta: ProjectMeta = {
  stage: 'alpha',
  tags: ['sandbox'],
  localPath: 'c:/dev/user/repo',
};

describe('buildGraph with ProjectRegistry', () => {
  it('GraphNode for a project with a registry entry gets stage, tags, and localPath populated', () => {
    const registry: ProjectRegistry = new Map([
      ['project:github.com/user/repo', repoMeta],
    ]);
    const graph = buildGraph(projectWeights, registry);
    const node = graph.nodeIndex.get('project:github.com/user/repo');
    expect(node?.stage).toBe('alpha');
    expect(node?.tags).toEqual(['sandbox']);
    expect(node?.localPath).toBe('c:/dev/user/repo');
  });

  it('GraphNode for a project WITHOUT a registry entry has no stage, tags, or localPath keys', () => {
    const graph = buildGraph(projectWeights);
    const node = graph.nodeIndex.get('project:github.com/user/repo');
    const serialized = JSON.parse(JSON.stringify(node));
    expect(serialized).not.toHaveProperty('stage');
    expect(serialized).not.toHaveProperty('tags');
    expect(serialized).not.toHaveProperty('localPath');
  });

  it('GraphNode for tool and skill nodes never carries stage/tags/localPath regardless of registry', () => {
    const registry: ProjectRegistry = new Map([
      ['project:github.com/user/repo', repoMeta],
    ]);
    const graph = buildGraph(projectWeights, registry);
    const toolNode = graph.nodeIndex.get('tool:Agent');
    const skillNode = graph.nodeIndex.get('skill:gsd');
    for (const node of [toolNode, skillNode]) {
      const serialized = JSON.parse(JSON.stringify(node));
      expect(serialized).not.toHaveProperty('stage');
      expect(serialized).not.toHaveProperty('tags');
      expect(serialized).not.toHaveProperty('localPath');
    }
  });

  it('graph:snapshot payload includes stage/tags/localPath on enriched project nodes', () => {
    const registry: ProjectRegistry = new Map([
      ['project:github.com/user/repo', repoMeta],
    ]);
    const graph = buildGraph(projectWeights, registry);
    const snapshot = getFullGraph(graph, new Date().toISOString());
    const parsed = JSON.parse(JSON.stringify(snapshot));
    const projectNode = parsed.nodes.find((n: { id: string }) => n.id === 'project:github.com/user/repo');
    expect(projectNode?.stage).toBe('alpha');
    expect(projectNode?.tags).toEqual(['sandbox']);
    expect(projectNode?.localPath).toBe('c:/dev/user/repo');
  });

  it('graph:snapshot with unenriched nodes deserializes without error via Zod schema', () => {
    const graph = buildGraph(projectWeights);
    const snapshot = getFullGraph(graph, new Date().toISOString());
    const message = { type: 'graph:snapshot' as const, payload: snapshot };
    const result = ServerMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});
