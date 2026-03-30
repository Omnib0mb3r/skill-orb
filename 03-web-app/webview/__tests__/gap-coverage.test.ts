// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

// ── InstancedMesh mock (for nodes.ts) ─────────────────────────────────────────

const { MockInstancedMesh } = vi.hoisted(() => {
  class MockInstancedMesh {
    geometry: unknown;
    material: unknown;
    count: number;
    instanceMatrix = { needsUpdate: false };
    instanceColor: { needsUpdate: boolean } | null = null;

    constructor(geo: unknown, mat: unknown, count: number) {
      this.geometry = geo;
      this.material = mat;
      this.count = count;
    }

    setMatrixAt(_i: number, _m: unknown): void {}
    getMatrixAt(_i: number, _t: unknown): void {}

    setColorAt(index: number, _color: unknown): void {
      if (!this.instanceColor) this.instanceColor = { needsUpdate: false };
      void index;
    }
  }
  return { MockInstancedMesh };
});

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three');
  return { ...actual, InstancedMesh: MockInstancedMesh };
});

// ── Line* mocks (for edges.ts) ────────────────────────────────────────────────

vi.mock('three/examples/jsm/lines/Line2.js', () => ({
  Line2: class Line2 {
    material = { color: { set: vi.fn() } };
    geometry: unknown;
    constructor() {}
    computeLineDistances() { return this; }
  },
}));

vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
  LineMaterial: class LineMaterial {
    color = { set: vi.fn() };
    constructor(_p: unknown) {}
  },
}));

vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
  LineGeometry: class LineGeometry {
    setPositions(_arr: number[]) {}
  },
}));

// ── three-forcegraph + renderer mocks (for orb.ts) ───────────────────────────

vi.mock('three-forcegraph', () => ({
  default: class ThreeForceGraph {
    graphData(_d?: unknown) { return { nodes: [], links: [] }; }
    nodeThreeObject(_fn?: unknown) { return this; }
    linkThreeObject(_fn?: unknown) { return this; }
    nodePositionUpdate(_fn?: unknown) { return this; }
    onEngineStop(_fn?: unknown) { return this; }
    forceEngine(_e?: unknown) { return this; }
    warmupTicks(_n?: unknown) { return this; }
    numDimensions(_n?: unknown) { return this; }
    cooldownTicks(_n?: unknown) { return this; }
    d3Force(_name?: unknown, _fn?: unknown) { return this; }
    onFinishUpdate(_fn?: unknown) { return this; }
  },
}));

vi.mock('../renderer', () => ({
  ORB_RADIUS: 150,
  addResizeListener: vi.fn(),
}));

// ── Module imports ────────────────────────────────────────────────────────────

import { capAndTransform } from '../orb';
import { applyEdgeColors } from '../edges';
import { createNodeMeshes, setNodePositions, resetNodeColors, nodeIndexMap } from '../nodes';
import type { GraphNode, GraphEdge } from '../../src/types';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(id: string, type: GraphNode['type'] = 'project'): GraphNode {
  return { id, label: id, type };
}

function makeEdge(id: string, src: string, tgt: string, weight = 1): GraphEdge {
  return {
    id, source: src, target: tgt,
    connection_type: 'project->tool',
    weight, raw_count: 1,
    first_seen: '2024-01-01', last_seen: '2024-01-01',
  };
}

// ── capAndTransform ───────────────────────────────────────────────────────────

