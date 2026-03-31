import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => ({
  Vector3: vi.fn((x: number, y: number, z: number) => ({ x: x ?? 0, y: y ?? 0, z: z ?? 0 })),
}));

import { onHover, onClick, getTopConnections, resetHoverState } from '../../src/orb/interaction';
import type { InteractionState } from '../../src/orb/interaction';
import type { OrbNode, OrbEdge } from '../../src/graph/types';
import * as THREE from 'three';

function makeMesh(opacity = 0.9, emissiveIntensity = 0.1): THREE.Mesh {
  return {
    material: { opacity, emissiveIntensity, color: { setHex: vi.fn() } },
  } as unknown as THREE.Mesh;
}

function makeNode(id: string, type: OrbNode['type'] = 'skill'): OrbNode {
  return {
    id,
    label: id,
    type,
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function makeState(nodeIds: string[]): InteractionState {
  const nodes = new Map<string, OrbNode>();
  const meshes = new Map<string, THREE.Mesh>();
  for (const id of nodeIds) {
    nodes.set(id, makeNode(id));
    meshes.set(id, makeMesh());
  }
  return {
    nodes,
    meshes,
    edges: [],
    highlightedNodeIds: new Set(),
    focusedNodeId: null,
    simulationCooled: false,
    selectedNodeId: null,
  };
}

function makeEdge(src: string, dst: string, weight: number): OrbEdge {
  return { sourceId: src, targetId: dst, weight };
}

describe('onHover', () => {
  beforeEach(() => {
    resetHoverState();
    vi.clearAllMocks();
  });

  it('onHover(node) → mesh opacity increases to 1.0 (brighter than 0.9 default)', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };
    expect(mat.opacity).toBe(0.9);

    onHover(node, state);

    expect(mat.opacity).toBe(1.0);
  });

  it('onHover(node) → emissiveIntensity increases above default 0.1', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };

    onHover(node, state);

    expect(mat.emissiveIntensity).toBeGreaterThan(0.1);
  });

  it('onHover(null) after hover → previous node opacity restored to default', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };

    onHover(node, state);
    expect(mat.opacity).toBe(1.0);

    onHover(null, state);

    expect(mat.opacity).toBe(0.92); // getMaterialForNodeType('skill').opacity
  });

  it('onHover(null) after hover → emissiveIntensity restored to default 0.15', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const mat = state.meshes.get('a')!.material as unknown as { opacity: number; emissiveIntensity: number };

    onHover(node, state);
    onHover(null, state);

    expect(mat.emissiveIntensity).toBe(0.15); // getMaterialForNodeType('skill').emissiveIntensity
  });

  it('hovering a new node restores the previously hovered node', () => {
    const state = makeState(['a', 'b']);
    const nodeA = state.nodes.get('a')!;
    const nodeB = state.nodes.get('b')!;
    const matA = state.meshes.get('a')!.material as unknown as { opacity: number };

    onHover(nodeA, state);
    expect(matA.opacity).toBe(1.0);

    onHover(nodeB, state); // hover b, should restore a
    expect(matA.opacity).toBe(0.92); // getMaterialForNodeType('skill').opacity
  });
});

describe('onClick', () => {
  it('onClick(node) → selectedNodeId updated to node.id', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const camera = { lookAt: vi.fn() };

    onClick(node, state, camera as unknown as THREE.Camera);

    expect(state.selectedNodeId).toBe('a');
  });

  it('onClick(node) → camera.lookAt called once', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const camera = { lookAt: vi.fn() };

    onClick(node, state, camera as unknown as THREE.Camera);

    expect(camera.lookAt).toHaveBeenCalledTimes(1);
  });

  it('onClick(node) → camera.lookAt called with a Vector3 at node position', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const camera = { lookAt: vi.fn() };

    onClick(node, state, camera as unknown as THREE.Camera);

    expect(THREE.Vector3).toHaveBeenCalledWith(
      node.position.x,
      node.position.y,
      node.position.z,
    );
  });

  it('onClick(null) → selectedNodeId cleared to null', () => {
    const state = makeState(['a']);
    const node = state.nodes.get('a')!;
    const camera = { lookAt: vi.fn() };

    onClick(node, state, camera as unknown as THREE.Camera);
    expect(state.selectedNodeId).toBe('a');

    onClick(null, state, camera as unknown as THREE.Camera);
    expect(state.selectedNodeId).toBeNull();
  });
});

describe('getTopConnections', () => {
  it('returns up to limit edges sorted by weight descending', () => {
    const node = makeNode('a');
    const edges: OrbEdge[] = [
      makeEdge('a', 'b', 3),
      makeEdge('a', 'c', 7),
      makeEdge('a', 'd', 1),
      makeEdge('a', 'e', 5),
      makeEdge('a', 'f', 9),
      makeEdge('a', 'g', 4),
    ];

    const result = getTopConnections(node, edges, 5);

    expect(result).toHaveLength(5);
    expect(result[0].weight).toBe(9);
    expect(result[1].weight).toBe(7);
    expect(result[2].weight).toBe(5);
  });

  it('with fewer than limit edges → returns all edges without padding', () => {
    const node = makeNode('a');
    const edges: OrbEdge[] = [
      makeEdge('a', 'b', 3),
      makeEdge('a', 'c', 7),
    ];

    const result = getTopConnections(node, edges, 5);

    expect(result).toHaveLength(2);
  });

  it('only returns edges where node is an endpoint (sourceId or targetId)', () => {
    const node = makeNode('a');
    const edges: OrbEdge[] = [
      makeEdge('a', 'b', 3),  // node is src
      makeEdge('c', 'a', 5),  // node is dst
      makeEdge('b', 'c', 7),  // node not involved
    ];

    const result = getTopConnections(node, edges, 5);

    expect(result).toHaveLength(2);
    expect(result.every(e => e.sourceId === 'a' || e.targetId === 'a')).toBe(true);
  });

  it('sorts by weight descending when node appears as both src and dst', () => {
    const node = makeNode('x');
    const edges: OrbEdge[] = [
      makeEdge('x', 'a', 2),
      makeEdge('b', 'x', 8),
      makeEdge('x', 'c', 5),
    ];

    const result = getTopConnections(node, edges, 3);

    expect(result[0].weight).toBe(8);
    expect(result[1].weight).toBe(5);
    expect(result[2].weight).toBe(2);
  });
});
