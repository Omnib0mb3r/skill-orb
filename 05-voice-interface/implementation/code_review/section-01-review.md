# Code Review: section-01-api-extensions

## Findings

### MEDIUM — `vi` imported but never used; no broadcastFn spy tests
`voice.test.ts` imports `vi` but never uses it. The plan noted broadcastFn injection as a testability seam for spy tests — no test verifies `broadcastFn` was called with the correct typed argument in isolation.

### MEDIUM — Missing voice:clear WS broadcast integration test
The plan specifies three WS broadcast tests (voice:focus, voice:highlight, invalid type). `voice:clear` is only tested at HTTP level (200 returned); no WS receive test for it.

### LOW — ZodError.message is a JSON blob string
Both 400 error branches in `voice.ts` return `{ error: error.message }`. Zod v3's `.message` serializes the issues array as embedded JSON — not human-readable. Plan says "return 400 with a descriptive error". Should use `error.issues.map(i => i.message).join('; ')`.

### LOW — `z.object({})` for voice:clear payload doesn't enforce empty
Zod v3 strips unknown keys by default rather than rejecting them. Arbitrary extra properties on voice:clear payloads silently pass. Minor spec imprecision but spec matches plan.

### LOW — Inner WS test timeout equals Vitest default (5000ms)
If broadcast is broken, inner timeout fires simultaneously with Vitest's own timeout, producing confusing double-failure. A shorter inner timeout (2000ms) against a higher vitest.config timeout would be clearer.

## Triage

| # | Category | Action |
|---|----------|--------|
| 1 | vi unused | Auto-fix: remove unused import |
| 2 | missing voice:clear WS test | Auto-fix: add test |
| 3 | ZodError.message | Auto-fix: use `.issues` for readable errors |
| 4 | z.object({}) semantics | Let go — matches plan spec |
| 5 | WS timeout | Auto-fix: reduce inner timeout to 2000ms |
