# Opus Review

**Model:** claude-opus-4-6
**Generated:** 2026-03-30T00:00:00Z

---

## Plan Review: `C:/dev/tools/DevNeural/05-voice-interface/claude-plan.md`

### 1. Critical Type Incompatibility: ServerMessage Discriminated Union

The plan states that the three new voice events (`voice:focus`, `voice:highlight`, `voice:clear`) "ride the existing `broadcast()` function and do not require changes to the WebSocket connection handling." This is only half true.

The `broadcast()` function in `C:/dev/tools/DevNeural/02-api-server/src/ws/broadcaster.ts` (line 10) accepts `ServerMessage`, which is defined in `C:/dev/tools/DevNeural/02-api-server/src/ws/types.ts` (lines 37-42) as a Zod `discriminatedUnion` with only two variants: `graph:snapshot` and `connection:new`. Passing a `voice:focus` event to `broadcast()` will fail Zod validation at the type level -- TypeScript will refuse to compile it, and if you bypass types, the schema does not include those event types.

The plan needs to explicitly call out that `ServerMessageSchema` and the `ServerMessage` type must be extended with three new discriminated union members. This is not a trivial "ride the existing function" change; it touches a schema that downstream consumers (including any validation middleware) depend on. The plan should specify the exact schema additions.

### 2. POST /voice/command Has No Input Validation

The plan says the new `POST /voice/command` endpoint "accepts a JSON body with `{ type, payload }` and calls the internal `broadcast()` function." There is no mention of validating that `type` is one of the three allowed voice event types. Without validation, any caller on localhost can inject arbitrary event types into the WebSocket stream. While this is localhost-only, it is still a footgun for debugging and a structural concern: a typo in the voice handler's event type would silently broadcast garbage to all WebSocket clients with no error feedback.

The plan should specify a Zod schema or at least an allowlist check on the `type` field: only `voice:focus`, `voice:highlight`, and `voice:clear` should be accepted. Reject all others with a 400.

### 3. Identity Module: Unnecessary Code Duplication

The plan describes a new `identity/index.ts` module in 05-voice-interface that "follows the pattern from 04-session-intelligence exactly." Looking at the actual code, `C:/dev/tools/DevNeural/04-session-intelligence/src/identity.ts` is already just a re-export of `C:/dev/tools/DevNeural/01-data-layer/dist/identity/index` (line 2). The plan proposes reimplementing git remote resolution from scratch instead of re-exporting the same function.

This creates a third copy of the identity resolution logic. The plan should instead specify importing from `01-data-layer` directly (the same approach 04-session-intelligence uses), or at minimum acknowledge the existing implementation and justify the duplication.

### 4. get_top_skills Routing Mismatch with Actual API

The plan says `get_top_skills` maps to `GET /graph/top?limit=N`, then "filter results to skill nodes." But looking at the actual `getTopEdges()` in `C:/dev/tools/DevNeural/02-api-server/src/graph/queries.ts` (line 70), it returns the top N **edges** by weight -- not the top N skill nodes. These edges can be `project->tool`, `project->project`, or `project->skill`. The plan acknowledges client-side filtering is needed ("then filter results to skill nodes") but does not address what happens when most of the top-N edges are not skill edges.

If the user asks for "top 5 skills" and the top 10 edges are all `project->tool`, the voice handler will return zero results. The plan should either: (a) specify fetching a larger batch from the API (e.g., `limit=100`) and filtering client-side, or (b) propose a new server-side endpoint that filters by node type before limiting.

### 5. get_stages Routing Is Expensive and Underspecified

The plan says `get_stages` maps to `GET /graph` (the full graph) and then filters by stage metadata. For any reasonably sized graph, downloading the entire graph to do a client-side filter is wasteful. More importantly, the plan does not specify **how** the filter works. Looking at `GraphNode` in `C:/dev/tools/DevNeural/02-api-server/src/graph/types.ts` (line 23-30), the `stage` field is optional and only populated from `devneural.json` files via the `ProjectRegistry`. Many nodes (tools, skills) will never have a `stage`. The plan should specify: filter to project nodes only, then filter by `stage` field matching the `stageFilter` entity.

Additionally, the "or if no stage filter, return all project nodes grouped by stage" behavior is underspecified. What does "grouped by stage" mean in a text response? What about project nodes with no stage set?

### 6. Node Name Entity Resolution Is Fragile

The plan says when a user names a project explicitly (e.g., "what's connected to DevNeural?"), the entity extractor captures `"DevNeural"` as `nodeName`, and "the router looks up `project:github.com/mcollins/DevNeural` by searching the graph nodes for a case-insensitive label match." This raises several issues:

