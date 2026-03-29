// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSceneAdd = vi.fn();
const mockSceneRemove = vi.fn();
const mockScene = { add: mockSceneAdd, remove: mockSceneRemove };

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    Vector2: class Vector2 {
      x: number; y: number;
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    },
  };
});

vi.mock('three/examples/jsm/lines/Line2.js', () => ({
  Line2: class MockLine2 {
    geometry: unknown;
    material: unknown;
    constructor(geo: unknown, mat: unknown) {
      this.geometry = geo;
      this.material = mat;
    }
    computeLineDistances() { return this; }
  },
}));

vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
  LineMaterial: class MockLineMaterial {
    color = { set: vi.fn() };
    opacity = 1.0;
    transparent = false;
    emissiveIntensity = 0;
    linewidth = 1.5;
    constructor(_params: unknown) {}
    dispose = vi.fn();
  },
}));

vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
  LineGeometry: class MockLineGeometry {
    setPositions(_arr: number[]) {}
    dispose = vi.fn();
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockLine2(
  edgeId: string,
  source: string,
  target: string
): {
  line: { geometry: unknown; material: { opacity: number; transparent: boolean; emissiveIntensity: number; dispose: () => void }; geometry_dispose?: () => void };
  id: string;
  source: string;
  target: string;
} {
  const material = {
    opacity: 1.0,
    transparent: false,
    emissiveIntensity: 0,
    dispose: vi.fn(),
  };
  const geometry = { setPositions: vi.fn(), dispose: vi.fn() };
  const line = { geometry, material };
  return { line: line as unknown as typeof line, id: edgeId, source, target };
}

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  initAnimation,
  registerEdges,
  onConnectionNew,
  onSnapshot,
  setRecencyFadingEnabled,
  computeRelativeRecency,
  applyRecencyOpacity,
  breathe,
  _resetState,
  _getEphemeralEdges,
  _getActiveEdgeIds,
} from '../animation';

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetState();
  mockSceneAdd.mockClear();
  mockSceneRemove.mockClear();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Live Connection Glow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Live Connection Glow', () => {
  it('on connection:new, the corresponding edge material emissiveIntensity is boosted', () => {
    initAnimation(mockScene as unknown as import('three').Scene);

    const { line, id, source, target } = makeMockLine2('e1', 'A', 'B');
    const edgeLines = new Map([[id, line as unknown as import('three/examples/jsm/lines/Line2.js').Line2]]);
    const edgeData = [{ id, source, target }];
    registerEdges(edgeLines, edgeData);

    onConnectionNew({ source: 'A', target: 'B', connectionType: 'import' });

    expect((line.material as { emissiveIntensity: number }).emissiveIntensity).toBe(1.0);
  });

  it('on connection:new for a non-existent edge, an ephemeral edge is created', () => {
    initAnimation(mockScene as unknown as import('three').Scene);
    registerEdges(new Map(), []);

    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });

    const ephemeral = _getEphemeralEdges();
    expect(ephemeral.size).toBe(1);
    expect(ephemeral.has('X:Y')).toBe(true);
  });

  it('ephemeral edge has weight 1.0, first_seen = Date.now(), last_seen = Date.now(), raw_count = 1', () => {
    vi.useFakeTimers();
    const fixedTime = 1_700_000_000_000;
    vi.setSystemTime(fixedTime);

    initAnimation(mockScene as unknown as import('three').Scene);
    registerEdges(new Map(), []);

    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });

    const entry = _getEphemeralEdges().get('X:Y')!;
    expect(entry).toBeDefined();
    expect(entry.data.weight).toBe(1.0);
    expect(entry.data.first_seen).toBe(fixedTime);
    expect(entry.data.last_seen).toBe(fixedTime);
    expect(entry.data.raw_count).toBe(1);
  });

  it('on next graph:snapshot, all active glow flags are cleared', () => {
    initAnimation(mockScene as unknown as import('three').Scene);

    const { line, id, source, target } = makeMockLine2('e1', 'A', 'B');
    const edgeLines = new Map([[id, line as unknown as import('three/examples/jsm/lines/Line2.js').Line2]]);
    registerEdges(edgeLines, [{ id, source, target }]);

    onConnectionNew({ source: 'A', target: 'B', connectionType: 'import' });
    expect(_getActiveEdgeIds().size).toBe(1);

    onSnapshot([{ id: 'e1', last_seen: Date.now() }]);
    expect(_getActiveEdgeIds().size).toBe(0);
  });

  it('on next graph:snapshot, all ephemeral edges are removed from the scene', () => {
    initAnimation(mockScene as unknown as import('three').Scene);
    registerEdges(new Map(), []);

    onConnectionNew({ source: 'X', target: 'Y', connectionType: 'call' });
    expect(mockSceneAdd).toHaveBeenCalledTimes(1);
    expect(_getEphemeralEdges().size).toBe(1);

    onSnapshot([]);
    expect(mockSceneRemove).toHaveBeenCalledTimes(1);
    expect(_getEphemeralEdges().size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Recency Fading — computeRelativeRecency
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeRelativeRecency', () => {
  it('most recently active edge gets score 1.0', () => {
    const edges = [
      { id: 'e1', last_seen: 1000 },
      { id: 'e2', last_seen: 2000 },
      { id: 'e3', last_seen: 3000 },
    ];
    const scores = computeRelativeRecency(edges);
    expect(scores.get('e3')).toBe(1.0);
  });

  it('least recently active edge gets score 0.0', () => {
    const edges = [
      { id: 'e1', last_seen: 1000 },
      { id: 'e2', last_seen: 2000 },
      { id: 'e3', last_seen: 3000 },
    ];
    const scores = computeRelativeRecency(edges);
    expect(scores.get('e1')).toBe(0.0);
  });

  it('all edges same last_seen → all scores 1.0 (no fading)', () => {
    const edges = [
      { id: 'e1', last_seen: 5000 },
      { id: 'e2', last_seen: 5000 },
      { id: 'e3', last_seen: 5000 },
    ];
    const scores = computeRelativeRecency(edges);
    expect(scores.get('e1')).toBe(1.0);
    expect(scores.get('e2')).toBe(1.0);
    expect(scores.get('e3')).toBe(1.0);
  });

  it('single-edge graph → score 1.0 (no range → no fading)', () => {
    const scores = computeRelativeRecency([{ id: 'e1', last_seen: 9999 }]);
    expect(scores.get('e1')).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Recency Fading — applyRecencyOpacity
// ═══════════════════════════════════════════════════════════════════════════════

describe('applyRecencyOpacity', () => {
  it('edge with score 1.0 has opacity 1.0', () => {
    const mat = { opacity: 0, transparent: false };
    const materials = new Map([['e1', mat]]);
    const scores = new Map([['e1', 1.0]]);
    applyRecencyOpacity(materials, scores, true);
    expect(mat.opacity).toBe(1.0);
  });

  it('edge with score 0.0 has opacity 0.2', () => {
    const mat = { opacity: 0, transparent: false };
    const materials = new Map([['e1', mat]]);
    const scores = new Map([['e1', 0.0]]);
    applyRecencyOpacity(materials, scores, true);
    expect(mat.opacity).toBeCloseTo(0.2, 5);
  });

  it('edge with score 0.5 has opacity ~0.6 (linear: 0.2 + score * 0.8)', () => {
    const mat = { opacity: 0, transparent: false };
    const materials = new Map([['e1', mat]]);
    const scores = new Map([['e1', 0.5]]);
    applyRecencyOpacity(materials, scores, true);
    expect(mat.opacity).toBeCloseTo(0.6, 5);
  });

  it('recency uses material.opacity and does NOT modify material.emissiveIntensity', () => {
    const mat = { opacity: 0, transparent: false, emissiveIntensity: 0.7 };
    const materials = new Map([['e1', mat as { opacity: number; transparent: boolean }]]);
    const scores = new Map([['e1', 0.5]]);
    applyRecencyOpacity(materials, scores, true);
    // emissiveIntensity must be untouched
    expect((mat as { emissiveIntensity: number }).emissiveIntensity).toBe(0.7);
  });

  it('when recencyFading = false, all edges have opacity 1.0 regardless of scores', () => {
    const mat1 = { opacity: 0, transparent: true };
    const mat2 = { opacity: 0, transparent: true };
    const materials = new Map([['e1', mat1], ['e2', mat2]]);
    const scores = new Map([['e1', 0.0], ['e2', 0.3]]);
    applyRecencyOpacity(materials, scores, false);
    expect(mat1.opacity).toBe(1.0);
    expect(mat2.opacity).toBe(1.0);
    expect(mat1.transparent).toBe(false);
    expect(mat2.transparent).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ambient Breathing
// ═══════════════════════════════════════════════════════════════════════════════

describe('breathe', () => {
  it('breathe(t=0) returns emissiveIntensity 0.0 (minimum)', () => {
    const { emissiveIntensity } = breathe(0, 0);
    expect(emissiveIntensity).toBeCloseTo(0.0, 5);
  });

  it('breathe(t=period/2 = 1500) returns emissiveIntensity ~0.4 (maximum)', () => {
    const { emissiveIntensity } = breathe(1500, 0);
    expect(emissiveIntensity).toBeCloseTo(0.4, 5);
  });

  it('breathe uses emissiveIntensity channel only — does NOT modify opacity', () => {
    const result = breathe(500, 0);
    expect(result).not.toHaveProperty('opacity');
    expect(result).toHaveProperty('emissiveIntensity');
    expect(result).toHaveProperty('scaleFactor');
  });

  it('node scale at breathe(t=0, nodeIndex=0) is 1.0 (base scale)', () => {
    const { scaleFactor } = breathe(0, 0);
    expect(scaleFactor).toBeCloseTo(1.0, 5);
  });

  it('node scale at t=5000 differs between nodeIndex=0 and nodeIndex=5', () => {
    const r0 = breathe(5000, 0);
    const r5 = breathe(5000, 5);
    expect(r0.scaleFactor).not.toBeCloseTo(r5.scaleFactor, 3);
  });
});
