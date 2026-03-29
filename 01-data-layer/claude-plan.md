# Implementation Plan: 01-data-layer

*DevNeural — Connection Logger & Weighted Dependency Graph*

---

## Overview

DevNeural is a "living neural network of project interconnections" — a system that observes how you use AI tools and skills across projects, and builds a persistent weighted graph of those relationships over time.

This split (`01-data-layer`) is the **MVP foundation**. It answers: *"What is actually happening in my Claude Code sessions?"* by silently capturing every significant tool invocation and updating a shared graph of connection strengths.

The output is two things:
1. **Append-only JSONL log files** — one per calendar day — recording every observed event
2. **A single `weights.json`** — a weighted edge graph that other DevNeural components read to understand which connections are strong vs. weak

Nothing in this split serves a user-facing API. It runs invisibly as a Claude Code hook script on every `PostToolUse` event.

---

## Why This Architecture

### Hook script as the entry point

Claude Code fires `PostToolUse` hooks synchronously after every tool call in a session. The hook is configured as a `command` type — Claude Code passes the event payload as JSON on stdin, and the script must exit cleanly (code 0) to avoid interrupting the session. This means:

- Every hook invocation is a **fresh Node.js process** (no persistent state in memory)
- The script has access to the full event payload but no session-level accumulation
- Write latency must be low (don't block the session)
- All errors must be silent (exit 0 always)

This architecture means the logger is stateless at runtime: it reads the payload, reads the current `weights.json`, updates it, and exits. The weights file is the persistence layer.

### Single weights.json (global graph)

All connections across all projects live in one file. This is intentional — the point of DevNeural is cross-project awareness. A single document makes it trivial for other splits (API server, session intelligence) to load the full graph without joins or merges.

The expected size at typical usage levels (dozens of projects, hundreds of tools) is well under 1 MB. JSON parse/stringify performance is not a concern at this scale.

### Configurable tool allowlist

Read-only tools (Read, Glob, Grep, WebSearch) fire constantly and don't represent meaningful "work" connections — they're noise. The allowlist defaults to `["Bash", "Write", "Edit", "Agent"]` which captures the tools that meaningfully transform state or invoke sub-workflows. The allowlist is configurable in `config.json` so users can tune this without redeploying.

---

## Directory Structure

```
01-data-layer/
├── src/
│   ├── hook-runner.ts          # Entry point for hook script
│   ├── config/
│   │   └── index.ts            # Config loading and defaults
│   ├── identity/
│   │   └── index.ts            # Project identity resolution
│   ├── logger/
│   │   ├── index.ts            # Log entry construction and writing
│   │   └── types.ts            # LogEntry type
│   └── weights/
│       ├── index.ts            # Weight loading, updating, saving
│       └── types.ts            # WeightsFile, ConnectionRecord types
├── tests/
│   ├── config.test.ts
│   ├── identity.test.ts
│   ├── logger.test.ts
│   ├── weights.test.ts
│   └── hook-runner.test.ts
├── dist/                       # Compiled output (hook-runner.js here)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

The shared data directory (`C:\dev\data\skill-connections\`) is **not** part of this repo — it's created at runtime. Its structure:

```
C:\dev\data\skill-connections\
├── config.json          # Allowlist and other settings
├── weights.json         # The connection weight graph
└── logs/
    ├── 2026-03-28.jsonl
    ├── 2026-03-29.jsonl
    └── ...
```

---

## Core Types

### LogEntry

The structure written as one line to the daily JSONL file on each qualifying hook event.

```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;           // ISO 8601 UTC
  session_id: string;          // from hook payload
  tool_use_id: string;         // unique ID per tool invocation — useful for deduplication and future correlation
  project: string;             // canonical project identifier
  project_source: ProjectSource; // how project was derived
  tool_name: string;           // from hook payload
  tool_input: Record<string, unknown>; // from hook payload
  connection_type: ConnectionType;
  source_node: string;         // prefixed: "project:...", "skill:..."
  target_node: string;         // prefixed: "tool:...", "skill:..."
}

