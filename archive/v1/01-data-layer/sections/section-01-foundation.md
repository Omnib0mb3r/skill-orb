# Section 01: Foundation

**Dependencies:** None — this section must be completed before any other section can begin.

**Blocks:** All other sections (02 through 07).

**Goal:** Scaffold the project and define all shared TypeScript types. No business logic is implemented here — only the project structure, build configuration, and type definitions that every other module imports.

---

## Overview

This section creates the skeleton for the `01-data-layer` module:

- `package.json` with all runtime and dev dependencies
- `tsconfig.json` targeting CommonJS / ES2022
- `vitest.config.ts` for the test runner
- A shared temp-dir fixture helper for I/O tests
- All core TypeScript interfaces in a single types file

After completing this section, every other section can start independently and in parallel.

---

## TODO List

1. Create `package.json` with the dependency list below
2. Create `tsconfig.json` with the compiler settings below
3. Create `vitest.config.ts`
4. Run `npm install` to lock the dependency tree
5. Create `src/types.ts` with all interface and type definitions
6. Create `tests/helpers/tempDir.ts` with the shared temp-dir fixture
7. Verify TypeScript compiles (`npx tsc --noEmit`) — no implementation files exist yet so only the type file is checked

---

## Tests (Write These First)

*File: none required for this section — types are compile-time only.*

The TDD verification for this section is:

- `tsc --noEmit` passes after `src/types.ts` is written
- All interfaces below typecheck without error
- `ConnectionType` union does **not** include `'skill→tool'` (this is a compile-time guard — confirm it is absent from the union)

There are no Vitest tests to write for this section. The shared fixture helper created here (`tests/helpers/tempDir.ts`) is used by sections 02–06 but contains no tests itself.

---

## Project Scaffold

### Directory Structure to Create

```
01-data-layer/
├── src/
│   └── types.ts              ← All shared interfaces (created in this section)
├── tests/
│   └── helpers/
│       └── tempDir.ts        ← Shared fixture for file I/O tests
├── dist/                     ← Created by tsc; add to .gitignore
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

The full `src/` module subdirectories (`config/`, `identity/`, `logger/`, `weights/`) and the individual module files are created by sections 02–05. Do not create them here.

The shared data directory at `C:\dev\data\skill-connections\` is **not** part of this repo — it is created at runtime by the hook runner. Do not create it here.

---

## File: `package.json`

```json
{
  "name": "devneural-data-layer",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/hook-runner.ts"
  },
  "dependencies": {
    "write-file-atomic": "^5.0.1",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/write-file-atomic": "^4.0.3",
    "@types/proper-lockfile": "^4.1.4",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "tsx": "^4.7.0"
  }
}
```

Key points:
- `write-file-atomic` — atomic writes for `weights.json` (used in section 05)
- `proper-lockfile` — read-modify-write concurrency protection for `weights.json` (used in section 05)
- `tsx` — dev-mode runner; allows `npm run dev` to pipe stdin without a prior build
- No `find-up` dependency — section 03 (Identity) uses an inline recursive helper instead, to avoid ESM compatibility issues with `find-up` v7

---

## File: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Key points:
- `"module": "CommonJS"` — required for `node dist/hook-runner.js` to work without `--input-type` flags
- `"target": "ES2022"` — enables top-level await syntax even though it is not used today
- `"strict": true` — enforced throughout all modules
- Tests are excluded from compilation (`"exclude": ["tests"]`); Vitest uses `tsx` for test transpilation

---

## File: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 15000,
  },
});
```

The 15-second timeout is set to accommodate the integration tests in section 06 that spawn a child process to run `dist/hook-runner.js`.

---

## File: `src/types.ts`

Define all shared interfaces in a single file. Every module imports from here. No implementation logic belongs in this file.

