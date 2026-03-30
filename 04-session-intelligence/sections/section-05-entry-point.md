# Section 05: Main Entry Point

## Overview

This section implements `src/session-start.ts`, the compiled hook binary that Claude Code's `SessionStart` hook executes. It wires together the three modules built in sections 02–04: identity resolution, API client, and formatter.

**Depends on:**
- section-01-setup: `package.json`, `tsconfig.json`, `vitest.config.ts`
- section-02-identity: `src/identity.ts` (`resolveProjectIdentity`)
- section-03-api-client: `src/api-client.ts` (`fetchSubgraph`, `GraphResponse`, `ApiClientConfig`)
- section-04-formatter: `src/formatter.ts` (`formatSubgraph`, `FormatterConfig`)

**Blocks:** section-07-integration (integration tests require the compiled binary)

---

## File to Create

`C:\dev\tools\DevNeural\04-session-intelligence\src\session-start.ts`

---

## Tests First

Tests live in `C:\dev\tools\DevNeural\04-session-intelligence\tests\session-start.test.ts`.

All integration tests in this file:
- Compile the binary once in `beforeAll` using `spawnSync('npx', ['tsc'], { cwd: <module-root> })`
- Then invoke the compiled binary with `spawnSync('node', ['dist/session-start.js'], { input: JSON.stringify(payload), env: { ...process.env, DEVNEURAL_API_URL: ... }, cwd: <module-root> })`
- Inspect `stdout`, `stderr`, and `status` (exit code)

The `vitest.config.ts` must set `testTimeout: 15000` (established in section-01) so that the 6-second delay tests do not hit Vitest's default 5-second timeout.

### Test stubs

```typescript
// tests/session-start.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { startMockApiServer } from './helpers.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('session-start integration', () => {
  beforeAll(() => {
    // compile once; all tests share the built binary
    // spawnSync('npx', ['tsc'], ...) — assert status === 0
  });

  it('happy path: project with skills and related projects', async () => {
    // Start mock API server returning a GraphResponse with skill and project edges
    // Spawn dist/session-start.js with DEVNEURAL_API_URL pointing to mock server
    // Expect stdout to contain "DevNeural Context for", a skill label, a weight value, and a use count
    // Expect exit code 0
  });

  it('no connections: project not in graph or all weights below threshold', async () => {
    // Mock server returns { nodes: [], edges: [], updated_at: "..." }
    // Expect stdout to contain "No significant connections"
    // Expect exit code 0
  });

  it('API offline (ECONNREFUSED): port where nothing is listening', async () => {
    // Do NOT start a mock server; point DEVNEURAL_PORT to a random unused port
    // Expect stdout to contain "API offline" and a command hint to start the server
    // Expect exit code 0
  });

  it('API timeout: mock server delays 6 seconds', { timeout: 15000 }, async () => {
    // Mock server delays 6s before responding
    // Expect stdout to contain "API offline"
    // Expect the test to complete within 7s (hook respects 5s AbortSignal timeout)
    // Expect exit code 0
  });

  it('malformed JSON on stdin: silent failure', async () => {
    // Spawn with input "{ not valid json"
    // Expect exit code 0 and empty stdout
  });

  it('CWD with no git: falls back to dirname, still calls API', async () => {
    // Create temp dir, use it as cwd in payload
    // Mock server returns normal GraphResponse
    // Expect exit code 0 (hook runs to completion with fallback identity)
  });

  it('top-10 limit: mock API returns 15 skills, output has exactly 10', async () => {
    // Mock server returns GraphResponse with 15 skill edges from the project
    // Count bullet points (•) in stdout
    // Expect exactly 10
  });

  it('weight filtering: skills with weight 0.5 do not appear', async () => {
    // Mock server returns a skill edge with weight 0.5 and a distinct label
    // Expect that label NOT to appear in stdout
  });
});
```

---

## Implementation

### Interface

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

`main()` is called immediately at the bottom of the file and its rejection is caught:

```typescript
main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(0);
});
```

### Execution Flow

Inside `main()`:

1. **Read stdin** — Collect all stdin chunks into a single string. Use a `for await ... of process.stdin` loop or accumulate `process.stdin` data events. `process.stdin.setEncoding('utf8')` first.

2. **Parse payload** — `JSON.parse(rawStdin)`. Extract `cwd`. If parse throws or `cwd` is missing/falsy, call `process.exit(0)` immediately (silent exit — Claude Code sent an unexpected payload).

3. **Resolve project identity** — `resolveProjectIdentity(cwd)`. This returns `{ id, source }`. The function never throws (falls back to `basename(cwd)` internally).

