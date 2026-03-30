# Implementation Plan: 04-session-intelligence

## Background

DevNeural is a system that tracks which skills, tools, and related projects Claude Code uses across every coding session. It writes connection data to a local graph stored in `weights.json` and exposes that graph through a REST API (`02-api-server`).

The `04-session-intelligence` module closes the loop: when Claude Code opens, it fires a `SessionStart` hook that queries the DevNeural API for nodes connected to the current project. The results — ranked by connection weight — are injected into Claude's context as plain stdout, so Claude immediately knows which skills and related projects are most associated with this codebase. This prevents duplicate work and surfaces cross-project patterns automatically.

---

## What We're Building

A compiled Node.js script (`dist/session-start.js`) registered as a global Claude Code `SessionStart` hook, plus an install script that patches `~/.claude/settings.json` to register it.

The hook does four things in sequence:
1. **Reads** the JSON payload from stdin and extracts `cwd`
2. **Resolves** the project identity (`github.com/user/repo`) from the working directory
3. **Queries** `GET /graph/subgraph?project=<id>` with a 5-second timeout
4. **Outputs** a compact ranked summary of skills and related projects to stdout

If the API is offline or the project has no connections, the hook outputs a short informational message and exits 0. The hook **never throws, never blocks the session.**

---

## Module Structure

```
04-session-intelligence/
├── src/
│   ├── session-start.ts      # Entry point: stdin → identity → API → format → stdout
│   ├── identity.ts           # Thin re-export wrapper around 01-data-layer identity
│   ├── api-client.ts         # HTTP GET /graph/subgraph with fetch + AbortSignal timeout
│   ├── formatter.ts          # GraphResponse → formatted stdout string
│   └── install-hook.ts       # Patches ~/.claude/settings.json with hook config
├── tests/
│   ├── session-start.test.ts # Integration: spawns compiled binary with mock API
│   ├── formatter.test.ts     # Unit: formatting logic
│   ├── api-client.test.ts    # Unit: timeout, offline, and empty-graph behavior
│   └── helpers.ts            # Shared: temp dirs, mock node:http server
├── package.json
├── tsconfig.json
├── vitest.config.ts          # Sets extended timeout for slow timeout test
└── spec.md                   # Original spec document
```

---

## Section 1: Package and TypeScript Setup

The module follows the exact pattern of `01-data-layer`: CommonJS output, ES2022 target, strict mode, `tsx` for development, `tsc` for production builds.

**`package.json` scripts:**
- `build` — `tsc` (compiles src/ to dist/)
- `dev` — `tsx src/session-start.ts` (development, reads from stdin)
- `install-hook` — `tsx src/install-hook.ts` (patches settings.json)
- `test` — `vitest run`
- `test:watch` — `vitest`

**`vitest.config.ts`:** Needed to set a project-wide `testTimeout` large enough for the API timeout test (which uses a 6s delay). Set `testTimeout: 15000` to avoid Vitest's default 5s timeout causing false failures.

**Dependencies:**
- Runtime: none (uses Node.js built-ins `fs`, `path`, `http`/`https`, `child_process`)
- Dev: `typescript`, `tsx`, `vitest`, `@types/node`
- Peer: `01-data-layer` (referenced via relative path)

**`tsconfig.json` settings:**
- `module`: `CommonJS`
- `moduleResolution`: `node`
- `target`: `ES2022`
- `outDir`: `dist/`
- `strict`: `true`
- `esModuleInterop`: `true`
- `declaration`: `true`
- **No `rootDir`** — omitting `rootDir` allows cross-directory relative imports (needed to reach `../01-data-layer/dist/`). TypeScript still writes output to `outDir` correctly.

---

## Section 2: Identity Module

The identity module is a thin wrapper that re-exports `resolveProjectIdentity` and its return type `ProjectIdentity` from `01-data-layer`. This module exists so the rest of the codebase imports from a local path, making future decoupling simpler.

```typescript
// src/identity.ts
export type { ProjectIdentity, ProjectSource } from '../01-data-layer/dist/types.js';
export { resolveProjectIdentity } from '../01-data-layer/dist/identity/index.js';
```

**Important:** These imports reference the compiled `dist/` output of `01-data-layer`, not its source files. This is required because both packages use CommonJS and `rootDir` is not set. The `01-data-layer` must be built (`npm run build` in `01-data-layer/`) before `04-session-intelligence` will compile.

