# Section 06: Routing — Intent to API Endpoint

## Overview

This section implements the routing layer for the 05-voice-interface split. It translates a parsed `IntentResult` into the HTTP request(s) needed to query the 02-api-server REST API, and provides a resilient HTTP client that returns `null` on any failure rather than throwing.

**Dependencies:**
- section-02-voice-foundation must be complete: provides the `IntentResult` type in `src/intent/types.ts` and the project scaffold
- section-01-api-extensions must be complete: the 02-api-server must be running and accepting the required endpoints

**Blocks:** section-07-formatter (formatter consumes the API responses produced by this routing layer)

**Parallelizable with:** section-03-local-parser and section-04-haiku-parser

**Test directory:** `05-voice-interface/`

---

## Files to Create

```
05-voice-interface/src/routing/intent-map.ts
05-voice-interface/src/routing/api-client.ts
05-voice-interface/tests/routing/intent-map.test.ts
```

---

## Tests First

Write these tests in `05-voice-interface/tests/routing/intent-map.test.ts` before implementing. All tests use Vitest. Mock `fetch` using `vi.stubGlobal('fetch', vi.fn())` — no real HTTP calls in unit tests.

```typescript
// Test: get_context → executeIntentRequest() returns result from /graph/subgraph?project={resolvedProjectId}
// Test: get_top_skills → request made to '/graph/top?limit=100' regardless of entities.limit
// Test: get_top_skills with entities.limit=5 → path still ends with 'limit=100' (client-side filter)
// Test: get_connections with entities.nodeName present → two fetches made:
//         first GET /graph (full graph), then GET /graph/node/{resolvedId}
// Test: get_connections without entities.nodeName → request path '/graph/subgraph?project={resolvedProjectId}'
// Test: get_node → two fetches: GET /graph then GET /graph/node/{resolvedId}
// Test: get_stages → request made to '/graph' (full graph fetch)
// Test: unknown intent → returns null (no API call)
// Test: resolveLabel('myproject', nodes) — graph nodes [{ id: 'project:github.com/user/repo', label: 'MyProject' }]
//         → returns 'project:github.com/user/repo' (case-insensitive)
// Test: resolveLabel — no match → returns null
// Test: resolveLabel — multiple partial matches, one exact match →
//         returns the exact match, not the partial
// Test: nodeName with URL-reserved characters → encoded correctly in the resolved node ID path
// Test: fetchWithTimeout() → returns null on network failure (mock fetch to reject)
// Test: fetchWithTimeout() → returns null on non-200 response
// Test: fetchWithTimeout() → returns null on AbortSignal timeout expiry
// Test: fetchWithTimeout() → returns parsed JSON body on 200 response
```

---

## Implementation: `src/routing/api-client.ts`

This module is the HTTP client shared by all routing calls. It follows the same pattern as `04-session-intelligence/src/api-client.ts`.

**Design rules:**
- A single exported `fetchWithTimeout(url, timeoutMs?)` function that returns `Promise<unknown | null>`
- Default timeout is 5000ms
- Uses `AbortSignal.timeout(timeoutMs)` for timeout management
- Returns `null` on any error: network failure, non-200 status, timeout, JSON parse error
- Never throws; all code paths return `T | null`

The API base URL defaults to `http://localhost:3747`. Overridable via `DEVNEURAL_API_URL` or `DEVNEURAL_PORT` env var (check how 04-session-intelligence reads these and follow the same pattern).

```typescript
export interface ApiClientConfig {
  apiUrl: string;
  timeoutMs: number;
}

export function buildApiConfig(): ApiClientConfig { /* reads env vars */ }

export async function fetchWithTimeout(
  url: string,
  timeoutMs?: number,
): Promise<unknown | null> { /* returns null on any error */ }
```

Declare `GraphNode`, `GraphEdge`, and `GraphResponse` interfaces in this file (do not import cross-split):

```typescript
export interface GraphNode {
  id: string;
  label?: string;
  type: string;
  stage?: string;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  weight: number;
  connection_type?: string;
}

export interface GraphResponse {
  nodes?: GraphNode[];
  edges: GraphEdge[];
  updated_at?: string;
}
```

---

## Implementation: `src/routing/intent-map.ts`

This is a pure mapping module. It takes an `IntentResult` and a resolved project ID and returns the API result.

### Core Export

```typescript
export async function executeIntentRequest(
  intent: IntentResult,
  projectId: string,
  config: ApiClientConfig,
): Promise<IntentApiResult | null>
```

Where:

```typescript
export interface IntentApiResult {
  intent: IntentName;
  data: unknown;              // raw JSON response from the API
  resolvedNodeId?: string;    // set when a named entity was resolved to a node ID
  entities: IntentResult['entities'];
}
```

### Intent-to-Endpoint Mapping

**`get_context`**
Single request: `GET /graph/subgraph?project={projectId}`. URL-encode the projectId.

**`get_top_skills`**
Single request: `GET /graph/top?limit=100`. Always use limit=100 regardless of `entities.limit` — the formatter filters client-side.

**`get_connections`**
- If `entities.nodeName` is set: two-request flow — `GET /graph` → `resolveLabel(nodeName, nodes)` → `GET /graph/node/{resolvedNodeId}`. If label resolution returns null, return null.
- If no `nodeName`: `GET /graph/subgraph?project={projectId}`

**`get_node`**
Always requires `entities.nodeName`. Two-request flow: `GET /graph` → `resolveLabel(nodeName, nodes)` → `GET /graph/node/{resolvedNodeId}`. If `nodeName` absent or label resolution fails, return null.

**`get_stages`**
Single request: `GET /graph` (full graph). Formatter filters and groups by `node.stage` client-side.

**`unknown`**
Return null immediately.

### Label Resolution Helper

```typescript
export function resolveLabel(
  name: string,
  nodes: GraphNode[],
): string | null
```

- Lowercase `name` and compare against `node.label?.toLowerCase()`
- Exact match wins; return `node.id` for the matched node
- If no match, return null
- Pure and synchronous — exported for direct testing

**Important:** The `/graph/node/:id` endpoint expects the full raw node ID with `encodeURIComponent()` applied in the URL path. Apply encoding after label resolution.

---

## Context: Available 02-api-server Endpoints

(Established in section-01)

| Endpoint | Returns |
|----------|---------|
| `GET /graph` | Full `{ nodes, edges, updated_at }` |
| `GET /graph/top?limit=N` | Top N edges by weight |
| `GET /graph/subgraph?project={id}` | Nodes and edges adjacent to the project |
| `GET /graph/node/{id}` | Single node with its connections |
| `POST /voice/command` | Broadcast a voice WebSocket event |

---

## Checklist

- [ ] Write all tests in `tests/routing/intent-map.test.ts` (all failing first)
- [ ] Create `src/routing/api-client.ts` with `fetchWithTimeout`, `buildApiConfig`, and graph type interfaces
- [ ] Create `src/routing/intent-map.ts` with `executeIntentRequest`, `resolveLabel`, and `IntentApiResult`
- [ ] All 6 intent cases handled in `executeIntentRequest`
- [ ] `fetchWithTimeout` returns null on network failure, timeout, and non-200 status
- [ ] `resolveLabel` is case-insensitive and exported for direct testing
- [ ] `npm test` passes in `05-voice-interface/`
