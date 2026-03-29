# Section 06: Hook Runner

## Overview

This section implements `src/hook-runner.ts` — the main entry point for the Claude Code `PostToolUse` hook. It integrates all previous modules (config, identity, logger, weights) into a single orchestration pipeline that runs on every tool call in every Claude Code session.

**Dependencies:** sections 02 (config), 03 (identity), 04 (logger), 05 (weights) must be complete before starting this section.

**File to create:** `src/hook-runner.ts`
**Test file to create:** `tests/hook-runner.test.ts`

---

## Background

Claude Code fires a `PostToolUse` hook after every tool invocation in a session. The hook is a `command` type — Claude Code spawns the command as a child process, passes the event payload as JSON on stdin, and expects exit code 0. Any non-zero exit or unhandled crash is visible to the user and disrupts their session.

This means:
- Every invocation is a fresh Node.js process — no shared in-memory state between calls
- The script must always exit 0, even on errors
- Write latency should be low — don't introduce noticeable delays between tool calls
- All errors must be swallowed and logged to stderr only (never stdout, never crash)

The hook runner is the only public entry point in this package. It wires together every other module.

---

## Tests First

**File: `tests/hook-runner.test.ts`**

Write these tests before implementing. Use a temp directory fixture (`beforeEach`/`afterEach`) as the `dataRoot` for all file I/O tests. For orchestration tests that invoke the compiled hook as a subprocess, use the `dist/hook-runner.js` path (these are integration tests and require a successful build).

### `extractProjectRefs` tests

- Detects cross-project file path in `Edit` `tool_input.file_path` → returns a `project→project` `DerivedConnection`
- Returns no additional connections when `file_path` is within the current project
- Detects cross-project repo URL in `Agent` `tool_input.prompt`
- Deduplicates multiple references to the same target project (emit only one edge per unique target)
- Silently skips unresolvable or nonexistent paths — does not throw

### `deriveConnections` tests

- Returns `[{ connectionType: 'project→tool', sourceNode: 'project:<id>', targetNode: 'tool:Bash' }]` for a Bash payload with no cross-project refs
- Returns `[{ connectionType: 'project→skill', sourceNode: 'project:<id>', targetNode: 'skill:deep-plan' }]` for an Agent payload with a recognizable skill name in `description`
- Returns `[{ connectionType: 'project→skill', targetNode: 'skill:unknown-skill' }]` when Agent `description` contains no recognizable skill name
- Returns `[{ connectionType: 'project→skill', targetNode: 'skill:unknown-skill' }]` when Agent payload has no `description` field
- Returns `[{ project→tool }, { project→project }]` for an Edit payload whose `file_path` resolves to a different project

### Hook runner orchestration tests

These tests spawn `dist/hook-runner.js` as a subprocess and pipe JSON payloads via stdin. They are end-to-end integration tests.

- Exits 0 and writes nothing (no log file created, no `weights.json` created) when `tool_name` is not in the allowlist
- Exits 0, writes a log entry to the daily JSONL file, and creates/updates `weights.json` when tool is in allowlist
- A non-default tool name added to `config.json` allowlist is processed correctly
- Exits 0 and writes nothing when stdin contains malformed JSON
- Exits 0 and writes nothing when stdin is empty
- Multiple derived connections (e.g., `project→tool` + `project→project`) each appear as separate lines in the JSONL log

### Integration (full pipeline)

- End-to-end: pipe a valid `PostToolUse` payload with `tool_name: "Bash"` to `dist/hook-runner.js`. Verify:
  - Process exits with code 0
  - `<dataRoot>/logs/<today>.jsonl` contains exactly one line of valid JSON
  - The log entry has `tool_name: "Bash"`, correct `session_id`, correct `source_node`/`target_node`
  - `<dataRoot>/weights.json` exists and contains the connection with `raw_count: 1`
- End-to-end: pipe a valid `PostToolUse` payload for `tool_name: "Edit"` with a `file_path` in a different project directory. Verify both `project→tool` and `project→project` lines appear in the JSONL log, and both connections exist in `weights.json`

