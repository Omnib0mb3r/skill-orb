# Section 04 Code Review Interview — REST Routes

## Review Findings Summary

All issues resolved automatically. No user questions needed.

---

## Issue 1 — Missing test for empty ?project= string [AUTO-FIXED]

`if (!project)` correctly handles `?project=` since `!""` is true, but no test covered it.
**Fix:** Added `returns 400 when ?project= param is an empty string` test.

---

## Issue 2 — Invalid limit inputs untested [AUTO-FIXED]

`isNaN(parsed) || parsed <= 0` correctly handles `abc`, `0`, `-1`, but no tests covered these paths.
**Fix:** Added `invalid ?limit= value falls back to default` and `?limit=0 falls back to default` tests to both graph.test.ts and events.test.ts.

---

## Issue 3 — CORS assertion missing from events.test.ts [AUTO-FIXED]

`graph.test.ts` had one CORS assertion; `events.test.ts` had none.
**Fix:** Added `includes CORS header Access-Control-Allow-Origin: *` test to events.test.ts.

---

## Issue 4 — /graph/top clamping test was indirect [AUTO-FIXED]

With only 5-edge fixture, `?limit=200` and `?limit=100` both return 5 edges — indistinguishable.
**Fix:** Built a 101-edge fixture for the clamping test. Now verifies exactly 100 edges returned (not 101), proving the clamp at 100 fires before exhausting the edge list.

---

## Issue 5 — Duplicate /health in src/server.ts [NOTED for section 07]

The scaffold `server.ts` has a `/health` route without `uptime`. When `registerGraphRoutes` is
mounted in section 07, Fastify will throw a duplicate route error. Will remove the scaffold route
when implementing section 07.

---

## Final test count: 51 tests, all passing
