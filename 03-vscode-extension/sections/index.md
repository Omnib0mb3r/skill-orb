<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-schema
section-02-data-layer
section-03-api-server
section-04-scaffold
section-05-extension-host
section-06-threejs-scene
section-07-rendering
section-08-animation
section-09-camera-hud
section-10-node-actions
section-11-voice
section-12-integration
END_MANIFEST -->

# Implementation Sections Index — 03-vscode-extension

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-schema | - | 02, 03 | Yes |
| section-02-data-layer | 01 | 12 | Yes (with 03) |
| section-03-api-server | 01 | 05 | Yes (with 02) |
| section-04-scaffold | - | 05, 06 | Yes (with 01) |
| section-05-extension-host | 04, 03 | 09, 10, 12 | No |
| section-06-threejs-scene | 04 | 07 | No |
| section-07-rendering | 06 | 08, 09, 10 | No |
| section-08-animation | 07 | 12 | Yes (with 09, 10) |
| section-09-camera-hud | 07, 05 | 11, 12 | Yes (with 08, 10) |
| section-10-node-actions | 07, 05 | 12 | Yes (with 08, 09) |
| section-11-voice | 09 | 12 | No |
| section-12-integration | 02, 03, 05, 08, 09, 10, 11 | - | No |

## Execution Order

1. **section-01-schema**, **section-04-scaffold** — parallel (no dependencies on each other)
2. **section-02-data-layer**, **section-03-api-server** — parallel after 01
3. **section-05-extension-host** — after 04 and 03; **section-06-threejs-scene** — after 04
4. **section-07-rendering** — after 06
5. **section-08-animation**, **section-09-camera-hud**, **section-10-node-actions** — parallel after 07 (09 and 10 also need 05)
6. **section-11-voice** — after 09 (HUD must exist)
7. **section-12-integration** — final, depends on all

## Section Summaries

### section-01-schema
Reconcile the pre-existing WeightsFile type mismatch between 01-data-layer and 02-api-server (field names: `schema_version` vs `version`, `updated_at` vs `last_updated`). Define and document the `devneural.json` standard format: required fields, stage values, tag values. Create `devneural.json` and `devneural.md` companion files for all existing DevNeural projects.

### section-02-data-layer
Update `01-data-layer` hook runner to read `devneural.json` by walking up from cwd. Enrich JSONL log entries with `stage` and `tags`. Stage/tags do NOT flow into `weights.json` (log-only). Tests cover: normal read, file not found, malformed JSON, various directory depths.

### section-03-api-server
Update `02-api-server` graph builder to scan `localReposRoot` for `devneural.json` files and build a project registry. Enrich `GraphNode` objects with `stage`, `tags`, and `localPath`. File-watcher re-scan on devneural.json changes. All existing tests continue to pass; new tests assert enrichment.

### section-04-scaffold
Create the full `03-vscode-extension` project: directory structure, `package.json` manifest (command, settings including `devneural.recencyFading`, activation events), `tsconfig.json`, `esbuild.mjs` dual-bundle config. Stub `src/extension.ts` and `webview/main.ts`. Build smoke test passes.

### section-05-extension-host
Implement `src/extension.ts`: panel lifecycle (create/reveal/dispose), WebSocket client with exponential backoff reconnect (`ws://HOST:PORT/ws`), message relay to webview via postMessage, workspaceState cache (500-edge cap), settings change reconnect, active project detection from `GraphNode.localPath`. Tests cover all WebSocket lifecycle scenarios and postMessage serialization.

### section-06-threejs-scene
Implement `webview/renderer.ts` and `webview/orb.ts`: Three.js scene bootstrap (WebGLRenderer, PerspectiveCamera, OrbitControls, lighting, FogExp2), three-forcegraph integration with ngraph physics, sphere constraint force, warmup loading overlay, graph size cap (500 nodes → top 300 edges). Server `edges` renamed to `links` on ingestion.

### section-07-rendering
Implement `webview/nodes.ts` and `webview/edges.ts`: four InstancedMesh objects (project BoxGeometry, tool BoxGeometry/custom, skill OctahedronGeometry, stage badge TorusGeometry). `instanceColor.needsUpdate` pattern. Edge Line2 rendering with relativistic color calculation (normalize weight distribution → cool-to-warm gradient). Tests: pure color calculation function.

### section-08-animation
Implement `webview/animation.ts`: live connection glow on `connection:new` (ephemeral edges with synthetic defaults: weight 1.0, timestamps = now), cleared on next snapshot. Relativistic recency fading (normalize `last_seen` distribution → opacity 1.0–0.2; no fading when all equal; disabled by `devneural.recencyFading` setting). Ambient breathing via `emissiveIntensity` (edges) and scale (nodes) — independent of opacity channel.

### section-09-camera-hud
Implement `webview/camera.ts` and `webview/hud.ts`: camera state machine (full-sphere / single-focus / multi-focus / manual), smooth transitions via lerp over 800ms, bounding-sphere zoom for multi-focus. HUD: status indicator, Auto/Manual toggle, "Return to Auto" button, legend, search input (debounced 150ms). Search: `webview/search.ts` with node label, type, stage tag, connection type matching, reverse query detection, InstancedMesh highlight (white) + non-match dimming (0.2 opacity).

### section-10-node-actions
Implement click/hover raycasting in `webview/main.ts`: map InstancedMesh instance index → node id. Postmessage to extension host for project node click (opens local folder via `GraphNode.localPath` or falls back to GitHub URL) and tool/skill node click (filterToConnected). Hover tooltip positioned at screen-space node projection: label, type, connection count, stage, last_seen.

### section-11-voice
Implement `webview/voice.ts`: mandatory 30-line spike POC first (validate `getUserMedia` in VS Code webview). If spike passes: `@huggingface/transformers` pipeline for Whisper-tiny transcription. Mic button hold-to-record via MediaRecorder. Transcribed text routed through `search.ts` intent detection (show/search/find/zoom/focus/connections) with substring fallback. Progress indicator for model download. If spike fails: defer and remove voice.ts + mic button.

### section-12-integration
Cross-component integration test (data layer hook → API server broadcast → extension host relay). @vscode/test-electron integration tests for panel lifecycle and settings reconnect. Build smoke test (.vsix verification). Webview logic unit tests covering all pure functions not already tested in earlier sections.