```typescript
// ── Connection types ──────────────────────────────────────────────────────────

/**
 * How a project identifier was derived from the working directory.
 * 'git-remote' is the most canonical; 'cwd' is the fallback.
 */
export type ProjectSource = 'git-remote' | 'git-root' | 'cwd';

/**
 * The type of directed edge in the connection graph.
 * NOTE: 'skill→tool' is deliberately absent — it requires a SubagentStop hook
 * and is deferred beyond this implementation.
 */
export type ConnectionType = 'project→tool' | 'project→skill' | 'project→project';

// ── Hook payload ──────────────────────────────────────────────────────────────

/**
 * The JSON payload Claude Code sends on stdin for every PostToolUse event.
 */
export interface HookPayload {
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

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Runtime configuration. Loaded from <dataRoot>/config.json and merged with defaults.
 */
export interface Config {
  /** Tool names that trigger logging. Default: ["Bash", "Write", "Edit", "Agent"] */
  allowlist: string[];
  /** Absolute path to the shared data directory. Default: "C:/dev/data/skill-connections" */
  data_root: string;
}

// ── Project identity ──────────────────────────────────────────────────────────

/**
 * Resolved canonical identifier for a project and how it was derived.
 */
export interface ProjectIdentity {
  id: string;
  source: ProjectSource;
}

// ── Log entry ─────────────────────────────────────────────────────────────────

/**
 * One line written to the daily JSONL log file per qualifying hook event.
 */
export interface LogEntry {
  schema_version: 1;
  timestamp: string;                      // ISO 8601 UTC
  session_id: string;                     // from HookPayload
  tool_use_id: string;                    // unique per tool invocation
  project: string;                        // canonical project id
  project_source: ProjectSource;          // how project was resolved
  tool_name: string;                      // from HookPayload
  tool_input: Record<string, unknown>;    // from HookPayload (full, untruncated)
  connection_type: ConnectionType;
  source_node: string;                    // prefixed: "project:<id>"
  target_node: string;                    // prefixed: "tool:<name>", "skill:<name>", "project:<id>"
}

// ── Weight graph ──────────────────────────────────────────────────────────────

/**
 * A single directed weighted edge in the connection graph.
 * Key in WeightsFile.connections: "<source_node>||<target_node>"
 */
export interface ConnectionRecord {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;    // unbounded total observations
  weight: number;       // min(raw_count, 100) / 100 * 10 — range [0.0, 10.0]
  first_seen: string;   // ISO 8601 UTC
  last_seen: string;    // ISO 8601 UTC
}

/**
 * The full JSON document stored in weights.json.
 */
export interface WeightsFile {
  schema_version: 1;
  updated_at: string;                              // ISO 8601 UTC, updated on every save
  connections: Record<string, ConnectionRecord>;   // keyed by connection key
}

// ── Hook runner internals ─────────────────────────────────────────────────────

/**
 * A single derived graph edge produced from one tool invocation.
 * One invocation may produce multiple DerivedConnections (e.g., project→tool + project→project).
 */
export interface DerivedConnection {
  connectionType: ConnectionType;
  sourceNode: string;
  targetNode: string;
}
```

---

## File: `tests/helpers/tempDir.ts`

A shared fixture helper imported by all file I/O test suites. Provides a unique temporary directory per test and cleans up after.

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Creates a unique temp directory under os.tmpdir().
 * Returns the absolute path.
 */
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-test-'));
}

/**
 * Removes the given directory and all its contents recursively.
 * Silently ignores errors (e.g., already removed).
 */
export function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
```

Usage pattern in test files (sections 02–06):

```typescript
import { createTempDir, removeTempDir } from './helpers/tempDir';

let dataRoot: string;

beforeEach(() => {
  dataRoot = createTempDir();
});

afterEach(() => {
  removeTempDir(dataRoot);
});
```

---

## Important Design Notes for Downstream Sections

The following decisions made here affect all downstream sections. Do not re-litigate them:

**No `find-up` npm dependency.** Section 03 (Identity) implements an inline `findUp` helper. This avoids the ESM-only constraint of `find-up` v7 while keeping the module free of compatibility shims. The helper is ~10 lines.

**CommonJS output.** The hook script must be invokable as `node dist/hook-runner.js` from `~/.claude/settings.json`. ESM output would require `--input-type=module` or a `.mjs` extension, both of which complicate the hook invocation. All source files use `require`/`module.exports` semantics via TypeScript's CommonJS compilation.

**Single `src/types.ts`.** All interfaces live here. Module files (`config/index.ts`, `identity/index.ts`, etc.) import types from `../types` — they do not re-declare interfaces locally. The per-module `types.ts` files mentioned in the plan (e.g., `src/logger/types.ts`, `src/weights/types.ts`) should simply re-export the relevant types from `src/types.ts` rather than defining new ones.

**Weight formula:** `Math.min(raw_count, 100) / 100 * 10`. Produces values in `[0.0, 10.0]`. Store rounded to 4 decimal places for forward compatibility. At integer `raw_count` values the rounding is effectively a no-op today.

**Connection key format:** `"<source_node>||<target_node>"` (double-pipe delimiter). Example: `"project:github.com/user/DevNeural||tool:Bash"`.

**Node prefix conventions:**
- Current project: `"project:<id>"`
- Tool target: `"tool:<tool_name>"`
- Skill target: `"skill:<skill_name>"` (or `"skill:unknown-skill"` as fallback)
- Cross-project target: `"project:<other_id>"`

**Data root default:** `"C:/dev/data/skill-connections"` (forward slashes, hardcoded for the author's machine). The `DEVNEURAL_DATA_ROOT` environment variable is the portability escape hatch for other users or platforms.
