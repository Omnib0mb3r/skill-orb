# Code Review Interview — section-03-api-client

## Review Findings

**MUST FIX (2)**
1. Import path `../src/api-client` lacks `.js` extension (plan stub uses `.js`)
2. ECONNREFUSED test hardcodes port 19999 — could be in use, causing flaky tests

**SHOULD FIX (2)**
3. No test for `!response.ok` branch (HTTP 4xx/5xx)
4. Timeout test lacks timing assertion — doesn't verify timeout fired at ~5s

**NITPICK (4)**
5. `buildApiConfig` hardcodes timeoutMs to 5000
6. `startMockServer` inline, not consolidated helper
7. `as GraphResponse` is an unsafe cast
8. Env-var precedence test isolation could be stricter

## Triage Decisions

| # | Decision | Rationale |
|---|---------|-----------|
| 1 | **Let go** | `identity.test.ts` uses the same no-extension style; consistent project pattern |
| 2 | **Auto-fix** | Start a server, record port, stop it, use freed port — deterministic |
| 3 | **Auto-fix** | Add `it('returns null on non-OK HTTP status')` |
| 4 | **Auto-fix** | Add `Date.now()` delta assertion: `expect(elapsed).toBeLessThan(5500)` |
| 5 | **Let go** | Plan-intentional; no env override needed |
| 6 | **Let go** | Section-07-integration will consolidate helpers |
| 7 | **Let go** | Plan-intentional trade-off, no schema validation required |
| 8 | **Let go** | Test effectively validates via null return from wrong port |

## User Interview

No user input required — all actionable items are auto-fixes.

## Applied Auto-fixes

1. ECONNREFUSED test: start a server, get port, stop server, then call fetchSubgraph on that freed port
2. Add HTTP non-OK test: mock server returns 404, assert null
3. Timeout test: add `Date.now()` before/after, assert elapsed < 5500ms
