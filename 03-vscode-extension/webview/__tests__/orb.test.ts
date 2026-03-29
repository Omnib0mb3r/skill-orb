// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GraphNode, GraphEdge } from '../../src/types';

// Capture the onFinishUpdate callback registered at module-init time.
const { onFinishUpdateCallbacks } = vi.hoisted(() => ({
  onFinishUpdateCallbacks: [] as (() => void)[],
}));

vi.mock('three-forcegraph', () => {
  const mockGraph = {
    forceEngine: vi.fn().mockReturnThis(),
    warmupTicks: vi.fn().mockReturnThis(),
    d3Force: vi.fn().mockReturnThis(),
    onFinishUpdate: vi.fn().mockImplementation((cb: () => void) => {
      onFinishUpdateCallbacks.push(cb);
      return mockGraph;
    }),
    graphData: vi.fn().mockReturnThis(),
    tickFrame: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn().mockImplementation(() => mockGraph) };
});

// renderer.ts only exports a constant + function — safe to import without mocking three
vi.mock('../renderer', () => ({ ORB_RADIUS: 120 }));

import { capAndTransform, updateGraph } from '../orb';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeNode(id: string, label = id): GraphNode {
  return { id, type: 'project', label };
}

function makeEdge(id: string, source: string, target: string, weight: number): GraphEdge {
  return { id, source, target, weight, connection_type: 'uses', raw_count: 1, first_seen: '2024-01-01', last_seen: '2024-01-01' };
}

// ── capAndTransform ────────────────────────────────────────────────────────────

describe('capAndTransform', () => {
  it('passes an empty snapshot through unchanged', () => {
    const result = capAndTransform({ nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.wasCapped).toBe(false);
    expect(result.originalCounts).toEqual({ nodes: 0, edges: 0 });
  });

  it('pins the DevNeural center node at origin (fx=fy=fz=0)', () => {
    const center: GraphNode = { id: 'project:github.com/mcollins-f6i/DevNeural', type: 'project', label: 'DevNeural' };
    const other: GraphNode = { id: 'other', type: 'tool', label: 'SomeTool' };
    const result = capAndTransform({ nodes: [center, other], edges: [] });
    const pinnedNode = result.nodes.find(n => n.id === center.id)!;
    expect(pinnedNode.fx).toBe(0);
    expect(pinnedNode.fy).toBe(0);
    expect(pinnedNode.fz).toBe(0);
    const unpinnedNode = result.nodes.find(n => n.id === 'other')!;
    expect(unpinnedNode).not.toHaveProperty('fx');
  });

  it('renames edges to links — no "edges" key in output', () => {
    const node = makeNode('a');
    const edge = makeEdge('e1', 'a', 'a', 1);
    const result = capAndTransform({ nodes: [node], edges: [edge] });
    expect('edges' in result).toBe(false);
    expect(result.links).toHaveLength(1);
  });

  it('preserves edge id and all fields in the link object', () => {
    const edge = makeEdge('edge-1', 'src', 'dst', 2.5);
    const result = capAndTransform({ nodes: [makeNode('src'), makeNode('dst')], edges: [edge] });
    expect(result.links[0].id).toBe('edge-1');
    expect(result.links[0].weight).toBe(2.5);
    expect(result.links[0].connection_type).toBe('uses');
    expect(result.links[0].source).toBe('src');
    expect(result.links[0].target).toBe('dst');
  });

  it('does not cap when node count is ≤ 500', () => {
    const nodes = Array.from({ length: 500 }, (_, i) => makeNode(`n${i}`));
    const edges = [makeEdge('e1', 'n0', 'n1', 1)];
    const result = capAndTransform({ nodes, edges });
    expect(result.wasCapped).toBe(false);
    expect(result.nodes).toHaveLength(500);
  });

  it('caps to top maxEdges by weight when node count > 500', () => {
    // 501 nodes, 400 edges with varying weights
    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
    const edges = Array.from({ length: 400 }, (_, i) =>
      makeEdge(`e${i}`, `n${i % 501}`, `n${(i + 1) % 501}`, i) // weight = index → higher i = heavier
    );
    const result = capAndTransform({ nodes, edges }, 300);
    expect(result.wasCapped).toBe(true);
    expect(result.links).toHaveLength(300);
    // All retained edges should be from the top 300 by weight (indices 100-399)
    const minWeight = Math.min(...result.links.map(l => l.weight));
    expect(minWeight).toBeGreaterThanOrEqual(100);
  });

  it('records original counts when capped', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
    const edges = Array.from({ length: 50 }, (_, i) =>
      makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, i)
    );
    const result = capAndTransform({ nodes, edges });
    expect(result.originalCounts).toEqual({ nodes: 501, edges: 50 });
  });

  it('emits console.warn with original counts when capped and updateGraph is called', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
    const edges = Array.from({ length: 400 }, (_, i) =>
      makeEdge(`e${i}`, `n${i % 501}`, `n${(i + 1) % 501}`, i)
    );
    updateGraph({ nodes, edges });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('501'));
    warnSpy.mockRestore();
  });
});

// ── updateGraph ───────────────────────────────────────────────────────────────

describe('updateGraph', () => {
  it('does not throw with an empty snapshot', () => {
    expect(() => updateGraph({ nodes: [], edges: [] })).not.toThrow();
  });
});

// ── loading overlay ────────────────────────────────────────────────────────────

describe('loading overlay', () => {
  beforeEach(() => {
    // Clean DOM before each test
    const existing = document.getElementById('devneural-loading');
    existing?.remove();
  });

  afterEach(() => {
    const existing = document.getElementById('devneural-loading');
    existing?.remove();
  });

  it('shows loading overlay when updateGraph is called', () => {
    updateGraph({ nodes: [], edges: [] });
    expect(document.getElementById('devneural-loading')).not.toBeNull();
  });

  it('removes loading overlay when onFinishUpdate callback fires', () => {
    updateGraph({ nodes: [], edges: [] });
    expect(document.getElementById('devneural-loading')).not.toBeNull();

    // Fire the callback registered via graph.onFinishUpdate(() => hideLoading())
    const hideLoading = onFinishUpdateCallbacks[0];
    expect(hideLoading).toBeDefined();
    hideLoading();

    expect(document.getElementById('devneural-loading')).toBeNull();
  });
});
