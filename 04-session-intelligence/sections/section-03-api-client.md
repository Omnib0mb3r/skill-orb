# Section 03: API Client

## Overview

This section implements `src/api-client.ts` — a single-file HTTP client that queries the DevNeural REST API for a project's subgraph. It is a self-contained module with no side effects; all results are returned as typed values. Any error condition returns `null` rather than throwing.

**Depends on:** section-01-setup (package.json, tsconfig.json must exist before this file can compile).

**Blocks:** section-05-entry-point (the main entry point imports and calls `fetchSubgraph`).

---

## Files to Create

```
C:\dev\tools\DevNeural\04-session-intelligence\src\api-client.ts
C:\dev\tools\DevNeural\04-session-intelligence\tests\api-client.test.ts
```

---

## Tests First

Write `tests/api-client.test.ts` before implementing `src/api-client.ts`. All tests use a minimal `node:http` mock server — no Fastify, no external HTTP libraries.

The test file should cover these seven cases:

1. **Successful response** — mock server returns a well-formed `GraphResponse` JSON body with nodes and edges. Assert that `fetchSubgraph` returns a parsed object with a `nodes` array and an `edges` array.

2. **Server offline (ECONNREFUSED)** — call `fetchSubgraph` on a port where nothing is listening. Assert that the return value is `null`.

3. **5-second timeout** — mock server accepts the connection but delays 6 seconds before sending any response. Assert that `fetchSubgraph` returns `null` within approximately 5.5 seconds. This test **must** set `{ timeout: 15000 }` in the test options (Vitest's default is 5 seconds, which would cause the test itself to fail before the client timeout fires).

4. **Empty graph response** — mock server returns `{ nodes: [], edges: [], updated_at: "2024-01-01T00:00:00Z" }` with HTTP 200. Assert that `fetchSubgraph` returns the empty `GraphResponse` object (not `null` — an empty graph is a valid successful response).

5. **Malformed JSON** — mock server returns `{invalid json` as the body with HTTP 200. Assert that `fetchSubgraph` returns `null`.

6. **`DEVNEURAL_API_URL` env var overrides `DEVNEURAL_PORT`** — start a mock server on a specific port, set `DEVNEURAL_API_URL` to `http://localhost:<that_port>`, set `DEVNEURAL_PORT` to a different port. Assert that `fetchSubgraph` hits the correct server (the one pointed to by `DEVNEURAL_API_URL`).

7. **`DEVNEURAL_PORT` default** — call `fetchSubgraph` with neither env var set while no server is running on port 3747. Assert that the function attempts port 3747 (observable because the return is `null` with ECONNREFUSED rather than an exception).

### Mock Server Helper

The `helpers.ts` file (shared across test files) provides `startMockApiServer`. For now, you may define a local inline helper in `api-client.test.ts` if `helpers.ts` does not yet exist; it will be consolidated in section-07-integration. The helper must:

- Start a `node:http.createServer` on a random available port (pass `0` to `listen` and read back `server.address().port`)
- Accept a `responses` map or a handler function so individual tests can control what the server returns
- Return `{ port, stop }` where `stop()` calls `server.close()`
- For the delay test: accept a configurable delay before writing the response

### Test Stubs (signatures only)

```typescript
// tests/api-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { fetchSubgraph } from '../src/api-client.js';

describe('fetchSubgraph', () => {
  it('returns parsed GraphResponse on success', async () => { /* ... */ });
  it('returns null when server is offline (ECONNREFUSED)', async () => { /* ... */ });
  it('returns null when server delays 6 seconds (timeout)', { timeout: 15000 }, async () => { /* ... */ });
  it('returns empty GraphResponse (not null) for empty graph', async () => { /* ... */ });
  it('returns null when server returns malformed JSON', async () => { /* ... */ });
  it('uses DEVNEURAL_API_URL when set, ignoring DEVNEURAL_PORT', async () => { /* ... */ });
  it('defaults to port 3747 when no env vars are set', async () => { /* ... */ });
});
```

---

## Implementation

### Types

Define these interfaces in `src/api-client.ts` (not in a shared types file — they are local to this module and re-exported for use by other modules in this package):

```typescript
export interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  raw_count: number;
  weight: number;  // [0.0, 10.0]
  first_seen: string;
  last_seen: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

export interface ApiClientConfig {
  apiUrl: string;    // full base URL, e.g. "http://localhost:3747"
  timeoutMs: number; // milliseconds before aborting; default 5000
}
```

### Function Signature

```typescript
export async function fetchSubgraph(
  projectId: string,
  config: ApiClientConfig,
): Promise<GraphResponse | null>
```

### URL Construction

The URL is `${config.apiUrl}/graph/subgraph?project=${encodeURIComponent(projectId)}`.

The caller (section-05-entry-point) is responsible for constructing `config.apiUrl` from environment variables. However, for the env-var tests to work, `api-client.ts` must also export a helper that builds the config from the environment:

```typescript
export function buildApiConfig(): ApiClientConfig
```

This function:
- Returns `{ apiUrl: process.env.DEVNEURAL_API_URL, timeoutMs: 5000 }` if `DEVNEURAL_API_URL` is set
- Otherwise returns `{ apiUrl: `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}`, timeoutMs: 5000 }`

