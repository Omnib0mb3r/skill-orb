# TDD Plan: 03-web-app + 05-voice-interface

Mirrors `claude-plan.md` section structure. For each implementation section, defines the test stubs to write BEFORE implementing that section. All tests use Vitest (`vitest.config.ts`, `environment: 'node'`). Three.js tests use `vi.mock('three')`.

---

## 02-api-server Extensions

### New WebSocket Event Types (ServerMessage Schema)

```typescript
// Test: ServerMessageSchema.parse() accepts { type: 'voice:focus', payload: { nodeId: 'project:foo' } }
// Test: ServerMessageSchema.parse() accepts { type: 'voice:highlight', payload: { nodeIds: ['project:foo', 'skill:bar'] } }
// Test: ServerMessageSchema.parse() accepts { type: 'voice:clear', payload: {} }
// Test: ServerMessageSchema.parse() throws on { type: 'voice:unknown', payload: {} } (not in union)
// Test: broadcast() called with voice:focus event — emits to all connected WS clients
```

### New REST Endpoint: POST /voice/command

```typescript
// Test: POST /voice/command { type: 'voice:focus', payload: { nodeId: 'x' } } → 200, broadcast called with event
// Test: POST /voice/command { type: 'voice:highlight', payload: { nodeIds: [] } } → 200
// Test: POST /voice/command { type: 'voice:clear', payload: {} } → 200
// Test: POST /voice/command { type: 'voice:invalid', payload: {} } → 400 with error message
// Test: POST /voice/command {} (missing type) → 400
// Test: POST /voice/command { type: 'graph:snapshot', payload: {} } → 400 (allowlist enforced)
```

---

## Part 1: 05-voice-interface

### Types

No runtime tests — types are compile-time guarantees. The TypeScript compiler enforces these. Write a `types.test.ts` that imports the types and verifies they are exported:

```typescript
// Test: IntentResult has all required fields (compile-time — tscheck passes)
// Test: VoiceResponse.orbEvent is optional (undefined acceptable)
// Test: confidence is typed as number not string (tscheck)
```

### NL Intent Parsing — Local Fast-Path

```typescript
// Test: keyword fast-path — "what skills am I using most" → intent: 'get_top_skills', confidence: 0.95, source: 'local'
// Test: keyword fast-path — "what's my current context" → intent: 'get_context', confidence ≥ 0.90, source: 'local'
// Test: keyword fast-path — "show me alpha projects" → intent: 'get_stages', confidence ≥ 0.90, source: 'local'
// Test: ambiguous keywords ("what's connected to my current project") → does NOT return fast-path result, defers to classifier
// Test: BayesClassifier — "list top skills" → intent: 'get_top_skills', confidence ≥ 0.75
// Test: BayesClassifier — "what tools does DevNeural use" → intent: 'get_connections' or 'get_node'
// Test: BayesClassifier — completely unrelated input ("what's the weather") → confidence < 0.75 (defers to Haiku)
// Test: normalizeConfidence() — log-prob array → float in 0.0–1.0 range (softmax over top-2)
// Test: normalizeConfidence() — top-2 log-probs close together → confidence near 0.5
// Test: normalizeConfidence() — top-1 log-prob much larger → confidence near 1.0
```

### NL Intent Parsing — Haiku Fallback

```typescript
// Test: haiku-parser calls Anthropic SDK with correct model ('claude-haiku-4-5') and max_tokens (256)
// Test: haiku-parser returns IntentResult matching the Zod schema shape
// Test: haiku-parser returns { intent: 'unknown', confidence: 0, source: 'haiku' } on API network failure
// Test: haiku-parser returns { intent: 'unknown', confidence: 0, source: 'haiku' } on API 429 (quota)
// Test: haiku-parser — mock Haiku returning intent: 'get_top_skills' → passes through correctly
// Test: haiku-parser — Zod schema enforces that confidence is a number between 0 and 1
```

### NL Intent Parsing — Orchestrated Pipeline (parser.ts)

