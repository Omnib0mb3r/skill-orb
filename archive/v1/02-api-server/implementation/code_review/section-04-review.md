# Code Review — Section 04: REST Route Handlers

Reviewer: Senior Code Reviewer
Date: 2026-03-29
Branch: implement/02-api-server
Files reviewed:
- `src/routes/graph.ts`
- `src/routes/events.ts`
- `tests/routes/graph.test.ts`
- `tests/routes/events.test.ts`
- `package.json` / `package-lock.json` (CORS upgrade)

---

## Overall Assessment

This is a clean, well-structured implementation. The closure pattern is applied correctly, all six endpoints are present, Fastify generics are used throughout, and the test suite covers every required scenario. There are no critical defects. Two important issues are identified below — one is a semantic gap in limit-clamping that could cause a silent behavioral difference from the spec, and one is a missing CORS header assertion on the `/events` endpoint. Several minor suggestions round out the review.

---

## Plan Alignment

| Requirement | Status | Notes |
|---|---|---|
| 6 REST endpoints present | PASS | `/health`, `/graph`, `/graph/node/:id`, `/graph/subgraph`, `/graph/top`, `/events` |
| Closure pattern `registerGraphRoutes(app, getGraph)` | PASS | Exact signature matches plan |
| Closure pattern `registerEventsRoutes(app, getEvents)` | PASS | Exact signature matches plan |
| `GET /health` → `{ status: "ok", uptime: number }` | PASS | Uses `process.uptime()` |
| `GET /graph` always 200, empty when no data | PASS | Delegates to `getFullGraph` which handles empty graph |
| `GET /graph/node/:id` decodes param, 200 or 404 | PASS | `decodeURIComponent` applied before lookup |
| `GET /graph/subgraph` requires `?project=`, 400 if missing | PARTIAL | See Issue 1 — empty-string case |
| `GET /graph/top` default 10, clamped `[1,100]` | PARTIAL | See Issue 2 — lower-bound clamping |
| `GET /events` default 50, clamped `[1,500]`, total = buffer.length | PARTIAL | See Issue 2 — lower-bound clamping; total is correct |
| `LogEntry` declared in `src/routes/events.ts` | PASS | Matches plan location and field list |
| CORS in tests via direct registration | PASS | Both test files register `@fastify/cors` |
| `@fastify/cors` upgraded to v11 | PASS | `package.json` and lock file updated correctly |

---

## Issues

### Issue 1 — Important: Empty-string `?project=` passes the guard in `/graph/subgraph`

**File:** `src/routes/graph.ts`, line 28

The plan states:

> Returns HTTP 400 with `{ error: "Missing required query parameter: project" }` if absent **or empty**.

The guard is:

```typescript
if (!project) {
```

In JavaScript `!""` is `true`, so an empty-string value — the request `GET /graph/subgraph?project=` — correctly triggers the 400. This looks fine at first glance.

However, Fastify parses `?project=` as `project: ""` (an empty string), and `!""` is `true`, so the guard does fire. This is actually correct. But there is a subtlety: when `?project` appears without `=` (e.g., `GET /graph/subgraph?project`), Fastify may parse the value as `""` or `null` depending on how the query-string is decoded. In both cases `!project` evaluates to `true`, so the 400 path is taken. The implementation is safe.

The gap is that no test covers `?project=` (empty string explicitly provided). The plan calls this out as a case to verify. While the implementation handles it correctly by construction, the absence of a test means this behaviour is undocumented and could silently regress if the guard logic changes.

**Recommendation:** Add a test case to `tests/routes/graph.test.ts`:
```typescript
it('returns 400 when ?project= is present but empty', async () => {
  const res = await app.inject({ method: 'GET', url: '/graph/subgraph?project=' });
  expect(res.statusCode).toBe(400);
  const body = JSON.parse(res.body);
  expect(body.error).toBe('Missing required query parameter: project');
});
```

---

### Issue 2 — Important: Limit clamping does not enforce the lower bound of 1