`resolveProjectIdentity(cwd: string): Promise<ProjectIdentity>` returns:
- `id` — the canonical identifier string (e.g., `github.com/user/repo`)
- `source` — which method resolved it (`"git-remote" | "git-root" | "cwd"`)

If identity resolution fails entirely (no git, permission error), the function falls back to `basename(cwd)` as the project ID. This fallback is handled inside the `01-data-layer` implementation — the session hook does not need special handling beyond calling the function.

---

## Section 3: API Client

The API client makes a single HTTP GET request to the DevNeural API server and returns the parsed `GraphResponse`, or `null` if the server is unreachable.

```typescript
// src/api-client.ts

interface ApiClientConfig {
  apiUrl: string;    // e.g., "http://localhost:3747"
  timeoutMs: number; // 5000
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

interface GraphNode {
  id: string;        // "project:...", "tool:...", "skill:..."
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  raw_count: number;
  weight: number;    // [0.0, 10.0]
  first_seen: string;
  last_seen: string;
}

async function fetchSubgraph(projectId: string, config: ApiClientConfig): Promise<GraphResponse | null>
```

**Implementation approach:**
- Uses `fetch` (built-in since Node 18, which is the minimum Claude Code requires) with `AbortSignal.timeout(5000)` for clean timeout handling
- On any error (ECONNREFUSED, ETIMEDOUT, AbortError, parse error): returns `null`
- On success: parses JSON and returns typed `GraphResponse`
- URL construction: `DEVNEURAL_API_URL` wins if set (useful for tests); otherwise constructs `http://localhost:${DEVNEURAL_PORT}` where `DEVNEURAL_PORT` defaults to `3747`

---

## Section 4: Formatter

The formatter transforms a `GraphResponse` into a human-readable plain text string suitable for Claude's context. It receives the full graph response and the project ID.

```typescript
// src/formatter.ts

interface FormatterConfig {
  maxResultsPerType: number; // 10
  minWeight: number;         // 1.0
}

function formatSubgraph(
  projectId: string,
  response: GraphResponse,
  config: FormatterConfig,
): string
```

**Formatting logic:**

1. **Filter edges** — keep only edges where:
   - `source === "project:" + id` (outgoing from this project — intentional; we care about what this project uses, not what uses it)
   - `connection_type` is either `"project->skill"` or `"project->project"` (edges of type `"project->tool"` are excluded by design — tools are too transient to be useful session context)
2. **Apply minimum weight** — discard edges with `weight < config.minWeight`
3. **Sort by weight** descending
4. **Limit to top N** per connection type separately
5. **Resolve node labels** — for each edge target, look up the corresponding node in `response.nodes` to get its `label`
6. **Format relative time** — convert `last_seen` ISO 8601 to human-readable "today", "2 days ago", "1 week ago", etc. using simple date arithmetic (no external libraries)
7. **Assemble output string** with the structure shown in the spec

**Edge cases:**
- No edges above threshold → output "No significant connections found for this project yet."
- Skill section empty but projects non-empty (or vice versa) → only show the non-empty section
- `label` missing for a node → fall back to the node's `id` with the type prefix stripped

**Output structure:**
```
DevNeural Context for <id>:

  Skills (top connections):
    • <label> (<weight>/10, <raw_count> uses) — <relativeTime>
    ...

  Related Projects:
    • <label> (<weight>/10, <raw_count> uses) — last connected <relativeTime>
    ...
```

The formatter is a pure function (no I/O, no side effects) — all formatting logic is testable in isolation.

---

## Section 5: Main Entry Point

The entry point (`src/session-start.ts`) is the hook binary. It reads stdin, orchestrates all modules, and writes to stdout.

```typescript
// src/session-start.ts

interface HookPayload {
  session_id?: string;
  cwd: string;
  hook_event_name: string;
  source?: string;
  transcript_path?: string;
  model?: string;
}

async function main(): Promise<void>
```

**Execution flow:**

