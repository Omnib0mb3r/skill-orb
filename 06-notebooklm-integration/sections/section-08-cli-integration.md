# Section 08: CLI Integration

## Overview

This is the final wiring section. All components (log-reader, graph-reader, generator, writer) are complete from prior sections. This section creates the CLI entry point `src/generate-summary.ts` and the full-pipeline integration test `tests/generate-summary.integration.test.ts`.

**Dependencies (must be complete before starting this section):**
- section-03-log-reader: `src/session/log-reader.ts` + `readSessionLog()`
- section-04-graph-reader: `src/session/graph-reader.ts` + `extractGraphInsights()`
- section-06-generator: `src/summary/generator.ts` + `generateSummary()`
- section-07-writer: `src/obsidian/writer.ts` + `writeSessionEntry()`

All shared types (`SessionData`, `GraphInsight`, `SessionSummary`, `ObsidianSyncConfig`) are defined in `src/types.ts` (section-02). The config loader `loadConfig()` is in `src/config.ts` (section-02). The renderer `renderSummary()` is in `src/summary/renderer.ts` (section-05).

---

## Files to Create

1. `C:\dev\tools\DevNeural\06-notebooklm-integration\src\generate-summary.ts`
2. `C:\dev\tools\DevNeural\06-notebooklm-integration\tests\generate-summary.integration.test.ts`

---

## Tests First

**File:** `tests/generate-summary.integration.test.ts`

These are integration tests. The Anthropic SDK is mocked via Vitest's `vi.mock()`. Real JSONL and weights.json fixture files are written to a temp directory at test startup. The CLI logic is imported as a function (not spawned as a subprocess) to allow mocking — see the implementation note below.

Test cases to implement:

```
# Integration test: full pipeline with real JSONL fixture + weights.json fixture in temp dir;
#   Anthropic SDK mocked; verifies Obsidian file created with correct format
#   - Temp dir contains <data_root>/logs/YYYY-MM-DD.jsonl with 3+ log entries spanning two tools
#   - Temp dir contains <data_root>/weights.json with 2-3 edges referencing the primary project
#   - Config points to temp dir for data_root, another temp dir for vault_path
#   - Mock Anthropic SDK returns a valid SessionSummary JSON payload
#   - After running the pipeline, verify the Obsidian file exists at the expected path
#   - Verify the file contains '## Session: YYYY-MM-DD'
#   - Verify the file contains the AI-generated 'what_i_worked_on' text from the mock

# Integration test: exits 0 with message when no log file found for date
#   - Config points to a data_root that has no logs directory (or no file for the target date)
#   - Verify the pipeline returns exit code 0 (or resolves without throwing)
#   - Verify stderr/stdout contains a user-friendly "no activity found" message

# Integration test: exits 1 with clear message when ANTHROPIC_API_KEY missing
#   - Temporarily remove process.env.ANTHROPIC_API_KEY
#   - Verify the pipeline throws or calls process.exit(1)
#   - Verify the error message includes 'ANTHROPIC_API_KEY'

# Integration test: --dry-run prints markdown to stdout without writing file
#   - Run pipeline with dry-run flag set
#   - Verify no file is created in the vault temp dir
#   - Verify the rendered markdown string is returned/printed (check for '## Session:' prefix)

# Integration test: second run for same date skips write and exits 0 (idempotency)
#   - Run pipeline once to create the note
#   - Run pipeline again for the same date (no --force)
#   - Verify the file is not modified (mtime unchanged, or content identical)
#   - Verify exit code 0

# Integration test: --force flag on second run overwrites existing session
#   - Run pipeline once to create the note
#   - Modify mock to return different 'what_i_worked_on' text
#   - Run pipeline again with --force
#   - Verify the file now contains the new text
```

**Test fixture setup helpers** to define in the test file:

```typescript
// createTempConfig(overrides?) → ObsidianSyncConfig pointing to temp dirs
// writeSampleJSONL(dataRoot, date, entries) → writes fixture JSONL
// writeSampleWeightsJson(dataRoot, edges) → writes fixture weights.json
// mockAnthropicResponse(what, lessons) → sets up vi.mock return value
```

The JSONL fixture entries should include at least:
- Two entries with `connection_type: 'project->tool'` (tool names: `'Read'`, `'Write'`)
- One entry with `connection_type: 'project->skill'` (skill: `'obsidian-integration'`)
- All entries referencing the same `project` value (e.g., `'github.com/user/TestProject'`)

The `weights.json` fixture should contain one edge with `first_seen` equal to today's date (to trigger a `new_connection` insight) and one edge with `raw_count: 10` and `last_seen` equal to today's date (to trigger a `weight_milestone` insight).

---

## Implementation: `src/generate-summary.ts`

This file is the CLI entry point. It also exports a `runPipeline()` function so the integration tests can import and call it directly without spawning a subprocess.

### CLI argument parsing

Parse `process.argv.slice(2)` manually (no external arg-parser library — keep the dependency footprint minimal). Supported flags:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--date YYYY-MM-DD` | string | today UTC (`new Date().toISOString().slice(0, 10)`) | Target date for log and summary |
| `--project <name>` | string | undefined (auto-detect from log) | Override primary project |
| `--dry-run` | boolean | false | Print markdown to stdout, do not write vault |
| `--force` | boolean | false | Overwrite existing session entry for same date |
| `--config <path>` | string | `./config.json` | Path to config JSON file |
| `--help` | boolean | false | Print usage and exit 0 |

Usage text to print for `--help`:

```
Usage: node dist/generate-summary.js [options]

