import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => ({
  SphereGeometry: vi.fn(),
  OctahedronGeometry: vi.fn(),
  BoxGeometry: vi.fn(),
  MeshStandardMaterial: vi.fn(),
  Mesh: vi.fn(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0, length: vi.fn(() => 0) },
  })),
  Color: vi.fn(() => ({ r: 0, g: 0, b: 0, set: vi.fn() })),
  Vector2: vi.fn(() => ({ x: 1920, y: 1080 })),
  Scene: vi.fn(() => ({ add: vi.fn() })),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn(),
}));

vi.mock('three/examples/jsm/lines/LineGeometry.js', () => ({
  LineGeometry: vi.fn(() => ({
    setPositions: vi.fn(),
    setColors: vi.fn(),
  })),
}));

vi.mock('three/examples/jsm/lines/LineMaterial.js', () => ({
  LineMaterial: vi.fn(() => ({
    linewidth: 1.5,
    opacity: 0,
    needsUpdate: false,
  })),
}));

vi.mock('three/examples/jsm/lines/Line2.js', () => ({
  Line2: vi.fn(() => ({
    geometry: { setPositions: vi.fn(), setColors: vi.fn() },
    material: { linewidth: 1.5, opacity: 0, needsUpdate: false },
  })),
}));

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { build, hashEdgeSeed } from '../../src/graph/builder';
import type { GraphData } from '../../src/graph/builder';
import { getMaterialForNodeType, getEdgeOpacity, getEdgeLinewidth } from '../../src/orb/visuals';

function makeScene(): THREE.Scene {
  return { add: vi.fn() } as unknown as THREE.Scene;
}

const projectNode = { id: 'project:foo', label: 'Foo', type: 'project' as const };
const skillNode   = { id: 'skill:bar',   label: 'Bar', type: 'skill'   as const };
const toolNode    = { id: 'tool:baz',    label: 'Baz', type: 'tool'    as const };

describe('build(graphData)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('project nodes use SphereGeometry, skill use OctahedronGeometry, tool use BoxGeometry', () => {
    build({ nodes: [projectNode, skillNode, toolNode], edges: [] }, makeScene());
    expect(THREE.SphereGeometry).toHaveBeenCalledTimes(1);
    expect(THREE.OctahedronGeometry).toHaveBeenCalledTimes(1);
    expect(THREE.BoxGeometry).toHaveBeenCalledTimes(1);
  });

  it('project nodes use a larger radius than skill nodes', () => {
    build({ nodes: [projectNode, skillNode], edges: [] }, makeScene());
    const projectRadius = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillRadius = vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number;
    expect(projectRadius).toBeGreaterThan(skillRadius);
  });

  it('skill nodes use a medium radius (between project and tool)', () => {
    build({ nodes: [projectNode, skillNode, toolNode], edges: [] }, makeScene());
    const projectR = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillR = (vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number) / 1.1;
    const toolR = (vi.mocked(THREE.BoxGeometry).mock.calls[0][0] as number) / 1.5;
    expect(skillR).toBeLessThan(projectR);
    expect(toolR).toBeLessThan(skillR);
  });

  it('tool nodes use the smallest radius', () => {
    build({ nodes: [projectNode, skillNode, toolNode], edges: [] }, makeScene());
    const projectR = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillR = (vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number) / 1.1;
    const toolR = (vi.mocked(THREE.BoxGeometry).mock.calls[0][0] as number) / 1.5;
    expect(toolR).toBeLessThan(projectR);
    expect(toolR).toBeLessThan(skillR);
  });

  it('project nodes: MeshStandardMaterial called with a blue-tinted color config', () => {
    build({ nodes: [projectNode], edges: [] }, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('project').color);
  });

  it('skill nodes: MeshStandardMaterial called with a green-tinted color config', () => {
    build({ nodes: [skillNode], edges: [] }, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('skill').color);
  });

  it('tool nodes: MeshStandardMaterial called with an orange-tinted color config', () => {
    build({ nodes: [toolNode], edges: [] }, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('tool').color);
  });

  it('edges: LineMaterial constructed with initial opacity = getEdgeOpacity(0.25)', () => {
    const data: GraphData = {
      nodes: [projectNode, skillNode],
      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 1 }],
    };
    build(data, makeScene());
    const matArgs = vi.mocked(LineMaterial).mock.calls[0][0] as { opacity: number };
    expect(matArgs.opacity).toBeCloseTo(getEdgeOpacity(0.25), 5);
  });

  it('edges: LineMaterial constructed with linewidth = 1.5 (default before heat)', () => {
    const data: GraphData = {
      nodes: [projectNode, skillNode],
      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 1 }],
    };
    build(data, makeScene());
    const matArgs = vi.mocked(LineMaterial).mock.calls[0][0] as { linewidth: number };
    expect(matArgs.linewidth).toBeCloseTo(1.5, 5);
  });

  it('build() called with empty graph → no Three.js constructors called, no errors', () => {
    expect(() => build({ nodes: [], edges: [] }, makeScene())).not.toThrow();
    expect(THREE.SphereGeometry).not.toHaveBeenCalled();
    expect(THREE.MeshStandardMaterial).not.toHaveBeenCalled();
    expect(THREE.Mesh).not.toHaveBeenCalled();
  });

  it('returned BuildResult has a simulation with tick, isCooled, reset methods', () => {
    const result = build({ nodes: [projectNode, skillNode], edges: [] }, makeScene());
    expect(typeof result.simulation.tick).toBe('function');
    expect(typeof result.simulation.isCooled).toBe('function');
    expect(typeof result.simulation.reset).toBe('function');
  });
});

describe('hashEdgeSeed', () => {
  it('returns a non-negative integer', () => {
    expect(hashEdgeSeed('project:foo', 'skill:bar')).toBeGreaterThanOrEqual(0);
  });

  it('same inputs produce the same seed', () => {
    expect(hashEdgeSeed('a', 'b')).toBe(hashEdgeSeed('a', 'b'));
  });

  it('different inputs produce different seeds (order-dependent)', () => {
    expect(hashEdgeSeed('project:a', 'skill:b')).not.toBe(hashEdgeSeed('skill:b', 'project:a'));
  });
});