---

## Types

These types are defined in section 01 (foundation) and used here:

```typescript
interface HookPayload {
  hook_event_name: 'PostToolUse';
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
  transcript_path: string;
  permission_mode: string;
}

type ConnectionType = 'project→tool' | 'project→skill' | 'project→project';

interface DerivedConnection {
  connectionType: ConnectionType;
  sourceNode: string;
  targetNode: string;
}
```

---

## Implementation

### File: `src/hook-runner.ts`

The module exports nothing — it is a runnable script. All logic is either in the `main()` async function (the orchestration pipeline) or in named helper functions that are independently testable.

#### Function: `extractSkillName`

```typescript
function extractSkillName(toolInput: Record<string, unknown>): string
```

Extracts the skill name from an Agent tool invocation's `tool_input`. Priority order:
1. Check `toolInput.description` — look for a recognizable skill name pattern. A recognizable pattern is a string that looks like `"deep-plan"`, `"gsd:execute-phase"`, `"update-config"` — i.e., kebab-case or `namespace:kebab-case`. Extract the first token that matches `/^[\w-]+(:([\w-]+))?$/` and is not a common English word.
2. Check `toolInput.subagent_type` if present.
3. Fall back to `"unknown-skill"`.

This heuristic will be imprecise in the MVP. The raw `tool_input` is always preserved in the log entry, enabling retrospective re-analysis.

#### Function: `extractProjectRefs`

```typescript
async function extractProjectRefs(
  payload: HookPayload,
  identity: ProjectIdentity
): Promise<DerivedConnection[]>
```

Scans `tool_input` for references to other projects. Returns zero or more `project→project` `DerivedConnection` objects. Never throws.

Rules per tool:

- **`Write` and `Edit`**: read `tool_input.file_path` as a string. Call `resolveProjectIdentity` on the parent directory (`path.dirname(file_path)`). If the resolved `id` differs from `identity.id`, return one `project→project` connection.
- **`Bash`**: scan `tool_input.command` as a string for absolute paths. Windows absolute paths match `/[A-Za-z]:[/\\]/`. Unix absolute paths start with `/`. For each candidate path that exists on disk (`fs.existsSync`) and resolves to a different project, collect a `project→project` connection. Skip candidates that fail `resolveProjectIdentity`.
- **`Agent`**: scan `tool_input.prompt` and `tool_input.description` (both as strings, if present) for absolute paths (same pattern as Bash) and repo URLs (patterns: `github.com/`, `https://`, `git@`). For each absolute path found, resolve via `resolveProjectIdentity`. For each URL found, use `normalizeGitUrl` directly as the target project id (skip `resolveProjectIdentity` — the URL is the id). Collect `project→project` connections for each unique target that differs from the current project.

Deduplication: if the same target `id` appears multiple times within one payload (e.g., two paths in the same Bash command that both resolve to the same project), emit only one `project→project` edge for that target.

Silently skip any candidate where `resolveProjectIdentity` throws or `fs.existsSync` returns false. Do not throw — return whatever was successfully resolved.

#### Function: `deriveConnections`

```typescript
async function deriveConnections(
  payload: HookPayload,
  identity: ProjectIdentity
): Promise<DerivedConnection[]>
```

Derives all connections produced by a single tool invocation. Returns a non-empty array (always at least one primary connection).

**Primary connection (always one):**
- If `tool_name !== "Agent"`: `{ connectionType: 'project→tool', sourceNode: 'project:<identity.id>', targetNode: 'tool:<tool_name>' }`
- If `tool_name === "Agent"`: `{ connectionType: 'project→skill', sourceNode: 'project:<identity.id>', targetNode: 'skill:<extractSkillName(payload.tool_input)>' }`

**Secondary connections (zero or more):**
Call `extractProjectRefs(payload, identity)` and append its results.

Never throws — if `extractProjectRefs` throws despite its own guard, catch and return only the primary connection.

#### Function: `main`