4. **Fetch subgraph** — `fetchSubgraph(identity.id, apiConfig)`. `fetchSubgraph` is the function from `src/api-client.ts`. Build `apiConfig` from environment:
   - If `process.env.DEVNEURAL_API_URL` is set, use it as `apiUrl`
   - Otherwise, construct `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}` as `apiUrl`
   - `timeoutMs: 5000`

5. **Handle null response** — if `fetchSubgraph` returned `null`, write the offline message to stdout and exit 0:
   ```
   DevNeural: API offline. Start the server with:
     node C:/dev/tools/DevNeural/02-api-server/dist/server.js
   ```
   The path in the offline message should be constructed using `path.resolve(__dirname, '../../02-api-server/dist/server.js')` so it is always correct regardless of where the hook is installed. Use `path.normalize` or forward-slash normalization so the path reads naturally.

6. **Format output** — `formatSubgraph(identity.id, response, formatterConfig)` where:
   ```typescript
   const formatterConfig: FormatterConfig = {
     maxResultsPerType: 10,
     minWeight: 1.0,
   };
   ```

7. **Write to stdout** — `process.stdout.write(output + '\n')`

8. **Exit 0** — `process.exit(0)` (explicit exit prevents any hanging async handles)

### Configuration from Environment

| Variable | Default | Purpose |
|---|---|---|
| `DEVNEURAL_API_URL` | (none) | Full base URL; takes priority over port-based construction |
| `DEVNEURAL_PORT` | `3747` | Used only when `DEVNEURAL_API_URL` is absent |

The URL is constructed once in `main()` before calling `fetchSubgraph`. `DEVNEURAL_API_URL` should be used as-is without appending anything (the subgraph path is added inside `fetchSubgraph`).

### Error Handling Guarantee

The top-level `.catch()` handler ensures:
- Any uncaught async error is written to `stderr` (not `stdout` — Claude only reads stdout for hook output)
- `process.exit(0)` is always called, never with a non-zero code

This guarantees the hook **never degrades the Claude Code session** regardless of what fails internally.

### Imports

```typescript
import { resolveProjectIdentity } from './identity.js';
import { fetchSubgraph } from './api-client.js';
import { formatSubgraph } from './formatter.js';
import * as path from 'node:path';
```

The `FormatterConfig` and `ApiClientConfig` types can be inlined as object literals or imported depending on how those modules export them.

---

## Key Design Constraints

- **Never exits non-zero.** Even unexpected errors go to `process.stderr` and then `process.exit(0)`.
- **Never blocks.** The 5-second `AbortSignal.timeout` inside `fetchSubgraph` is the only possible delay. The rest of the execution is effectively instantaneous.
- **stdout is for Claude context only.** The formatted output or the offline message is written to stdout. All diagnostic/error content goes to stderr so it doesn't pollute Claude's context.
- **Silent on bad payload.** If stdin is empty or not valid JSON, exit 0 without writing anything to stdout. Claude Code occasionally fires hooks with minimal payloads during early startup.

---

## Relation to Other Modules

- `src/identity.ts` (section-02): provides `resolveProjectIdentity`. Import from `./identity.js`.
- `src/api-client.ts` (section-03): provides `fetchSubgraph`. The subgraph endpoint path (`/graph/subgraph?project=<id>`) is constructed inside `fetchSubgraph` — the entry point only passes the base URL.
- `src/formatter.ts` (section-04): provides `formatSubgraph`. The entry point passes `identity.id`, the `GraphResponse`, and the config object.
- `tests/helpers.ts` (section-07): provides `startMockApiServer` and `createTempDir`/`removeTempDir` used by the integration tests above.

---

## Checklist

- [ ] Create `src/session-start.ts` with `HookPayload` interface and `main()` function
- [ ] `main()` reads stdin fully before parsing
- [ ] `main()` silently exits 0 on JSON parse failure or missing `cwd`
- [ ] `main()` constructs API URL from `DEVNEURAL_API_URL` or `DEVNEURAL_PORT`
- [ ] `main()` writes offline message to stdout when `fetchSubgraph` returns null
- [ ] `main()` calls `formatSubgraph` with `maxResultsPerType: 10` and `minWeight: 1.0`
- [ ] `main()` ends with explicit `process.exit(0)`
- [ ] Top-level `.catch()` writes error to stderr and exits 0
- [ ] Write test stubs in `tests/session-start.test.ts`
- [ ] Verify `npm run build` compiles without errors
- [ ] Verify test stubs fail (red) before implementation, pass (green) after
