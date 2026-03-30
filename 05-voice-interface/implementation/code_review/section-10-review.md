# Code Review: section-10-orb-renderer

## Critical

**1. builder.ts — Mesh position and PhysicsNode position are separate objects (lines 87–104)**
`mesh.position.set(pos.x, pos.y, pos.z)` copies scalars into Three.js's internal Vector3.
The `pos` plain object assigned to `physNode.position` is a completely separate object.
Physics mutations never reach the mesh. The plan explicitly requires sharing the same position object.
**Fix**: Assign `mesh.position` directly as `physNode.position` (Vector3 satisfies `{ x, y, z }`).

## Significant

**2. physics.ts — O(E×N) node lookup in spring loop (lines 184–185)**
`nodes.find()` inside the spring loop is O(E×N) per frame. Pre-build a `Map<string, PhysicsNode>` inside `createSimulation` for O(1) lookup.

**3. renderer.ts — resize listener leaks on repeated initRenderer calls**
No cleanup mechanism. Acceptable for plan scope; noted for section-12 integration.

**4. builder.ts — BuildResult extends SceneState adding `simulation` field**
The plan says return `SceneState`; implementation uses `BuildResult`. Intentional extension needed for section-12 wiring. Noted as plan deviation.

## Minor

**5. builder.test.ts — No test for returned simulation object**
Missing assertion that `result.simulation` has `tick`, `isCooled`, `reset` methods.

**6. builder.ts — `type` field in GraphNode should be optional**
Plan says "if for any reason it is absent, fall back to id prefix" but GraphNode.type is non-optional.
Dead code: the `?? inferType(node.id)` branch is unreachable with current typing.

**7. renderer.test.ts lights test — fragile exact count**
`expect(sceneMock.add).toHaveBeenCalledTimes(2)` will break if a third light is ever added.
Low risk for now.

## Verdict
Critical fix required: position sharing. O(N²) lookup should be fixed as well. Others are auto-fixable or acceptable.
