# Implementation Plan: 03-web-app + 05-voice-interface

## What We're Building

This plan covers two DevNeural splits built together because they are tightly coupled:

**03-web-app** is a locally-running browser application that renders the DevNeural connection graph as an interactive Three.js 3D force visualization — the "orb." It listens to the 02-api-server WebSocket for live graph updates and voice command events.

**05-voice-interface** is a natural language query interface accessible via a `/voice` Claude Code skill. The user types or dictates a question about their graph ("what skills am I using most?"), the voice handler parses the intent, queries the 02-api-server REST endpoints, formats a readable text response, and sends a visual command to the orb web app via WebSocket.

The two splits share a WebSocket event protocol, which is why they are planned and built together. Voice is read-only — it queries the graph but never writes to it.

---

## Why These Two Together

The voice interface's primary value comes from visual feedback in the orb. Text responses alone are useful but the orb responding in real-time — highlighting relevant nodes, centering on a queried project, lighting up the top-weighted skills — is the intended experience. Building them in isolation would require re-designing the integration contract later. Building them together lets us define the event protocol once and implement both sides immediately.

The orb also gives the voice interface a feedback channel that doesn't depend on TTS output. Claude Voice mode is input-only (speech-to-text dictation); it doesn't synthesize spoken output. The orb provides the visual response layer.

---

## System Architecture

The full system, including existing infrastructure:

```
User (voice via Claude dictation OR typed in Claude chat)
     │
     ▼
Claude Code session
     │
     ▼  /voice "what skills am I using most?"
05-voice-interface (Node.js, CommonJS TypeScript)
     │
     ├──→ NL Intent Parser
     │         ├── local keyword fast-path (natural.BayesClassifier)
     │         └── Haiku fallback (@anthropic-ai/sdk + zod)
     │
     ├──→ 02-api-server REST  GET /graph/top?limit=10
     │         └── returns edge list
     │
     ├──→ Response formatter
     │         └── plain readable text → Claude chat
     │
     └──→ WebSocket client → 02-api-server (port 3747)
               └── broadcast "voice:highlight" event
                         │
                         ▼
              03-web-app (browser, Three.js)
                    orb highlights top skill nodes
```

Data flow:
1. User query arrives as text (typed or dictated)
2. Intent parsed locally or via Haiku
3. Intent mapped to REST endpoint call
4. API response formatted as readable sentences
5. WebSocket event sent to trigger orb visual
6. Text response returned to Claude chat

---

## 02-api-server Extensions

Before implementing either new split, the 02-api-server needs two additions. These are the only changes to existing infrastructure.

### New WebSocket Event Types

The broadcaster needs to support three new event types emitted to all connected clients:

- `voice:focus` — carries a single `nodeId`; the orb should center and highlight that node
- `voice:highlight` — carries an array of `nodeIds`; the orb highlights the set
- `voice:clear` — no payload; the orb returns to its default view

These ride the existing `broadcast()` function, but the `ServerMessageSchema` discriminated union in `src/ws/types.ts` must be extended with three new variants for TypeScript to accept them. The three new union members follow the same shape as the existing variants: a `type` literal field plus a `payload` field (or empty object for `voice:clear`). Downstream consumers that pattern-match on `ServerMessage` are unaffected since they only need to handle the existing `graph:snapshot` and `connection:new` variants.

### New REST Endpoint: Voice Command Broadcast

A new route `POST /voice/command` accepts a JSON body with `{ type, payload }` and calls the internal `broadcast()` function with that event. This is how the voice handler (running as a Node.js subprocess or skill) injects voice events into the WebSocket stream without needing to open a WebSocket connection itself.

The endpoint validates the `type` field against an allowlist of `voice:focus`, `voice:highlight`, and `voice:clear` using a Zod schema. Unknown or misspelled event types return 400 immediately — this prevents silent broadcast of garbage events during development and gives the caller immediate feedback on type mismatches.

The endpoint is local-only; no authentication is needed since it's on localhost.

---

## Part 1: 05-voice-interface

### Directory Structure

```
05-voice-interface/
  src/
    index.ts              ← entry point, reads query from argv/stdin
    intent/
      types.ts            ← VoiceIntent, IntentResult types
      local-parser.ts     ← keyword fast-path + BayesClassifier
      haiku-parser.ts     ← Haiku fallback via @anthropic-ai/sdk
      parser.ts           ← orchestrates local → Haiku pipeline
    routing/
      intent-map.ts       ← intent name → API endpoint factory
      api-client.ts       ← HTTP calls to 02-api-server
    formatter/
      response.ts         ← converts API result to readable text
      orb-events.ts       ← maps intent to voice:* WebSocket event
    identity/
      index.ts            ← re-exports resolveProjectId from 01-data-layer
  tests/
    intent/
      local-parser.test.ts
      haiku-parser.test.ts
      parser.test.ts
    routing/
      intent-map.test.ts
    formatter/
      response.test.ts
  tsconfig.json
  package.json
  vitest.config.ts

.claude/commands/
  voice.md                ← Claude Code skill definition for /voice command
```

