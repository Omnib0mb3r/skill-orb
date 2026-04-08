/** Node types that correspond to DevNeural graph node types. */
export type NodeType = 'project' | 'skill' | 'tool';

/**
 * A node as represented in the orb scene.
 * Tracks position and velocity for the force simulation.
 */
export interface OrbNode {
  id: string;
  label: string;
  type: NodeType;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/**
 * An edge between two OrbNodes with a weight that drives
 * both spring force strength and visual opacity.
 */
export interface OrbEdge {
  /** Source node ID. */
  sourceId: string;
  /** Target node ID. */
  targetId: string;
  /** Normalized color weight in range 0.0–1.0 (relative to max edge weight in graph). */
  weight: number;
  /** Raw upstream usage weight — how much this edge is actually used. Drives heat. */
  usage: number;
}

/**
 * The full state of the Three.js scene, kept outside Three.js
 * objects so it is accessible to the force simulation and event handlers
 * without requiring a WebGL context.
 */
export interface SceneState {
  nodes: Map<string, OrbNode>;
  edges: OrbEdge[];
  /** Node IDs currently highlighted by a voice:highlight event. Empty = none highlighted. */
  highlightedNodeIds: Set<string>;
  /** Single node ID focused by a voice:focus event. Null = none focused. */
  focusedNodeId: string | null;
  /** Whether the force simulation has cooled down (all velocities below threshold). */
  simulationCooled: boolean;
}
