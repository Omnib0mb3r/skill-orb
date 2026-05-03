# TDD Plan: 01-data-layer

*Companion to `claude-plan.md` — defines tests to write BEFORE implementing each section.*

**Testing framework:** Vitest
**Test runner:** `vitest run` (CI), `vitest` (watch mode)
**Conventions:** Test files in `tests/`, named `<module>.test.ts`. Temp directory fixture in `beforeEach`/`afterEach` for all file I/O tests.

---

## Overview

No test stubs here — the overview section is architectural context only.

---

## Why This Architecture

No test stubs — rationale section.

---

## Directory Structure

No test stubs — directory layout section.

---

## Core Types

No executable tests — type definitions are compile-time only. Verify by:
- Test: TypeScript compilation succeeds (`tsc --noEmit`) with all type definitions in place
- Test: `LogEntry` with all required fields satisfies the interface (type-check test)
- Test: `ConnectionType` union does not include `'skill→tool'` (compile-time guard)

---

## Module: Config

*File: `tests/config.test.ts`*

- Test: returns default allowlist and data_root when `config.json` does not exist
- Test: reads and merges custom allowlist from `config.json`
- Test: returns defaults and logs to stderr when `config.json` exists but contains invalid JSON
- Test: reads `data_root` field from `config.json` when present
- Test: `DEVNEURAL_DATA_ROOT` env var overrides the compiled-in default

---

## Module: Identity

*File: `tests/identity.test.ts`*

**`normalizeGitUrl`:**
- Test: converts SSH format `git@github.com:user/repo.git` → `github.com/user/repo`
- Test: converts HTTPS format `https://github.com/user/repo.git` → `github.com/user/repo`
- Test: strips trailing `.git` only (not mid-path)
- Test: returns input unchanged for unrecognized format (bare path, `file://`, `git://`, ported SSH URL)

**`normalizePath`:**
- Test: converts backslashes to forward slashes
- Test: lowercases Windows drive letter

**`resolveProjectIdentity`:**
- Test: returns `source: 'git-remote'` and normalized URL when git remote exists
- Test: returns `source: 'git-root'` and normalized git root path when no remote exists
- Test: returns `source: 'cwd'` and normalized cwd when no `.git` directory exists
- Test: returns `source: 'cwd'` when `git` binary is not on PATH (simulated)
- Test: returns `source: 'cwd'` when `cwd` is an empty string
- Test: never throws — returns fallback on any filesystem error

---

## Module: Logger

*File: `tests/logger.test.ts`*

**`getLogFilePath`:**
- Test: produces `<dataRoot>/logs/YYYY-MM-DD.jsonl` for a given date

**`buildLogEntry`:**
- Test: sets `schema_version: 1`
- Test: sets `connection_type: 'project→tool'`, `source_node: 'project:<id>'`, `target_node: 'tool:<name>'`
- Test: sets `connection_type: 'project→skill'`, correct source/target nodes
- Test: sets `connection_type: 'project→project'`, correct source/target nodes
- Test: copies `session_id`, `tool_use_id`, `tool_name`, `tool_input` from payload
- Test: `timestamp` is ISO 8601 UTC string

**`appendLogEntry`:**
- Test: creates `logs/` directory if it doesn't exist
- Test: writes a line of valid JSON terminated with `\n`
- Test: appends to existing file (does not overwrite)
- Test: written JSON deserializes to a valid `LogEntry` shape
- Test: logs to stderr and does not throw when the target directory is read-only/nonexistent

---

## Module: Weights

*File: `tests/weights.test.ts`*

**`connectionKey`:**
- Test: returns `"a||b"` for source `"a"` and target `"b"`

**`loadWeights`:**
- Test: returns empty graph when `weights.json` does not exist
- Test: returns parsed `WeightsFile` when file is valid
- Test: returns empty graph and logs to stderr when file contains invalid JSON

**`updateWeight`:**
- Test: creates a new `ConnectionRecord` with `raw_count=1`, `weight=0.1`, `first_seen` set
- Test: increments `raw_count` and recalculates `weight` for an existing connection
- Test: caps `weight` at 10.0 when `raw_count >= 100`
- Test: updates `last_seen` but not `first_seen` on subsequent calls
- Test: mutates in place — the returned reference is the same object passed in

**`saveWeights`:**
- Test: writes valid JSON to `weights.json`
- Test: sets `updated_at` on the written file
- Test: atomic write — file is readable by another process during write (no partial content)

**Concurrency:**
- Test: two simulated concurrent read-modify-write cycles produce a valid, non-corrupt `weights.json` (file locking prevents clobbering)
- Test: lock fallback — if lock acquisition fails (simulated timeout), write still completes (unlocked fallback)

---

## Module: Hook Runner

*File: `tests/hook-runner.test.ts`*

**`extractProjectRefs`:**
- Test: detects cross-project file path in `Edit` `tool_input.file_path` → returns `project→project` connection
- Test: returns no additional connections when `file_path` is within the current project
- Test: detects cross-project repo URL in `Agent` `tool_input.prompt`
- Test: deduplicates multiple references to the same target project
- Test: silently skips unresolvable/nonexistent paths (no throws)

**`deriveConnections`:**
- Test: returns `[{ project→tool }]` for a Bash payload with no cross-project refs
- Test: returns `[{ project→skill }]` for Agent payload with recognizable skill name in `description`
- Test: returns `[{ project→skill }]` with `"unknown-skill"` when Agent `description` has no recognizable skill name
- Test: returns `[{ project→skill }]` with `"unknown-skill"` when Agent has no `description` field
- Test: returns `[{ project→tool }, { project→project }]` for Edit payload referencing another project's file path

**Hook runner orchestration:**
- Test: exits 0 and writes nothing when `tool_name` is not in allowlist
- Test: exits 0, writes a log entry, and updates `weights.json` when tool is in allowlist
- Test: non-default tool added to allowlist config is processed correctly
- Test: exits 0 and writes nothing on malformed stdin
- Test: exits 0 and writes nothing when stdin is empty
- Test: multiple derived connections all appear as separate lines in the JSONL log

**Integration (full pipeline):**
- Test: end-to-end — pipe a valid `PostToolUse` payload for `tool_name: "Bash"` to the compiled `dist/hook-runner.js`, verify:
  - Correct JSONL line written to `<dataRoot>/logs/<today>.jsonl`
  - `weights.json` contains the connection with `raw_count=1`
  - Process exits with code 0
- Test: end-to-end — pipe a valid payload for `tool_name: "Edit"` with a cross-project file path, verify both `project→tool` and `project→project` entries in the log

---

## Hook Configuration

No unit tests — configuration is applied manually. Verify during build step:
- Test: `node dist/hook-runner.js` exits 0 when piped a valid PostToolUse JSON payload via stdin
- Test: `node dist/hook-runner.js` exits 0 when piped empty stdin (no crash)
- Test: `node dist/hook-runner.js` exits 0 when piped malformed JSON (no crash)

---

## Build Setup

No unit tests — verify during build:
- Test: `tsc` compiles without errors
- Test: `dist/hook-runner.js` is present after build
- Test: compiled output is CommonJS (no `import`/`export` statements in dist)

---

## Testing Strategy

*(Self-referential section — no additional test stubs)*

---

## Implementation Order

*(Guidance section — no test stubs)*

---

## Edge Cases and Decisions

*(Rationale section — covered by module-level tests above)*