### Types

The core types that flow through the system:

```typescript
// src/intent/types.ts
type IntentName = "get_context" | "get_top_skills" | "get_connections"
                | "get_node" | "get_stages" | "unknown";

interface IntentResult {
  intent: IntentName;
  confidence: number;        // 0.0–1.0
  entities: {
    nodeName?: string;       // project or skill name mentioned in query
    stageFilter?: string;    // "alpha" | "beta" | "deployed" | "archived"
    limit?: number;          // for top-N queries
  };
  source: "local" | "haiku"; // which parser resolved the intent
}

interface VoiceResponse {
  text: string;              // formatted text for chat output
  orbEvent?: {               // undefined if no orb action needed
    type: "voice:focus" | "voice:highlight" | "voice:clear";
    payload: unknown;
  };
}
```

### NL Intent Parsing — Hybrid Pipeline

#### Local Fast-Path

The local parser uses two strategies in order:

1. **Keyword phrase table**: A map from strong phrases to intents. A query containing "skills" and "most" or "top" routes directly to `get_top_skills` with confidence 0.95. A query containing "context" or "working on" routes to `get_context`. A query containing "stage" or "alpha" or "beta" routes to `get_stages`. The fast-path only returns a match when exactly one intent's keywords match the query. If keywords from two or more intents match simultaneously (e.g., "what's connected to my current project" hits both "connected" → `get_connections` and "current project" → `get_context`), the fast-path defers to the BayesClassifier rather than guessing. If a single unambiguous keyword hit is found, return immediately.

2. **BayesClassifier fallback** (within the local path): If no keyword hit, the classifier (from the `natural` library) classifies the query using training examples. The classifier is initialized and trained at startup from a static training set embedded in the module (no external files). Training takes ~10ms on startup.

`natural.BayesClassifier` does not return a 0–1 confidence score. Use `classifier.getClassifications()` which returns an array of `{ label, value }` where `value` is a log-probability (negative number). Convert to a normalized confidence using a simple heuristic: sort results descending by `value`, take the top-2 log-probs, apply softmax (`e^v1 / (e^v1 + e^v2)`) to get a normalized score between 0 and 1. If the normalized top-1 score exceeds 0.75, return it as the classification. Otherwise hand off to Haiku.

**Compatibility note:** The `natural` library has shifted toward ESM in recent major versions. Before using it, verify CommonJS compatibility with `require()` in the project's Node.js version. If incompatible, pin to `natural@6.x` (last stable CJS release) or replace with a hand-rolled Naive Bayes implementation (~50 lines) suitable for 6 intents with 20 training examples each.

The training set covers ~20 example phrases per intent. It is defined as a constant in `local-parser.ts` and does not require any external model files.

#### Haiku Fallback

When local confidence is below threshold, the Haiku parser is called. It uses the Anthropic SDK's structured output feature with a Zod schema defining the `IntentResult` shape. The model is `claude-haiku-4-5`. Max tokens is 256. System prompt is concise: describe the intent taxonomy and entity extraction requirements.

The Zod schema enforces exact field types, so no validation is needed on the response. Error handling distinguishes two failure cases: (a) Haiku returns `unknown` with low confidence — the caller treats this as "not understood" and returns a clarification response ("I'm not sure what you mean — try asking about connections, skills, or your current project."); (b) the API call fails (network error, quota, timeout) — the pipeline returns `{ intent: "unknown", confidence: 0, source: "haiku" }` and the caller uses a different message: "I couldn't reach the AI assistant, but here's what I could parse locally: [local parse result or clarification if local also failed]."

#### Confidence Thresholding

After parsing (local or Haiku), the caller applies confidence gates:
- `< 0.60`: Return a clarification response without making any API call
- `0.60–0.85`: Make the API call but prefix the text response with "I think you're asking about..."
- `≥ 0.85`: Execute without hedging

### Routing: Intent to API Endpoint

`intent-map.ts` exports a function that takes an `IntentResult` and returns the HTTP request configuration needed to query 02-api-server. It is a pure mapping function with no side effects.