type ProjectSource = 'git-remote' | 'git-root' | 'cwd';
// 'skill→tool' is deferred — requires a SubagentStop hook to observe what tools a skill calls.
type ConnectionType = 'project→tool' | 'project→skill' | 'project→project';
```

### ConnectionRecord

A single weighted edge in the graph, stored in `weights.json`.

```typescript
interface ConnectionRecord {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;           // total observations (unbounded)
  weight: number;              // min(raw_count, 100) / 100 * 10, stored as float
  first_seen: string;          // ISO 8601 UTC
  last_seen: string;           // ISO 8601 UTC
}
```

### WeightsFile

The full JSON document stored in `weights.json`.

```typescript
interface WeightsFile {
  schema_version: 1;
  updated_at: string;          // ISO 8601 UTC, set on every write
  connections: Record<string, ConnectionRecord>; // keyed by connection key
}
```

**Connection key format:** `"<source_node>||<target_node>"` — double-pipe delimiter. Example: `"project:github.com/user/DevNeural||tool:Bash"`

### HookPayload

The shape of the JSON received on stdin from Claude Code's PostToolUse hook.

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
```

### Config

```typescript
interface Config {
  allowlist: string[];         // default: ["Bash", "Write", "Edit", "Agent"]
  data_root: string;           // default: "C:/dev/data/skill-connections"
}
```

---

## Module: Config (`src/config/index.ts`)

The config module loads `config.json` from the data root and merges it with defaults. If `config.json` does not exist, defaults are used silently.

**Constants:**
- `DEFAULT_DATA_ROOT`: `"C:/dev/data/skill-connections"` — intentionally Windows-specific for the author's machine. `DEVNEURAL_DATA_ROOT` is the portability escape hatch for other users/platforms.
- `DEFAULT_ALLOWLIST`: `["Bash", "Write", "Edit", "Agent"]`

**Functions:**

```typescript
function loadConfig(dataRoot: string): Config
```
Reads `<dataRoot>/config.json`. If the file doesn't exist, returns defaults silently. If the file exists but fails JSON parsing, logs `[DevNeural] config parse error: <message>` to stderr and returns defaults. Never throws.

---

## Module: Identity (`src/identity/index.ts`)

Resolves a canonical project identifier from a `cwd` string using a priority cascade. This is the most complex piece of the logger because it involves filesystem traversal and a subprocess call.

**The cascade:**

1. Walk up from `cwd` using `findUp` to locate the nearest `.git` directory → derive `gitRoot`
2. If `gitRoot` found, attempt `child_process.execSync('git -C <gitRoot> remote get-url origin')` wrapped in try/catch
   - If the command succeeds and returns a URL: normalize it and return `{ id, source: 'git-remote' }`
   - If no remote exists (non-zero exit) or `git` is not on PATH: normalize the `gitRoot` path and return `{ id, source: 'git-root' }`
3. If no `.git` found: normalize `cwd` and return `{ id, source: 'cwd' }`

Note: `simple-git` was rejected in favor of a direct `execSync` call — the module only needs one command and inlining is consistent with the `findUp` decision. The `package.json` name as a fallback between git-remote and git-root was deliberately omitted for simplicity; it can be added if `git-root` identifiers prove noisy in practice.

**URL normalization:**

SSH format `git@github.com:user/repo.git` → `github.com/user/repo`
HTTPS format `https://github.com/user/repo.git` → `github.com/user/repo`

**Path normalization (cross-platform):**

Backslashes replaced with forward slashes, drive letters lowercased. `C:\dev\tools\DevNeural` → `c:/dev/tools/devneural`

**Functions:**

```typescript
interface ProjectIdentity {
  id: string;
  source: ProjectSource;
}

async function resolveProjectIdentity(cwd: string): Promise<ProjectIdentity>
```
Returns best-available identity. Never throws — falls back to normalized `cwd` on any error.

```typescript
function normalizeGitUrl(url: string): string
```
Normalizes SSH and HTTPS git remote URLs to `host/owner/repo` format.

```typescript
function normalizePath(p: string): string
```
Converts backslashes to forward slashes, lowercases drive letter.

