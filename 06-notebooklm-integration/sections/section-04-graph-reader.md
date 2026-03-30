# Section 04: Graph Reader

## Overview

This section implements `src/session/graph-reader.ts` — the component responsible for querying the DevNeural graph and extracting `GraphInsight[]` for the active project. It tries the 02-api-server REST API first, falls back to reading `weights.json` directly, and returns an empty array (never throws) when both sources fail.

**Depends on:** section-01-setup (project scaffold), section-02-types-config (`ObsidianSyncConfig`, `GraphInsight` types)

**Blocks:** section-08-cli-integration

**Parallelizable with:** section-03-log-reader, section-05-renderer, section-06-generator

---

## Files to Create

- `src/session/graph-reader.ts` — implementation
- `tests/graph-reader.test.ts` — test file (write first)
- `tests/fixtures/sample-weights.json` — fixture file for tests (shared with log-reader tests; may already exist from section-01)

---

## Tests First

**File:** `tests/graph-reader.test.ts`

Write and run these tests before implementing. All tests should initially fail (or the function should be an unimplemented stub). Implement until all pass.

```
# Test: extractGraphInsights calls API endpoint with project ID and returns parsed insights
# Test: extractGraphInsights falls back to reading weights.json when API returns non-200 or fetch throws
# Test: extractGraphInsights matches project edges using both bare ID and 'project:' prefixed ID from weights.json
# Test: extractGraphInsights identifies new_connection insights where first_seen date matches target date
# Test: extractGraphInsights identifies high_weight insights for top 3 edges by weight
# Test: extractGraphInsights identifies weight_milestone insights where last_seen = today AND raw_count in [10, 25, 50, 100]
# Test: extractGraphInsights returns empty array when both API and file read fail (no throw)
# Test: extractGraphInsights produces plain-English description strings for each insight type
```

### Test Setup Notes

- Mock `fetch` using Vitest's `vi.spyOn(global, 'fetch')` or `vi.fn()` assigned to `globalThis.fetch`
- Provide a fixture `tests/fixtures/sample-weights.json` with a few representative edges covering all three insight types
- The fixture should include edges with: `first_seen` = today (for `new_connection`), high `weight` values (for `high_weight`), `last_seen` = today and `raw_count` in `[10, 25, 50, 100]` (for `weight_milestone`)
- The config fixture only needs `api_base_url` and `data_root` fields relevant to this component

### Fixture `sample-weights.json` Shape

The fixture should match the actual weights.json format used by 01-data-layer. Check `C:\dev\data\skill-connections\weights.json` to verify the exact structure. Minimum shape:

```json
{
  "edges": [
    {
      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
      "target_node": "tool:Read",
      "weight": 0.95,
      "raw_count": 50,
      "first_seen": "2026-03-30T00:00:00.000Z",
      "last_seen": "2026-03-30T10:00:00.000Z"
    },
    {
      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
      "target_node": "tool:Write",
      "weight": 0.87,
      "raw_count": 25,
      "first_seen": "2026-02-01T00:00:00.000Z",
      "last_seen": "2026-03-30T09:00:00.000Z"
    },
    {
      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
      "target_node": "skill:typescript",
      "weight": 0.73,
      "raw_count": 10,
      "first_seen": "2026-03-30T00:00:00.000Z",
      "last_seen": "2026-03-30T08:00:00.000Z"
    },
    {
      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
      "target_node": "tool:Bash",
      "weight": 0.55,
      "raw_count": 7,
      "first_seen": "2026-02-15T00:00:00.000Z",
      "last_seen": "2026-03-28T12:00:00.000Z"
    }
  ]
}
```

---

## Implementation: `src/session/graph-reader.ts`

### Function Signature

```typescript
export async function extractGraphInsights(
  projectId: string,
  date: string,           // YYYY-MM-DD, e.g. "2026-03-30"
  config: ObsidianSyncConfig
): Promise<GraphInsight[]>
```

The exported interface is intentionally minimal — one public function, everything else is internal helpers.

### Logic Overview

**Step 1 — Fetch edges for the project**

Try the API first:
```
GET {config.api_base_url}/graph/subgraph?project={projectId}
```

If the response is non-200 or `fetch` throws, fall through to the file fallback. Do not re-throw.

File fallback: read `{config.data_root}/weights.json`, parse as JSON, filter edges where `source_node` or `target_node` matches the project (see prefix handling below).

If the file read also fails, log a warning to stderr and return `[]`.

**Step 2 — Project ID prefix handling**