Each intent maps to exactly one endpoint:
- `get_context` → `GET /graph/subgraph?project={resolvedProjectId}`
- `get_top_skills` → `GET /graph/top?limit=100`, then filter edges to those where at least one endpoint is a skill node (edge types `project->skill` and `tool->skill`), deduplicate the skill node IDs, return up to `entities.limit ?? 5` unique skill nodes ranked by the edge weight sum. Note: `/graph/top` returns top edges by weight, not top nodes — fetching 100 ensures enough candidates survive the filter even when most top edges are `project->tool` or `project->project`.
- `get_connections` → If `entities.nodeName` is set: first `GET /graph` to resolve the label to a node ID (case-insensitive match on node label), then `GET /graph/node/{resolvedNodeId}`. If no named entity: `GET /graph/subgraph?project={resolvedProjectId}`.
- `get_node` → `GET /graph` to resolve label to node ID, then `GET /graph/node/{resolvedNodeId}`
- `get_stages` → `GET /graph`, filter to nodes where `type === 'project'`, then filter by `node.stage === entities.stageFilter` if a stage entity is set. If no stage filter, group all project nodes by their `stage` field. Nodes with no `stage` field are grouped under "untracked".
- `unknown` → No API call; return clarification response

The API client follows the pattern from 04-session-intelligence: a single `fetchWithTimeout()` function that returns `null` on any error rather than throwing. If null is returned, the formatter generates an "API not available" message.

### Project Identity Resolution

The identity module re-exports the identity resolution function from `01-data-layer` — the same pattern used by `04-session-intelligence/src/identity.ts`. It does not reimplement git remote resolution. `identity/index.ts` is a thin re-export: `export { resolveProjectId } from '01-data-layer/dist/identity/index'`. This ensures a single implementation is shared across all DevNeural splits.

When the user names a project explicitly in the query (e.g., "what's connected to DevNeural?"), the entity extractor captures `"DevNeural"` as `nodeName`. The router resolves this to a full node ID via a two-request flow: first `GET /graph` to retrieve all nodes, then a case-insensitive search of node labels to find the matching node ID (e.g., `project:github.com/mcollins/DevNeural`). The second request uses that resolved ID. The `/graph/node/:id` endpoint expects the full ID with no normalization, so label-to-ID resolution is mandatory before calling it with a user-supplied name.

### Response Formatting

The formatter receives the raw API response (edge list, node, or graph) and converts it to readable natural language text. Rules:
- No markdown: no `**`, `#`, `` ` ``, or bullet characters in the output
- 1–3 sentences for simple queries; up to 5 sentences for list results
- Numbers are written out naturally: "You use deep-plan most heavily, with a connection weight of 8.2 out of 10."
- Empty results: "I didn't find any connections matching that query."
- API unavailable: "The DevNeural graph isn't running. Start it with: node {dynamicPath}" where `dynamicPath` is resolved at runtime via `path.resolve(__dirname, '../../02-api-server/dist/server.js')` — consistent with how 04-session-intelligence resolves this path rather than hardcoding an absolute path

The formatter is intent-aware — it knows how to format a subgraph response differently from a top-N edges response.

### Orb Event Generation

After formatting the text, `orb-events.ts` maps the intent and API result to the appropriate voice WebSocket event(s):

- `get_context`: Two events in sequence — first `POST /voice/command` with `voice:focus` on the current project node ID, then immediately `POST /voice/command` with `voice:highlight` on all adjacent node IDs. Both fire before returning to the caller.
- `get_top_skills`: `voice:highlight` on the top-N skill node IDs returned
- `get_connections` / `get_node`: `voice:focus` on the named node
- `get_stages`: `voice:highlight` on all project node IDs matching the stage
- `unknown` / clarification: `voice:clear`

**Protocol invariant:** `voice:highlight` with an empty `nodeIds` array is treated as `voice:clear` by the orb client. This handles the empty-graph case cleanly — the voice handler sends `voice:highlight` with the empty result set, and the orb resets to its default view.

The orb event(s) are sent by HTTP POST to `http://localhost:3747/voice/command`. These calls are fire-and-forget: if the web app isn't running, the POST returns a non-200 and the voice handler ignores the error. The text response is always returned regardless.

### Entry Point

`src/index.ts` reads the voice query from process argv (`node dist/index.js "what skills am I using?"`). It orchestrates the pipeline: identity resolution, intent parsing, API call, formatting, orb event, and prints the text response to stdout.

The Claude Code `/voice` skill invokes this as a subprocess using `spawnSync`, reads stdout, and presents it in the chat. `spawnSync` is intentionally synchronous: Claude Code skills are already invoked as blocking subprocess calls from the shell's perspective, so async here buys nothing. The bounded latency (~500ms for a Haiku call + HTTP round-trip) is acceptable.

