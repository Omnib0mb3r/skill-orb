<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-setup
section-02-identity
section-03-api-client
section-04-formatter
section-05-entry-point
section-06-install-script
section-07-integration
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-setup | — | all | Yes |
| section-02-identity | 01 | 05 | Yes |
| section-03-api-client | 01 | 05 | Yes |
| section-04-formatter | 01 | 05 | Yes |
| section-05-entry-point | 02, 03, 04 | 07 | No |
| section-06-install-script | 01 | — | Yes |
| section-07-integration | 05 | — | No |

## Execution Order

1. **section-01-setup** — no dependencies; creates package.json, tsconfig.json, vitest.config.ts
2. **section-02-identity**, **section-03-api-client**, **section-04-formatter**, **section-06-install-script** — all depend only on section-01; can run in parallel
3. **section-05-entry-point** — requires 02, 03, 04
4. **section-07-integration** — final; verifies compiled binary end-to-end

## Section Summaries

### section-01-setup
`package.json`, `tsconfig.json`, `vitest.config.ts`. No `rootDir` in tsconfig to allow cross-package imports. Vitest config sets `testTimeout: 15000`. Establishes `npm run build`, `npm test`, `npm run install-hook` scripts. Runtime deps: none. Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`.

### section-02-identity
`src/identity.ts` — thin re-export wrapper. Imports `resolveProjectIdentity` and `ProjectIdentity` from `../01-data-layer/dist/identity/index.js` and `../01-data-layer/dist/types.js`. Note: `01-data-layer` must be built first. TDD stubs: compile-time check for import; unit tests for known git dir and fallback (no git).

### section-03-api-client
`src/api-client.ts` — HTTP client using `fetch` + `AbortSignal.timeout(5000)`. Returns `GraphResponse | null`. URL: `DEVNEURAL_API_URL` wins; otherwise `http://localhost:${DEVNEURAL_PORT ?? 3747}`. Any error returns null. TDD stubs: success, ECONNREFUSED, timeout, empty graph, malformed JSON, env var precedence.

### section-04-formatter
`src/formatter.ts` — pure function `formatSubgraph(id, response, config)`. Filters to outgoing `project->skill` and `project->project` edges above minWeight (1.0), top 10 per type, includes raw_count. Output structure per spec. TDD stubs: both sections, skills only, projects only, no connections, raw_count in output, relative time, label fallback, top-10 limit, weight filter, outgoing-only, tool-edge exclusion.

### section-05-entry-point
`src/session-start.ts` — reads stdin JSON payload, extracts `cwd`, calls identity → API → formatter → stdout. Entire execution wrapped in `.catch(process.exit(0))`. Uses `DEVNEURAL_API_URL`/`DEVNEURAL_PORT` for config. TDD stubs: happy path, no connections, API offline, timeout, malformed stdin, no-git fallback, top-10 limit, weight filter.

### section-06-install-script
`src/install-hook.ts` — reads `~/.claude/settings.json`, deduplicates by scanning command strings across ALL entries (including entries without `matcher` field), appends 4 matcher entries (startup, resume, clear, compact) if not already present. Idempotent. TDD stubs: install on empty settings, idempotency, dedup with matcher-less entries, JSON validity.

### section-07-integration
Full integration pass: `npm run build` + `npm test`. Verifies compiled binary end-to-end with `spawnSync`. Integration tests in `tests/session-start.test.ts`; unit tests in `tests/formatter.test.ts` and `tests/api-client.test.ts`. All mock servers use `node:http.createServer` — no Fastify dependency.
