import { describe, it, expect } from 'vitest';
import { evaluateQuery, detectReverseQuery } from '../search';
import type { GraphNode, GraphEdge } from '../../src/types';

function makeNode(partial: Partial<GraphNode> & { id: string; type: GraphNode['type'] }): GraphNode {
  return {
    label: partial.id,
    ...partial,
  };
}

function makeEdge(partial: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
  return {
    connection_type: 'project->tool',
    weight: 1,
    raw_count: 1,
    first_seen: '2024-01-01',
    last_seen: '2024-01-01',
    ...partial,
  };
}

const sampleNodes: GraphNode[] = [
  makeNode({ id: 'p1', type: 'project', label: 'ProjectAlpha', stage: 'alpha' }),
  makeNode({ id: 'p2', type: 'project', label: 'ProjectBeta', stage: 'beta' }),
  makeNode({ id: 't1', type: 'tool', label: 'playwright' }),
  makeNode({ id: 't2', type: 'tool', label: 'webpack' }),
  makeNode({ id: 's1', type: 'skill', label: 'TypeScript' }),
];

const sampleEdges: GraphEdge[] = [
  makeEdge({ id: 'e1', source: 'p1', target: 't1', connection_type: 'project->tool' }),
  makeEdge({ id: 'e2', source: 'p2', target: 't2', connection_type: 'project->tool' }),
  makeEdge({ id: 'e3', source: 'p1', target: 's1', connection_type: 'project->skill' }),
];

describe('evaluateQuery', () => {
  it('empty query string returns all nodes and edges as matches', () => {
    const result = evaluateQuery('', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.size).toBe(sampleNodes.length);
    expect(result.matchingEdgeIds.size).toBe(sampleEdges.length);
  });

  it('query "tool" returns all nodes with type === "tool"', () => {
    const result = evaluateQuery('tool', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('t1')).toBe(true);
    expect(result.matchingNodeIds.has('t2')).toBe(true);
    expect(result.matchingNodeIds.has('p1')).toBe(false);
    expect(result.matchingNodeIds.has('p2')).toBe(false);
  });

  it('query matching a node label (case-insensitive substring) returns that node + connected edges', () => {
    const result = evaluateQuery('playwright', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('t1')).toBe(true);
    expect(result.matchingEdgeIds.has('e1')).toBe(true);
  });

  it('query matching a stage value (e.g., "beta") returns project nodes with that stage', () => {
    const result = evaluateQuery('beta', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('p2')).toBe(true);
    expect(result.matchingNodeIds.has('p1')).toBe(false);
  });

  it('query "project->tool" returns all edges with connection_type "project->tool"', () => {
    const result = evaluateQuery('project->tool', sampleNodes, sampleEdges);
    expect(result.matchingEdgeIds.has('e1')).toBe(true);
    expect(result.matchingEdgeIds.has('e2')).toBe(true);
    expect(result.matchingEdgeIds.has('e3')).toBe(false);
  });

  it('reverse query "uses playwright" returns project nodes connected to playwright tool node', () => {
    const result = evaluateQuery('uses playwright', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('p1')).toBe(true);
  });

  it('unrecognized query falls back to substring match across all node labels', () => {
    const result = evaluateQuery('TypeScript', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('s1')).toBe(true);
    expect(result.matchingNodeIds.has('p1')).toBe(false);
  });

  it('non-matching nodes identified in result as non-matching set', () => {
    const result = evaluateQuery('playwright', sampleNodes, sampleEdges);
    expect(result.matchingNodeIds.has('p2')).toBe(false);
    expect(result.matchingNodeIds.has('t2')).toBe(false);
    expect(result.matchingNodeIds.has('s1')).toBe(false);
  });
});

describe('detectReverseQuery', () => {
  it('"uses playwright" → isReverse=true, target="playwright"', () => {
    const result = detectReverseQuery('uses playwright');
    expect(result.isReverse).toBe(true);
    expect(result.target).toBe('playwright');
  });

  it('"connects to webpack" → isReverse=true, target="webpack"', () => {
    const result = detectReverseQuery('connects to webpack');
    expect(result.isReverse).toBe(true);
    expect(result.target).toBe('webpack');
  });

  it('normal query → isReverse=false', () => {
    const result = detectReverseQuery('playwright');
    expect(result.isReverse).toBe(false);
  });
});