describe('capAndTransform', () => {
  it('small graph (≤ 500 nodes) passes through unchanged with wasCapped=false', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`));
    const edges = [makeEdge('e1', 'n0', 'n1')];
    const result = capAndTransform({ nodes, edges });
    expect(result.wasCapped).toBe(false);
    expect(result.nodes.length).toBe(5);
    expect(result.originalCounts.nodes).toBe(5);
  });

  it('graph with > 500 nodes caps to referenced nodes and sets wasCapped=true', () => {
    const nodes = Array.from({ length: 502 }, (_, i) => makeNode(`n${i}`));
    // Only 10 edges referencing the first 11 nodes — the rest (n11–n501) are unreferenced
    const edges = Array.from({ length: 10 }, (_, i) =>
      makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, i + 1)
    );
    const result = capAndTransform({ nodes, edges });
    expect(result.wasCapped).toBe(true);
    expect(result.nodes.length).toBeLessThan(502);
    expect(result.originalCounts.nodes).toBe(502);
  });

  it('pins the DevNeural center node at origin (fx=0, fy=0, fz=0)', () => {
    const centerNode: GraphNode = {
      id: 'project:github.com/mcollins-f6i/DevNeural',
      label: 'DevNeural',
      type: 'project',
    };
    const nodes = [makeNode('other'), centerNode];
    const edges = [makeEdge('e1', 'other', centerNode.id)];
    const result = capAndTransform({ nodes, edges });

    const pinned = result.nodes.find(n => n.id === centerNode.id);
    expect(pinned).toBeDefined();
    expect(pinned!.fx).toBe(0);
    expect(pinned!.fy).toBe(0);
    expect(pinned!.fz).toBe(0);
  });

  it('maxEdges parameter caps the number of returned links', () => {
    const nodes = Array.from({ length: 502 }, (_, i) => makeNode(`n${i}`));
    // 20 edges with different weights — pass maxEdges=5 to exercise the cap
    const edges = Array.from({ length: 20 }, (_, i) =>
      makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, i + 1)
    );
    const result = capAndTransform({ nodes, edges }, 5);
    expect(result.wasCapped).toBe(true);
    expect(result.links.length).toBe(5);
    expect(result.originalCounts.edges).toBe(20);
  });

  it('non-center nodes are NOT pinned (no fx/fy/fz)', () => {
    const nodes = [makeNode('plain')];
    const edges = [makeEdge('e1', 'plain', 'plain')];
    const result = capAndTransform({ nodes, edges });
    const plain = result.nodes.find(n => n.id === 'plain')!;
    expect(plain.fx).toBeUndefined();
  });
});

// ── applyEdgeColors ───────────────────────────────────────────────────────────

describe('applyEdgeColors', () => {
  it('calls color.set on each Line2 material matching the colorMap', () => {
    const line1 = { material: { color: { set: vi.fn() } } };
    const line2 = { material: { color: { set: vi.fn() } } };
    const edgeLines = new Map<string, Line2>([
      ['e1', line1 as unknown as Line2],
      ['e2', line2 as unknown as Line2],
    ]);
    const red = new THREE.Color(0xff0000);
    const blue = new THREE.Color(0x0000ff);
    const colorMap = new Map([['e1', red], ['e2', blue]]);

    applyEdgeColors(edgeLines, colorMap);

    expect(line1.material.color.set).toHaveBeenCalledWith(red);
    expect(line2.material.color.set).toHaveBeenCalledWith(blue);
  });

  it('skips edges whose id is absent from colorMap', () => {
    const line = { material: { color: { set: vi.fn() } } };
    const edgeLines = new Map<string, Line2>([['e1', line as unknown as Line2]]);
    const colorMap = new Map<string, THREE.Color>(); // empty

    applyEdgeColors(edgeLines, colorMap);

    expect(line.material.color.set).not.toHaveBeenCalled();
  });
});

// ── resetNodeColors ───────────────────────────────────────────────────────────

describe('resetNodeColors', () => {
  beforeEach(() => {
    nodeIndexMap.clear();
  });

  it('marks instanceColor.needsUpdate = true on all type meshes after reset', () => {
    const m = createNodeMeshes(10);
    setNodePositions([{ id: 'p1', type: 'project', x: 0, y: 0, z: 0 }], m);
    resetNodeColors(m, nodeIndexMap);
    expect(m.projectMesh.instanceColor).not.toBeNull();
    expect(m.projectMesh.instanceColor?.needsUpdate).toBe(true);
  });

  it('calls setColorAt for every node registered in the map', () => {
    const m = createNodeMeshes(10);
    const spy = vi.spyOn(m.projectMesh, 'setColorAt');
    setNodePositions([
      { id: 'p1', type: 'project', x: 0, y: 0, z: 0 },
      { id: 'p2', type: 'project', x: 1, y: 0, z: 0 },
    ], m);
    spy.mockClear();
    resetNodeColors(m, nodeIndexMap);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