---

## Module: Logger (`src/logger/index.ts`)

Handles constructing log entries and appending them to the daily JSONL file.

**File path calculation:**

The log file for a given day is `<dataRoot>/logs/<YYYY-MM-DD>.jsonl`. The date is derived from the current UTC time at the moment of the hook invocation.

**Write strategy:**

Each hook invocation is a short-lived process. The logger uses `fs.promises.appendFile` with the default `'a'` flag. Each log entry is a single JSON line under ~4KB, making `O_APPEND` atomic at the kernel level on Linux. On Windows, this is not formally guaranteed but is practically reliable at this entry size.

The `logs/` directory is created recursively on first write if it doesn't exist.

**Functions:**

```typescript
function buildLogEntry(
  payload: HookPayload,
  identity: ProjectIdentity,
  connectionType: ConnectionType,
  sourceNode: string,
  targetNode: string
): LogEntry
```
Constructs a `LogEntry` from the hook payload and resolved identity. Does not perform I/O.

```typescript
async function appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void>
```
Serializes the entry as a single JSON line and appends it to the appropriate daily log file. Creates the `logs/` directory if needed. Never throws — logs errors to stderr.

```typescript
function getLogFilePath(dataRoot: string, date?: Date): string
```
Returns the full path for the log file for the given date (defaults to `new Date()`).

---

## Module: Weights (`src/weights/index.ts`)

Handles loading, updating, and saving the connection weight graph.

**Load strategy:**

Read `weights.json`. If it doesn't exist, return an empty `WeightsFile`. If it exists but is corrupt (JSON parse fails), log an error to stderr and return an empty `WeightsFile` (overwriting on next save — acceptable for the MVP since the log files preserve history and weights can be rebuilt).

**Weight calculation:**

`weight = Math.min(raw_count, 100) / 100 * 10`

This produces a value in [0.0, 10.0]. Values are stored as floats rounded to 4 decimal places. The `raw_count` is not capped — only the stored `weight` is normalized. At integer `raw_count` values, the formula always produces at most 1 decimal place (e.g., 5 → 0.5, 50 → 5.0), so the 4-decimal rounding is effectively a no-op today — it exists for forward compatibility if the formula is later replaced with an EMA or decay function.

**Save strategy:**

Use the atomic write pattern: write to `<dataRoot>/weights.json.tmp.<pid>`, then `fs.rename`. This prevents readers (the API server) from seeing a partially-written file. Uses `write-file-atomic` npm package for cross-platform reliability and proper file permissions.

**Concurrency protection:**

The read-modify-write cycle (loadWeights → updateWeight → saveWeights) is wrapped with `proper-lockfile`. Acquire a lock on `weights.json` before reading, release after writing. Use a 5-second stale lock timeout. If lock acquisition fails (stale lock, timeout, another process holds it), fall back to the unlocked write — this preserves the "never block Claude" invariant at the cost of a possible lost update, which is acceptable for soft weight data. Schema version migration (for future format changes) runs inside `loadWeights` and is guarded by the same lock.

**Functions:**

```typescript
function loadWeights(dataRoot: string): WeightsFile
```
Synchronous — reads and parses `weights.json`. Returns empty graph on any error.

```typescript
function connectionKey(sourceNode: string, targetNode: string): string
```
Returns `"<sourceNode>||<targetNode>"`. Pure function.

```typescript
function updateWeight(
  weights: WeightsFile,
  sourceNode: string,
  targetNode: string,
  connectionType: ConnectionType,
  now: Date
): WeightsFile
```
In-place mutation — modifies `weights.connections` directly and returns the same reference. Increments `raw_count`, recalculates `weight`, updates `last_seen`. Sets `first_seen` if the connection is new. No I/O.

```typescript
async function saveWeights(weights: WeightsFile, dataRoot: string): Promise<void>
```
Sets `updated_at` to current UTC time, then atomically writes to `weights.json`. Never throws — logs errors to stderr.

---

## Module: Hook Runner (`src/hook-runner.ts`)

The entry point for the hook script. This is what Claude Code calls on every `PostToolUse` event.

