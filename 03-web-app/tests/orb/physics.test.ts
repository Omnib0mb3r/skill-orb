import { describe, it, expect } from 'vitest';
import { createSimulation } from '../../src/orb/physics';
import type { PhysicsNode, PhysicsEdge } from '../../src/orb/physics';

function makeNode(id: string, x = 0, y = 0, z = 0): PhysicsNode {
  return { id, position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } };
}

function dist(a: PhysicsNode, b: PhysicsNode): number {
  return Math.sqrt(
    (b.position.x - a.position.x) ** 2 +
    (b.position.y - a.position.y) ** 2 +
    (b.position.z - a.position.z) ** 2,
  );
}

describe('physics simulation', () => {
  it('simulate(nodes, edges) → each node position changes after one tick', () => {
    const nodes = [makeNode('a', 0, 0, 0), makeNode('b', 3, 0, 0)];
    const sim = createSimulation(nodes, []);
    const aX0 = nodes[0].position.x;
    const bX0 = nodes[1].position.x;
    sim.tick();
    const moved = nodes[0].position.x !== aX0 || nodes[1].position.x !== bX0;
    expect(moved).toBe(true);
  });

  it('simulate with no edges → nodes repel each other (positions spread apart after N ticks)', () => {
    const nodes = [makeNode('a', 0, 0, 0), makeNode('b', 3, 0, 0)];
    const sim = createSimulation(nodes, []);
    const d0 = dist(nodes[0], nodes[1]);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(dist(nodes[0], nodes[1])).toBeGreaterThan(d0);
  });

  it('high-weight edge → connected nodes closer after N ticks than with low-weight edge', () => {
    function runSim(weight: number): number {
      const nodes = [makeNode('a', -5, 0, 0), makeNode('b', 5, 0, 0)];
      const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight };
      const sim = createSimulation(nodes, [edge]);
      for (let i = 0; i < 60; i++) sim.tick();
      return dist(nodes[0], nodes[1]);
    }
    expect(runSim(10)).toBeLessThan(runSim(1));
  });

  it('velocity threshold: after many ticks on a stable graph, all node velocities < 0.001', () => {
    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
    const sim = createSimulation(nodes, [edge]);
    for (let i = 0; i < 600; i++) sim.tick();
    for (const node of nodes) {
      const speed = Math.sqrt(node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2);
      expect(speed).toBeLessThan(0.001);
    }
  });

  it('cooldown flag is set when simulation stabilizes → further tick() calls are no-ops', () => {
    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
    const sim = createSimulation(nodes, [edge]);
    for (let i = 0; i < 600; i++) sim.tick();
    expect(sim.isCooled()).toBe(true);
    const posX = nodes[0].position.x;
    sim.tick();
    expect(nodes[0].position.x).toBe(posX);
  });

  it('reset() restarts the simulation: cooldown flag cleared, velocities zeroed', () => {
    const nodes = [makeNode('a', -3, 0, 0), makeNode('b', 3, 0, 0)];
    const edge: PhysicsEdge = { sourceId: 'a', targetId: 'b', weight: 5 };
    const sim = createSimulation(nodes, [edge]);
    for (let i = 0; i < 600; i++) sim.tick();
    expect(sim.isCooled()).toBe(true);
    sim.reset();
    expect(sim.isCooled()).toBe(false);
    for (const node of nodes) {
      expect(node.velocity.x).toBe(0);
      expect(node.velocity.y).toBe(0);
      expect(node.velocity.z).toBe(0);
    }
  });
});
