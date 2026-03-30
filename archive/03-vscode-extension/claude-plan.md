# Implementation Plan — 03-vscode-extension

## What We're Building

A VS Code extension that renders the DevNeural skill graph as a living, breathing 3D orb — a sphere of interconnected nodes that pulses and glows in real time as Claude sessions drive tool use across projects. The orb is always accurate to the current moment: connection colors rebalance continuously as usage patterns shift, live connections glow when they fire, and the camera intelligently focuses on whatever is active.

This component has two phases. First, it extends the existing data layer and API server to carry project-level metadata (stage tags read from `devneural.json` files). Second, it builds the VS Code extension itself: the extension host that owns the WebSocket connection, the Three.js webview that renders the orb, a context-aware camera, an HUD with search and filtering, and an offline-capable voice query system powered by Whisper running as WebAssembly in the webview.

The implementation is in TypeScript throughout. The extension host compiles to CommonJS for Node.js; the webview compiles to a self-contained browser IIFE bundle with Three.js and all dependencies inlined. esbuild handles both bundles.

---

## Part 1: Schema Pre-Work

### 1.0 Pre-Existing Schema Divergence (Reconcile First)

Before adding any new fields, the implementer must reconcile an existing mismatch between the data layer and API server `WeightsFile` types. The data layer writes `schema_version: 1` and `updated_at`, while the API server expects `version` and `last_updated`. These are the same concept under different field names. Step zero is aligning them: update the API server reader (or the data layer writer) so both use the same field names, and update their TypeScript types to match. Only after this reconciliation should stage/tags fields be added. This prevents amplifying an existing coupling bug.

The `ConnectionType` also diverges: the data layer defines 3 variants, the API server defines 4 (adding `tool->skill`). For this phase, the extension depends only on the API server's 4-variant type. The data layer misalignment is noted as cross-component tech debt but not fixed here.

### 1.1 devneural.json — The Per-Project Config Standard

Every project tracked by DevNeural must have a `devneural.json` at its root. This file is the canonical source of truth for project metadata and is what enables the orb to show stage tags on nodes. It also enforces the local folder hierarchy that makes path resolution from node IDs deterministic.

The required fields are: `name` (display name), `localPath` (absolute local path — this enforces the directory structure), `githubUrl` (canonical GitHub URL), `stage` (one of `alpha | beta | deployed | archived`), `tags` (array, any combination of `revision-needed | sandbox`), and `description` (short human-readable string).

A companion file `devneural.md` must be created at the project root alongside the schema — it explains the format in natural language for both human developers and Claude. It serves as the living documentation for the project registry, describing what each field means, how tags stack, and what changes to devneural.json trigger.

Both files should be created for every existing DevNeural project as part of this section.

### 1.2 Data Layer Updates (01-data-layer)

The hook logger (`src/hook-runner.ts`) fires on every tool use and writes a JSONL log entry. It must be updated to:

1. Locate `devneural.json` by walking up from the current working directory or using a configured root
2. Read and parse the `stage` and `tags` fields
3. Include those fields in the JSONL log entry (for audit/history purposes)

The `LogEntry` type (in `src/types.ts`) gains `stage` and `tags` optional fields. Importantly, stage/tags are **not** propagated into `weights.json` edge records — they are node-level metadata and do not belong in edge storage. The data layer change is limited to log enrichment only.

The `devneural.json` read is best-effort: if the file is missing or malformed, the hook runner logs a warning and proceeds without tags (never blocks a tool use). All unit tests for the hook runner must be updated or extended to cover: normal tag read, file not found, malformed JSON, devneural.json at various directory depths.

### 1.3 API Server Updates (02-api-server)

The `GraphNode` type gains `stage?: string`, `tags?: string[]`, and `localPath?: string` fields. These are populated **directly from `devneural.json` files** during graph building in `src/graph/builder.ts`, not from edge data. The graph builder scans the configured `localReposRoot` directory at startup (and re-scans on file-watcher events) to build a project registry: a `Map<nodeId, ProjectMeta>` keyed by `project:githubUrl`. When building `GraphNode` objects, the builder enriches them from this registry.

This is architecturally correct: stage tags describe nodes, so they must come from a node-level source. Including `localPath` in `GraphNode` means the extension host never needs to guess path resolution — it receives the exact path from the API server.