**Flow:**

1. Read stdin to end, parse as JSON → `HookPayload`
2. Load config from data root
3. Check if `payload.tool_name` is in the allowlist — if not, exit 0 immediately
4. Resolve project identity from `payload.cwd`
5. Call `deriveConnections(payload, identity)` → `DerivedConnection[]` (1 primary + 0 or more `project→project`)
6. For each derived connection, build a `LogEntry`. Then **in parallel** (`Promise.all`):
   - Append all log entries to daily JSONL via `appendLogEntry` (one call per entry)
   - Load current `weights.json`, apply `updateWeight` for each connection, save via `saveWeights` once (single lock acquisition covers all updates for this event)
7. Exit 0

**`deriveConnection` function:**

A single tool invocation can produce multiple edges. For example, editing a file in another project creates both a `project→tool` edge (you used Edit) and a `project→project` edge (your project depends on that project).

```typescript
interface DerivedConnection {
  connectionType: ConnectionType;
  sourceNode: string;
  targetNode: string;
}

async function deriveConnections(
  payload: HookPayload,
  identity: ProjectIdentity
): Promise<DerivedConnection[]>
```

**Primary connection rules (always produces one):**
- If `tool_name != "Agent"`: `{ connectionType: 'project→tool', sourceNode: 'project:<id>', targetNode: 'tool:<tool_name>' }`
- If `tool_name == "Agent"`: `{ connectionType: 'project→skill', sourceNode: 'project:<id>', targetNode: 'skill:<extractedName>' }`

**Cross-project detection (optional additional connection):**

After deriving the primary connection, scan `tool_input` for references to other projects using `extractProjectRefs(payload, identity)`. For each detected project that differs from the current project, append a `project→project` edge:
`{ connectionType: 'project→project', sourceNode: 'project:<currentId>', targetNode: 'project:<otherProjectId>' }`

**`extractProjectRefs` — rules per tool:**
- `Write`, `Edit`: read `tool_input.file_path` (string). Resolve it via `resolveProjectIdentity` on the parent directory. If the resolved project id differs from `identity.id`, it's a cross-project reference.
- `Bash`: scan `tool_input.command` (string) for absolute paths matching `/[A-Za-z]:[/\\]` (Windows) or starting with `/` (Unix). For each candidate path that exists on disk and falls outside the current project root, resolve via `resolveProjectIdentity`.
- `Agent`: scan `tool_input.prompt` and `tool_input.description` for absolute paths or repo URLs (`github.com/`, `https://`, `git@`). Resolve paths via `resolveProjectIdentity`; for URLs, use `normalizeGitUrl` directly as the target project id.

**Deduplication:** if the same target project appears multiple times in one payload, emit only one `project→project` edge per unique target.

**Never throws** — if path resolution fails for any candidate, skip that candidate silently. The hook still exits 0.

**Skill name extraction (for Agent tool calls):**

The `tool_input` for an Agent call contains `description` and `prompt` fields. Extract the skill name using this priority:
1. Check `tool_input.description` for a recognizable skill name pattern (e.g., `"deep-plan"`, `"gsd:execute-phase"`)
2. Check `tool_input.subagent_type` if present
3. Fall back to `"unknown-skill"`

This extraction will be imprecise in the MVP — skill name detection can be improved as patterns become clear from real log data. The raw `tool_input` is preserved in the log entry, enabling retrospective re-analysis.

**Error handling:**

The entire flow is wrapped in a top-level try/catch. Any error → `console.error('[DevNeural]', err.message)` → `process.exit(0)`. This ensures Claude Code sessions are never interrupted.

**stdin handling:**

Read all stdin data before processing. Handle the case where stdin provides no data (e.g., hook invoked manually without payload) by exiting 0 silently.

---

## Hook Configuration

The hook is registered globally in `~/.claude/settings.json` under `PostToolUse`. Since this is a user-global config, it applies to every Claude Code session on the machine.

The command path points to the compiled JavaScript at `dist/hook-runner.js` (relative to the module root). The absolute path must be used since the hook runs from arbitrary working directories.

