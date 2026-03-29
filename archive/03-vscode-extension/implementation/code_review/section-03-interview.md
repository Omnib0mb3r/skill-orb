# Code Review Interview: section-03-api-server

## Items asked of user

None — all actionable items were clear-cut auto-fixes or had no real tradeoffs.

## Auto-fixes applied

- **Issue 1:** Added `localReposRoot: ''` to `createServer(...)` call in `tests/server.integration.test.ts` — TypeScript compile error from new required `ServerConfig` field
- **Issue 2:** Fixed Windows path separator in registry watcher glob in `server.ts` — replaced `path.join(localReposRoot, '*', 'devneural.json')` with forward-slash template literal + `depth: 1`
- **Issue 3:** Added `console.warn` for non-ENOENT read errors in `registry.ts` — previously swallowed silently; plan requires logging warnings for non-fatal errors
- **Issue 4:** Added `expect(warnSpy).toHaveBeenCalled()` assertion in `registry.test.ts` "returns an empty Map when localReposRoot does not exist" test — warning contract was unverified

## Items let go

- **Issue 5:** No watcher test for WeightsFile second arg — watcher contract indirectly covered by integration tests; out of scope for this section
- **Issue 6:** Pre-existing watcher/pre-load ordering race — not introduced by this diff
- **Issue 7:** Empty-string `stage` skipped silently — treated same as missing; acceptable per plan semantics
- **Issue 8:** Zod snapshot test doesn't verify absent-field JSON contract — absent-field contract already covered by a dedicated builder test