The `graph:snapshot` WebSocket message and all REST endpoints that return `GraphNode` arrays must include the new fields. The `getFullGraph`, `getNodeById`, `getSubgraph`, and `getTopEdges` query functions pass through the enriched nodes transparently since they work from the in-memory graph.

All existing tests must continue to pass. New tests assert that enriched nodes carry stage/tags when present and omit them gracefully when absent (for nodes that predate devneural.json adoption).

---

## Part 2: Extension Scaffold

### 2.1 Project Structure

```
03-vscode-extension/
├── src/
│   └── extension.ts          # Extension host entry point
├── webview/
│   ├── main.ts               # Scene bootstrap and message routing
│   ├── orb.ts                # Sphere constraint + three-forcegraph integration
│   ├── renderer.ts           # Three.js renderer, camera, controls
│   ├── nodes.ts              # Instanced mesh node rendering by type
│   ├── edges.ts              # Edge line rendering, relativistic color
│   ├── animation.ts          # Live glow, recency fade, ambient breathing
│   ├── camera.ts             # Context-aware automatic camera logic
│   ├── hud.ts                # HTML overlay: search input, legend, controls
│   ├── search.ts             # Query parsing and node/edge filtering
│   └── voice.ts              # Whisper WebAssembly speech-to-text
├── dist/
│   ├── extension.js          # CJS bundle
│   └── webview.js            # Browser IIFE bundle (~3-5MB)
├── esbuild.mjs
├── package.json              # Extension manifest
└── tsconfig.json
```

### 2.2 VS Code Extension Manifest

The `package.json` contributes one command (`devneural.openGraphView`), three configuration settings, and declares two activation events. The command appears in the Command Palette as "DevNeural: Open Graph View".

Configuration contributions:
- `devneural.apiServerHost` (string, default `"localhost"`) — just the hostname, no scheme. The extension constructs `ws://HOST:PORT/ws` for the WebSocket internally.
- `devneural.apiServerPort` (number, default `3747`, range 1024–65535)
- `devneural.localReposRoot` (string, default `""`) — the root directory where local project clones live; used to resolve `project:github.com/user/repo` node IDs to absolute paths like `/home/user/repos/user/repo`
- `devneural.recencyFading` (boolean, default `true`) — when enabled, edges less recently active than others in the graph render at reduced opacity; when disabled, all edges render at full opacity

Activation events: `onCommand:devneural.openGraphView` and `onWebviewPanel:devneuralGraph`. The second event restores the panel if VS Code is restarted with the panel open.

### 2.3 Build System (esbuild)

The `esbuild.mjs` script produces two bundles in a single pass:

**Extension host bundle**: Entry `src/extension.ts`, format `cjs`, platform `node`, `external: ['vscode']`. The `vscode` module is provided at runtime by VS Code and must not be bundled. All other dependencies (`ws`) are inlined. Output: `dist/extension.js`.

**Webview bundle**: Entry `webview/main.ts`, format `iife`, platform `browser`, no externals. Three.js (~400KB minified), `three-forcegraph`, and the `@huggingface/transformers` runtime (~2-3MB) are all inlined. The resulting bundle is approximately 3-5MB (not 600-800KB — the larger estimate properly accounts for the transformers runtime). The Whisper model weights are downloaded on first use — they are NOT bundled (models are 40-150MB). Output: `dist/webview.js`.

Both bundles use `sourcemap: true` in development and `minify: true` in production. TypeScript type checking runs separately via `tsc --noEmit` — esbuild strips types but does not check them.

The `package.json` `"vscode:prepublish"` script runs `esbuild.mjs --production`. `@vscode/vsce package` invokes this automatically before creating the `.vsix`. The `.vscodeignore` excludes `src/`, `webview/`, `node_modules/`, and includes only `dist/`.

---

## Part 3: Extension Host

### 3.1 Activation and Panel Management

The extension activates via the registered command. The `activate` function registers the command handler and, if the `onWebviewPanel` activation event fires, restores a previously-open panel.

A module-level variable tracks the single active panel instance (only one orb panel exists at a time). The command handler checks whether a panel exists and calls `reveal()` on it rather than creating a duplicate. On panel creation, `retainContextWhenHidden: true` is set — the Three.js scene is expensive to rebuild and must survive tab switches.