The `/voice` skill definition lives at `.claude/commands/voice.md` in the repo root (or the user's global `~/.claude/commands/voice.md`). It specifies the skill name (`voice`), description, and the subprocess invocation: `node {resolvedPath}/05-voice-interface/dist/index.js "$@"` where `$@` passes the user's query text.

---

## Part 2: 03-web-app

### Directory Structure

```
03-web-app/
  src/
    main.ts             ← entry point, initializes graph + WebSocket
    graph/
      builder.ts        ← converts GraphData to Three.js scene objects
      types.ts          ← OrbNode, OrbEdge, SceneState types
    ws/
      client.ts         ← WebSocket connection to 02-api-server
      handlers.ts       ← event handlers for graph:* and voice:* events
    orb/
      renderer.ts       ← Three.js renderer setup (canvas, scene, camera, lights)
      physics.ts        ← force-directed layout (spring forces, repulsion)
      interaction.ts    ← click/hover handlers, node selection
      visuals.ts        ← node/edge materials, colors, animation helpers
    ui/
      hud.ts            ← minimal HUD overlay (connection count, project label)
  public/
    index.html          ← static HTML shell
  tests/
    graph/builder.test.ts
    ws/handlers.test.ts
    orb/visuals.test.ts
  tsconfig.json
  package.json
  vite.config.ts        ← Vite build config
  vitest.config.ts
```

### Three.js Orb Design

The orb renders three node types with distinct visual treatments:

- **Project nodes**: Larger spheres, blue-tinted material, labeled with project name
- **Skill nodes**: Medium spheres, green-tinted material, labeled with skill name
- **Tool nodes**: Smaller spheres, orange-tinted material, labeled with tool name

Edge thickness and opacity map to connection weight (0.0–10.0): higher weight = thicker, more opaque edge.

The layout uses a force-directed algorithm:
- Spring force pulls connected nodes together (strength proportional to weight)
- Repulsion pushes all nodes apart (prevents overlap)
- Damping reduces oscillation over time
- The simulation runs per-frame in the Three.js animation loop using `requestAnimationFrame`
- The simulation tracks a velocity threshold and stops iterating when all node velocities fall below 0.001 units/frame, preventing continuous CPU usage once the layout stabilizes. It restarts when new nodes are added (e.g., `connection:new` event).

Expected graph size for a personal DevNeural graph is dozens to low hundreds of nodes. Performance is not a concern at this scale; no Web Worker is needed.

### WebSocket Client

`ws/client.ts` manages the connection to `ws://localhost:3747/ws`:
- Connects on page load
- Auto-reconnects after disconnection (exponential backoff, max 30 seconds)
- Registers event handlers from `ws/handlers.ts`

`ws/handlers.ts` processes incoming messages:
- `graph:snapshot` → rebuild the full Three.js scene from the new graph data
- `connection:new` → add a new edge to the scene without full rebuild
- `voice:focus` → animate the camera to center on the named node; highlight that node's sphere with a bright glow material
- `voice:highlight` → apply a highlight material to the listed nodes; dim all others
- `voice:clear` → restore all nodes to their default materials; return camera to default position

### Build System

The app uses Vite:
- `vite dev` for development (HMR, serves on port 3748 by default)
- `vite build` produces a `dist/` directory of static files
- `vite preview` serves the built output for testing

TypeScript target is ESNext for the browser build (separate from the Node.js CommonJS splits).

### Scene Initialization

Initialization order matters: the Three.js renderer and scene are fully constructed before the WebSocket client connects. This prevents the race condition where a `graph:snapshot` message arrives before the scene is ready. If a snapshot arrives before scene initialization is complete (e.g., during hot reload), it is stored in a `pendingSnapshot` variable and applied on the next animation frame once the scene is ready.

On first load and on `graph:snapshot`:
1. Clear the Three.js scene
2. For each node in the graph, create a sphere mesh with type-appropriate material and position it at a random point within a sphere of radius 5
3. For each edge, create a line or tube mesh between the two endpoint spheres
4. Add node labels using CSS2DRenderer or sprite-based text
5. Start the force simulation loop

### Interaction

Mouse hover: the node under the cursor brightens slightly; a tooltip shows the node ID and connection count.

Click: the clicked node becomes the "selected" node. The camera animates to face it. A small panel shows its top 5 connections by weight.

These interactions are independent of the voice system — they work whether or not a voice query has been made.

### HUD Overlay

A minimal fixed-position HTML overlay shows:
- Total node count and edge count (updates on `graph:snapshot`)
- Current project label (if resolved from the 02-api-server context or URL param)
- Last voice query text (updates when `voice:*` events arrive)

This is plain HTML/CSS positioned over the canvas, not part of the Three.js scene.

---

## Shared: WebSocket Event Protocol

The full set of events that flow over `ws://localhost:3747/ws`, for reference:

| Event Type | Direction | Payload |
|------------|-----------|---------|
| `graph:snapshot` | server → clients | Full `InMemoryGraph` |
| `connection:new` | server → clients | `GraphEdge` |
| `voice:focus` | server → clients | `{ nodeId: string }` |
| `voice:highlight` | server → clients | `{ nodeIds: string[] }` |
| `voice:clear` | server → clients | `{}` |

The voice events are injected by the 05-voice-interface via `POST /voice/command` → 02-api-server calls `broadcast()` → all WebSocket clients receive the event.

---

## Testing Strategy

### 05-voice-interface Tests

**Intent parsing unit tests** (`tests/intent/`):
- Each of the 5 supported intents is correctly classified from example phrases (local path)
- Low-confidence local results correctly hand off to Haiku (mock the Haiku call)
- Confidence gating: below-threshold queries return clarification without API call
- `unknown` intent when query is unrecognizable

**Routing tests** (`tests/routing/`):
- Each intent maps to the correct endpoint path and query parameters
- Node name entity in query is correctly URL-encoded in the endpoint
- `unknown` intent produces no API call

**Formatter tests** (`tests/formatter/`):
- Subgraph response formats to readable text without markdown
- Empty results handled gracefully
- API unavailable message is clear and actionable
- Orb event type matches intent

**Integration test** (subprocess pattern from 04):
- `node dist/index.js "what skills am I using most?"` against a running or mocked 02-api-server
- Verify stdout contains readable text
- Verify the voice command was POSTed to 02-api-server (mock the HTTP endpoint)

### 03-web-app Tests

Three.js requires a WebGL context not available in Node.js. The testing approach is to mock Three.js constructors entirely (`vi.mock('three')`): tests verify that builder and handler functions call the right constructors with the right arguments, not that actual WebGL objects are created. Visuals tests operate on plain JS objects representing material property configs (color values, opacity) rather than live Three.js material instances. No `jsdom` or `happy-dom` environment is needed since all Three.js imports are mocked at the module level.

**Graph builder tests** (`tests/graph/`):
- Converts GraphData to the correct number of Three.js mesh constructor calls
- Node types produce correctly typed material config objects (right color per node type)

**WebSocket handler tests** (`tests/ws/`):
- `graph:snapshot` triggers scene rebuild (scene.clear called, meshes recreated)
- `voice:focus` event triggers node highlight state change
- `voice:highlight` with empty `nodeIds` array triggers `voice:clear` behavior (protocol invariant)
- `voice:clear` resets node materials to defaults

**Visuals tests** (`tests/orb/`):
- Node material factory returns correct color for each node type
- Weight-to-opacity mapping is monotonic (higher weight = higher opacity)

---

## Implementation Order

The interdependencies suggest this order:

1. **02-api-server extensions first**: Add `POST /voice/command` route and the three new event types. This is the integration backbone that both new splits depend on.

2. **05-voice-interface**: Build intent parsing, routing, formatting, and orb event generation. Can be tested against the extended API server immediately.

3. **03-web-app**: Build the Three.js renderer, WebSocket client, and event handlers. The orb integration with voice can be tested end-to-end once both 1 and 2 are done.

Build and test each layer before moving to the next.

---

## Key Constraints and Decisions

**CommonJS for 05**: Follows the convention of 01-data-layer and 04-session-intelligence. The Node.js entry point runs as a subprocess, so ESM interop issues are avoided. HTTP calls to 02-api-server (ESM) cross the module system boundary safely.

**ESM for 03-web-app**: Browser targets require ESM. Vite handles the build. This split is completely separate from the Node.js toolchain.

**Fire-and-forget orb events**: If the web app isn't running, voice still works — it just returns a text response. The orb event POST failing is always silently swallowed. This ensures the voice interface degrades gracefully without the browser open.

**No TTS**: Claude Code voice mode provides input dictation but no TTS output. The orb provides the visual response; text in the Claude chat provides the readable response. No TTS dependency.

**Local-first NL parsing**: The DevNeural intent space is narrow (6 intents). The BayesClassifier with ~20 examples per intent will handle the common case offline and free of API cost. Haiku handles the long tail.

**No graph writes from voice**: Voice queries are observational. Writing to the graph on each query would dilute the signal that comes from actual tool use in Claude sessions.