- **The plan does not specify where this search happens.** The voice handler would need to fetch the full graph (`GET /graph`) just to do a label lookup before making the actual intent-specific API call. That is two HTTP requests for every query with a named entity.
- **Label matching is ambiguous.** If the user says "DevNeural," the handler needs to match against node labels. But node IDs are like `project:github.com/mcollins/DevNeural` and labels are set from the graph builder. The plan does not specify what the label values actually are or how fuzzy the matching should be.
- **The `GET /graph/node/:id` endpoint expects the full node ID** (as noted in the comment on line 19 of queries.ts: "no prefix normalization is performed -- callers must pass the full id"). A label-to-ID resolution step is required but not architected.

The plan should add either: a label-search endpoint on the API server, a local cache of the node index, or a clear specification of the two-request flow.

### 7. `natural` Library CommonJS Compatibility

The plan specifies using `natural.BayesClassifier` from the `natural` npm package. The `natural` library is a large package (~15MB installed) that includes tokenizers, stemmers, classifiers, and phonetic algorithms -- most of which are unused here. More importantly, recent versions of `natural` have shifted toward ESM. Given that 05-voice-interface is CommonJS, the plan should verify that the specific version of `natural` being used exports correctly under CommonJS `require()`. If not, `esmoduleinterop` might not be sufficient, and a dynamic `import()` wrapper or a pinned older version may be needed.

Consider whether a simpler library (or hand-rolled Naive Bayes with ~50 lines of code over only 6 intents with 20 examples each) would be a better fit than pulling in the full `natural` package.

### 8. Confidence Values from BayesClassifier

The plan specifies confidence thresholding at 0.60 and 0.85. However, `natural.BayesClassifier.classify()` returns only the classification label -- not a confidence score. To get scores, you need `classifier.getClassifications()`, which returns an array of `{ label, value }` pairs where `value` is a log-probability (negative numbers), not a 0.0-1.0 probability.

The plan treats confidence as a normalized 0.0-1.0 float uniformly across both the local parser and Haiku. The implementer will need to convert BayesClassifier log-probabilities to a normalized confidence score, and that conversion is non-trivial (softmax over log-probs, or a heuristic like checking the gap between the top two classifications). The plan should specify the conversion strategy so the confidence gates work as described.

### 9. Haiku Fallback Error Semantics

The plan says "if the API call fails (network error, quota), the pipeline returns `{ intent: "unknown", confidence: 0, source: "haiku" }`." A confidence of `0` will always hit the `< 0.60` gate and return a clarification response. This is correct behavior. However, the plan should distinguish between "Haiku was called and returned `unknown` with some confidence" versus "Haiku was unreachable." The user experience should differ: "I'm not sure what you mean" vs. "I couldn't reach the AI assistant to understand your question, but here's what I could parse locally." Currently both cases are collapsed.

### 10. spawnSync for Skill Invocation

The plan says the Claude Code `/voice` skill invokes the voice handler "as a subprocess using `spawnSync`." This is synchronous and will block the Claude Code event loop for the entire duration of the voice pipeline, which includes:
- Identity resolution (git subprocess)
- Intent parsing (potentially a Haiku API call at 300-800ms)
- API server HTTP request
- Orb event HTTP POST

That is potentially 1-2 seconds of blocking. The plan should either specify `spawn` (async) instead of `spawnSync`, or document why blocking is acceptable in this context (e.g., Claude Code skills are already synchronous subprocess invocations by design).

### 11. WebSocket Client in web-app: Missing Initial Graph Load Timing

The plan says on `ws://localhost:3747/ws` connection, the server sends a `graph:snapshot` immediately (which it does -- see `C:/dev/tools/DevNeural/02-api-server/src/server.ts` line 50-52). But the plan's "Scene Initialization" section (Part 2) says "On first load and on `graph:snapshot`" without addressing the race condition: the WebSocket might connect and receive the snapshot before the Three.js renderer is initialized. The plan should specify that either: (a) the renderer is initialized first, then the WebSocket connects, or (b) the first snapshot is buffered and replayed once the renderer is ready.

### 12. Force-Directed Layout Performance

The plan says the force simulation runs "per-frame in the Three.js animation loop using `requestAnimationFrame`." For small graphs this is fine, but there is no specification of:
- Maximum node count the layout can handle before frame rate degrades
- Whether the simulation should "cool down" and stop iterating once the layout stabilizes (the damping mention suggests this, but it is not explicit)
- Whether layout computation should move to a Web Worker for graphs above a threshold

For a personal skill graph this is likely fine (tens to low hundreds of nodes), but the plan should state the expected graph size and the performance envelope.

### 13. Missing: `/voice` Skill Definition File