1. **Read stdin** — collect all stdin bytes into a string (the hook payload is delivered as JSON on stdin)
2. **Parse payload** — `JSON.parse()` the stdin string, extract `cwd`. If parse fails, exit 0 silently.
3. **Resolve project identity** — call `resolveProjectIdentity(cwd)`, extract `id`
4. **Fetch subgraph** — call `fetchSubgraph(identity.id, config)` with API config from env
5. **Handle null response** — if `null`, output offline message with start command and exit 0
6. **Format output** — call `formatSubgraph(projectId, response, formatterConfig)`
7. **Write to stdout** — `process.stdout.write(output + '\n')`
8. **Exit 0**

**Error handling wrapper:** The entire `main()` call is wrapped in a top-level `.catch()` that writes to `process.stderr` and calls `process.exit(0)`. This guarantees the hook never crashes with a non-zero exit code regardless of what goes wrong internally.

**Configuration from environment:**
- `DEVNEURAL_API_URL` — if set, used as the full API base URL (takes priority)
- `DEVNEURAL_PORT` (default: `3747`) — used only if `DEVNEURAL_API_URL` is not set; constructs `http://localhost:${port}`

---

## Section 6: Install Script

The install script (`src/install-hook.ts`) patches `~/.claude/settings.json` to register the hook for all 4 matchers. It is invoked via `npm run install-hook`.

```typescript
// src/install-hook.ts

function getSettingsPath(): string
  /** Returns ~/.claude/settings.json path (cross-platform) */

function readSettings(settingsPath: string): Record<string, unknown>
  /** Reads and JSON-parses settings.json; returns empty object if file missing */

function buildHookEntry(scriptPath: string): object
  /** Builds the { type, command, timeout, statusMessage } object */

function mergeHooks(
  existing: Record<string, unknown>,
  hookCommand: string,
): Record<string, unknown>
  /** Deep-merges the 4 SessionStart hook entries into existing settings */

function writeSettings(settingsPath: string, settings: Record<string, unknown>): void
  /** Writes settings back to disk with 2-space indentation */

async function main(): Promise<void>
  /** Orchestrates: read → merge → write → confirm */
```

**Merge strategy:**
- Reads existing `hooks.SessionStart` array (if present)
- Deduplicates by scanning the hook command string across ALL existing entries (regardless of whether they have a `matcher` field — existing entries in settings.json often omit `matcher` entirely). If the absolute path to `session-start.js` already appears in any entry's command, skip registration.
- Appends the 4 matcher entries (one per matcher: startup, resume, clear, compact) if not already present
- The `statusMessage` is only set on the `startup` entry ("Loading DevNeural context...")
- Preserves all other existing settings untouched
- **Note:** Multiple matchers mean the hook fires on startup, resume, clear, and compact — each call is a lightweight local API request (~1ms), so the redundancy is acceptable by design.
- **Note:** Moving or renaming the DevNeural repo after installation breaks the hook silently (the path in settings.json becomes stale). The install output explicitly informs the user that the hook is bound to the absolute path at install time.

**Script path resolution:** The installed command uses the absolute path to `dist/session-start.js` in the DevNeural repo. The install script determines this from `__dirname` at runtime:
```
node "C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js"
```

**Output after success:**
```
DevNeural SessionStart hook installed.
Script: C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js
Registered in: C:/Users/<user>/.claude/settings.json

Matchers: startup, resume, clear, compact

Note: Run 'npm run build' first to compile the hook script.
Open a new Claude Code session to verify the hook fires.
```

**Idempotent:** Running `npm run install-hook` multiple times does not create duplicate entries.

---

## Section 7: Tests

Testing follows the established `01-data-layer` pattern: Vitest with integration tests that spawn the compiled binary via `spawnSync`.

### Test Helpers (`tests/helpers.ts`)

Three utilities:
1. `createTempDir()` — wraps `fs.mkdtempSync` with a `devneural-04-test-` prefix
2. `removeTempDir(dir)` — wraps `fs.rmSync({ recursive: true, force: true })`
3. `startMockApiServer(port, responses)` — starts a minimal `node:http.createServer` server on a random port that serves configurable responses. Returns an object with a `stop()` method. Uses `node:http` directly (not Fastify) — this module has no Fastify dependency and `node:http` is sufficient for serving canned JSON responses.

The mock server covers:
- Normal responses (returns a static `GraphResponse`)
- Delayed responses (configurable delay to test timeout behavior)
- Connection-refused behavior (server not started)
- Empty responses (project has no connections — `{ nodes: [], edges: [], updated_at: "..." }`)

