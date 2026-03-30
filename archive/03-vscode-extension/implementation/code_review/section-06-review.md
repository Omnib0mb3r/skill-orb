# Code Review — section-06-threejs-scene

## MUST_FIX

1. **forceEngine 'd3' vs spec 'ngraph'** — spec says use ngraph first, fallback to d3 only if ngraph can't support per-tick custom forces. Implementation uses d3 without documenting the decision.

2. **warmupTicks at module init** — reviewer says overlay must be in DOM before warmupTicks is called. However, `warmupTicks(N)` is a configuration setter; actual warmup runs synchronously during `graphData()`. The overlay IS shown before `graphData()` is called (via requestAnimationFrame). This is correct behavior, not a bug.

3. **onFinishUpdate registered once globally** — reviewer worried it won't re-fire. Per three-forcegraph API, `onFinishUpdate` fires on every `graphData()` call after warmup. Module-level registration is correct.

4. **GraphLink type redundancy** — `type GraphLink = GraphEdge & { source: string; target: string }` is redundant since GraphEdge already has these fields. Minor cleanup.

5. **Test fragility with onFinishUpdateCallbacks[0]** — acceptable since vitest caches modules within a test file.

## CONSIDER

6. **Missing vz in sphere force** — `createSphereForce` updates vx and vy but omits vz entirely. Nodes would form a disk instead of sphere shell. **BUG — auto-fix.**

7. **Pin check only tests fx** — `node.fx !== undefined` is adequate for our use case (we pin all three axes together).

8. **capAndTransform includes pinning logic** — valid concern that pinning is physics concern, not pure data transform. Will add test coverage for it.

9. **Missing explicit "does not throw" test** — spec requires it. **Auto-add.**

10. **Mock path coupling** — acceptable for now.

## NITPICK

11. ResizeObserver not disconnected — valid, but not spec required.
12. startAnimationLoop no guard — acceptable.
13. main.ts calls getGraphInstance() twice — auto-fix.
14. CachedSnapshot comment mismatch in types.ts — not changed in this section.

## Decisions

- **MUST_FIX #1**: Add comment to orb.ts explaining d3 engine choice (ngraph lacks per-tick force injection API that we need for the sphere constraint)
- **MUST_FIX #2/#3**: No change — implementation is correct per API
- **MUST_FIX #4**: Simplify GraphLink type
- **CONSIDER #6**: Fix missing vz (BUG)
- **CONSIDER #8**: Add capAndTransform pinning test
- **CONSIDER #9**: Add explicit updateGraph no-throw test
- **NITPICK #13**: Clean up main.ts double call
