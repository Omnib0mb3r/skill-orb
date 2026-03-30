import { describe, it, expect, vi } from 'vitest';

vi.mock('three');

import {
  getMaterialForNodeType,
  getEdgeOpacity,
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
  it('is monotonic — getEdgeOpacity(5) > getEdgeOpacity(3)', () => {
    expect(getEdgeOpacity(5)).toBeGreaterThan(getEdgeOpacity(3));
  });

  it('returns at least 0.05 for weight 0 (minimum visibility)', () => {
    expect(getEdgeOpacity(0)).toBeGreaterThanOrEqual(0.05);
  });

  it('returns at most 1.0 for weight 10 (max opacity capped)', () => {
    expect(getEdgeOpacity(10)).toBeLessThanOrEqual(1.0);
  });

  it('returns a value in 0.0–1.0 for any weight in the valid range', () => {
    for (const w of [0, 1, 2.5, 5, 7.5, 10]) {
      const opacity = getEdgeOpacity(w);
      expect(opacity).toBeGreaterThanOrEqual(0.05);
      expect(opacity).toBeLessThanOrEqual(1.0);
    }
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
