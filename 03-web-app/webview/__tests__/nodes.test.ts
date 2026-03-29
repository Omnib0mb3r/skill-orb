// @vitest-environment jsdom
import { vi, describe, it, expect } from 'vitest';
import * as THREE from 'three';

// Hoist MockInstancedMesh so vi.mock factory can reference it without temporal dead zone
const { MockInstancedMesh } = vi.hoisted(() => {
  class MockInstancedMesh {
    geometry: unknown;
    material: unknown;
    count: number;
    instanceMatrix: { needsUpdate: boolean } = { needsUpdate: false };
    instanceColor: { needsUpdate: boolean } | null = null;
    private _matrices = new Map<number, number[]>();

    constructor(geo: unknown, mat: unknown, count: number) {
      this.geometry = geo;
      this.material = mat;
      this.count = count;
    }

    setMatrixAt(index: number, matrix: { elements: ArrayLike<number> }): void {
      this._matrices.set(index, Array.from(matrix.elements));
    }

    getMatrixAt(index: number, target: { fromArray: (arr: number[]) => void }): void {
      const stored = this._matrices.get(index);
      if (stored) target.fromArray(stored);
    }

    setColorAt(index: number, _color: unknown): void {
      if (!this.instanceColor) this.instanceColor = { needsUpdate: false };
      void index;
    }
  }
  return { MockInstancedMesh };
});

// Replace only InstancedMesh; keep all real Three.js classes for geometry, math, etc.
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three');
  return { ...actual, InstancedMesh: MockInstancedMesh };
});

import {
  createNodeMeshes,
  setNodePositions,
  setNodeColor,
  stageColor,
  nodeIndexMap,
  type NodeRenderData,
} from '../nodes';

// ── createNodeMeshes ──────────────────────────────────────────────────────────

describe('createNodeMeshes', () => {
  it('creates exactly 3 distinct non-badge InstancedMesh objects (project, tool, skill)', () => {
    const m = createNodeMeshes(10);
    expect(m.projectMesh).toBeInstanceOf(MockInstancedMesh);
    expect(m.toolMesh).toBeInstanceOf(MockInstancedMesh);
    expect(m.skillMesh).toBeInstanceOf(MockInstancedMesh);
    expect(m.projectMesh).not.toBe(m.toolMesh);
    expect(m.toolMesh).not.toBe(m.skillMesh);
    expect(m.skillMesh).not.toBe(m.projectMesh);
  });

  it('creates 1 InstancedMesh for stage badges distinct from type meshes', () => {
    const m = createNodeMeshes(10);
    expect(m.badgeMesh).toBeInstanceOf(MockInstancedMesh);
    expect(m.badgeMesh).not.toBe(m.projectMesh);
    expect(m.badgeMesh).not.toBe(m.toolMesh);
    expect(m.badgeMesh).not.toBe(m.skillMesh);
  });

  it('project InstancedMesh uses BoxGeometry with strongly unequal dimensions', () => {
    const m = createNodeMeshes(10);
    expect(m.projectMesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    const geo = m.projectMesh.geometry as THREE.BoxGeometry;
    const { width, height, depth } = geo.parameters;
    const dims = [width, height, depth];
    const ratio = Math.max(...dims) / Math.min(...dims);
    // 1.2 / 0.15 = 8 — strongly unequal
    expect(ratio).toBeGreaterThan(4);
  });

  it('skill InstancedMesh uses OctahedronGeometry', () => {
    const m = createNodeMeshes(10);
    expect(m.skillMesh.geometry).toBeInstanceOf(THREE.OctahedronGeometry);
  });
});

// ── setNodePositions ──────────────────────────────────────────────────────────

describe('setNodePositions', () => {
  it('updates Matrix4 for each instance and sets instanceMatrix.needsUpdate', () => {
    const m = createNodeMeshes(10);
    const nodes: NodeRenderData[] = [
      { id: 'p1', type: 'project', x: 1, y: 2, z: 3 },
      { id: 't1', type: 'tool', x: 4, y: 5, z: 6 },
    ];
    setNodePositions(nodes, m);

    expect(m.projectMesh.instanceMatrix.needsUpdate).toBe(true);
    expect(m.toolMesh.instanceMatrix.needsUpdate).toBe(true);

    // Verify the project node got the right position
    const mat = new THREE.Matrix4();
    (m.projectMesh as unknown as InstanceType<typeof MockInstancedMesh>).getMatrixAt(0, mat);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mat.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(1);
    expect(pos.y).toBeCloseTo(2);
    expect(pos.z).toBeCloseTo(3);
    expect(scale.x).toBeCloseTo(1);
  });

  it('badge InstancedMesh scale is zero for project node with no stage', () => {
    const m = createNodeMeshes(10);
    const nodes: NodeRenderData[] = [{ id: 'p1', type: 'project', x: 5, y: 5, z: 5 }];
    setNodePositions(nodes, m);

    // Access stored elements directly — avoids fromArray/decompose roundtrip
    // makeScale(0,0,0) elements: te[0]=0 (sx), te[5]=0 (sy), te[10]=0 (sz)
    const stored = (m.badgeMesh as any)._matrices.get(0) as number[] | undefined;
    expect(stored).toBeDefined();
    expect(stored![0]).toBeCloseTo(0);   // te[0] = sx
    expect(stored![5]).toBeCloseTo(0);   // te[5] = sy
    expect(stored![10]).toBeCloseTo(0);  // te[10] = sz
  });
});

// ── setNodeColor ──────────────────────────────────────────────────────────────

describe('setNodeColor', () => {
  it('sets instanceColor.needsUpdate to true after call', () => {
    const m = createNodeMeshes(10);
    setNodePositions([{ id: 'a', type: 'project', x: 0, y: 0, z: 0 }], m);

    setNodeColor('a', new THREE.Color(0xffffff), m, nodeIndexMap);

    expect(m.projectMesh.instanceColor).not.toBeNull();
    expect(m.projectMesh.instanceColor!.needsUpdate).toBe(true);
  });
});

// ── stageColor ────────────────────────────────────────────────────────────────

describe('stageColor', () => {
  it('returns distinct THREE.Color values for alpha, beta, deployed, archived', () => {
    const stages = ['alpha', 'beta', 'deployed', 'archived'];
    const colors = stages.map(stageColor);

    colors.forEach(c => expect(c).toBeInstanceOf(THREE.Color));

    // All four must be visually distinct (different hex values)
    const hexes = colors.map(c => c.getHex());
    expect(new Set(hexes).size).toBe(4);
  });
});