The panel's `onDidDispose` callback does three things: nullifies the panel variable (allowing GC), closes the WebSocket connection, and cancels any pending reconnect timers.

### 3.2 WebSocket Client

The extension host owns the WebSocket connection. It reads the server URL and port from settings on each connect, constructing `ws://localhost:3747/ws`. Reconnect logic uses exponential backoff (starting at 1s, capped at 30s) and retries indefinitely until the panel is disposed.

On `graph:snapshot` message receipt, the extension host does two things: relays the payload to the webview via `panel.webview.postMessage`, and serializes a capped subset of the payload to `context.workspaceState['devneural.lastGraph']` for persistence across restarts. The cache stores at most 500 edges (top by weight) to prevent the workspace state JSON from growing unbounded on large graphs.

On `connection:new` message receipt, the extension host relays the payload to the webview.

When `vscode.workspace.onDidChangeConfiguration` fires for any `devneural.*` key, the extension host tears down the current WebSocket and reconnects with the new settings.

### 3.3 State Persistence

When the panel is first created, before the WebSocket connects, the extension host checks `workspaceState['devneural.lastGraph']`. If a cached snapshot exists, it is sent to the webview immediately as the initial render. This prevents a blank orb during the reconnect window.

When the WebSocket delivers its first live `graph:snapshot`, it overwrites the cached state and updates the webview.

### 3.4 Webview HTML Generation

The `getWebviewContent` function generates the HTML shell sent to the webview. It:
1. Converts `dist/webview.js` to a webview URI via `webview.asWebviewUri()`
2. Generates a cryptographic nonce for the `<script>` tag
3. Constructs the CSP with `connect-src https:` (for Hugging Face model weight downloads). Note: `connect-src ws://` is intentionally absent — the webview never opens a WebSocket directly. The extension host owns the WebSocket and relays data via postMessage.
4. Returns minimal HTML with a full-viewport `<canvas>` and the `<script src>` referencing the webview URI

The canvas fills the entire panel. The HUD overlay is rendered as HTML DOM elements on top of it using absolute positioning.

---

## Part 4: Three.js Scene and Orb Layout

### 4.1 Scene Bootstrap

`renderer.ts` creates a `WebGLRenderer` with antialiasing, sets `devicePixelRatio` from `window.devicePixelRatio`, and sizes it to fill the canvas. A `PerspectiveCamera` (75° FOV) starts at a distance that frames the full sphere. `OrbitControls` are attached with `enableDamping: true` for smooth deceleration.

A `ResizeObserver` on the canvas element updates `renderer.setSize` and the camera aspect ratio on panel resize — necessary because VS Code webviews don't fire window resize events reliably.

Ambient and directional lights illuminate the scene. A subtle `FogExp2` adds depth — distant nodes and edges fade softly.

### 4.2 three-forcegraph Integration

`orb.ts` creates a `ThreeForceGraph` instance and adds it to the scene. The physics engine is set to `ngraph` (better performance at 100-500 nodes). `warmupTicks(150)` pre-runs the physics simulation before the first render so nodes don't start in a heap at the origin.

The `graphData` method accepts `{ nodes, links }`. The server sends `edges`; these are renamed to `links` on ingestion, and `edge.id` is preserved in the link object for glow/animation lookups. Links use `source` and `target` fields referencing node IDs — `three-forcegraph` resolves these to node objects internally.

**Graph size cap**: If the snapshot contains more than 500 nodes, only the top 300 edges by weight are loaded (plus their terminal nodes). A warning banner is shown in the HUD. This prevents multi-second warmup freezes on large graphs.

The sphere constraint is implemented as a custom d3-force applied to the simulation: each tick, nodes outside the target radius `R` are pulled toward the sphere surface with a configurable strength. The DevNeural center node is pinned at `(0, 0, 0)` using `fx/fy/fz` fixed-position fields.

**Loading state**: While `warmupTicks(150)` runs (which is synchronous and may take 750ms–3s on larger graphs), the webview displays a "Building graph..." overlay. The overlay is removed when `onFinishUpdate` fires after warmup completes.

When a `graph:snapshot` arrives, the graph data is transformed from the server's `{ nodes, edges }` format to `three-forcegraph`'s `{ nodes, links }` format and passed to `graphData()`. The library performs a diff internally to animate node/link additions and removals rather than rebuilding from scratch.