```typescript
async function main(): Promise<void>
```

The full orchestration pipeline:

1. **Read stdin**: collect all chunks from `process.stdin`. If stdin provides no data (empty buffer), exit 0 silently.
2. **Parse JSON**: `JSON.parse(rawInput)` → `HookPayload`. If parse fails, exit 0 silently (no log, no write).
3. **Load config**: call `loadConfig(dataRoot)` where `dataRoot` comes from the `DEVNEURAL_DATA_ROOT` env var or the compiled-in default `"C:/dev/data/skill-connections"`.
4. **Allowlist check**: if `payload.tool_name` is not in `config.allowlist`, exit 0 immediately (no further processing).
5. **Resolve identity**: call `resolveProjectIdentity(payload.cwd)`.
6. **Derive connections**: call `deriveConnections(payload, identity)` → `DerivedConnection[]`.
7. **Build log entries**: for each `DerivedConnection`, call `buildLogEntry(payload, identity, connection.connectionType, connection.sourceNode, connection.targetNode)`.
8. **Parallel I/O** via `Promise.all`:
   - **Log all entries**: call `appendLogEntry(entry, dataRoot)` for each entry (these can be parallelized with `Promise.all` among themselves)
   - **Update weights once**: call `loadWeights(dataRoot)`, then call `updateWeight(weights, ...)` for each connection in sequence (in-place mutations), then call `saveWeights(weights, dataRoot)` once (single lock acquisition covers all updates for this event)
9. **Exit 0**.

The `Promise.all` at step 8 runs the log-append group and the weights update group concurrently. The weights group is a sequential load→update→save internally — do not parallelize the individual weight updates since they operate on the same in-memory object.

**stdin reading:** Use the async iterator pattern:

```typescript
async function readStdin(): Promise<string>
// collect chunks from process.stdin into a buffer, return as UTF-8 string
```

Handle the case where `process.stdin` is not a TTY and no data arrives (returns empty string → exit 0 silently).

#### Top-level error handling

Wrap the `main()` call in a top-level try/catch:

```typescript
main().catch((err) => {
  console.error('[DevNeural]', err instanceof Error ? err.message : String(err));
  process.exit(0);
});
```

`process.exit(0)` is always the outcome — success or failure. This is non-negotiable: the hook must never interrupt Claude Code sessions.

---

## Key Decisions and Edge Cases

**Allowlist filtering happens in `main`, not in modules.** The individual modules (logger, weights) do not know about the allowlist. This keeps them general-purpose and testable in isolation.

**Single `saveWeights` call per hook event.** Even if three connections are derived (e.g., one `project→tool` and two `project→project`), all three `updateWeight` mutations are applied to the same in-memory `WeightsFile` object before a single `saveWeights` call. This means one lock acquisition covers the whole event — minimizing lock contention on concurrent sessions.

**`Promise.all` for log append and weights update.** These two I/O operations are independent. Running them concurrently cuts the perceived latency roughly in half relative to sequential execution.

**Skill name extraction is best-effort.** Some Agent invocations are exploratory subagents, not skills. The heuristic will classify these as `"unknown-skill"`. The raw `tool_input.description` is always preserved in the log for future refinement. Do not over-engineer the extraction — a simple token scan is sufficient for MVP.

**Very long `tool_input` values.** The full `tool_input` is stored in each log entry. For `Write` tool calls this may include large file contents (potentially >> 4KB). This is intentional for MVP completeness. Add a comment near the `appendLogEntry` call acknowledging this and noting that truncation can be added later.

**`cwd` as empty string.** `resolveProjectIdentity` handles this (falls back to `'cwd'` source with empty string id). The hook runner does not need special-case handling.

**stdin with no data.** The `readStdin` helper returns an empty string when no data is written to stdin. The `main` function checks for this and exits 0 before attempting JSON parse. This supports manual invocation of the script for testing.

---

## Implementation Checklist

