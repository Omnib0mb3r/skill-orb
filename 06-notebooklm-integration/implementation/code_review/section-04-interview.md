# Code Review Interview — section-04-graph-reader

## No blockers. Auto-fix applied:

**API path lacked client-side project filter**
- Added same `source_node`/`target_node` filter to API path as file fallback
- Ensures API response is always scoped to the requested project, regardless of server behavior

## Let Go

**JSON.parse error message misleading** — caught by same block, logs as file read error; still returns []. Not worth restructuring.
**Test assertion strength** — toBeGreaterThan(0) is acceptable for integration-style assertions
**buildApiResponse helper missing target filter** — test helper detail, not a production bug
