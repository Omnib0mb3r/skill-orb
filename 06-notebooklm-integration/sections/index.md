<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-setup
section-02-types-config
section-03-log-reader
section-04-graph-reader
section-05-renderer
section-06-generator
section-07-writer
section-08-cli-integration
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-setup | — | all | Yes (first) |
| section-02-types-config | 01 | 03, 04, 05, 06, 07 | No |
| section-03-log-reader | 02 | 08 | Yes |
| section-04-graph-reader | 02 | 08 | Yes |
| section-05-renderer | 02 | 07, 08 | Yes |
| section-06-generator | 02 | 08 | Yes |
| section-07-writer | 02, 05 | 08 | No |
| section-08-cli-integration | 03, 04, 06, 07 | — | No (final) |

## Execution Order

1. **section-01-setup** — no dependencies; creates project scaffold
2. **section-02-types-config** — after 01; shared interfaces + config loader
3. **section-03-log-reader, section-04-graph-reader, section-05-renderer, section-06-generator** — parallel after 02
4. **section-07-writer** — after 02 and 05 (needs renderer)
5. **section-08-cli-integration** — after 03, 04, 06, 07; final wiring + integration tests

## Section Summaries

### section-01-setup
Project scaffold: `package.json`, `tsconfig.json`, `vitest.config.ts`, `config.example.json`, directory structure (`src/session/`, `src/summary/`, `src/obsidian/`, `tests/`). No source files yet — just the project configuration and test fixture files used across all other sections.

### section-02-types-config
Two foundational files with zero external deps (other than zod):
- `src/types.ts` — all shared TypeScript interfaces: `ObsidianSyncConfig`, `SessionData`, `ConnectionEvent`, `LogEntry` (re-export or import from 01-data-layer), `GraphInsight`, `SessionSummary`
- `src/config.ts` — Zod schema for `ObsidianSyncConfig`, `loadConfig()` function with `DEVNEURAL_OBSIDIAN_CONFIG` env var override, `ANTHROPIC_API_KEY` presence check

Tests: `tests/config.test.ts`

### section-03-log-reader
`src/session/log-reader.ts` — reads `<data_root>/logs/YYYY-MM-DD.jsonl`, parses `LogEntry` objects, derives `primary_project` by frequency, builds `SessionData` including `connection_events` for all four connection types. Returns `null` when file absent.

Tests: `tests/log-reader.test.ts` (uses JSONL fixture file in `tests/fixtures/`)

### section-04-graph-reader
`src/session/graph-reader.ts` — calls `GET /graph/subgraph?project=<id>` on 02-api-server; falls back to `weights.json` on failure. Handles `project:` prefix when matching edges. Produces `GraphInsight[]` with `new_connection`, `high_weight`, and `weight_milestone` (approximate) types.

Tests: `tests/graph-reader.test.ts` (mock `fetch`, fixture `weights.json`)

### section-05-renderer
`src/summary/renderer.ts` — pure function `renderSummary(summary: SessionSummary): string`. Produces the `## Session: YYYY-MM-DD` markdown block ending with `---`. Omits "Graph insights" section when array is empty.

Tests: `tests/renderer.test.ts` (snapshot tests)

### section-06-generator
`src/summary/generator.ts` — calls Anthropic SDK `messages.create()` with enriched context (tool names, file paths, skill nodes extracted from `SessionData`). Parses JSON response into `SessionSummary`. Returns placeholder text on API failure without throwing.

Tests: `tests/generator.test.ts` (mock `@anthropic-ai/sdk`)

### section-07-writer
`src/obsidian/writer.ts` — manages per-project `.md` files in the Obsidian vault. Implements `deriveSlug()` with prefix-stripping, lowercasing, and collision handling. Implements `writeSessionEntry()` with idempotency check, `<!-- DEVNEURAL_SESSIONS_START -->` anchor for prepend, explicit UTF-8 encoding.

Tests: `tests/writer.test.ts` (temp directory fixture)

### section-08-cli-integration
`src/generate-summary.ts` — CLI entry point. Parses args (`--date`, `--project`, `--dry-run`, `--force`, `--config`). Checks `ANTHROPIC_API_KEY`. Orchestrates steps 2–10. Try/catch around Obsidian write. Correct exit codes.

`tests/generate-summary.integration.test.ts` — full pipeline test with JSONL + weights.json fixtures, mocked Anthropic SDK. Covers normal flow, no-log-found, dry-run, idempotency, --force override.
