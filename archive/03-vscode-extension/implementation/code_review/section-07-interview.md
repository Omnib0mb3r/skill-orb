# Code Review Interview: section-07-rendering

## Decisions

### Ghost nodes fix (MUST FIX → Fix)
**Decision:** Yes, fix it.
**Action:** Track `prevNodeCount` at module level in nodes.ts. At the start of each `setNodePositions` call, zero out slots `nodes.length..prevNodeCount-1` for all four meshes before writing current nodes.

### Zero-range color (MUST FIX → Document)
**Decision:** Keep normalized = 1.0 (warm orange). The spec docstring was a typo; the algorithm step is authoritative.
**Action:** Add a clarifying comment in edges.ts.

### addResizeListener not wired (MUST FIX → Auto-fix)
**Decision:** Auto-fix — wire it in updateGraph (called when edge lines are rebuilt).

### resetNodeColors missing badgeMesh flush (CONSIDER → Auto-fix)
**Decision:** Auto-fix — add badgeMesh to the instanceColor.needsUpdate loop.

### computeLineDistances every frame (CONSIDER → Auto-fix)
**Decision:** Auto-fix — remove from updateEdgePositions; it's already called in createEdgeLines.

### nodeIndexMap singleton (CONSIDER → Let go)
**Decision:** Spec says "Export this"; keep as-is.

### _meshes dead parameter (CONSIDER → Let go)
**Decision:** Spec requires this signature for section-10 compatibility; keep with underscore prefix.

### resetNodeColors test coverage (NITPICK → Let go)
**Decision:** Defer to section-09 when it's first used.

### Per-frame allocation (NITPICK → Let go)
**Decision:** Not a priority at this stage; optimize if profiling shows GC pressure.