- [ ] Write `tests/hook-runner.test.ts` with all 15+ tests listed above (do not implement yet)
- [ ] Confirm all prior section tests still pass (`npm test`)
- [ ] Implement `extractSkillName(toolInput)` in `src/hook-runner.ts`
- [ ] Implement `extractProjectRefs(payload, identity)` in `src/hook-runner.ts`
- [ ] Implement `deriveConnections(payload, identity)` in `src/hook-runner.ts`
- [ ] Implement `readStdin()` helper in `src/hook-runner.ts`
- [ ] Implement `main()` orchestration function in `src/hook-runner.ts`
- [ ] Add top-level `main().catch(...)` call at module bottom
- [ ] Run `npm test` — all tests should pass
- [ ] Build (`npm run build`) — verify `dist/hook-runner.js` exists
- [ ] Smoke test: `echo '{}' | node dist/hook-runner.js` — should exit 0 silently
- [ ] Smoke test: `echo '' | node dist/hook-runner.js` — should exit 0 silently
- [ ] Smoke test: pipe a valid `PostToolUse` payload with `tool_name: "Bash"` — verify log file and weights created

---

## Recommended Approach Before Implementing

Before writing `extractProjectRefs` and `extractSkillName`, capture real `PostToolUse` stdin payloads from a live Claude Code session. Run the hook temporarily with a debug version that writes raw stdin to a temp file. Examine several Agent payloads (skill calls) and Edit/Bash payloads (cross-project file references) to confirm the shape of `tool_input.description`, `tool_input.prompt`, and `tool_input.file_path`. Use these as test fixtures in `hook-runner.test.ts`.

Without real payload examples, the skill-name extraction token pattern and the Bash path-scanning regex are guesswork. Real examples will make the logic correct rather than speculative.

---

## Deviations from Plan

- **Helper functions exported** — `extractSkillName`, `extractProjectRefs`, `deriveConnections` are exported for unit testability. Plan said "module exports nothing" but this is necessary to test the core logic without subprocess overhead.
- **Subprocess tests use `tsx` instead of `dist/hook-runner.js`** — plan required compiled output. Kept `tsx` for faster tests (~350ms per subprocess vs build prerequisite). TypeScript compilation is validated at build time; end-to-end logic is validated by the subprocess tests. Deviation accepted.
- **`require.main === module` guard added** — without this, importing the module in tests hangs on stdin. Plan spec did not mention this guard but it is required for the module to be testable.
- **`SKILL_STOP` set added** — plan mentioned skipping "common English words" but did not specify a list. Added 20 common hyphenated phrases (well-known, up-to-date, built-in, etc.) that match `SKILL_TOKEN_RE` but must not be classified as skill names.
- **`path.dirname` applied in Bash and Agent branches** — plan described resolving paths via `resolveProjectIdentity` but did not specify `path.dirname`. Both branches now call `resolveProjectIdentity(path.dirname(candidate))`, consistent with the Write/Edit branch.
- **Lock first-run pre-creation** — `proper-lockfile` requires the target file to exist. Added `fs.writeFileSync` with `flag: 'wx'` before lock acquisition to create `weights.json` if absent. Race-safe: the `wx` flag ensures only one process creates it; others silently continue.
- **URL_RE uses negative lookbehind** — `[^\s.,;:)\]'"<>]+` (character exclusion) incorrectly stops at dots, breaking domain names like `github.com`. Replaced with `[^\s]+` followed by `(?<![.,;:)\]'"<>])` (negative lookbehind), which allows dots within URLs while stripping trailing sentence punctuation via backtracking.
- **`effectiveDataRoot` not introduced** — plan implied using `config.data_root` as an override. Simplified to use `dataRoot` (from env or compiled-in default) everywhere. The config `data_root` field override path is undocumented and untested; removed.
- **Test count is 23, not 15** — expanded to: 5 `extractSkillName` + 5 `extractProjectRefs` + 5 `deriveConnections` + 6 subprocess orchestration + 2 full-pipeline integration. Subprocess "multiple connections" test strengthened to unconditionally assert `>= 2` lines and both connection types.