**Settings structure:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <absolute-path-to>/01-data-layer/dist/hook-runner.js"
          }
        ]
      }
    ]
  }
}
```

The matcher `""` matches all tools — the allowlist filtering happens inside the script.

**The hook configuration is managed manually** (not auto-installed) as part of the build setup instructions. This avoids accidentally overwriting existing hooks in the user's settings.json.

---

## Build Setup

**Runtime target:** Node.js 20+ (LTS). CommonJS output (not ESM) for compatibility with direct `node` invocation without `--input-type` flags.

**TypeScript config:** `"module": "CommonJS"`, `"target": "ES2022"`, `"strict": true`, `"outDir": "./dist"`.

**Key scripts in `package.json`:**
- `build` — `tsc`
- `test` — `vitest run`
- `test:watch` — `vitest`
- `dev` — `tsx src/hook-runner.ts` (for local testing with stdin piped)

**`find-up` v7 is ESM-only.** Since we're targeting CommonJS output, use `find-up` v5 (the last CJS-compatible version) OR use a dynamic `import()` at runtime. Alternatively, inline a simple recursive `findUp` helper to avoid the dependency entirely. **Decision:** inline a 10-line recursive `findUp` helper to keep the module free of ESM compatibility issues.

---

## Testing Strategy

Tests use **Vitest** with a temporary directory fixture for all file I/O.

### Test Setup

Each test suite creates a temp directory (via `os.tmpdir()` + unique suffix) as `dataRoot`. Tests write config, weights, and log files there. Cleanup happens in `afterEach`.

### What to Test

**Config (`config.test.ts`):**
- Returns defaults when `config.json` doesn't exist
- Reads and merges custom allowlist from `config.json`
- Returns defaults when `config.json` is corrupt JSON (and logs to stderr)
- Respects `DEVNEURAL_DATA_ROOT` environment variable override
- Reads `data_root` field from `config.json` when present

**Identity (`identity.test.ts`):**
- Normalizes SSH git remote URL correctly
- Normalizes HTTPS git remote URL correctly
- Falls back to git root path when no remote exists
- Falls back to CWD when no `.git` directory exists
- Handles Windows paths (backslashes → forward slashes, lowercase drive)
- Returns `'git-remote'` source when remote URL is found
- `normalizeGitUrl` returns URL unchanged for unrecognized formats (bare paths, `file://`, `git://`, ported SSH)
- Falls back to CWD when `git` binary is not on PATH (simulated by passing a bad command path)
- Falls back gracefully when `cwd` is an empty string

