import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => ({
  SphereGeometry: vi.fn(),
  OctahedronGeometry: vi.fn(),
  BoxGeometry: vi.fn(),
  MeshStandardMaterial: vi.fn(),
  Mesh: vi.fn(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
  })),
  BufferGeometry: vi.fn(() => ({
    setFromPoints: vi.fn(),
  })),
  LineBasicMaterial: vi.fn(),
  Line: vi.fn(),
  Scene: vi.fn(() => ({ add: vi.fn() })),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn(),
  Color: vi.fn(),
}));

import * as THREE from 'three';
import { build } from '../../src/graph/builder';
import type { GraphData } from '../../src/graph/builder';
import { getMaterialForNodeType, getEdgeOpacity } from '../../src/orb/visuals';

function makeScene(): THREE.Scene {
  return { add: vi.fn() } as unknown as THREE.Scene;
}

const projectNode = { id: 'project:foo', label: 'Foo', type: 'project' as const };
const skillNode = { id: 'skill:bar', label: 'Bar', type: 'skill' as const };
const toolNode = { id: 'tool:baz', label: 'Baz', type: 'tool' as const };

describe('build(graphData)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('project nodes use SphereGeometry, skill nodes use OctahedronGeometry, tool nodes use BoxGeometry', () => {
    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
    build(data, makeScene());
    expect(THREE.SphereGeometry).toHaveBeenCalledTimes(1);
    expect(THREE.OctahedronGeometry).toHaveBeenCalledTimes(1);
    expect(THREE.BoxGeometry).toHaveBeenCalledTimes(1);
  });

  it('project nodes use a larger radius than skill nodes', () => {
    const data: GraphData = { nodes: [projectNode, skillNode], edges: [] };
    build(data, makeScene());
    const projectRadius = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillRadius = vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number;
    expect(projectRadius).toBeGreaterThan(skillRadius);
  });

  it('skill nodes use a medium radius (between project and tool)', () => {
    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
    build(data, makeScene());
    // SphereGeometry arg is r directly; OctahedronGeometry arg is r*1.1; BoxGeometry arg is r*1.5
    const projectR = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillR = (vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number) / 1.1;
    const toolR = (vi.mocked(THREE.BoxGeometry).mock.calls[0][0] as number) / 1.5;
    expect(skillR).toBeLessThan(projectR); // skill < project
    expect(toolR).toBeLessThan(skillR);    // tool < skill
  });

  it('tool nodes use the smallest radius', () => {
    const data: GraphData = { nodes: [projectNode, skillNode, toolNode], edges: [] };
    build(data, makeScene());
    const projectR = vi.mocked(THREE.SphereGeometry).mock.calls[0][0] as number;
    const skillR = (vi.mocked(THREE.OctahedronGeometry).mock.calls[0][0] as number) / 1.1;
    const toolR = (vi.mocked(THREE.BoxGeometry).mock.calls[0][0] as number) / 1.5;
    expect(toolR).toBeLessThan(projectR);
    expect(toolR).toBeLessThan(skillR);
  });

  it('project nodes: MeshStandardMaterial called with a blue-tinted color config', () => {
    const data: GraphData = { nodes: [projectNode], edges: [] };
    build(data, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('project').color);
  });

  it('skill nodes: MeshStandardMaterial called with a green-tinted color config', () => {
    const data: GraphData = { nodes: [skillNode], edges: [] };
    build(data, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('skill').color);
  });

  it('tool nodes: MeshStandardMaterial called with an orange-tinted color config', () => {
    const data: GraphData = { nodes: [toolNode], edges: [] };
    build(data, makeScene());
    const matArgs = vi.mocked(THREE.MeshStandardMaterial).mock.calls[0][0] as { color: number };
    expect(matArgs.color).toBe(getMaterialForNodeType('tool').color);
  });

  it('edges: LineBasicMaterial opacity is proportional to edge weight', () => {
    const data: GraphData = {
      nodes: [projectNode, skillNode],
      edges: [
        { sourceId: projectNode.id, targetId: skillNode.id, weight: 3 },
        { sourceId: skillNode.id, targetId: projectNode.id, weight: 7 },
      ],
    };
    build(data, makeScene());
    const ops = vi.mocked(THREE.LineBasicMaterial).mock.calls.map(
      c => (c[0] as { opacity: number }).opacity,
    );
    expect(ops[0]).toBeLessThan(ops[1]);
  });

  it('edge with weight=0 → opacity ≥ minimum threshold (not zero)', () => {
    const data: GraphData = {
      nodes: [projectNode, skillNode],
      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 0 }],
    };
    build(data, makeScene());
    const op = (vi.mocked(THREE.LineBasicMaterial).mock.calls[0][0] as { opacity: number }).opacity;
    expect(op).toBeGreaterThanOrEqual(getEdgeOpacity(0));
    expect(op).toBeGreaterThan(0);
  });

  it('edge with weight=10 → opacity at maximum (≤ 1.0)', () => {
    const data: GraphData = {
      nodes: [projectNode, skillNode],
      edges: [{ sourceId: projectNode.id, targetId: skillNode.id, weight: 10 }],
    };
    build(data, makeScene());
    const op = (vi.mocked(THREE.LineBasicMaterial).mock.calls[0][0] as { opacity: number }).opacity;
    expect(op).toBeLessThanOrEqual(1.0);
  });

  it('build() called with empty graph → no Three.js constructors called, no errors', () => {
    const data: GraphData = { nodes: [], edges: [] };
    expect(() => build(data, makeScene())).not.toThrow();
    expect(THREE.SphereGeometry).not.toHaveBeenCalled();
    expect(THREE.MeshStandardMaterial).not.toHaveBeenCalled();
    expect(THREE.Mesh).not.toHaveBeenCalled();
  });

  it('returned BuildResult has a simulation with tick, isCooled, reset methods', () => {
    const data: GraphData = { nodes: [projectNode, skillNode], edges: [] };
    const result = build(data, makeScene());
    expect(typeof result.simulation.tick).toBe('function');
    expect(typeof result.simulation.isCooled).toBe('function');
    expect(typeof result.simulation.reset).toBe('function');
  });
});
