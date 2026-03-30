# Section 07: Formatter

## Overview

This section implements the response formatting layer for `05-voice-interface`. It produces two output artifacts:

- `05-voice-interface/src/formatter/response.ts` — converts raw API responses into plain readable sentences for the Claude chat window
- `05-voice-interface/src/formatter/orb-events.ts` — maps intents and API results to `voice:*` WebSocket events posted to the 02-api-server

**Depends on:** section-06-routing (provides `IntentResult`, routing types, and the `fetchWithTimeout` pattern)

**Blocks:** section-08-entry-point

Tests run in `05-voice-interface/` using Vitest.

---

## Background and Context

### What the formatter receives

After the routing layer executes the API call(s) for a given intent, the formatter receives:

- The resolved `IntentResult` (intent name, confidence, entities)
- The raw API response body from 02-api-server (edge list, node object, or full graph object — depending on the endpoint called)
- A `hedging` boolean flag from the parser pipeline indicating whether to prefix the response

The formatter's job is to produce a `VoiceResponse` (from `src/intent/types.ts`):

```typescript
interface VoiceResponse {
  text: string;
  orbEvent?: {
    type: "voice:focus" | "voice:highlight" | "voice:clear";
    payload: unknown;
  };
}
```

### Key constraints

**No markdown in text output.** Do not use `**bold**`, `# headers`, backticks, or bullet characters. The output is read in the Claude chat window and potentially aloud.

**1–3 sentences for simple queries; up to 5 sentences for list results.** No paragraphs.

**Raw node IDs must not appear in output.** Extract labels from node objects where available. Fall back to parsing the suffix of the ID: `project:github.com/mcollins/DevNeural` → `DevNeural`, `skill:typescript` → `typescript`.

**Confidence hedging.** When `hedging === true`, prefix text with: `I think you're asking about [intent label]. `

**Dynamic error path.** Use `path.resolve(__dirname, '../../02-api-server/dist/server.js')` — not a hardcoded absolute path.

### 02-api-server response shapes

- `GET /graph/top?limit=100` → array of edge objects: `{ source, target, weight, connection_type? }`
- `GET /graph/subgraph?project={id}` → `{ nodes: [...], edges: [...] }`
- `GET /graph/node/{id}` → `{ node: { id, label?, type, stage? }, edges: [...] }`
- `GET /graph` → `{ nodes: [...], edges: [...] }`

---

## Files to Create

```
05-voice-interface/src/formatter/response.ts
05-voice-interface/src/formatter/orb-events.ts
05-voice-interface/tests/formatter/response.test.ts
05-voice-interface/tests/formatter/orb-events.test.ts
```

---

## Tests First

### `tests/formatter/response.test.ts`

```typescript
// formatResponse with intent=get_top_skills and a real-shaped edges array
//   → output contains no markdown characters (**/#/`/bullets)
//   → output contains skill names (not raw node IDs like 'skill:typescript')

// formatResponse with intent=get_top_skills and edges array that has no skill edges
//   → returns "I didn't find any skill connections in your graph."

// formatResponse with intent=get_top_skills, tool->skill edges present
//   → skill on the target side of a tool->skill edge is included in results

// formatResponse with intent=get_stages, no stageFilter entity
//   → output groups projects by stage; nodes without stage appear under "untracked"

// formatResponse with intent=get_stages, stageFilter='alpha'
//   → output mentions only alpha projects

// formatResponse with null apiResult (API unavailable)
//   → output contains "isn't running"
//   → output contains "node " followed by a path string (not a hardcoded absolute path)

// formatResponse with empty result set
//   → "I didn't find any connections matching that query."

// formatResponse with hedging=true
//   → output starts with "I think you're asking about"

// formatResponse for any intent
//   → output contains no raw node IDs matching /[a-z]+:[a-z0-9./-]+/
//   → sentence count ≤ 5

// formatResponse with intent=get_context and a subgraph response
//   → output mentions connection counts, no markdown
```

Representative test fixtures to use inline:

```typescript
const edges = [
  { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2, connection_type: 'project->skill' },
  { source: 'tool:vim', target: 'skill:typescript', weight: 3.1, connection_type: 'tool->skill' },
  { source: 'project:github.com/user/BridgeDB', target: 'skill:python', weight: 6.0, connection_type: 'project->skill' },
];

const graph = {
  nodes: [
    { id: 'project:github.com/user/Alpha1', label: 'Alpha1', type: 'project', stage: 'alpha' },
    { id: 'project:github.com/user/Deployed1', label: 'Deployed1', type: 'project', stage: 'deployed' },
    { id: 'project:github.com/user/NoStage', label: 'NoStage', type: 'project' },
  ],
  edges: []
};
```

### `tests/formatter/orb-events.test.ts`

```typescript
// sendOrbEvents with intent=get_context and a valid subgraph result
//   → POST called twice (verify mock call count)
//   → first POST body has type='voice:focus'
//   → second POST body has type='voice:highlight'

// sendOrbEvents with intent=get_top_skills and skill edges
//   → POST called once with type='voice:highlight' and nodeIds array of skill IDs

// sendOrbEvents with intent=get_connections, named entity resolved
//   → POST called once with type='voice:focus'

// sendOrbEvents with intent=get_stages and matching project IDs
//   → POST called once with type='voice:highlight' and matching nodeIds

// sendOrbEvents with intent=unknown
//   → POST called once with type='voice:clear' and empty payload

// sendOrbEvents with empty API result (no matching nodes)
//   → POST called with type='voice:highlight' and nodeIds=[]
//   → does NOT send voice:clear directly

