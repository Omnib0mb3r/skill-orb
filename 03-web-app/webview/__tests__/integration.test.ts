// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// ── InstancedMesh mock ────────────────────────────────────────────────────────

const { MockInstancedMesh } = vi.hoisted(() => {
  class MockInstancedMesh {
    geometry: unknown;
    material: unknown;
    count: number;
    instanceMatrix = { needsUpdate: false };
    instanceColor: { needsUpdate: boolean } | null = null;
    constructor(geo: unknown, mat: unknown, count: number) {
      this.geometry = geo; this.material = mat; this.count = count;
    }
    setMatrixAt(_i: number, _m: unknown): void {}
    getMatrixAt(_i: number, _t: unknown): void {}
    setColorAt(index: number, _c: unknown): void {
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

// ── Line* mocks ───────────────────────────────────────────────────────────────

vi.mock('three/examples/jsm/lines/Line2.js', () => ({
  Line2: class Line2 {
    material = { opacity: 1, transparent: false, emissiveIntensity: 0, dispose: vi.fn() };
    geometry = { dispose: vi.fn() };
    computeLineDistances() { return this; }
  },
}));

vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
  LineMaterial: class LineMaterial {
    color = { set: vi.fn() };
    opacity = 1; transparent = false; emissiveIntensity = 0;
    linewidth = 1.5;
    constructor(_p: unknown) {}
    dispose = vi.fn();
  },
}));

vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
  LineGeometry: class LineGeometry {
    setPositions(_arr: number[]) {}
    dispose = vi.fn();
  },
}));

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

import { createNodeMeshes, setNodePositions, nodeIndexMap } from '../nodes';
import { evaluateQuery } from '../search';
import {
  initAnimation, onConnectionNew, onSnapshot,
  _resetState, _getEphemeralEdges, _getActiveEdgeIds,
} from '../animation';

// ── Test 1: setNodePositions produces nodeIndexMap entries for every node ─────

describe('setNodePositions → nodeIndexMap integration', () => {
  beforeEach(() => {
    nodeIndexMap.clear();
  });

  it('populates nodeIndexMap with one entry per rendered node', () => {
    const m = createNodeMeshes(10);
    const nodes = [
      { id: 'proj-a', type: 'project' as const, x: 0, y: 0, z: 0 },
      { id: 'tool-b', type: 'tool' as const, x: 1, y: 0, z: 0 },
      { id: 'skill-c', type: 'skill' as const, x: 2, y: 0, z: 0 },
    ];
    setNodePositions(nodes, m);
    expect(nodeIndexMap.size).toBe(3);
    expect(nodeIndexMap.has('proj-a')).toBe(true);
    expect(nodeIndexMap.has('tool-b')).toBe(true);
    expect(nodeIndexMap.has('skill-c')).toBe(true);
  });

  it('each nodeIndexMap entry references the correct mesh for its type', () => {
    const m = createNodeMeshes(10);
    setNodePositions([
      { id: 'p', type: 'project' as const, x: 0, y: 0, z: 0 },
      { id: 't', type: 'tool' as const, x: 0, y: 0, z: 0 },
    ], m);
    expect(nodeIndexMap.get('p')!.mesh).toBe(m.projectMesh);
    expect(nodeIndexMap.get('t')!.mesh).toBe(m.toolMesh);
  });
});

// ── Test 2: WebSocket reconnect pattern ───────────────────────────────────────

describe('WebSocket reconnect pattern', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).WebSocket;
  });

  it('schedules a new connection after 2s following onclose', () => {
    vi.useFakeTimers();

    const instances: Array<{ onclose: (() => void) | null }> = [];
    const MockWS = vi.fn(() => {
      const ws = { onopen: null as (() => void) | null, onclose: null as (() => void) | null };
      instances.push(ws);
      return ws;
    });

    // Simulate the reconnect pattern from main.ts
    function connect() {
      const ws = new (MockWS as any)();
      ws.onclose = () => setTimeout(connect, 2000);
    }

    connect();
    expect(MockWS).toHaveBeenCalledTimes(1);

    // Trigger close
    instances[0].onclose!();
    expect(MockWS).toHaveBeenCalledTimes(1); // not yet

    vi.advanceTimersByTime(2000);
    expect(MockWS).toHaveBeenCalledTimes(2); // reconnected
  });

  it('does not reconnect before the 2s delay elapses', () => {
    vi.useFakeTimers();

    const MockWS = vi.fn(() => {
      const ws = { onclose: null as (() => void) | null };
      return ws;
    });

    let latestWs: { onclose: (() => void) | null };
    function connect() {
      latestWs = new (MockWS as any)();
      latestWs.onclose = () => setTimeout(connect, 2000);
    }

    connect();
    latestWs!.onclose!();

    vi.advanceTimersByTime(1999);
    expect(MockWS).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(MockWS).toHaveBeenCalledTimes(2);
  });
});

// ── Test 3: graph:snapshot clears ephemeral animation edges ──────────────────

describe('graph:snapshot clears ephemeral edges (animation sync)', () => {
  let mockScene: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    _resetState();
    mockScene = { add: vi.fn(), remove: vi.fn() };
    initAnimation(mockScene as unknown as THREE.Scene);
  });

  afterEach(() => {
    _resetState();
  });

  it('onSnapshot clears all ephemeral edges and calls scene.remove for each', () => {
    onConnectionNew({ source: 'a', target: 'b', connectionType: 'project->tool' });
    onConnectionNew({ source: 'c', target: 'd', connectionType: 'project->tool' });
    const countBefore = _getEphemeralEdges().size;
    expect(countBefore).toBeGreaterThan(0);

    onSnapshot([]);

    expect(_getEphemeralEdges().size).toBe(0);
    expect(mockScene.remove).toHaveBeenCalledTimes(countBefore);
  });

  it('onSnapshot clears active edge glow flags', () => {
    const activeIds = _getActiveEdgeIds();
    activeIds.add('fake-edge-id');

    onSnapshot([]);
    expect(_getActiveEdgeIds().size).toBe(0);
  });
});

// ── Test 4: evaluateQuery does not throw on empty snapshot ────────────────────

describe('evaluateQuery + empty snapshot safety', () => {
  it('returns empty result sets without throwing for empty node/edge arrays', () => {
    expect(() => {
      const result = evaluateQuery('', [], []);
      expect(result.matchingNodeIds.size).toBe(0);
      expect(result.matchingEdgeIds.size).toBe(0);
    }).not.toThrow();
  });

  it('non-empty query against empty arrays returns empty sets without throwing', () => {
    expect(() => {
      const result = evaluateQuery('playwright', [], []);
      expect(result.matchingNodeIds.size).toBe(0);
      expect(result.matchingEdgeIds.size).toBe(0);
    }).not.toThrow();
  });

  it('reverse query against empty arrays returns empty sets without throwing', () => {
    expect(() => {
      const result = evaluateQuery('uses some-tool', [], []);
      expect(result.matchingNodeIds.size).toBe(0);
    }).not.toThrow();
  });
});
