// @vitest-environment jsdom
import { vi, describe, it, expect } from 'vitest';

// Mock Line classes to prevent JSM import side-effects in the test environment
vi.mock('three/examples/jsm/lines/Line2.js', () => ({
  Line2: class Line2 {
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
  LineMaterial: class LineMaterial {
    color = { set: vi.fn() };
    constructor(_params: unknown) {}
  },
}));
vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
  LineGeometry: class LineGeometry {
    setPositions(_arr: number[]) {}
  },
}));

import { computeRelativeColor } from '../edges';

// ── computeRelativeColor ──────────────────────────────────────────────────────

describe('computeRelativeColor', () => {
  it('all equal weights return the same color for all edges', () => {
    const edges = [
      { id: 'e1', weight: 0.5 },
      { id: 'e2', weight: 0.5 },
      { id: 'e3', weight: 0.5 },
    ];
    const result = computeRelativeColor(edges);

    const hsl1 = { h: 0, s: 0, l: 0 };
    const hsl2 = { h: 0, s: 0, l: 0 };
    result.get('e1')!.getHSL(hsl1);
    result.get('e2')!.getHSL(hsl2);
    expect(hsl1.h).toBeCloseTo(hsl2.h, 5);
    expect(hsl1.s).toBeCloseTo(hsl2.s, 5);
    expect(hsl1.l).toBeCloseTo(hsl2.l, 5);
  });

  it('weight 0.0 (min) maps to cool blue — hue > 180 degrees', () => {
    const edges = [
      { id: 'e1', weight: 0.0 },
      { id: 'e2', weight: 1.0 },
    ];
    const result = computeRelativeColor(edges);
    const hsl = { h: 0, s: 0, l: 0 };
    result.get('e1')!.getHSL(hsl);
    expect(hsl.h * 360).toBeGreaterThan(180);
  });

  it('weight 1.0 (max) maps to warm red/orange — hue < 30 degrees', () => {
    const edges = [
      { id: 'e1', weight: 0.0 },
      { id: 'e2', weight: 1.0 },
    ];
    const result = computeRelativeColor(edges);
    const hsl = { h: 0, s: 0, l: 0 };
    result.get('e2')!.getHSL(hsl);
    expect(hsl.h * 360).toBeLessThan(30);
  });

  it('mid-range weight maps to cyan/green — hue between 120 and 180 degrees', () => {
    const edges = [
      { id: 'e1', weight: 0.0 },
      { id: 'mid', weight: 0.5 },
      { id: 'e3', weight: 1.0 },
    ];
    const result = computeRelativeColor(edges);
    const hsl = { h: 0, s: 0, l: 0 };
    result.get('mid')!.getHSL(hsl);
    const hueDegrees = hsl.h * 360;
    expect(hueDegrees).toBeGreaterThanOrEqual(120);
    expect(hueDegrees).toBeLessThanOrEqual(180);
  });

  it('is a pure function — same input always produces same output', () => {
    const edges = [
      { id: 'e1', weight: 0.3 },
      { id: 'e2', weight: 0.7 },
    ];
    const r1 = computeRelativeColor(edges);
    const r2 = computeRelativeColor(edges);

    const hsl1 = { h: 0, s: 0, l: 0 };
    const hsl2 = { h: 0, s: 0, l: 0 };
    r1.get('e1')!.getHSL(hsl1);
    r2.get('e1')!.getHSL(hsl2);
    expect(hsl1.h).toBeCloseTo(hsl2.h, 5);
    expect(hsl1.s).toBeCloseTo(hsl2.s, 5);
    expect(hsl1.l).toBeCloseTo(hsl2.l, 5);
  });

  it('returns Map keyed by edge id with exactly one entry per edge', () => {
    const edges = [
      { id: 'e1', weight: 0.1 },
      { id: 'e2', weight: 0.5 },
      { id: 'e3', weight: 0.9 },
    ];
    const result = computeRelativeColor(edges);
    expect(result.size).toBe(3);
    expect(result.has('e1')).toBe(true);
    expect(result.has('e2')).toBe(true);
    expect(result.has('e3')).toBe(true);
  });
});