// sendOrbEvents when POST fails (network error, API not running)
//   → function resolves without throwing
//   → no unhandled rejection

// sendOrbEvents with intent=get_context — focus fires before highlight (verify call order)
```

Mock `fetch` at module level using `vi.stubGlobal('fetch', vi.fn())`. Verify POST bodies by inspecting `mockFetch.mock.calls[N][1].body`.

---

## Implementation: `src/formatter/response.ts`

Export a single function:

```typescript
export function formatResponse(
  intent: IntentResult,
  apiResult: unknown,    // raw response body; null = API unavailable
  hedging: boolean
): string
```

Internal helpers (not exported but tested via `formatResponse`):

**`extractLabel(nodeId: string): string`**
- Split on `:`, take everything after the first colon
- Split on `/` and take the last segment
- Capitalize first letter
- Examples: `skill:typescript` → `Typescript`, `project:github.com/user/DevNeural` → `DevNeural`

**`formatTopSkills(edges, limit)`**
1. Filter to edges where `target` starts with `skill:` OR `source` starts with `skill:`
2. Include both `project->skill` and `tool->skill` edge types
3. Collect skill node IDs from filtered edges (skill is on the target side for well-formed data)
4. Sum weights per skill node ID
5. Sort descending by weight sum, take top `limit` (default 5)
6. Format: "Your top skills are TypeScript, Python, and Node.js."

**`formatSubgraph(subgraph, projectId)`**
Counts edges in the subgraph and formats: "DevNeural connects to 12 skills and 4 tools."

**`formatNode(nodeResult)`**
Formats a single node's connections: "TypeScript is connected to 7 projects."

**`formatStages(graph, stageFilter?)`**
- With filter: "You have 3 alpha projects: DevNeural, BridgeDB, and SkillMap."
- Without filter: one sentence per stage group (up to 5 sentences total). Nodes without `stage` field appear under "untracked".
- If result count exceeds 5 sentences, truncate and add "and N more."

**API unavailable path:**
```typescript
import path from 'path';
const serverPath = path.resolve(__dirname, '../../02-api-server/dist/server.js');
return `The DevNeural graph isn't running. Start it with: node ${serverPath}`;
```

**Hedging prefix map:**

| Intent | Label phrase |
|--------|-------------|
| `get_context` | `your current context` |
| `get_top_skills` | `your top skills` |
| `get_connections` | `connections` |
| `get_node` | `a specific node` |
| `get_stages` | `project stages` |
| `unknown` | (no prefix) |

---

## Implementation: `src/formatter/orb-events.ts`

Export a single async function:

```typescript
export async function sendOrbEvents(
  intent: IntentResult,
  apiResult: unknown
): Promise<void>
```

The function never throws. All errors from HTTP POSTs are swallowed.

Intent-to-event mapping:

| Intent | Events sent (in order) |
|--------|------------------------|
| `get_context` | 1. `voice:focus` with current project node ID; 2. `voice:highlight` with all adjacent node IDs |
| `get_top_skills` | `voice:highlight` with top-N skill node IDs |
| `get_connections` | `voice:focus` with the resolved target node ID |
| `get_node` | `voice:focus` with the resolved node ID |
| `get_stages` | `voice:highlight` with all matching project node IDs |
| `unknown` | `voice:clear` with `{}` payload |

**Protocol invariant:** `voice:highlight` with `nodeIds: []` is sent when the result set is empty — do NOT send `voice:clear` explicitly in this case. The orb client handles empty arrays as a reset.

**`get_context` ordering:** `voice:focus` POST must complete (or fail) before `voice:highlight` is sent. Use sequential awaits — not `Promise.all`.

POST body format:
```json
{ "type": "voice:focus", "payload": { "nodeId": "project:github.com/..." } }
```

Use native `fetch` (Node 18+) or follow 04-session-intelligence's HTTP pattern. POST to `http://localhost:3747/voice/command`.

---

## Checklist

1. Create `tests/formatter/response.test.ts` with all stubs (failing)
2. Create `tests/formatter/orb-events.test.ts` with all stubs (failing)
3. Implement `src/formatter/response.ts`
4. Implement `src/formatter/orb-events.ts`
5. Run `npm test` in `05-voice-interface/` — all formatter tests pass
6. No existing tests broken

## Implementation Notes

**Files created:**
- `05-voice-interface/src/formatter/response.ts` — `formatResponse(intent, apiResult, hedging): string`
- `05-voice-interface/src/formatter/orb-events.ts` — `sendOrbEvents(intent, apiResult): Promise<void>`
- `05-voice-interface/tests/formatter/response.test.ts` — 17 tests
- `05-voice-interface/tests/formatter/orb-events.test.ts` — 10 tests

**Deviations from plan:**
- `serverPath` uses `'../../../02-api-server/dist/server.js'` (3 levels up from `src/formatter/`) rather than the `'../../...'` in the spec — correct path to reach `DevNeural/02-api-server` from `dist/formatter/` when compiled.
- `get_context` in orb-events: `voice:focus` is skipped when no project node found (guard added via code review) to avoid sending `{ nodeId: '' }`.
- `get_top_skills` in orb-events: filter checks both `source` and `target` for `skill:` prefix (aligned with response.ts behavior, found in code review).
- `HEDGING_LABELS` typed as `Partial<Record<IntentName, string>>` for type safety.
- Added `joinList([])` guard to return `''` rather than `'undefined'`.
- Added 3 extra tests beyond the original spec: `get_node` (2 tests), `hedging+unknown` (1 test).

**Final test count:** 93 total (27 formatter, 66 existing)
