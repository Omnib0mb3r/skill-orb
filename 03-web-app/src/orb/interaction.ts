import * as THREE from 'three';
import type { OrbNode, OrbEdge, SceneState } from '../graph/types';
import { getMaterialForNodeType, highlightMaterialConfig } from './visuals';

/** Extended SceneState with Three.js meshes and interaction selection state. */
export interface InteractionState extends SceneState {
  meshes: Map<string, THREE.Mesh>;
  selectedNodeId: string | null;
}

/** Module-level tracker for the currently hovered node ID. */
let _previousHoverNodeId: string | null = null;

/** Reset hover state — exported for test cleanup. */
export function resetHoverState(): void {
  _previousHoverNodeId = null;
}

/**
 * Update mesh material brightness on hover.
 * Restores the previously hovered node's material before applying to the new target.
 */
export function onHover(node: OrbNode | null, state: InteractionState): void {
  // Restore previous hover target
  if (_previousHoverNodeId !== null) {
    const prevMesh = state.meshes.get(_previousHoverNodeId);
    const prevNode = state.nodes.get(_previousHoverNodeId);
    if (prevMesh && prevNode) {
      const mat = prevMesh.material as THREE.MeshStandardMaterial;
      const config = state.highlightedNodeIds.has(_previousHoverNodeId)
        ? highlightMaterialConfig
        : getMaterialForNodeType(prevNode.type);
      mat.opacity = config.opacity;
      mat.emissiveIntensity = config.emissiveIntensity ?? 0.1;
    }
    _previousHoverNodeId = null;
  }

  if (node !== null) {
    const mesh = state.meshes.get(node.id);
    if (mesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 1.0;
      mat.emissiveIntensity = 0.5;
    }
    _previousHoverNodeId = node.id;
  }
}

/**
 * Handle a click on a node or empty space.
 * Updates selectedNodeId and points the camera toward the clicked node.
 */
export function onClick(
  node: OrbNode | null,
  state: InteractionState,
  camera: THREE.Camera,
): void {
  if (node !== null) {
    state.selectedNodeId = node.id;
    camera.lookAt(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
  } else {
    state.selectedNodeId = null;
  }
}

/**
 * Pure function — returns the top `limit` edges connected to `node`,
 * sorted by weight descending.
 */
export function getTopConnections(
  node: OrbNode,
  edges: OrbEdge[],
  limit: number,
): OrbEdge[] {
  return edges
    .filter(e => e.sourceId === node.id || e.targetId === node.id)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}