`weights.json` stores node IDs with `project:` prefix (e.g., `project:github.com/user/DevNeural`). The `projectId` passed in is a bare ID (without prefix). When filtering edges, compare against both forms:

```typescript
const prefixed = 'project:' + projectId;
edge.source_node === projectId || edge.source_node === prefixed ||
edge.target_node === projectId || edge.target_node === prefixed
```

**Step 3 — Classify edges into insights**

Given the filtered edges, produce `GraphInsight[]` covering three types:

**`new_connection`** — edges where `first_seen` date portion equals `date`:
```typescript
edge.first_seen.startsWith(date)   // "2026-03-30T..." starts with "2026-03-30"
```

**`high_weight`** — top 3 edges sorted by `weight` descending. If fewer than 3 edges exist, return all of them. Avoid double-counting edges already classified as `new_connection` — or simply let them appear in multiple insight types (acceptable duplication; note in comments).

**`weight_milestone`** — edges where `last_seen.startsWith(date)` AND `raw_count` is in `[10, 25, 50, 100]`.

Note in a comment that this is an approximation: an edge already at a milestone count that was simply touched again today will appear as a false positive. True milestone detection requires comparing against yesterday's snapshot, which is out of scope.

**Step 4 — Build description strings**

Each `GraphInsight` has a `description` field — a plain-English string. Examples:
- `new_connection`: `"New connection: project:devneural → tool:Bash"`
- `high_weight`: `"Strong connection (weight 0.87): project:devneural → skill:typescript"`
- `weight_milestone`: `"Milestone: project:devneural → tool:Edit reached 25 uses"`

### `GraphInsight` Interface (from `types.ts`)

```typescript
interface GraphInsight {
  type: 'new_connection' | 'high_weight' | 'weight_milestone';
  source_node: string;
  target_node: string;
  weight: number;
  raw_count: number;
  description: string;
}
```

### API Response Shape

The `/graph/subgraph` endpoint returns a `GraphResponse`. The graph-reader only needs the `edges` array from the response. Assume:

```typescript
interface GraphResponse {
  nodes: Array<{ id: string; [key: string]: unknown }>;
  edges: Array<{
    source_node: string;
    target_node: string;
    weight: number;
    raw_count: number;
    first_seen: string;
    last_seen: string;
  }>;
}
```

Parse with `response.json()` and access `.edges`.

### Error Handling

Following the project-wide "never throws for I/O" pattern:

| Operation | On failure |
|-----------|-----------|
| `fetch` call throws | Catch, fall back to file read; warn to stderr |
| API returns non-200 | Fall back to file read; warn to stderr |
| `fs.readFileSync` on weights.json throws | Catch, return `[]`; warn to stderr |
| `JSON.parse` throws | Catch, return `[]`; warn to stderr |

The function must never throw — callers depend on it returning an array (empty is fine).

### Imports Needed

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ObsidianSyncConfig, GraphInsight } from '../types.js';
```

Note the `.js` extension on local imports — required by NodeNext module resolution (TypeScript compiles `.ts` to `.js`, but imports must reference `.js`).

---

## Checking the Real `weights.json` Format

Before writing the fixture, verify the actual format used by `01-data-layer`:

- Real data lives at `C:\dev\data\skill-connections\weights.json`
- Check whether the top-level value is an array or an object with an `edges` key
- The fixture must match the actual format that the fallback code will parse

If the format turns out to be different from what is documented above (e.g., connections keyed by `source||target`), update the fallback parsing logic accordingly and note the discrepancy in a comment.

---

## Implementation Notes

- Files created: `src/session/graph-reader.ts`, `tests/graph-reader.test.ts`, updated `tests/fixtures/sample-weights.json`
- Real weights.json format is `connections` keyed object (not `edges` array) — handled via `Object.values(data.connections)`
- Both API path and file fallback apply client-side project filter (source_node or target_node match)
- All 24 tests pass

## Acceptance Criteria

All 8 tests in `tests/graph-reader.test.ts` pass with `npm test`. Specifically:

1. API path: mock `fetch` returns a valid `GraphResponse`; insights are derived from the response edges
2. Fallback path: `fetch` throws `ECONNREFUSED`; insights are derived from the fixture `weights.json`
3. Prefix matching: edges stored as `project:myproject` are found when `projectId = "myproject"`
4. `new_connection` insight type is correctly identified by `first_seen` date
5. `high_weight` returns at most 3 insights, sorted by weight descending
6. `weight_milestone` uses the round-number heuristic on `raw_count`
7. Both API and file fail → returns `[]`, no throw
8. Description strings are non-empty human-readable text for all three types
