<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-foundation
section-02-config
section-03-identity
section-04-logger
section-05-weights
section-06-hook-runner
section-07-build-and-wire
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-foundation | — | all | Yes |
| section-02-config | 01 | 06 | Yes (with 03, 04, 05) |
| section-03-identity | 01 | 06 | Yes (with 02, 04, 05) |
| section-04-logger | 01 | 06 | Yes (with 02, 03, 05) |
| section-05-weights | 01 | 06 | Yes (with 02, 03, 04) |
| section-06-hook-runner | 02, 03, 04, 05 | 07 | No |
| section-07-build-and-wire | 06 | — | No |

## Execution Order

1. **section-01-foundation** (no dependencies — sets up project scaffold and core types)
2. **section-02-config**, **section-03-identity**, **section-04-logger**, **section-05-weights** (all parallel after 01 — independent modules with no cross-dependencies)
3. **section-06-hook-runner** (after 02–05 — integrates all modules)
4. **section-07-build-and-wire** (final — build verification and settings.json hook registration)

## Section Summaries

### section-01-foundation
Project scaffold: `package.json` (dependencies including `write-file-atomic`, `proper-lockfile`), `tsconfig.json` (CommonJS output, ES2022 target, strict), `vitest.config.ts`, `tests/` directory with shared temp-dir fixture helper. Core TypeScript interfaces: `LogEntry`, `ConnectionRecord`, `WeightsFile`, `HookPayload`, `Config`, `ConnectionType`, `ProjectSource`, `DerivedConnection`. No implementation — types only.

### section-02-config
`src/config/index.ts` — `loadConfig(dataRoot)` function. Reads `<dataRoot>/config.json`, merges with defaults. Logs to stderr on JSON parse failure. Respects `DEVNEURAL_DATA_ROOT` env var. Full test suite in `tests/config.test.ts` (5 tests).

### section-03-identity
`src/identity/index.ts` — `resolveProjectIdentity(cwd)`, `normalizeGitUrl(url)`, `normalizePath(p)`, inline `findUp` helper. Uses `child_process.execSync` for git remote lookup. Never throws — falls back through git-remote → git-root → cwd. Full test suite in `tests/identity.test.ts` (11 tests including edge cases for unrecognized URL formats and missing git binary).

### section-04-logger
`src/logger/types.ts` (re-exports `LogEntry` type) and `src/logger/index.ts` — `buildLogEntry(...)`, `appendLogEntry(entry, dataRoot)`, `getLogFilePath(dataRoot, date?)`. Uses `fs.promises.appendFile` with lazy directory creation. Never throws. Full test suite in `tests/logger.test.ts` (7 tests including read-only directory failure case).

### section-05-weights
`src/weights/types.ts` (re-exports `WeightsFile`, `ConnectionRecord`) and `src/weights/index.ts` — `loadWeights(dataRoot)`, `connectionKey(source, target)`, `updateWeight(weights, ...)`, `saveWeights(weights, dataRoot)`. Uses `write-file-atomic` for atomic writes and `proper-lockfile` for read-modify-write concurrency protection (5-second stale timeout, unlocked fallback). Full test suite in `tests/weights.test.ts` (9 tests including concurrent write simulation).

### section-06-hook-runner
`src/hook-runner.ts` — the main entry point. Implements `deriveConnections(payload, identity)` returning `DerivedConnection[]` (primary `project→tool`/`project→skill` + optional `project→project`), `extractProjectRefs(payload, identity)` for cross-project detection per tool type (Write/Edit file_path, Bash absolute paths, Agent prompt/description URLs). Orchestrates the full pipeline with `Promise.all` for parallel log append + weight update. Top-level try/catch ensures exit 0 always. Full test suite in `tests/hook-runner.test.ts` (15 tests including integration end-to-end tests).

### section-07-build-and-wire
Build verification: run `npm run build`, confirm `dist/hook-runner.js` exists and is valid CommonJS. Manual smoke test: pipe sample JSON payloads via stdin. Document `~/.claude/settings.json` hook configuration snippet with the absolute path to `dist/hook-runner.js`. No automated test — verification is manual.