The plan describes the voice handler being invoked via a `/voice` Claude Code slash command, but never specifies the skill definition file that registers this command. Claude Code skills require a specific file structure (typically in `.claude/commands/` or similar). The plan should include the skill definition file in the directory structure and specify its contents -- the command name, description, and the subprocess invocation command.

### 14. Missing: Vite Dev Proxy for WebSocket

The plan says the web app runs on port 3748 (Vite dev server) and connects to `ws://localhost:3747/ws` (the API server). During development with Vite, this cross-origin WebSocket connection will work because the browser's WebSocket API does not enforce same-origin policy. However, if CORS headers become relevant for any HTTP fetches from the web app to the API server (e.g., fetching initial data via REST before WebSocket connects), the plan should note that the API server already has `@fastify/cors` with `origin: '*'` configured, so this is covered. This is a minor point but worth a brief mention.

### 15. get_context Intent: Missing Disambiguation from get_connections

The keyword table maps "context" and "working on" to `get_context`, while "connected" and "connections" map to `get_connections`. A query like "what's connected to my current project" contains both "connected" and "current project" signals. The plan does not specify keyword priority or conflict resolution when multiple intents have keyword matches. The BayesClassifier handles this naturally via training data, but the keyword fast-path (checked first) needs a tie-breaking rule.

### 16. Hardcoded Paths in Error Messages

The plan specifies the API-unavailable message as: `"The DevNeural graph isn't running. Start it with: node C:/dev/tools/DevNeural/02-api-server/dist/server.js"`. This is a hardcoded absolute path. The 04-session-intelligence implementation resolves this path dynamically using `path.resolve(__dirname, ...)` (line 44-45 of `C:/dev/tools/DevNeural/04-session-intelligence/src/session-start.ts`). The plan should specify the same dynamic resolution rather than a hardcoded path.

### 17. Missing: voice:highlight Payload for get_context

The plan says `get_context` maps to both `voice:focus` on the current project node AND `voice:highlight` on all adjacent nodes. But the WebSocket event protocol only allows one event per broadcast. The plan needs to specify whether: (a) two separate events are sent in sequence, (b) the protocol is extended with a compound event type, or (c) one of the two effects is dropped. This same issue applies to any intent that needs both focus and highlight simultaneously.

### 18. Three.js Testing Without a DOM

The plan includes tests for Three.js components (builder, visuals, handlers). Three.js requires a WebGL context, which is not available in Node.js. The plan specifies `vitest.config.ts` but does not mention `jsdom` or `happy-dom` environments, and neither of those provide WebGL. Testing Three.js scene construction typically requires either: (a) mocking the Three.js constructors, (b) using a headless GL implementation like `gl` (node-gl), or (c) testing only the data transformation layer and not the actual Three.js objects. The plan should specify the testing approach for browser-dependent code.

### 19. Missing: Graceful Handling of Empty Graph

The plan does not address what happens when the voice handler queries an API server that has an empty graph (no nodes, no edges). The `getTopEdges` will return an empty array. The `getSubgraph` will return empty nodes and edges. The formatter handles empty results ("I didn't find any connections matching that query"), but the orb event generation is underspecified: what `nodeIds` does `voice:highlight` send when there are no results? An empty array? The handler test spec mentions "voice:highlight with empty array triggers voice:clear behavior," which is good, but this should be formalized in the event protocol section as an invariant.

### 20. Connection Type Mismatch Between 01-data-layer and 02-api-server

The `ConnectionType` in `C:/dev/tools/DevNeural/01-data-layer/src/types.ts` (line 17) is `'project->tool' | 'project->skill' | 'project->project'`. The `ConnectionType` in `C:/dev/tools/DevNeural/02-api-server/src/graph/types.ts` (line 1-5) adds a fourth variant: `'tool->skill'`. The plan's intent routing for `get_top_skills` filters for skill nodes, but the `tool->skill` edge type exists only in the API server's type system, not in the data layer. The plan should acknowledge this discrepancy and specify whether `tool->skill` edges should be considered when filtering for "skills the user is using."

---

### Summary of Highest-Priority Issues

1. **ServerMessage type must be extended** -- the plan glosses over this as "no changes needed" but it will fail to compile.
2. **BayesClassifier does not return 0-1 confidence** -- the confidence gating logic as written cannot work without a conversion strategy.
3. **Node name entity resolution requires a graph fetch** -- this undocumented extra request needs to be architected.
4. **get_top_skills will return zero results** for most graphs because top edges are rarely skill edges -- the filtering strategy needs rethinking.
5. **POST /voice/command needs input validation** -- accepting arbitrary event types into the broadcast is a structural defect.

The plan is well-structured and thorough in its architectural rationale, data flow, and separation of concerns. The issues above are all addressable within the current architecture; they are specification gaps rather than fundamental design problems.
