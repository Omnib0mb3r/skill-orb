# Section 07: Integration — Code Review Interview

## Decision: Missing Assertions

**Question asked:** Should we add three missing assertions that were in the spec but not in the tests?

**User decision:** Yes, add them.

**Changes applied:**

1. `session-start.test.ts` happy path: `toContain('7.5')` → `toContain('7.5/10')` and `toContain('42')` → `toContain('42 uses')`
2. `session-start.test.ts` API offline: added `expect(result.stdout).toContain('node ')` to verify server startup command is printed

## Auto-fixes Applied

| Issue | Fix |
|-------|-----|
| `beforeAll` missing 30s timeout | Added `}, 30_000)` to `beforeAll` |
| `beforeAll` compile command | Changed `spawnSync('npx', ['tsc'])` → `spawnSync('npm', ['run', 'build'])` |
| ECONNREFUSED race in api-client.test.ts | Replaced start-then-stop pattern with hardcoded `http://127.0.0.1:1` |
| Port 19987 in session-start.test.ts | Changed to `http://127.0.0.1:1` (guaranteed refused on loopback) |

## Let Go

- `helpers.ts` handler-based API vs plan's response-object shape — handler is strictly more capable (tests inspect `?project=` query param) and all tests pass
- `api-client.test.ts` local `startMockServer` duplicate — self-contained and fine
- Extra boundary tests in formatter/api-client (good additions)
- `daysAgoISO(0)` midnight fragility — acceptable edge case
- Temp dir prefix mismatch — cosmetic

## Final Result

All 42 tests pass after fixes.