**Files:** `src/routes/graph.ts` line 36, `src/routes/events.ts` line 17

The plan states the clamp range is `[1, 100]` for `/graph/top` and `[1, 500]` for `/events`. The current expression:

```typescript
const limit = isNaN(parsed) || parsed <= 0 ? 10 : Math.min(parsed, 100);
```

The ternary condition `parsed <= 0` correctly rejects zero and negatives, so `0` and `-5` fall back to the default of `10`. This satisfies the spec's "if below 1 or not a valid integer, use the default" language.

However, there is an edge case the spec language does not directly address but is implied by "clamp to `[1, 100]`": a value of exactly `0` should produce the default (10), not be clamped to `1`. The current code returns the default (`10`) for `parsed <= 0`, which is correct.

The actual gap is: the spec says "if below 1 or not a valid integer, use the default of 10" — this means `0`, `-5`, `NaN`, and `"abc"` all produce `10`. The code handles all of these correctly.

A secondary concern: the spec phrase "clamp to range `[1, 100]`" could be read as requiring that `parsed=0` maps to `1` rather than to the default `10`. The code resolves this by using the default, which is the safer and more user-friendly interpretation. This is an acceptable implementation choice, but it should be explicitly tested.

**Missing tests for both routes:**

- `/graph/top?limit=0` — should return default (10) edges, not 0 or 1
- `/graph/top?limit=-1` — should return default (10) edges
- `/graph/top?limit=abc` — should return default (10) edges
- Equivalent three cases for `/events`

The existing tests only cover the upper-bound clamp (`?limit=200` clamped to `100`, `?limit=600` clamped to `500`) and valid `?limit=3`. The invalid-input path for limits is completely untested.

**Recommendation:** Add the following to `tests/routes/graph.test.ts`:
```typescript
it('?limit=0 falls back to default of 10', async () => { ... });
it('?limit=-1 falls back to default of 10', async () => { ... });
it('?limit=abc falls back to default of 10', async () => { ... });
```
And equivalent cases to `tests/routes/events.test.ts`.

---

### Issue 3 — Suggestion: CORS header is only asserted on `GET /graph`, not on other endpoints

**File:** `tests/routes/graph.test.ts`, line 111–114

The plan states: "The `Access-Control-Allow-Origin: *` header must appear on **all** responses."

There is one CORS assertion in the test suite, placed on `GET /graph`. There are no CORS assertions on `/health`, `/graph/node/:id`, `/graph/subgraph`, `/graph/top`, or `/events`. Because CORS is registered as a global plugin the header will appear everywhere, but the lack of assertions means a future refactor that accidentally scopes CORS narrowly would not be caught by tests.

**Recommendation:** Add at minimum one CORS assertion to the `/events` test suite (since it lives in a separate file) and optionally spot-check one more endpoint in `graph.test.ts` (e.g., `/health`). This is low-effort and closes a documentation gap in the test suite.

---

### Issue 4 — Suggestion: `/graph/top` clamping test uses indirect evidence

**File:** `tests/routes/graph.test.ts`, lines 217–223

The test for `?limit=200` being clamped to `100` relies on the fixture having only 5 edges — so clamping to `100` and not clamping to `200` both produce `body.edges.length === 5`. The comment acknowledges this:

```
// fixture only has 5 edges, but limit was clamped to 100 (not 200)
```

This test does not actually prove the clamp occurred; it only proves the response length matches the fixture size. If the clamping logic were removed entirely, this test would still pass. The test is correct but not falsifiable for the clamping behavior.

**Recommendation:** Either add a fixture with more than 100 edges to provide a direct test of the upper-bound clamp, or add a comment acknowledging the indirect nature of this assertion so future readers are aware the clamping is only tested transitively.

---

### Issue 5 — Suggestion: `server.ts` contains a duplicate `/health` route that will conflict

**File:** `src/server.ts`, line 8

`server.ts` currently registers its own inline `GET /health` route:

```typescript
app.get('/health', async () => {
  return { status: 'ok' };
});
```

This route will conflict with the `/health` route registered by `registerGraphRoutes` when Section 07 wires everything together. Fastify will throw a duplicate route error at startup. The scaffold route also returns `{ status: 'ok' }` without `uptime`, which differs from the spec.

This is a Section 07 concern (server wiring), but it is worth flagging now so the Section 07 implementer knows this stub must be removed before calling `registerGraphRoutes`.

**Recommendation:** Add a comment to `src/server.ts` noting that the inline `/health` route is a placeholder and must be removed when `registerGraphRoutes` is mounted.

---

### Issue 6 — Suggestion: `parseInt` base-10 radix is correct but `??''` pattern has a subtle interaction

**Files:** `src/routes/graph.ts` line 35, `src/routes/events.ts` line 16

```typescript
const parsed = parseInt(request.query.limit ?? '', 10);
```

When `limit` is undefined, `?? ''` substitutes an empty string. `parseInt('', 10)` returns `NaN`, which the subsequent `isNaN` check catches correctly. This is a valid and common pattern. The only note is that `parseInt('5abc', 10)` returns `5` (leading-integer parse), so a user passing `?limit=5abc` would receive 5 edges, not the default. This is standard `parseInt` behavior and not a bug — it is worth documenting in a comment if strict validation is ever needed.

---

## What Was Done Well

**Closure pattern fidelity.** Both `registerGraphRoutes` and `registerEventsRoutes` match the planned signatures exactly. The `getGraph` and `getEvents` parameters make the shared-state contract explicit and testable without globals.

**Fastify generic typing.** `app.get<{ Querystring: { limit?: string } }>` and `app.get<{ Params: { id: string } }>` are used correctly throughout. TypeScript will catch any typos in `request.query.limit` or `request.params.id` at compile time.

**URL decoding.** `decodeURIComponent` is applied correctly before the graph lookup. The dedicated test with `project%3Ac%3A%2Fdev` verifies full encoding of colons and slashes — this is the correct and non-trivial case.

**`total` before slicing.** `buffer.length` is captured before `buffer.slice(0, limit)`, ensuring `total` reflects the full buffer size. The dedicated test at line 68 of `events.test.ts` verifies this directly.

**CORS upgrade.** The bump from `@fastify/cors` v9 to v11 is required for Fastify 5 compatibility. The `package-lock.json` is updated consistently, `mnemonist`/`obliterator` (now removed dependencies) are cleaned from the lock file, and the new `toad-cache` + `fastify-plugin@5` dependency tree is correct.

**Test isolation.** Each test file creates and tears down its own Fastify instance in `beforeEach`/`afterEach`. Fixture data is declared at module scope (immutable) and the mutable `graph` variable is reassigned per-test only where needed. This is the correct pattern.

**Empty-graph handling.** The `/graph` test at line 92 and `/graph/top` test at line 225 both verify empty-graph responses produce `{ nodes: [], edges: [] }` with HTTP 200, matching the plan's "never 404" requirement.

**`LogEntry` location.** Declared in `src/routes/events.ts` as specified. The interface is exported, allowing tests to import and use it for type-safe fixture construction.

---

## Summary of Required Actions

| Priority | Issue | Action |
|---|---|---|
| Important | Issue 1 | Add test for `?project=` (empty string) in `graph.test.ts` |
| Important | Issue 2 | Add tests for `limit=0`, `limit=-1`, `limit=abc` in both test files |
| Suggestion | Issue 3 | Add CORS header assertion to `events.test.ts` |
| Suggestion | Issue 4 | Document indirect nature of `?limit=200` clamp test |
| Suggestion | Issue 5 | Add comment to `server.ts` about placeholder `/health` route conflict |
| Suggestion | Issue 6 | Optional: document `parseInt` leading-integer behavior in a comment |

No code changes are required in the production source files. All issues are in the test suite. The implementation is correct and ready to integrate once the test gaps are addressed.
