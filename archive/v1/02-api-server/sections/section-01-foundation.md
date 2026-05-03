# Section 01 — Foundation Scaffold

## Overview

This section sets up the entire project skeleton for `02-api-server`. Everything that follows depends on this scaffold being in place. After completing this section, the project will compile, start with `npm run dev`, and pass `npm test` (with zero test files, which is acceptable at this stage).

This section has no dependencies on other sections.

---

## What to Build

- `02-api-server/package.json` — ESM project config with all dependencies and scripts
- `02-api-server/tsconfig.json` — TypeScript config for the project
- `02-api-server/vitest.config.ts` — vitest config (matching `01-data-layer` conventions)
- `02-api-server/src/config.ts` — `ServerConfig` interface, env var loading, fail-fast validation
- `02-api-server/src/server.ts` — minimal Fastify server stub that reads config and binds to a port
- All required subdirectories (empty, for future sections)

---

## Tests for This Section

There is no automated test file for the foundation scaffold. Verification is done via smoke tests:

**`npm run dev` smoke test** — starts without error and prints the bound port to stdout.

**`npm run build` smoke test** — compiles with no TypeScript errors.

**`npm test` smoke test** — runs vitest, finds zero tests, exits successfully (zero tests is acceptable at this stage).

**Config validation smoke tests (manual, run from `02-api-server/`):**

```
PORT=abc npm run dev
  → clear error message printed to stderr, process exits non-zero

PORT=99999 npm run dev
  → clear error message, process exits non-zero

# no env vars (use defaults)
npm run dev
  → server binds to 127.0.0.1:3747 and logs the bound address
```

---

## File: `package.json`

Location: `c:/dev/tools/DevNeural/02-api-server/package.json`

Key requirements:

- `"type": "module"` — the entire project uses ESM. This differs intentionally from `01-data-layer`, which is CommonJS because it is `require()`'d by the Claude Code hook runner. This server is a standalone long-running process, never imported by hooks.
- All runtime and dev dependencies listed below must be installed.

**Scripts:**

| Script | Command |
|--------|---------|
| `start` | `node dist/server.js` |
| `dev` | `tsx --watch src/server.ts` |
| `build` | `tsc` |
| `test` | `vitest run` |

**Runtime dependencies:**

| Package | Purpose |
|---------|---------|
| `fastify` | HTTP server framework |
| `@fastify/websocket` | WebSocket support on the same port as HTTP |
| `@fastify/cors` | CORS headers (required for VS Code webview origin) |
| `chokidar` | File watching (v4 required — ESM-native, normalized events on Windows) |
| `zod` | Runtime schema validation and TypeScript type inference |

**Dev dependencies:**

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `tsx` | ESM-aware TypeScript runner for `npm run dev` |
| `vitest` | Test runner |
| `@types/node` | Node.js type definitions |
| `ws` | Used as a test client in WebSocket integration tests |
| `@types/ws` | Type definitions for `ws` |

---

## File: `tsconfig.json`

Location: `c:/dev/tools/DevNeural/02-api-server/tsconfig.json`

Required settings:

- `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` — required for ESM with Node.js
- `"target": "ES2022"` or later
- `"outDir": "./dist"`
- `"rootDir": "./src"`
- `"strict": true`
- `"esModuleInterop": true`
- Include `src/**/*`, exclude `node_modules` and `dist`

---

## File: `vitest.config.ts`

Location: `c:/dev/tools/DevNeural/02-api-server/vitest.config.ts`

Follow the same pattern as `01-data-layer`. Key settings:

- `test.include`: `["tests/**/*.test.ts"]`
- `test.environment`: `"node"`
- No custom reporters needed at this stage

---

## File: `src/config.ts`

Location: `c:/dev/tools/DevNeural/02-api-server/src/config.ts`

### `ServerConfig` interface

```typescript
interface ServerConfig {
  port: number;           // validated integer, 1–65535
  dataRoot: string;       // path to skill-connections data directory
}
```

### `loadConfig(): ServerConfig`

Reads `process.env.PORT` and `process.env.DEVNEURAL_DATA_ROOT` and returns a validated `ServerConfig`. Defaults:

- `PORT`: `3747`
- `DEVNEURAL_DATA_ROOT`: `C:/dev/data/skill-connections`

The default for `DEVNEURAL_DATA_ROOT` is intentionally machine-specific and Windows-only. Override via env var for portability in other environments or CI.

**Validation rules:**

- `PORT` must parse as an integer (reject floats, NaN, non-numeric strings)
- `PORT` must be in range 1–65535 inclusive
- `DEVNEURAL_DATA_ROOT` must be a non-empty string (the default satisfies this; an empty string override is rejected)

