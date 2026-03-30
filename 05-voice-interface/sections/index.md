<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-api-extensions
section-02-voice-foundation
section-03-local-parser
section-04-haiku-parser
section-05-parser-pipeline
section-06-routing
section-07-formatter
section-08-entry-point
section-09-web-foundation
section-10-orb-renderer
section-11-ws-handlers
section-12-integration
END_MANIFEST -->

# Implementation Sections Index

This plan covers three directories: `02-api-server` (extensions to existing split), `05-voice-interface` (new Node.js CLI handler), and `03-web-app` (new Vite browser app). Each section specifies which directory its tests run in.

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-api-extensions | — | 02, 09 | No (foundation) |
| section-02-voice-foundation | 01 | 03, 04, 06 | No |
| section-03-local-parser | 02 | 05 | Yes (parallel with 04, 06) |
| section-04-haiku-parser | 02 | 05 | Yes (parallel with 03, 06) |
| section-05-parser-pipeline | 03, 04 | 08 | No |
| section-06-routing | 02 | 07 | Yes (parallel with 03, 04) |
| section-07-formatter | 06 | 08 | No |
| section-08-entry-point | 05, 07 | 12 | No |
| section-09-web-foundation | 01 | 10, 11 | Yes (parallel with 02) |
| section-10-orb-renderer | 09 | 12 | Yes (parallel with 11) |
| section-11-ws-handlers | 09 | 12 | Yes (parallel with 10) |
| section-12-integration | 08, 10, 11 | — | No (final) |

## Execution Order (Batches)

1. **section-01-api-extensions** — no dependencies; unblocks everything
2. **section-02-voice-foundation, section-09-web-foundation** — parallel after 01
3. **section-03-local-parser, section-04-haiku-parser, section-06-routing** — parallel after 02 (06 only needs 02)
4. **section-05-parser-pipeline, section-07-formatter, section-10-orb-renderer, section-11-ws-handlers** — parallel: 05 after 03+04; 07 after 06; 10+11 after 09
5. **section-08-entry-point** — after 05 and 07
6. **section-12-integration** — after 08, 10, and 11

## Section Summaries

### section-01-api-extensions
Extend `02-api-server` to support voice events. Two changes: (1) add three new discriminated union members (`voice:focus`, `voice:highlight`, `voice:clear`) to `ServerMessageSchema` in `ws/types.ts`; (2) add `POST /voice/command` route with Zod validation allowlist. Tests run in `02-api-server/`.

### section-02-voice-foundation
Bootstrap `05-voice-interface`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/intent/types.ts` (IntentResult, VoiceResponse), `src/identity/index.ts` (re-export from 01-data-layer). No logic yet — just types and project wiring. Tests: TypeScript compiles, types export correctly.

### section-03-local-parser
Implement `src/intent/local-parser.ts`: keyword phrase table fast-path with conflict detection (defer to classifier when multiple intents match), `natural.BayesClassifier` with ~20 training examples per intent, `normalizeConfidence()` using softmax over top-2 log-probs. Tests run in `05-voice-interface/`.

### section-04-haiku-parser
Implement `src/intent/haiku-parser.ts`: Anthropic SDK call to `claude-haiku-4-5` with Zod schema structured output, two error paths (Haiku returned unknown vs Haiku unreachable), max_tokens=256. Tests mock the SDK. Tests run in `05-voice-interface/`.

### section-05-parser-pipeline
Implement `src/intent/parser.ts`: orchestrates local → Haiku pipeline. Calls local parser first; if confidence ≥ 0.75 returns local result; otherwise calls Haiku. Applies confidence gates: <0.60 → unknown+clarification, 0.60–0.85 → result+hedging flag, ≥0.85 → confident result. Tests run in `05-voice-interface/`.

### section-06-routing
Implement `src/routing/intent-map.ts` and `src/routing/api-client.ts`. Intent-to-endpoint mapping for all 6 intents including two-request flow for named entity resolution (fetch full graph → label lookup → intent-specific call). `fetchWithTimeout()` returns null on any error. `get_top_skills` fetches limit=100 and filters client-side. Tests run in `05-voice-interface/`.

### section-07-formatter
Implement `src/formatter/response.ts` and `src/formatter/orb-events.ts`. Text formatter: no markdown, 1–5 sentences, dynamic error path, confidence hedging prefix. Orb events: maps intents to voice:* events, `get_context` sends two POSTs in sequence, empty result set sends `voice:highlight` with empty array. Tests run in `05-voice-interface/`.

### section-08-entry-point
Implement `src/index.ts` entry point and `.claude/commands/voice.md` skill definition. Entry point reads argv, orchestrates pipeline (identity → parse → route → format → orb), prints to stdout, always exits 0. Skill definition wires `/voice` command to `node dist/index.js "$@"`. Integration tests use subprocess pattern. Tests run in `05-voice-interface/`.

### section-09-web-foundation
Bootstrap `03-web-app`: `package.json`, `tsconfig.json`, `vite.config.ts` (port 3748), `vitest.config.ts` (vi.mock three), `src/graph/types.ts` (OrbNode, OrbEdge, SceneState), `src/orb/visuals.ts` (material config factory, edge opacity mapping). Tests run in `03-web-app/`.

### section-10-orb-renderer
Implement `src/orb/renderer.ts` (canvas/scene/camera/lights setup), `src/orb/physics.ts` (force simulation with cool-down at velocity < 0.001), `src/graph/builder.ts` (GraphData → Three.js mesh constructor calls). Three.js mocked in tests. Tests run in `03-web-app/`.

### section-11-ws-handlers
Implement `src/ws/client.ts` (connect, auto-reconnect with exponential backoff, `pendingSnapshot` buffer) and `src/ws/handlers.ts` (all five event types: `graph:snapshot`, `connection:new`, `voice:focus`, `voice:highlight`, `voice:clear`; empty `nodeIds` array triggers clear behavior). Three.js mocked in tests. Tests run in `03-web-app/`.

### section-12-integration
Implement `src/orb/interaction.ts` (hover/click handlers), `src/ui/hud.ts` (node count, project label, last voice query), `src/main.ts` (wires renderer + WebSocket, init order: scene first then WS). `public/index.html` shell. End-to-end: `vite build` passes, 05-voice-interface subprocess test against mocked 02-api-server, voice event appears in web-app handler. Tests run in both `03-web-app/` and `05-voice-interface/`.
