import { describe, it, expect, vi } from 'vitest';

vi.mock('three');

import {
  getMaterialForNodeType,
  getEdgeColor,
  getEdgeOpacity,
  getEdgeLinewidth,
  highlightMaterialConfig,
  dimmedMaterialConfig,
  defaultMaterialConfig,
} from '../../src/orb/visuals';

describe('getMaterialForNodeType', () => {
  it('returns a config with a blue hue for project nodes', () => {
    const config = getMaterialForNodeType('project');
    // Blue hue: R component < G/B, or explicitly in blue range
    expect(config.color).toBeGreaterThanOrEqual(0x0000ff);
    expect(config.color).toBeLessThanOrEqual(0x8888ff);
  });

  it('returns a config with a green hue for skill nodes', () => {
    const config = getMaterialForNodeType('skill');
    expect(config.color).toBeGreaterThanOrEqual(0x00bb00);
    expect(config.color).toBeLessThanOrEqual(0x88ff88);
  });

  it('returns a config with an orange hue for tool nodes', () => {
    const config = getMaterialForNodeType('tool');
    expect(config.color).toBeGreaterThanOrEqual(0xcc6600);
    expect(config.color).toBeLessThanOrEqual(0xffaa44);
  });

  it('returns a config for unknown node type without throwing', () => {
    expect(() => getMaterialForNodeType('unknown' as never)).not.toThrow();
  });
});

describe('getEdgeOpacity', () => {
  it('is monotonic — getEdgeOpacity(0.5) > getEdgeOpacity(0.3)', () => {
    expect(getEdgeOpacity(0.5)).toBeGreaterThan(getEdgeOpacity(0.3));
  });

  it('returns at least 0.05 for weight 0 (minimum visibility)', () => {
    expect(getEdgeOpacity(0)).toBeGreaterThanOrEqual(0.05);
  });

  it('returns at most 1.0 for weight 1 (max opacity capped)', () => {
    expect(getEdgeOpacity(1)).toBeLessThanOrEqual(1.0);
  });

  it('returns a value in 0.0–1.0 for any normalized weight', () => {
    for (const w of [0, 0.1, 0.25, 0.5, 0.75, 1.0]) {
      const opacity = getEdgeOpacity(w);
      expect(opacity).toBeGreaterThanOrEqual(0.05);
      expect(opacity).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('getEdgeColor', () => {
  it('weight=1.0 returns a hot red-dominant tone', () => {
    const color = getEdgeColor(1.0);
    const r = (color >> 16) & 0xff;
    const b = color & 0xff;
    expect(r).toBeGreaterThan(b);
  });

  it('weight=0.0 returns a cool blue-dominant tone', () => {
    const color = getEdgeColor(0.0);
    const r = (color >> 16) & 0xff;
    const b = color & 0xff;
    expect(b).toBeGreaterThan(r);
  });

  it('is monotonically warmer — weight=0.8 is redder than weight=0.2', () => {
    const hot = getEdgeColor(0.8);
    const cool = getEdgeColor(0.2);
    expect((hot >> 16) & 0xff).toBeGreaterThan((cool >> 16) & 0xff);
  });
});

describe('material config variants', () => {
  it('highlightMaterialConfig differs from defaultMaterialConfig', () => {
    expect(highlightMaterialConfig).not.toEqual(defaultMaterialConfig);
  });

  it('dimmedMaterialConfig has lower opacity than defaultMaterialConfig', () => {
    expect(dimmedMaterialConfig.opacity).toBeLessThan(defaultMaterialConfig.opacity);
  });
});

describe('getEdgeLinewidth', () => {
  it('returns minimum 1.5 at heat=0 (cold edge)', () => {
    expect(getEdgeLinewidth(0)).toBeCloseTo(1.5, 5);
  });

  it('returns maximum 3.0 at heat=1 (hot edge)', () => {
    expect(getEdgeLinewidth(1)).toBeCloseTo(3.0, 5);
  });

  it('is monotonically increasing — heat=0.75 > heat=0.25', () => {
    expect(getEdgeLinewidth(0.75)).toBeGreaterThan(getEdgeLinewidth(0.25));
  });

  it('clamps below 0 to 1.5', () => {
    expect(getEdgeLinewidth(-1)).toBeCloseTo(1.5, 5);
  });

  it('clamps above 1 to 3.0', () => {
    expect(getEdgeLinewidth(2)).toBeCloseTo(3.0, 5);
  });
});