Options:
  --date YYYY-MM-DD    Generate summary for a specific date (default: today UTC)
                       Note: dates are UTC — run with --date $(date -u +%Y-%m-%d) on Linux/Mac
                       to use your local date if you work past midnight UTC
  --project <name>     Override project detection
  --dry-run            Print generated markdown to stdout, don't write to vault
  --force              Overwrite existing session entry for the same date
  --config <path>      Path to config.json (default: ./config.json)
  --help               Show this help

Required environment:
  ANTHROPIC_API_KEY    Anthropic API key for Claude summary generation
```

If `--help` is passed, print the usage block and call `process.exit(0)`.

Unknown flags should print `Unknown option: <flag>` to stderr and exit 1.

### `runPipeline()` function signature

```typescript
interface PipelineOptions {
  date?: string;          // YYYY-MM-DD; defaults to today UTC
  project?: string;       // override primary project detection
  dryRun?: boolean;
  force?: boolean;
  configPath?: string;    // path to config.json
}

interface PipelineResult {
  exitCode: 0 | 1;
  message: string;        // human-readable summary of what happened
  outputPath?: string;    // set on successful write (not dry-run)
  rendered?: string;      // set on dry-run
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult>
```

Exporting `runPipeline` allows tests to call it without `process.exit` side effects. The `main()` function at the bottom calls `runPipeline()`, then calls `process.exit(result.exitCode)`.

### Execution sequence inside `runPipeline()`

1. Resolve `configPath` (default: `./config.json` — resolved relative to `process.cwd()` using `path.resolve`)
2. Check `process.env.ANTHROPIC_API_KEY` — if absent or empty string, return `{ exitCode: 1, message: 'Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.' }`
3. Call `loadConfig(configPath)` — let Zod errors propagate as thrown exceptions (caught by the outer try/catch in `main()`)
4. Determine `targetDate`: use `options.date` if provided, else today UTC via `new Date().toISOString().slice(0, 10)`
5. Call `readSessionLog(targetDate, config.data_root)` → `SessionData | null`
6. If null, return `{ exitCode: 0, message: 'No DevNeural activity found for ${targetDate}. Nothing to write.' }`
7. Override `sessionData.primary_project` with `options.project` if provided
8. Call `extractGraphInsights(sessionData.primary_project, targetDate, config)` → `GraphInsight[]`
9. Call `generateSummary(sessionData, insights, config)` → `SessionSummary`
10. Call `renderSummary(summary)` → `string`
11. If `options.dryRun`, return `{ exitCode: 0, message: 'Dry run complete.', rendered: renderedMarkdown }`
12. Call `writeSessionEntry(summary, renderedMarkdown, config, { force: options.force ?? false })`
13. Resolve the output path using `resolveNotePath(summary, config)` (see note below)
14. Return `{ exitCode: 0, message: '✓ Session note written: ${outputPath}', outputPath }`

### `resolveNotePath()` export from writer

To print the output path in the confirmation message, `generate-summary.ts` needs to know where the file was written. Add a named export to `src/obsidian/writer.ts`:

```typescript
export function resolveNotePath(summary: SessionSummary, config: ObsidianSyncConfig): string
```

This is a pure function that applies the slug logic and joins the path components — no I/O. The CLI uses it after a successful write to construct the confirmation message.

### `main()` wrapper

```typescript
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await runPipeline(options);

    if (result.exitCode === 0) {
      if (options.dryRun && result.rendered) {
        console.log(result.rendered);
      } else {
        console.log(result.message);
      }
    } else {
      console.error(result.message);
    }

    process.exit(result.exitCode);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Guard: only run main() when this file is the entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

### Key Implementation Notes

**`writeSessionEntry` force option:** The section-07 writer signature needs to accept an options bag with a `force` boolean:

```typescript
export function writeSessionEntry(
  summary: SessionSummary,
  rendered: string,
  config: ObsidianSyncConfig,
  options?: { force?: boolean }
): void
```

If section-07 was implemented without this parameter, add it now — the change is backward-compatible (options is optional).

**Dry-run output:** When `--dry-run` is set, print `result.rendered` with `console.log()` — no decorators. This lets users pipe the output to a file.

**Exit code 0 for non-error cases:** "No log found" and "session already exists" are not errors — use exit code 0 for both.

**Error handling in `main()`:** Config parse errors (Zod throws) and unexpected failures should print to stderr and exit 1. The `writeSessionEntry` rethrow on file write failure is caught here.

---

## Acceptance Criteria

The section is complete when:

1. `npm test` passes all six integration test cases in `tests/generate-summary.integration.test.ts`
2. `node dist/generate-summary.js --help` prints the usage block without error (after `npm run build`)
3. `node dist/generate-summary.js --dry-run` with a populated `config.json` and today's log file prints a well-formed markdown session block to stdout
4. `node dist/generate-summary.js` with a valid config writes the note to the Obsidian vault and prints the confirmation path
5. Running the command a second time for the same date exits 0 with the "already exists" message
6. Running with `--force` on the second run overwrites the existing entry
