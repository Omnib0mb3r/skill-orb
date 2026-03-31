import type { NodeType } from '../graph/types';

// No top-level import from 'three' — keeps this module testable without WebGL.

export interface MaterialConfig {
  color: number;
  opacity: number;
  transparent: boolean;
  emissive?: number;
  emissiveIntensity?: number;
}

const NODE_COLORS: Record<NodeType, number> = {
  project: 0x4488ff,
  skill: 0x44cc55,
  tool: 0xff8833,
};

export function getMaterialForNodeType(type: NodeType): MaterialConfig {
  const color = NODE_COLORS[type] ?? NODE_COLORS.project;
  return {
    color,
    opacity: 0.92,
    transparent: true,
    emissive: color,
    emissiveIntensity: 0.15,
  };
}

/** Lerp between two 0xRRGGBB hex colors. t in 0..1 */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/**
 * Map a normalized edge weight [0,1] to a cool→warm color gradient.
 * Callers must pre-normalize relative to the graph's max weight.
 * Weak = deep blue, Medium = cyan, Strong = hot orange-red.
 */
export function getEdgeColor(normalizedWeight: number): number {
  const w = Math.max(0, Math.min(1, normalizedWeight));
  if (w < 0.25) return lerpColor(0x0d1f5c, 0x1a5faa, w / 0.25);
  if (w < 0.5)  return lerpColor(0x1a5faa, 0x22bbcc, (w - 0.25) / 0.25);
  if (w < 0.75) return lerpColor(0x22bbcc, 0xeecc22, (w - 0.5)  / 0.25);
  return              lerpColor(0xeecc22, 0xff4411, (w - 0.75) / 0.25);
}

export function getEdgeOpacity(normalizedWeight: number): number {
  const w = Math.max(0, Math.min(1, normalizedWeight));
  return Math.max(0.38, w * 0.85);
}

export const defaultMaterialConfig: MaterialConfig = {
  color: 0x8899bb,
  opacity: 0.8,
  transparent: true,
  emissiveIntensity: 0.05,
};

export const highlightMaterialConfig: MaterialConfig = {
  color: 0xffffff,
  opacity: 1.0,
  transparent: false,
  emissive: 0xffffff,
  emissiveIntensity: 0.7,
};

export const dimmedMaterialConfig: MaterialConfig = {
  color: 0x334455,
  opacity: 0.2,
  transparent: true,
  emissiveIntensity: 0.0,
};