```typescript
// Test: local confidence ≥ 0.75 → Haiku is NOT called; local result returned
// Test: local confidence < 0.75 → Haiku IS called (mock haiku-parser)
// Test: local returns 'unknown' → Haiku called
// Test: final confidence < 0.60 → { intent: 'unknown', confidence, source } with clarification flag
// Test: final confidence 0.60–0.85 → result with hedging flag set
// Test: final confidence ≥ 0.85 → result with no hedging flag
// Test: Haiku unreachable (network error) → returns { intent: 'unknown', confidence: 0, source: 'haiku' } with unreachable=true flag
```

### Routing: Intent to API Endpoint

```typescript
// Test: get_context → request config has url: '/graph/subgraph?project={resolvedProjectId}'
// Test: get_top_skills → request config has url: '/graph/top?limit=100'
// Test: get_top_skills with entities.limit=5 → still fetches limit=100 (impl filters client-side)
// Test: get_connections with entities.nodeName present → two requests: GET /graph then GET /graph/node/{resolvedId}
// Test: get_connections without entities.nodeName → request config has url: '/graph/subgraph?project={resolvedProjectId}'
// Test: get_node → request config triggers graph fetch first for label resolution
// Test: get_stages → request config has url: '/graph' (full graph fetch)
// Test: unknown → returns null (no request config)
// Test: nodeName URL encoding — 'my project' → '%2F' etc. handled correctly in resolved node ID
```

### Project Identity Resolution

```typescript
// Test: identity/index.ts re-exports resolveProjectId from 01-data-layer (import succeeds, function exists)
// Test: label-to-node-ID resolution — graph with node { id: 'project:github.com/user/repo', label: 'MyProject' } → 'DevNeural' case-insensitive match returns full ID
// Test: label-to-node-ID resolution — no match → returns null
// Test: label-to-node-ID resolution — multiple partial matches → returns first exact match or null if ambiguous
```

### Response Formatting

```typescript
// Test: subgraph response → readable text, no markdown characters (**/#/`/bullets)
// Test: top-N edges response → filters to skill edges only, formats top-N skill names
// Test: top-N filter with tool->skill edges → skill on target side included
// Test: top-N filter — empty after filtering → "I didn't find any skill connections in your graph."
// Test: stages response → project nodes grouped by stage, 'untracked' group for nodes without stage
// Test: empty result → "I didn't find any connections matching that query."
// Test: API unavailable → message contains dynamically resolved path, not hardcoded absolute path
// Test: confidence hedging — confidence 0.60–0.85 → response prefixed with "I think you're asking about..."
// Test: formatter output — max 5 sentences for list results
// Test: response contains no raw node IDs (e.g., 'project:github.com/...' not in output text)
```

### Orb Event Generation

```typescript
// Test: get_context → two orb events: [{ type: 'voice:focus', payload: { nodeId: ... } }, { type: 'voice:highlight', payload: { nodeIds: [...] } }]
// Test: get_top_skills → [{ type: 'voice:highlight', payload: { nodeIds: topSkillNodeIds } }]
// Test: get_connections with named entity → [{ type: 'voice:focus', payload: { nodeId: resolvedId } }]
// Test: get_stages → [{ type: 'voice:highlight', payload: { nodeIds: stageProjectIds } }]
// Test: unknown intent → [{ type: 'voice:clear', payload: {} }]
// Test: empty result set → [{ type: 'voice:highlight', payload: { nodeIds: [] } }] (triggers voice:clear on client per protocol)
// Test: orb events are POSTed to http://localhost:3747/voice/command (mock fetch, verify call count and body)
// Test: POST failure (API not running) → error is swallowed, text response still returned
// Test: get_context POSTs in correct order — focus first, then highlight
```

### Entry Point

```typescript
// Integration test (subprocess): node dist/index.js "what skills am I using most?"
//   → stdout contains readable text without markdown
//   → exit code 0

// Integration test: node dist/index.js "" (empty query)
//   → stdout contains clarification message
//   → exit code 0 (never crashes)

// Integration test (mocked API): node dist/index.js "what's my context"
//   → POST to /voice/command made (verify via mock server)
//   → stdout contains text response