**Logger (`logger.test.ts`):**
- `buildLogEntry` produces correct `source_node` and `target_node` for `project→tool`
- `buildLogEntry` produces correct nodes for `project→skill`
- `appendLogEntry` creates the `logs/` directory if absent
- `appendLogEntry` writes a valid JSON line terminated with `\n`
- `appendLogEntry` appends (doesn't overwrite) on second call
- `appendLogEntry` logs to stderr and does not throw when directory is read-only
- `getLogFilePath` produces correct `YYYY-MM-DD.jsonl` filename

**Weights (`weights.test.ts`):**
- `loadWeights` returns empty graph when file doesn't exist
- `loadWeights` returns empty graph (not throws) when file is corrupt
- `updateWeight` creates a new connection with `raw_count=1`, correct `weight`, `first_seen` set
- `updateWeight` increments an existing connection correctly
- `updateWeight` caps `weight` at 10.0 when `raw_count >= 100`
- `saveWeights` writes valid JSON to `weights.json`
- `saveWeights` does not corrupt existing file on concurrent read (atomic write pattern)
- `connectionKey` produces `"a||b"` format
- Concurrent write simulation: two interleaved read-modify-write cycles produce a valid, non-corrupt `weights.json` (lock prevents silent clobbering)

**Hook Runner (`hook-runner.test.ts`):**
- Exits 0 when tool is not in allowlist (no file writes)
- Exits 0 when tool IS in allowlist (writes log entry and updates weights)
- Exits 0 on malformed stdin input
- Exits 0 when stdin is empty
- `deriveConnections` returns `[project→tool]` for non-Agent tools
- `deriveConnections` returns `[project→skill]` for Agent tools, extracts skill name from `description`
- `deriveConnections` falls back to `"unknown-skill"` when Agent description is unparseable
- `deriveConnections` falls back to `"unknown-skill"` when Agent call has no `description` field
- Non-default tools added to allowlist config are processed correctly
- `extractProjectRefs` detects cross-project file path in `Edit` tool_input and returns a `project→project` edge
- `extractProjectRefs` detects cross-project repo URL in `Agent` prompt and returns a `project→project` edge
- `extractProjectRefs` returns no additional edges when `file_path` is within the current project
- `extractProjectRefs` deduplicates multiple references to the same target project
- `extractProjectRefs` silently skips unresolvable paths (no throws)

### Integration Test

One end-to-end test in `hook-runner.test.ts` simulates a full PostToolUse payload for `tool_name: "Bash"` through to file assertions — verifying the JSONL line exists in the correct log file and the connection weight was incremented in `weights.json`.

---

## Implementation Order

The modules have a clear dependency chain. Implement in this order:

1. **Types** — Define all interfaces before implementing anything
2. **Config** — No dependencies; easiest to test
3. **Identity** — Uses `child_process.execSync` + inline `findUp` helper; test with mock filesystem
4. **Logger types + `buildLogEntry`** — Pure function; test immediately
5. **Logger I/O (`appendLogEntry`)** — Depends on `fs`; test with temp dir
6. **Weights** — Depends on `write-file-atomic` and `proper-lockfile`; test with temp dir including concurrent write simulation
7. **Hook runner: `deriveConnection`** — Pure function; test independently before wiring I/O
8. **Hook runner: orchestration** — Integrates all modules; test last with full payload simulation
9. **Build** — Verify `dist/hook-runner.js` runs correctly with piped JSON input
10. **Hook wiring** — Update `~/.claude/settings.json` manually

**Strongly recommended before step 7:** manually invoke a few Skill tool calls and a few cross-project Edit/Bash commands in a test session and capture the raw PostToolUse stdin payloads. Use these as test fixtures for `deriveConnections` skill-name extraction and `extractProjectRefs` path detection — without real payload examples, the extraction logic is guesswork.

---

## Edge Cases and Decisions

**Corrupt weights.json:** Overwrite with empty graph on next save. The JSONL log files preserve all history — weights can always be rebuilt from logs in a future utility script.

**Missing data root:** Create `<dataRoot>/logs/` recursively on first write. Do not pre-create the directory — lazy creation is simpler.

**Very long `tool_input`:** No truncation. The full `tool_input` is stored in the log entry. For `Write` tool calls this may include large file contents. This is acceptable for MVP — compression or truncation can be added later. Log entries may exceed 4KB in this case; acknowledge this in the code comment near the append call.

**Multiple Claude sessions running concurrently:** Two sessions writing to the same `weights.json` simultaneously could produce a lost update. This is mitigated by `proper-lockfile` wrapping the read-modify-write cycle. On lock failure (stale/timeout), the system falls back to unlocked writes — one lost update is not critical since weights are soft data and logs preserve full history.

**`project→project` detection scope:** Cross-project edges are captured in this MVP via path/URL scanning of `tool_input`. The extraction is best-effort — some cross-project references (e.g., inside Bash scripts that construct paths dynamically) will be missed. This is acceptable; the log files preserve full `tool_input` for retrospective re-analysis. `skill→tool` edges remain deferred (require SubagentStop hook).

**`tool_name == "Agent"` but not a skill:** Some Agent calls are exploratory subagents, not skills. The skill name extraction heuristic will fall back to `"unknown-skill"` in these cases. These entries are still logged and contribute to the `project→skill` weight with the generic name. The raw `tool_input.description` is preserved for future refinement.

**Windows path as `data_root`:** Use `path.join` consistently throughout — never string concatenation — to ensure cross-platform path construction. Store paths in normalized form (forward slashes) in the JSON files.
