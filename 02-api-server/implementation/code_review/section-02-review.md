# Code Review: section-02-graph-types

## Summary

Types and builder algorithm are correct. Two MEDIUM test coverage gaps: the 6th required test (duplicate connections) is missing, replaced by a bonus test; the adjacency test doesn't exercise the "2 as source + 1 as target = 3 total" scenario from the plan spec. One LOW (no test for unknown-prefix fallback). Both MEDIUMs are auto-fixed.

---

## Findings

### MEDIUM → AUTO-FIX: Missing required test — duplicate connections

The plan specifies 6 required tests; test 6 is:
> "WeightsFile keys are unique by definition, so each key produces exactly one edge."

A bonus colon-in-label test was added instead. Action: add the duplicate-connections test (bonus test stays as 7th).

### MEDIUM → AUTO-FIX: Adjacency test scenario narrower than plan

The plan (spec line 54): "a node that appears in 3 edges (as source in 2, target in 1) has 3 edge ids."
The current test uses `project:a` as source only in 2 edges. A buggy "source-only adjacency" implementation would still pass. Fix: add a connection where `project:a` is also a *target*.

### LOW: No test for unknown-prefix fallback

If node id has no ':', parseNode silently returns type='skill'. Plan permits this. Optional test for MVP — skipped.

---

## Non-Issues

- **types.ts**: All 7 exports match spec exactly.
- **buildGraph algorithm**: 4-phase flow, deduplication, dual adjacency, descending sort — all correct.
- **ESM .js extensions**: Correct throughout.
