export interface PhysicsNode {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface PhysicsEdge {
  sourceId: string;
  targetId: string;
  weight: number;
}

export interface Simulation {
  tick(): void;
  reset(): void;
  isCooled(): boolean;
  nodes: PhysicsNode[];
}

const REST_LENGTH = 3;
const SPRING_STRENGTH = 0.02;
const REPULSION_STRENGTH = 50;
const DAMPING = 0.85;
const VELOCITY_THRESHOLD = 0.001;

export function createSimulation(nodes: PhysicsNode[], edges: PhysicsEdge[]): Simulation {
  let _cooled = false;

  // Pre-build O(1) lookup for spring force calculations
  const nodeMap = new Map<string, PhysicsNode>(nodes.map(n => [n.id, n]));

  return {
    nodes,

    tick() {
      if (_cooled) return;

      // Spring forces (attraction along edges)
      for (const edge of edges) {
        const source = nodeMap.get(edge.sourceId);
        const target = nodeMap.get(edge.targetId);
        if (!source || !target) continue;

        const dx = target.position.x - source.position.x;
        const dy = target.position.y - source.position.y;
        const dz = target.position.z - source.position.z;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.1);
        const force = (dist - REST_LENGTH) * SPRING_STRENGTH * edge.weight;

        source.velocity.x += (dx / dist) * force;
        source.velocity.y += (dy / dist) * force;
        source.velocity.z += (dz / dist) * force;
        target.velocity.x -= (dx / dist) * force;
        target.velocity.y -= (dy / dist) * force;
        target.velocity.z -= (dz / dist) * force;
      }

      // Repulsion forces (all pairs)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const dz = b.position.z - a.position.z;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.1);
          const force = REPULSION_STRENGTH / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const fz = (dz / dist) * force;
          a.velocity.x -= fx;
          a.velocity.y -= fy;
          a.velocity.z -= fz;
          b.velocity.x += fx;
          b.velocity.y += fy;
          b.velocity.z += fz;
        }
      }

      // Apply damping, update positions, check cooldown
      let allCooled = true;
      for (const node of nodes) {
        node.velocity.x *= DAMPING;
        node.velocity.y *= DAMPING;
        node.velocity.z *= DAMPING;
        node.position.x += node.velocity.x;
        node.position.y += node.velocity.y;
        node.position.z += node.velocity.z;

        const speed = Math.sqrt(
          node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2,
        );
        if (speed >= VELOCITY_THRESHOLD) allCooled = false;
      }

      if (allCooled) _cooled = true;
    },

    reset() {
      _cooled = false;
      for (const node of nodes) {
        node.velocity.x = 0;
        node.velocity.y = 0;
        node.velocity.z = 0;
      }
    },

    isCooled() {
      return _cooled;
    },
  };
}
