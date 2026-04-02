import { describe, it, expect } from 'vitest';
import { generateEdgeCurve, CURVE_SEGMENTS } from '../../src/graph/edge-curve';

describe('generateEdgeCurve', () => {
  it('returns a Float32Array of length (CURVE_SEGMENTS+1)*3', () => {
    const pts = generateEdgeCurve(0, 0, 0, 10, 0, 0, 12345);
    expect(pts).toBeInstanceOf(Float32Array);
    expect(pts.length).toBe((CURVE_SEGMENTS + 1) * 3);
  });

  it('first point equals src', () => {
    const pts = generateEdgeCurve(1, 2, 3, 10, 5, 7, 99);
    expect(pts[0]).toBeCloseTo(1, 4);
    expect(pts[1]).toBeCloseTo(2, 4);
    expect(pts[2]).toBeCloseTo(3, 4);
  });

  it('last point equals tgt', () => {
    const n = CURVE_SEGMENTS;
    const pts = generateEdgeCurve(1, 2, 3, 10, 5, 7, 99);
    expect(pts[n * 3]).toBeCloseTo(10, 4);
    expect(pts[n * 3 + 1]).toBeCloseTo(5, 4);
    expect(pts[n * 3 + 2]).toBeCloseTo(7, 4);
  });

  it('midpoint is displaced from straight line (seed 12345)', () => {
    const pts = generateEdgeCurve(0, 0, 0, 10, 0, 0, 12345);
    const mid = Math.floor(CURVE_SEGMENTS / 2);
    // On a straight X-axis edge, a displaced midpoint has non-zero Y or Z
    const midY = pts[mid * 3 + 1];
    const midZ = pts[mid * 3 + 2];
    expect(Math.abs(midY) + Math.abs(midZ)).toBeGreaterThan(0.01);
  });

  it('same seed produces identical curves', () => {
    const a = generateEdgeCurve(0, 0, 0, 10, 0, 0, 777);
    const b = generateEdgeCurve(0, 0, 0, 10, 0, 0, 777);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
  });

  it('different seeds produce different midpoints', () => {
    const a = generateEdgeCurve(0, 0, 0, 10, 0, 0, 1);
    const b = generateEdgeCurve(0, 0, 0, 10, 0, 0, 2);
    const mid = Math.floor(CURVE_SEGMENTS / 2);
    const differs = a[mid * 3] !== b[mid * 3] ||
                    a[mid * 3 + 1] !== b[mid * 3 + 1] ||
                    a[mid * 3 + 2] !== b[mid * 3 + 2];
    expect(differs).toBe(true);
  });

  it('driftTime shifts midpoints but preserves endpoints', () => {
    const n = CURVE_SEGMENTS;
    const base = generateEdgeCurve(0, 0, 0, 10, 0, 0, 42, 0);
    const drifted = generateEdgeCurve(0, 0, 0, 10, 0, 0, 42, 100);
    // Endpoints unchanged
    expect(drifted[0]).toBeCloseTo(base[0], 4);
    expect(drifted[n * 3]).toBeCloseTo(base[n * 3], 4);
    // Some midpoint has moved
    const mid = Math.floor(n / 2);
    const changed = base[mid * 3] !== drifted[mid * 3] ||
                    base[mid * 3 + 1] !== drifted[mid * 3 + 1] ||
                    base[mid * 3 + 2] !== drifted[mid * 3 + 2];
    expect(changed).toBe(true);
  });

  it('degenerate edge (src === tgt) returns all-src positions without throwing', () => {
    expect(() => generateEdgeCurve(5, 5, 5, 5, 5, 5, 1)).not.toThrow();
    const pts = generateEdgeCurve(5, 5, 5, 5, 5, 5, 1);
    expect(pts[0]).toBeCloseTo(5, 4);
    expect(pts[1]).toBeCloseTo(5, 4);
  });
});