### Fetch Implementation

Use Node.js built-in `fetch` (available since Node 18, which is the minimum for Claude Code hooks). Do not import `node-fetch` or any third-party HTTP library.

Timeout handling: pass `signal: AbortSignal.timeout(config.timeoutMs)` in the `fetch` options. This is the cleanest approach — no manual `AbortController` setup required.

On any thrown error (network error, `AbortError` from timeout, etc.), catch and return `null`.

On a non-OK HTTP status, return `null` (defensive — the real API always returns 200 or 404; treat 404 as `null`).

On a successful response, call `.json()` and return the result cast to `GraphResponse`. If `.json()` throws (malformed body), catch and return `null`.

The entire function body should be wrapped in a single `try/catch` that returns `null` on any error:

```typescript
export async function fetchSubgraph(
  projectId: string,
  config: ApiClientConfig,
): Promise<GraphResponse | null> {
  try {
    const url = `${config.apiUrl}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json() as GraphResponse;
    return data;
  } catch {
    return null;
  }
}
```

---

## Key Design Decisions

**Why `fetch` instead of `node:http`?** The `fetch` API with `AbortSignal.timeout` is the simplest correct implementation. `node:http` requires manual response body assembly and timeout management. Node 18+ (required by Claude Code) makes `fetch` available globally.

**Why return `null` for all errors?** The caller (main entry point) must treat "API offline" and "API error" identically: output a fallback message and exit 0. A single `null` sentinel is unambiguous and prevents error-type leakage into the formatter.

**Why is `buildApiConfig` exported?** Tests that verify env-var precedence need to call the function that actually reads `process.env`. Exporting `buildApiConfig` lets tests set `process.env.DEVNEURAL_API_URL` before calling it, without having to spawn a subprocess.

**Empty graph is not `null`.** An HTTP 200 response with `{ nodes: [], edges: [] }` means the project exists in the graph but has no connections yet. The formatter handles this case by outputting "No significant connections found". Returning the empty object (not `null`) preserves this distinction — `null` means "could not reach the API".

---

## Dependencies

- **Node.js built-ins only:** `fetch` (global, Node 18+). No imports from `node:http`, `node:https`, or any third-party package.
- **No dependency on other sections** at runtime. The `ApiClientConfig` is constructed by the caller; this module does not read env vars directly except through `buildApiConfig`.

---

## Acceptance Criteria

All seven tests in `tests/api-client.test.ts` pass. The module compiles without TypeScript errors (`tsc --noEmit`). No test modifies global state or leaves a server running after the test suite finishes (use `afterEach` to call `stop()` on any started mock server).