### 4.3 Node Rendering by Type

`nodes.ts` manages three `InstancedMesh` objects — one per node type. Using instanced meshes means one draw call per node type regardless of node count, which is essential for performance.

Geometry by type:
- `project`: a flat `BoxGeometry` with strongly unequal dimensions (very thin, like a piece of paper) — this reads as a file icon
- `tool`: a standard `BoxGeometry` (cube) or a custom gear mesh approximated with a torus + extrusions
- `skill`: an `OctahedronGeometry` — this reads as a diamond/crystal

For each node, a `Matrix4` is set on the `InstancedMesh` encoding position, rotation, and a uniform scale. Node size is constant (not weight-encoded — weight is encoded on edges). After any per-instance color change (e.g., search highlight), `instanceColor.needsUpdate = true` must be set on the `InstancedMesh` — without this flag, Three.js silently ignores color mutations.

Stage tag badges are managed as a **fourth `InstancedMesh`** (a thin `TorusGeometry`) rather than individual `Mesh` objects. Individual meshes would add one draw call per badge, defeating the instancing optimization. The badge mesh has one instance per project node that has a stage; nodes without a `devneural.json` entry simply have their badge instance scaled to zero.

### 4.4 Edge Rendering and Relativistic Color

`edges.ts` manages edge geometry. Each edge is a `Line2` (from `three/examples/jsm/lines/Line2`) which supports configurable line width. Uniform line thickness is used — width does not encode weight (color does).

**Relativistic color calculation**: On every `graph:snapshot`, the full weight distribution is computed — find the min and max weight across all edges. Each edge's weight is normalized within that range `[0, 1]`. This normalized value drives a color gradient from cool blue (low) through cyan/green (mid) to warm orange/red (high). Nothing is permanently a specific color — as new connections form and old ones fade, the entire distribution shifts and all colors rebalance. This computation runs in `search.ts` as a pure function and produces a `Map<edgeId, color>`.

---

## Part 5: Animation System

### 5.1 Live Connection Glow

When a `connection:new` message arrives, the corresponding edge is flagged as `active`. While active, its material emissive intensity is boosted and its opacity is raised to full. The edge stays in this boosted state until the next `graph:snapshot` arrives (which rebuilds the full graph with new weight distribution). On snapshot, all active flags are cleared.

If an edge from `connection:new` doesn't yet exist in the graph (the weights haven't been persisted yet), it is rendered as a temporary ephemeral edge at full brightness and removed when the next snapshot arrives. The `connection:new` payload contains no weight or timestamp fields, so ephemeral edges are constructed with synthetic defaults: `weight: 1.0` (forces maximum brightness in the relativistic color calculation), `first_seen: Date.now()`, `last_seen: Date.now()`, `raw_count: 1`.

### 5.2 Recency Fading

Each edge carries a `last_seen` timestamp. On every `graph:snapshot`, `animation.ts` computes a **relativistic recency score** — mirroring the color system's approach. The min and max `last_seen` values are found across all edges. Each edge's recency is normalized within that range: `score = (last_seen - min_last_seen) / (max_last_seen - min_last_seen)`. An edge with score 1.0 is the most recently active and renders at full opacity. An edge with score 0.0 is the least recently active and renders at minimum opacity (0.2).

