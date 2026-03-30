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
    opacity: 0.9,
    transparent: true,
    emissive: color,
    emissiveIntensity: 0.1,
  };
}

export function getEdgeOpacity(weight: number): number {
  return Math.min(1.0, Math.max(0.05, weight / 10));
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
  emissiveIntensity: 0.6,
};

export const dimmedMaterialConfig: MaterialConfig = {
  color: 0x334455,
  opacity: 0.2,
  transparent: true,
  emissiveIntensity: 0.0,
};
