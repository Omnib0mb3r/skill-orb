# TDD Plan: 04-session-intelligence

## Testing Framework

**Vitest** — matching the `01-data-layer` pattern.
- Unit tests: pure function calls with constructed inputs
- Integration tests: `spawnSync('node', ['dist/session-start.js'], { input: payload })` against compiled binary
- Mock API server: `node:http.createServer` (no Fastify dependency)
- Test timeout config: `vitest.config.ts` with `testTimeout: 15000` for slow timeout tests

Write tests BEFORE implementing each section. Each test should fail (or not compile) at first, then pass after implementation.

---

## Section 1: Package and TypeScript Setup

**Tests to write first:**

- Test: `tsc --noEmit` succeeds with no errors (write this as a build validation step, confirmed by `npm run build` in CI)
- Test: `dist/session-start.js` exists after `npm run build`
- Test: `node dist/session-start.js` with empty stdin exits 0 without throwing

---

## Section 2: Identity Module

**Tests to write first (`tests/formatter.test.ts` or a dedicated `tests/identity.test.ts`):**

- Test: importing `resolveProjectIdentity` from `./identity` succeeds (compile-time check)
- Test: `resolveProjectIdentity` called with a known git repo path returns an object with `id` (string) and `source` fields
- Test: `resolveProjectIdentity` called with a temp directory (no `.git`) returns an object with `id` falling back to the directory name

---

## Section 3: API Client

**Tests to write first (`tests/api-client.test.ts`):**

- Test: `fetchSubgraph` with a mock server returning valid `GraphResponse` JSON → returns the parsed object
- Test: `fetchSubgraph` with a port where nothing is listening → returns `null` (ECONNREFUSED)
- Test: `fetchSubgraph` with a mock server that delays 6 seconds → returns `null` within ~5.5s; `{ timeout: 15000 }`
- Test: `fetchSubgraph` with a mock server returning empty graph `{ nodes: [], edges: [], updated_at: "..." }` → returns the empty `GraphResponse` (not null; empty is valid)
- Test: `fetchSubgraph` with a mock server returning malformed JSON → returns `null`
- Test: `DEVNEURAL_API_URL` env var overrides `DEVNEURAL_PORT` when constructing the URL
- Test: `DEVNEURAL_PORT` defaults to `3747` when neither env var is set

---

## Section 4: Formatter

**Tests to write first (`tests/formatter.test.ts`):**

- Test: `formatSubgraph` with a project that has both skill and project edges → output contains "Skills (top connections):" and "Related Projects:" headers
- Test: `formatSubgraph` with only skill edges → output contains "Skills" section but NOT "Related Projects:" header
- Test: `formatSubgraph` with only project edges → output contains "Related Projects" section but NOT "Skills:" header
- Test: `formatSubgraph` with no edges above minWeight → output contains "No significant connections found"
- Test: `formatSubgraph` output includes `raw_count` as "(N uses)" next to each entry
- Test: `formatSubgraph` `last_seen` of today → relative time string is "today"
- Test: `formatSubgraph` `last_seen` of 2 days ago → "2 days ago"
- Test: `formatSubgraph` `last_seen` of 8 days ago → "1 week ago"
- Test: `formatSubgraph` edge target with no matching node in `nodes` array → strips type prefix from id as fallback label (e.g., `"skill:my-skill"` → `"my-skill"`)
- Test: `formatSubgraph` with 15 skill edges → output contains exactly 10 entries (maxResultsPerType = 10)
- Test: `formatSubgraph` with a skill edge where `weight < 1.0` → that skill does NOT appear in output
- Test: outgoing-only filter — an edge where this project is the `target` (not source) is excluded
- Test: `project->tool` edges are excluded from output

---

## Section 5: Main Entry Point

**Tests to write first (`tests/session-start.test.ts`):**

All integration tests compile the binary once in `beforeAll` (`tsc`) then use `spawnSync`.

- Test: valid payload with a project in the mock API graph → stdout contains "DevNeural Context for", skill labels, weight values, and use counts; exit code 0
- Test: valid payload with project not in graph (empty `GraphResponse`) → stdout contains "No significant connections"; exit code 0
- Test: valid payload but API is offline (ECONNREFUSED) → stdout contains "API offline" and a command to start the server; exit code 0
- Test: valid payload but API delays 6s → stdout contains "API offline"; exits within 7s; exit code 0; `{ timeout: 15000 }`
- Test: malformed JSON on stdin → exits 0 with empty stdout (silent failure)
- Test: valid payload with CWD pointing to a temp dir (no git) → exits 0 (uses fallback identity, calls API)
- Test: mock API returns 15 skills → stdout contains exactly 10 skill entries
- Test: mock API returns skills with weight 0.5 → those skills do NOT appear in stdout

---

## Section 6: Install Script

**Tests to write first (can be manual/smoke tests — install script is a one-time utility):**

- Test: running `npm run install-hook` on a settings.json with no existing `SessionStart` hooks → adds 4 matcher entries for startup, resume, clear, compact
- Test: running `npm run install-hook` twice → settings.json contains exactly 4 DevNeural entries (idempotent, no duplicates)
- Test: running `npm run install-hook` on a settings.json where an existing entry has no `matcher` field with the same command → does not add a duplicate
- Test: settings.json is valid JSON after install (all existing fields preserved)

These can be written as unit tests against the `mergeHooks` function directly, using constructed settings objects, without touching the real `~/.claude/settings.json`.

---

## Section 7: Tests

The tests themselves are the deliverable of this section. No additional stubs required — verify that all tests from sections 1–6 pass after `npm run build` and `npm test`.

Final validation:
- `npm run build` exits 0 with no TypeScript errors
- `npm test` exits 0 with all tests passing
- No test uses Fastify (only `node:http`)
- No test modifies the real `~/.claude/settings.json`