This means: if all edges were last seen 6 months ago, nothing fades (they're all equally "stale"). Fading only appears when some edges are actively accumulating new connections while others are not. An edge's appearance degrades only because *other edges are being used more*, not because of clock time.

If only one unique `last_seen` value exists (or the range is zero), no fading is applied — all edges render at full opacity.

Recency fading can be disabled via the `devneural.recencyFading` setting (boolean, default `true`). When disabled, all edges render at full opacity regardless of activity distribution.

### 5.3 Ambient Breathing

When no `connection:new` events are arriving, the orb still feels alive via ambient animation. A slow sinusoidal pulse modulates edge `emissiveIntensity` between `0.0` and `0.4` at roughly a 3-second period — this is distinct from the `opacity` channel used by recency fading (Part 5.2). The two effects operate independently: opacity (recency) and emissiveIntensity (breathing) are separate material properties. There is no compounding that could make old edges invisible. Node scale breathes very slightly (±3%) at a 5-second period offset by node index — this prevents synchronized pulsing. The breathing animation runs in the main `requestAnimationFrame` loop.

---

## Part 6: Context-Aware Camera

### 6.1 Active Project Detection

The extension host tracks which project is "active" by listening to `vscode.window.onDidChangeActiveTextEditor`. When the editor changes, the active file's path is matched against project `localPath` values received from the API server's `GraphNode` objects (which now include `localPath` from Part 1.3). Matching is done by checking whether the active file path starts with a known `localPath`. If `localReposRoot` is empty or no match is found, active project detection is skipped and the camera stays in `full-sphere` mode. The matched active node IDs are sent to the webview via postMessage as a `setActiveProjects` message.

### 6.2 Automatic Camera Behavior

`camera.ts` maintains the auto-camera state machine with three states: `full-sphere` (no active projects), `single-focus` (one active project), and `multi-focus` (multiple active projects).

In `single-focus`, the camera smoothly orbits to face the active project node and zooms to show it and its immediate neighbors. The transition uses `TWEEN.js` (or a simple lerp) over 800ms with ease-in-out.

In `multi-focus`, the camera pulls back to frame all active project nodes within the view frustum — the zoom level is computed from the bounding sphere of the active node positions.

In `full-sphere`, the camera is at the default wide-angle position showing the entire orb.

Any user mouse interaction (orbit, zoom, pan) immediately transitions the camera to manual mode. A "Return to Auto" button in the HUD reactivates automatic mode.

---

## Part 7: HUD Overlay

### 7.1 Layout

The HUD is a set of HTML elements absolutely positioned over the canvas. It does not interfere with Three.js mouse events (pointer events are set to `none` on the canvas overlay container; individual interactive HUD elements set pointer events to `auto`).

HUD regions:
- **Top-left**: DevNeural logo/title, connection status indicator (WebSocket connected/disconnected)
- **Top-right**: Control mode toggle (Auto / Manual), "Reset View" button
- **Bottom-left**: Legend (shape → type, color gradient → strength, badge symbols → stage tags)
- **Bottom-center**: Search input and voice button

### 7.2 Search

The search input in `hud.ts` fires the query through `search.ts` on every keystroke (debounced at 150ms). The `search.ts` module accepts a query string and the current graph, and returns sets of matching node IDs and edge IDs.

Match criteria:
- Node label contains the query text (case-insensitive)
- Node type equals the query (e.g., "tool", "skill", "project")
- Stage tag matches the query (e.g., "sandbox", "beta")
- Connection type matches (e.g., "project->tool")

Reverse queries ("uses playwright", "connects to python") are detected heuristically and return nodes connected to the named target.

Matching nodes are highlighted by boosting their `InstancedMesh` color to white. Non-matching nodes and edges are dimmed to 20% opacity. The camera auto-focuses on the matching cluster if in auto mode.

---

## Part 8: Offline Voice Queries

### 8.0 Prerequisite Spike: Validate Microphone Access

**Before implementing voice, a mandatory spike must confirm that `navigator.mediaDevices.getUserMedia()` works inside a VS Code webview on the target platform.** VS Code webviews run inside Electron's iframe sandbox; microphone permissions require explicit `setPermissionRequestHandler` configuration in the extension host and may not be grantable at all. The spike is a 30-line extension that opens a webview, calls `getUserMedia`, and confirms audio capture.

If the spike fails on any of: VS Code desktop (Windows), VS Code desktop (Mac/Linux), or VS Code Remote, the voice feature is deferred to a follow-up. The rest of the orb (Parts 1-7, 9-10) proceeds regardless of the spike outcome.

### 8.1 Whisper via @huggingface/transformers

`voice.ts` uses `@huggingface/transformers` (v3+, the successor to the archived `@xenova/transformers`) to run OpenAI's Whisper model entirely in WebAssembly inside the webview. The model runs locally with no internet connection required after the first model download.

On first use, the pipeline (`pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny')`) downloads the model weights (~40MB for tiny, ~150MB for base). Model weights are stored via the browser's Cache API in the webview context. Note: if the webview panel is disposed (not just hidden — `retainContextWhenHidden` prevents disposal on hide), the cache may not persist and a re-download may be required. This is acceptable behavior and should be indicated with a progress UI. The user is shown a one-time "Downloading voice model..." progress indicator.

The mic button in the HUD initiates capture via the Web MediaRecorder API. Audio is captured while the button is held, then passed to the Whisper pipeline as a `Float32Array`. The transcription result (a text string) is routed directly to the search module — the same logic that handles typed queries.

### 8.2 Query Routing

Transcribed text undergoes simple intent detection in `search.ts`:
- "show all X" → filter to nodes/edges matching type or tag X
- "search for X" / "find X" → search query for X
- "zoom out" / "reset" → emit a camera reset event
- "focus on X" → activate single-focus camera on node matching X
- "show connections to X" → reverse search

Unrecognized queries fall back to a substring search across all node labels (same as the typed search path). The result is always a visual response on the orb — nodes highlight, camera adjusts if in auto mode.

### 8.3 Offline Behavior

All Whisper inference runs in the webview's WebAssembly runtime. No network requests are made during transcription or query processing. The orb can respond to voice queries about the locally-cached graph data even when the API server is unreachable.

---

## Part 9: Node Actions

When a user clicks a node in the Three.js scene, a raycaster check identifies the clicked instance from the `InstancedMesh`. The node ID is extracted from the instance index. A postMessage is sent to the extension host with the action type and node ID.

The extension host resolves the action:

**Project node click**: Uses the `localPath` field on the `GraphNode` object (populated by the API server from `devneural.json`). If `localPath` is set and the path exists on disk, calls `vscode.openFolder()`. If `localPath` is absent or the path doesn't exist, falls back to `vscode.env.openExternal()` with the GitHub URL derived from the node ID (`project:` prefix stripped).

**Tool or skill node click**: Sends a `filterToConnected(nodeId)` message back to the webview — highlights all project nodes connected to this tool/skill.

**GitHub button** (shown in tooltip on hover): `vscode.env.openExternal()` with the GitHub URL.

The hover tooltip is an HTML element in the HUD layer, positioned relative to the screen-space projection of the node's 3D position. It shows: node label, type, connection count, stage tag (if any), and last-seen timestamp.

---

## Part 10: Testing

### Extension Host Unit Tests (vitest, no VS Code)
The extension host logic is isolated from VS Code APIs via dependency injection patterns. Tests cover WebSocket lifecycle (connect, message relay, reconnect backoff), config parsing and validation, postMessage serialization, and workspaceState read/write mock.

### Extension Host Integration Tests (@vscode/test-electron)
These run in a real VS Code instance. They cover panel creation/reveal/dispose, command registration, and settings change triggering reconnect. The test runner launches VS Code with the extension installed from a test workspace.

### Webview Logic Tests (vitest, jsdom)
The webview modules that don't touch Three.js are tested in jsdom. Tests cover: graph data transformation (server format → three-forcegraph format), relativistic color calculation (deterministic given a weight distribution), search/filter matching logic, camera state machine transitions, and voice query intent detection.

### Cross-Component Integration Test
A test that spans all three components: fires a real data layer hook event (writing to the data directory) → waits for the API server to broadcast an updated `graph:snapshot` (via WebSocket) → confirms the extension host relays the snapshot via a mock postMessage sink. This test catches the type mismatches identified in Part 1.0 that unit tests per component cannot catch. It runs in CI as part of the API server's integration test suite (since that's the glue layer).

### Build Smoke Test
A script runs `vsce package --no-dependencies` and verifies the `.vsix` is produced without errors and contains `dist/extension.js` and `dist/webview.js`.

---

## Key Constraints and Cross-Cutting Concerns

**WebSocket ownership**: The extension host — never the webview — owns the WebSocket connection. This is required for Codespaces/Remote Development compatibility. The webview only receives data via postMessage.

**Three.js context**: `retainContextWhenHidden: true` is mandatory. A WebGL context lost on hide would require full scene reconstruction on reveal, which is expensive and breaks animation state.

**Relativistic color**: Colors are always computed fresh from the full weight distribution on every `graph:snapshot`. They are never stored or persisted. This ensures the orb reflects the current reality of the connection graph at all times.

**devneural.json availability**: Stage tags are best-effort. Nodes without `devneural.json` in their project still render and participate in the orb — they simply have no stage badge. The schema change in Part 1 is additive; old data without tags is valid.

**Voice model download**: The Whisper model download happens on-demand, not at extension install time. The first click of the mic button triggers the download with a progress indicator. The user is never blocked from using the orb just because the voice model hasn't downloaded yet.