### Integration Tests (`tests/session-start.test.ts`)

All tests compile the binary once (`tsc` in `beforeAll`) then use `spawnSync('node', ['dist/session-start.js'], { input: payload, ... })`.

Test cases:
1. **Happy path** — project with skills and related projects → output contains "DevNeural Context", skill names, weight values, and use counts
2. **No connections** — project ID not in graph or all weights < 1.0 → output contains "No significant connections"
3. **API offline (ECONNREFUSED)** — `DEVNEURAL_PORT` points to nothing → output contains "API offline" and start command; exit code 0
4. **API timeout** — mock server delays 6s → output contains "API offline"; completes within 7s. This test uses `{ timeout: 15000 }` to override Vitest's default 5s test timeout.
5. **Invalid JSON payload** — malformed stdin → exits 0 with no output (silent)
6. **CWD with no git** — temp directory with no `.git` → falls back to dirname, still calls API
7. **Top-10 limit** — mock API returns 15 skills → output contains exactly 10
8. **Weight filtering** — mock API returns skills with weight 0.5 → those skills do NOT appear

### Unit Tests (`tests/formatter.test.ts`)

Tests `formatSubgraph()` directly with constructed `GraphResponse` objects:
1. **Skills only** — no project edges → only Skills section appears
2. **Projects only** — no skill edges → only Related Projects section appears
3. **Both sections** — normal case
4. **Relative time formatting** — `last_seen` values at various ages produce correct strings
5. **Label fallback** — edge target has no matching node → strips type prefix from ID

### Unit Tests (`tests/api-client.test.ts`)

Tests `fetchSubgraph()` with a minimal `node:http` mock server:
1. **Successful response** — returns parsed `GraphResponse`
2. **Server offline (ECONNREFUSED)** — returns `null`
3. **5-second timeout** — server delays 6s, returns `null` within ~5.5s; test uses `{ timeout: 15000 }`
4. **Empty graph response** — server returns `{ nodes: [], edges: [], updated_at: "..." }` → returns the empty `GraphResponse` (not null; 200 OK with no data is valid)
5. **Malformed JSON** — server returns `{invalid}` → returns `null`

---

## Error Handling and Robustness

The module's primary constraint is: **never degrade the Claude Code session experience.** This means:

- **Top-level catch**: All async errors are caught and result in `process.exit(0)`. The user never sees a hook crash.
- **Partial results OK**: If the API returns a response but node labels are missing for some edges, those edges are skipped rather than throwing.
- **Env var fallbacks**: Missing `DEVNEURAL_PORT` defaults to 3747 without throwing.
- **Cross-platform paths**: All file path construction uses `node:path` and `os.homedir()`. The install script writes forward-slash paths in the JSON command (or handles escaping correctly for Windows).
- **Race conditions in settings.json**: The install script reads the current state of settings.json immediately before writing. It does not hold an exclusive lock (unnecessary for a one-time install script).

---

## Integration with the Broader DevNeural Ecosystem

The session hook is the last piece of the DevNeural feedback loop:

1. **01-data-layer** (PostToolUse hook) records every tool use → writes to `weights.json`
2. **02-api-server** reads `weights.json` → exposes `/graph/subgraph`
3. **04-session-intelligence** (SessionStart hook) queries `/graph/subgraph` → injects context

The hook does not write any data — it is a pure consumer. The same `resolveProjectIdentity` function that the PostToolUse hook uses to write connections is used here to query them, ensuring the project keys match exactly.

**Startup order dependency:** The hook queries the API, so `02-api-server` must be running. The fallback message when it's offline is actionable: the user sees the exact command to start it. There is no auto-start behavior in this module — that is outside the scope of a SessionStart hook (which must be fast and non-blocking).

---

## Implementation Sequence

The sections should be implemented in this order (each section depends on the previous):

1. **Package + tsconfig** — establish build tooling so other sections can compile
2. **Identity module** — simplest section, validates the import path from 01-data-layer
3. **API client** — self-contained HTTP module with timeout behavior
4. **Formatter** — pure function, can be fully unit-tested in isolation
5. **Main entry point** — wires together all other modules
6. **Install script** — standalone utility, can be developed and tested independently
7. **Integration tests** — verify the compiled binary end-to-end
