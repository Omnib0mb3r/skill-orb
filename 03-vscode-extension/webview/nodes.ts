import * as THREE from 'three';

export interface NodeRenderData {
  id: string;
  type: 'project' | 'tool' | 'skill';
  x: number;
  y: number;
  z: number;
  stage?: string;
}

// Module-level index map — populated by setNodePositions, consumed by section-09/10
export const nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }> = new Map();

// High-water mark: the number of node slots written in the last setNodePositions call.
// Used to zero out surplus slots when a subsequent snapshot has fewer nodes.
let prevNodeCount = 0;

// HSL tuples [hue, saturation, lightness] for stage badge colors (all visually distinct)
const STAGE_COLORS: Record<string, [number, number, number]> = {
  alpha:    [0.083, 0.95, 0.60],   // amber/gold
  beta:     [0.556, 0.85, 0.65],   // cyan
  deployed: [0.333, 0.90, 0.55],   // green
  archived: [0.000, 0.00, 0.45],   // neutral grey (achromatic)
};

const DEFAULT_NODE_COLORS: Record<string, THREE.Color> = {
  project: new THREE.Color(0x3388ff),
  tool:    new THREE.Color(0x33cc77),
  skill:   new THREE.Color(0xff7733),
};

/** Returns the badge color for a stage string. */
export function stageColor(stage: string): THREE.Color {
  const hsl = STAGE_COLORS[stage];
  if (!hsl) return new THREE.Color(0x888888);
  return new THREE.Color().setHSL(hsl[0], hsl[1], hsl[2]);
}

/**
 * Creates the four InstancedMesh objects used for node rendering.
 * maxNodes is the upper bound for all instance counts.
 * All instances are initialized to zero-scale (invisible) until setNodePositions is called.
 */
export function createNodeMeshes(maxNodes: number): {
  projectMesh: THREE.InstancedMesh;
  toolMesh: THREE.InstancedMesh;
  skillMesh: THREE.InstancedMesh;
  badgeMesh: THREE.InstancedMesh;
} {
  const mat = new THREE.MeshPhongMaterial();

  const projectMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.15, 0.9),
    mat.clone(),
    maxNodes
  );
  const toolMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    mat.clone(),
    maxNodes
  );
  const skillMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.7),
    mat.clone(),
    maxNodes
  );
  const badgeMesh = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.55, 0.06, 8, 24),
    mat.clone(),
    maxNodes
  );

  // Initialize all slots to zero scale (invisible)
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < maxNodes; i++) {
    projectMesh.setMatrixAt(i, zeroMatrix);
    toolMesh.setMatrixAt(i, zeroMatrix);
    skillMesh.setMatrixAt(i, zeroMatrix);
    badgeMesh.setMatrixAt(i, zeroMatrix);
  }
  projectMesh.instanceMatrix.needsUpdate = true;
  toolMesh.instanceMatrix.needsUpdate = true;
  skillMesh.instanceMatrix.needsUpdate = true;
  badgeMesh.instanceMatrix.needsUpdate = true;

  return { projectMesh, toolMesh, skillMesh, badgeMesh };
}

/**
 * Updates all instance matrices from force layout positions.
 * Uses a global index per node so all four meshes share the same slot numbering.
 * Populates nodeIndexMap with the mesh and index for each node id.
 */
export function setNodePositions(
  nodes: NodeRenderData[],
  meshes: ReturnType<typeof createNodeMeshes>
): void {
  nodeIndexMap.clear();

  const dummy = new THREE.Object3D();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  // Zero out any slots written by the previous call that exceed the current node count.
  // Without this, removed nodes leave ghost geometry at their last positions.
  const all4 = [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh, meshes.badgeMesh];
  for (let i = nodes.length; i < prevNodeCount; i++) {
    for (const m of all4) {
      m.setMatrixAt(i, zeroMatrix);
    }
  }

  nodes.forEach((node, globalIndex) => {
    // Build visible node matrix at the node's force position
    dummy.position.set(node.x, node.y, node.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    const nodeMatrix = dummy.matrix.clone();

    // Show only the correct type mesh for this slot; zero the others
    let nodeMesh: THREE.InstancedMesh;
    if (node.type === 'project') {
      nodeMesh = meshes.projectMesh;
      meshes.projectMesh.setMatrixAt(globalIndex, nodeMatrix);
      meshes.toolMesh.setMatrixAt(globalIndex, zeroMatrix);
      meshes.skillMesh.setMatrixAt(globalIndex, zeroMatrix);
    } else if (node.type === 'tool') {
      nodeMesh = meshes.toolMesh;
      meshes.projectMesh.setMatrixAt(globalIndex, zeroMatrix);
      meshes.toolMesh.setMatrixAt(globalIndex, nodeMatrix);
      meshes.skillMesh.setMatrixAt(globalIndex, zeroMatrix);
    } else {
      nodeMesh = meshes.skillMesh;
      meshes.projectMesh.setMatrixAt(globalIndex, zeroMatrix);
      meshes.toolMesh.setMatrixAt(globalIndex, zeroMatrix);
      meshes.skillMesh.setMatrixAt(globalIndex, nodeMatrix);
    }

    // Default type color
    nodeMesh.setColorAt(globalIndex, DEFAULT_NODE_COLORS[node.type]);

    // Badge: visible only for project nodes that have a stage
    if (node.type === 'project' && node.stage) {
      dummy.position.set(node.x, node.y + 0.65, node.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshes.badgeMesh.setMatrixAt(globalIndex, dummy.matrix.clone());
      meshes.badgeMesh.setColorAt(globalIndex, stageColor(node.stage));
    } else {
      meshes.badgeMesh.setMatrixAt(globalIndex, zeroMatrix);
    }

    nodeIndexMap.set(node.id, { mesh: nodeMesh, index: globalIndex });
  });

  // Bulk needsUpdate after all writes
  for (const m of all4) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  prevNodeCount = nodes.length;
}

/** Sets a node's instance color. MUST call instanceColor.needsUpdate = true — this function does it. */
export function setNodeColor(
  nodeId: string,
  color: THREE.Color,
  _meshes: ReturnType<typeof createNodeMeshes>,
  map: Map<string, { mesh: THREE.InstancedMesh; index: number }>
): void {
  const entry = map.get(nodeId);
  if (!entry) return;
  entry.mesh.setColorAt(entry.index, color);
  entry.mesh.instanceColor!.needsUpdate = true;
}

/** Resets all node colors to their default type-based colors. */
export function resetNodeColors(
  meshes: ReturnType<typeof createNodeMeshes>,
  map: Map<string, { mesh: THREE.InstancedMesh; index: number }>
): void {
  for (const { mesh, index } of map.values()) {
    const type =
      mesh === meshes.projectMesh ? 'project' :
      mesh === meshes.toolMesh    ? 'tool'    :
      'skill';
    mesh.setColorAt(index, DEFAULT_NODE_COLORS[type]);
  }
  for (const m of [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh, meshes.badgeMesh]) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
