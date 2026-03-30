# Integration Notes: Opus Review Feedback

## Issues Being Integrated

### 1. ServerMessage discriminated union must be extended (INTEGRATING)
The reviewer is correct. The plan says voice events "ride the existing broadcast()" without calling out that `ServerMessageSchema` and the `ServerMessage` type in 02-api-server's `ws/types.ts` need three new discriminated union members. This would fail to compile as written. Adding explicit spec for schema extension.

### 2. POST /voice/command needs input validation (INTEGRATING)
Good catch. Accepting arbitrary `type` fields and broadcasting them silently is a real footgun. Adding Zod schema to allowlist only `voice:focus`, `voice:highlight`, `voice:clear`, returning 400 on unknown types.

### 3. BayesClassifier does not return 0–1 confidence (INTEGRATING)
The reviewer is right: `classify()` returns the label only; `getClassifications()` returns log-probabilities, not normalized floats. Adding specification of the conversion strategy: use softmax over the top-2 log-prob values as an approximation, or use the gap between top-2 as a heuristic confidence score. The plan must specify this or the confidence gates are unimplementable as written.

### 4. get_top_skills: larger fetch + filter (INTEGRATING)
The reviewer is correct that top-N edges by weight are likely not skill edges. Changing the spec to fetch `limit=100` (or all edges) from `/graph/top` and apply client-side filter for skill nodes, returning up to the requested N.

### 5. Node name entity resolution: two-request flow (INTEGRATING)
The plan describes label lookup without specifying the mechanism. Adding explicit spec: when `entities.nodeName` is set, first fetch `GET /graph` to get all nodes, do case-insensitive label match to get the full node ID, then use that ID in the intent-specific endpoint call. This is two requests, which is acceptable for a named-entity query. Note the `getSubgraph` call already requires a resolved project ID so this pattern is already present in the identity module.

### 6. Identity module: re-export from 01-data-layer (INTEGRATING)
The reviewer correctly identifies that 04-session-intelligence's `identity.ts` is a re-export of 01-data-layer/dist/identity/index. The plan should specify the same pattern rather than reimplementing. Changing the spec to import from `01-data-layer` directly.

### 7. Hardcoded paths in error messages (INTEGRATING)
Use `path.resolve(__dirname, '../../02-api-server/dist/server.js')` instead of the hardcoded absolute path. Consistent with 04-session-intelligence's approach.

### 8. get_context: two events sent in sequence (INTEGRATING)
The plan says `get_context` triggers both `voice:focus` and `voice:highlight`, but doesn't specify the protocol when a single broadcast channel carries one event at a time. Adding spec: two consecutive POSTs to `/voice/command` — first `voice:focus` for the project node, then `voice:highlight` for adjacent nodes.

### 9. natural library CommonJS compatibility (INTEGRATING as note)
Adding a note to the plan: verify CommonJS compatibility before using `natural`. If ESM-only in recent versions, pin to `natural@6.x` (last CJS-compatible major release) or hand-roll a simple Naive Bayes classifier (~50 lines) for 6 intents. The plan should not assume latest `natural` works under CommonJS `require()`.

### 10. Haiku fallback error semantics: distinguish unavailable vs unknown (INTEGRATING)
Two different user messages: "I'm not sure what you mean — try asking about connections, skills, or your current project." (Haiku returned unknown) vs. "I couldn't reach the AI assistant, but here's what I could understand locally: [local parse result or clarification]." (Haiku unreachable). The text response should differentiate.

### 11. spawnSync acceptable in Claude Code skill context (INTEGRATING as clarification)
Adding a note that `spawnSync` is intentional: Claude Code skills are invoked as subprocess calls that are already synchronous from the shell's perspective. The blocking is bounded by API call latency (~500ms) and is acceptable. Not changing to async but documenting the reasoning.

### 12. WebSocket initialization race condition (INTEGRATING)
Specifying init order: renderer initializes first (scene, camera, lights), then WebSocket client connects. If a `graph:snapshot` arrives before scene init completes, it is buffered in a `pendingSnapshot` variable and applied on the next animation frame once the scene is ready.

### 13. Force simulation cool-down (INTEGRATING as note)
Adding: the simulation should track a velocity threshold and stop iterating when all node velocities fall below a minimum (e.g., 0.001 units/frame). Expected graph size for a personal DevNeural graph is dozens to low hundreds of nodes — performance is not a concern but explicit cool-down prevents unnecessary CPU usage.

### 14. Missing /voice skill definition file (INTEGRATING)
Adding `voice.md` to the directory structure for the Claude Code skill definition. This is a Markdown file in `.claude/commands/` that specifies the skill name, description, and subprocess invocation command.

### 15. get_stages: filter to project nodes first (INTEGRATING)
Updating the routing spec for `get_stages`: after fetching the full graph, filter to nodes where `type === 'project'` first, then apply `stage` field filter if `stageFilter` entity is set. For "all stages" queries, group project nodes by their `stage` field value and format as: "DevNeural: alpha, SessionStart: deployed, VoiceInterface: planning". Nodes with no `stage` field are grouped under "untracked".

### 16. Empty graph invariant for voice:highlight (INTEGRATING)
Adding protocol invariant: `voice:highlight` with an empty `nodeIds` array is treated as `voice:clear` by the client. The orb handler spec should include this explicitly.

### 17. Three.js testing approach (INTEGRATING)
Adding to testing strategy: Three.js scene objects cannot be tested in Node.js without WebGL. The approach is to mock Three.js constructors (`vi.mock('three')`) and test that builder functions call the right constructors with the right arguments. `visuals.ts` tests (color/material logic) operate on plain JS objects representing material properties, not actual Three.js materials. No `jsdom` or `happy-dom` needed since Three.js is mocked at the import level.

---

## Issues NOT Being Integrated

### 18. Vite dev proxy for WebSocket (NOT INTEGRATING)
The reviewer notes this is already covered by `@fastify/cors` with `origin: '*'`. The plan already notes that the API server is on port 3747 and the web app on 3748. No additional spec needed — this is a clarification of existing behavior, not a gap.

### 19. get_context vs get_connections keyword conflict (PARTIALLY INTEGRATING)
The reviewer raises a valid edge case: "what's connected to my current project" hits both keyword sets. The BayesClassifier handles this through training data. For the keyword fast-path, adding a tie-breaking rule: if keywords from multiple intents match, defer to the classifier rather than returning a match on the first keyword hit. The fast-path is only used when a single intent's keywords match unambiguously.

### 20. Connection type mismatch tool->skill (INTEGRATING as note)
The `tool->skill` edge type exists in 02-api-server's type system but not in 01-data-layer. For `get_top_skills`, the filter should include both `project->skill` and `tool->skill` edge types when identifying skill nodes from the edge list. Adding this to the routing spec.