// Integration test: API server not running
//   → stdout contains "The DevNeural graph isn't running. Start it with: node ..."
//   → path in message is a valid-looking file path (not hardcoded absolute)
//   → exit code 0
```

---

## Part 2: 03-web-app

**Note:** All Three.js tests use `vi.mock('three')` — Three.js constructors are mocked, tests verify constructor calls and arguments, not actual WebGL objects.

### Graph Builder

```typescript
// Test: build(graphData) calls new THREE.SphereGeometry for each node
// Test: project nodes → SphereGeometry with larger radius than skill nodes
// Test: skill nodes → SphereGeometry with medium radius
// Test: tool nodes → SphereGeometry with smaller radius
// Test: project nodes → MeshStandardMaterial called with blue-tinted color
// Test: skill nodes → MeshStandardMaterial called with green-tinted color
// Test: tool nodes → MeshStandardMaterial called with orange-tinted color
// Test: edges → LineBasicMaterial opacity proportional to edge weight (higher weight = higher opacity)
// Test: edge with weight=0 → opacity near minimum threshold (not zero — still visible)
// Test: edge with weight=10 → opacity at maximum
// Test: build() called with empty graph → no Three.js constructors called, no errors
```

### WebSocket Handlers

```typescript
// Test: graph:snapshot handler → clears scene (scene.clear called), then rebuilds (builder.build called)
// Test: connection:new handler → adds one new mesh to scene (not full rebuild)
// Test: voice:focus handler → sets focusedNodeId state, triggers highlight material on that node
// Test: voice:highlight handler → sets highlighted node IDs, dims all other nodes
// Test: voice:highlight with empty nodeIds → same effect as voice:clear (all nodes restored to default)
// Test: voice:clear handler → restores all nodes to default materials, resets camera position
// Test: snapshot received before scene init → buffered in pendingSnapshot, applied once scene ready
// Test: WebSocket reconnect → exponential backoff delay increases between attempts
```

### Orb Visuals

```typescript
// Test: getMaterialForNodeType('project') → returns config with blue hue
// Test: getMaterialForNodeType('skill') → returns config with green hue
// Test: getMaterialForNodeType('tool') → returns config with orange hue
// Test: getEdgeOpacity(weight) is monotonic — getEdgeOpacity(5) > getEdgeOpacity(3)
// Test: getEdgeOpacity(0) ≥ 0.05 (minimum visibility)
// Test: getEdgeOpacity(10) ≤ 1.0 (max opacity capped)
// Test: highlightMaterial differs from defaultMaterial (brighter/different color)
// Test: dimmedMaterial has lower opacity than defaultMaterial
```

### Force-Directed Physics

```typescript
// Test: simulate(nodes, edges) → each node position changes after one tick
// Test: simulate with no edges → nodes repel (spread apart, not converge)
// Test: simulate with high-weight edge → connected nodes closer after N ticks
// Test: velocity threshold — after many ticks, all velocities fall below 0.001 (simulation cools down)
// Test: cooldown flag set when simulation stabilizes → further ticks are skipped
// Test: reset() restarts simulation (cooldown cleared, velocities zeroed)
```

---

## Shared: WebSocket Event Protocol

```typescript
// Test: voice:focus payload schema — requires { nodeId: string }
// Test: voice:highlight payload schema — requires { nodeIds: string[] }
// Test: voice:clear payload schema — accepts {}
// Test: voice:highlight with empty nodeIds is valid per schema (not rejected)
// (These are type-level tests; verify via Zod schema parse in 02-api-server)
```

---

## 02-api-server Extensions — Integration

```typescript
// Integration test: start server, connect WS client, POST /voice/command voice:focus
//   → WS client receives { type: 'voice:focus', payload: { nodeId: '...' } }

// Integration test: POST /voice/command voice:highlight with empty nodeIds
//   → WS client receives voice:highlight with nodeIds: []

// Integration test: POST /voice/command with unknown type
//   → HTTP 400 response
//   → WS client receives nothing
```