**Fail-fast behavior:** If any validation fails, the function should print a clear human-readable error to `process.stderr` describing which value is invalid and why, then call `process.exit(1)`. The server must never reach the bind step with invalid config.

Example error messages:
- `"Invalid PORT: 'abc' is not a valid integer. Expected 1-65535."`
- `"Invalid PORT: 99999 is out of range. Expected 1-65535."`
- `"Invalid DEVNEURAL_DATA_ROOT: must be a non-empty string."`

---

## File: `src/server.ts`

Location: `c:/dev/tools/DevNeural/02-api-server/src/server.ts`

This is a minimal stub at this stage. The full wiring happens in Section 07. The stub only needs to:

1. Call `loadConfig()` to validate config at startup
2. Create a Fastify instance (with `logger: true` so pino logs the bound address)
3. Register a `GET /health` stub that returns `{ status: 'ok' }` — this verifies the server is up during smoke testing
4. Listen on `127.0.0.1:<config.port>`
5. Log the bound address on successful start

The `listen` call should bind to `127.0.0.1` only, not `0.0.0.0`. The server is a local tool — it should never be reachable from the network.

No `SIGINT` handler yet — that is added in Section 07.

---

## Directory Structure to Create

Create these directories (empty, populated by later sections):

```
c:/dev/tools/DevNeural/02-api-server/
├── src/
│   ├── graph/
│   ├── routes/
│   ├── ws/
│   └── watcher/
└── tests/
    ├── helpers/
    ├── graph/
    ├── routes/
    └── ws/
```

Only `src/config.ts` and `src/server.ts` contain code at the end of this section.

---

## Implementation Notes

**Why ESM here but CommonJS in `01-data-layer`:** chokidar v4 is ESM-only. The API server is a standalone long-running process launched directly via `node` or `tsx` — it is never `require()`'d by any hook script. ESM is the natural choice. `01-data-layer` must remain CommonJS because it is imported synchronously by the Claude Code hook runner.

**Why `tsx --watch` for dev:** `tsx` handles ESM TypeScript without a separate compilation step. The `--watch` flag auto-restarts the server process when any source file changes, making the inner development loop fast.

**Why port 3747:** This is a fixed, stable port. Consumers (VS Code webview, session hook, voice interface) need a known address. No automatic port selection — the server must be reachable at a predictable address. If port 3747 is in use, startup fails with a clear error message from Fastify.

**`127.0.0.1` binding:** The server is a local developer tool. Binding to loopback only prevents any accidental network exposure, which matters because `CORS: origin '*'` is used (safe for localhost, not safe if the server were publicly reachable).

---

## Implementation Notes (Actual)

**Deviations from plan:**

- `vitest.config.ts` adds `passWithNoTests: true` — required in vitest v2.x, which exits code 1 when no test files found. Without this, `npm test` would fail the smoke test.
- `tsconfig.json` omits `declaration: true` and `declarationMap: true` — these fields generate `.d.ts` output which is unnecessary for a standalone server binary that is never imported as a library. `sourceMap: true` retained for debugging.
- `src/config.ts` PORT validation uses regex `!/^\d+$/.test(trimmed)` instead of mixed `Number.isInteger + includes('.')` check — cleaner, handles whitespace-padded values correctly after trim.

**Files created:**
- `02-api-server/package.json`
- `02-api-server/package-lock.json`
- `02-api-server/tsconfig.json`
- `02-api-server/vitest.config.ts`
- `02-api-server/src/config.ts`
- `02-api-server/src/server.ts`
- Directories (empty, not tracked by git): `src/graph/`, `src/routes/`, `src/ws/`, `src/watcher/`, `tests/helpers/`, `tests/graph/`, `tests/routes/`, `tests/ws/`

## Completion Checklist

- [x] `package.json` created with `"type": "module"`, all dependencies, all four scripts
- [x] `npm install` runs without errors
- [x] `tsconfig.json` created with NodeNext module resolution and `strict: true`
- [x] `vitest.config.ts` created
- [x] All subdirectories under `src/` and `tests/` created
- [x] `src/config.ts` implements `ServerConfig` interface and `loadConfig()` with fail-fast validation
- [x] `src/server.ts` stub creates Fastify, calls `loadConfig()`, registers `/health`, binds to `127.0.0.1:<port>`
- [x] `npm run build` exits 0 with no TypeScript errors
- [x] `npm run dev` starts, prints bound address (`http://127.0.0.1:3747`)
- [x] `npm test` exits 0 (zero tests found is acceptable)
- [x] `PORT=abc npm run dev` prints clear error and exits non-zero
- [x] `PORT=99999 npm run dev` prints clear error and exits non-zero
