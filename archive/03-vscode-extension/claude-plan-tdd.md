# TDD Plan — 03-vscode-extension

Testing stack: **vitest** (unit + webview logic, jsdom), **@vscode/test-electron** (integration). All unit tests run without VS Code. webview GL-dependent tests are skipped; data transformation and state logic are fully tested.

---

## Part 1: Schema Pre-Work

### 1.0 Pre-Existing Schema Divergence

Tests for the reconciliation step (run against the data layer and API server, not the extension):

```
// Data layer writer + API server reader alignment
// Test: GraphBuilder reads weights.json written by data layer without field-name errors
// Test: WeightsFile type has aligned field names between 01-data-layer/src/types.ts and 02-api-server/src/graph/types.ts
// Test: Reading a weights.json with old field names (schema_version/updated_at) produces a recoverable error or fallback, not a silent wrong value
```

### 1.1 devneural.json — Per-Project Config Standard

```
// devneural.json schema validation (data layer or shared module)
// Test: Valid devneural.json with all required fields passes schema validation
// Test: Missing required field (e.g., stage) fails validation with clear error message
// Test: Invalid stage value (not alpha|beta|deployed|archived) fails validation
// Test: tags array with unrecognized tag value fails validation
// Test: localPath as relative path fails validation (must be absolute)
```

### 1.2 Data Layer Updates (hook-runner enrichment)

```
// hook-runner.ts — devneural.json reading
// Test: hook-runner finds devneural.json in current directory and reads stage+tags into LogEntry
// Test: hook-runner walks up 3 levels to find devneural.json and reads it correctly
// Test: hook-runner with no devneural.json in path logs warning and proceeds without stage/tags (no throw)
// Test: hook-runner with malformed JSON in devneural.json logs warning and proceeds without stage/tags
// Test: hook-runner with devneural.json missing 'stage' field logs warning and omits stage from LogEntry
// Test: LogEntry type includes optional stage?: string and tags?: string[]
// Test: Weights accumulator does NOT write stage/tags fields to WeightsFileEntry (they are log-only)
```

### 1.3 API Server Updates (graph builder enrichment)

```
// graph/builder.ts — devneural.json registry scan
// Test: GraphBuilder scans localReposRoot and builds project registry Map<nodeId, ProjectMeta>
// Test: GraphNode for a project with devneural.json gets stage, tags, localPath populated
// Test: GraphNode for a project without devneural.json gets stage/tags/localPath omitted (not null, not empty string)
// Test: graph:snapshot WebSocket message includes stage/tags/localPath on enriched nodes
// Test: graph:snapshot with unenriched nodes does not break deserialization (fields are optional)
// Test: GraphBuilder re-scans on file-watcher event and updates the registry
// Test: Registry scan is non-blocking — missing or inaccessible localReposRoot logs a warning, does not crash the server
```

---

## Part 2: Extension Scaffold

### 2.1 Project Structure

```
// Build smoke test
// Test: `node esbuild.mjs` produces dist/extension.js (CJS format check: first line is require/module.exports pattern)
// Test: `node esbuild.mjs` produces dist/webview.js (IIFE format check: wraps in self-executing function)
// Test: dist/extension.js does not contain the string 'vscode' as an inline bundle (must remain external)
// Test: dist/webview.js contains 'THREE' or 'three' (Three.js bundled in)
```

### 2.2 VS Code Extension Manifest

```
// package.json contributions (static validation — no runtime needed)
// Test: package.json has "devneural.openGraphView" in contributes.commands
// Test: package.json apiServerHost contribution has type "string" and default "localhost"
// Test: package.json apiServerPort contribution has type "number", default 3747, min 1024, max 65535
// Test: package.json activationEvents includes "onCommand:devneural.openGraphView"
// Test: package.json activationEvents includes "onWebviewPanel:devneuralGraph"
```

### 2.3 Build System

```
// esbuild.mjs produces correct bundles — covered by 2.1 smoke tests above
// Test: Production build (--production flag) produces minified output (file size < development)
// Test: Source maps are present in development build (dist/*.js.map exists)
// Test: .vsix package is created by `vsce package --no-dependencies` and contains dist/extension.js and dist/webview.js
// Test: .vsix does not contain src/, webview/, or node_modules/ directories
```

---

## Part 3: Extension Host

### 3.1 Activation and Panel Management

```
// vitest with vscode mock
// Test: openGraphView command creates a new panel when none exists
// Test: openGraphView called a second time reveals the existing panel instead of creating a new one (panel.reveal called)
// Test: panel.onDidDispose sets currentPanel to undefined
// Test: panel.onDidDispose closes the WebSocket connection
// Test: panel.onDidDispose cancels any pending reconnect timers
// Test: retainContextWhenHidden is true in panel creation options
```

### 3.2 WebSocket Client

```
// Test: WebSocket connects to ws://HOST:PORT/ws using apiServerHost + apiServerPort settings
// Test: On message type "graph:snapshot", payload is relayed to webview via postMessage
// Test: On message type "connection:new", payload is relayed to webview via postMessage
// Test: On WebSocket close, reconnect is scheduled with 1-second initial delay
// Test: Reconnect delays follow exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped)
// Test: Reconnect loop stops when panel is disposed
// Test: Config change on devneural.* key tears down the current WebSocket and creates a new one with new URL
// Test: graph:snapshot caches at most 500 edges (top by weight) to workspaceState
```

### 3.3 State Persistence

```
// Test: On panel creation, if workspaceState['devneural.lastGraph'] exists, it is sent to webview immediately
// Test: On first live graph:snapshot, workspaceState is updated with the new (capped) snapshot
// Test: workspaceState read on a fresh workspace (no cached data) does not throw
// Test: Cached snapshot with >500 edges is trimmed to 500 by weight before storing
```

### 3.4 Webview HTML Generation

```
// Test: getWebviewContent returns HTML containing a <canvas> element
// Test: Generated HTML includes a nonce attribute on the <script> tag
// Test: Generated CSP contains connect-src https:
// Test: Generated CSP does NOT contain connect-src ws:// (webview never opens WebSocket)
// Test: Generated CSP contains script-src with webview.cspSource and the nonce
// Test: Script src attribute uses a webview URI (starts with vscode-webview://)
```

---

## Part 4: Three.js Scene and Orb Layout

### 4.1 Scene Bootstrap

```
// vitest / jsdom — mock WebGL, skip renderer.render assertions
// Test: Renderer is created with antialiasing option
// Test: Camera starts at distance that frames a sphere of radius R
// Test: OrbitControls are created with enableDamping: true
// Test: ResizeObserver callback updates renderer size and camera aspect
```

### 4.2 three-forcegraph Integration

```
// Test: graphData({ nodes: [], links: [] }) does not throw
// Test: Server edges are renamed to links before passing to graphData (edges key absent in input)
// Test: Edge id is preserved in the link object after renaming
// Test: Graph size cap: if snapshot has >500 nodes, only top 300 edges (by weight) are loaded
// Test: When graph is capped, the HUD receives a warning message with the node/edge counts
// Test: Loading overlay is shown before warmupTicks, removed after onFinishUpdate fires
```

### 4.3 Node Rendering by Type

```
// Test: nodes.ts creates 3 InstancedMesh objects (one per node type: project, tool, skill)
// Test: nodes.ts creates 1 InstancedMesh for stage badges (TorusGeometry)
// Test: setNodePositions updates Matrix4 for each instance from current force layout
// Test: After setColorAt for search highlight, instanceColor.needsUpdate is set to true
// Test: Project node has geometry type BoxGeometry with unequal dimensions
// Test: Skill node has geometry type OctahedronGeometry
// Test: Badge InstancedMesh scale is set to zero for nodes without a stage value
// Test: Badge color encodes stage: different Color values for alpha/beta/deployed/archived
```

### 4.4 Edge Rendering and Relativistic Color

```
// Test: relativistic color with all-equal weights returns same color for all edges
// Test: relativistic color with weight 0 returns cool blue (hue > 180)
// Test: relativistic color with weight 1 (max) returns warm red/orange (hue < 30)
// Test: relativistic color with a mid-range weight returns green/cyan (hue ~120–180)
// Test: color calculation is a pure function: same input → same output
// Test: color Map is keyed by edge id and has exactly one entry per edge
```

---

## Part 5: Animation System

### 5.1 Live Connection Glow

```
// Test: On connection:new, the corresponding edge material emissiveIntensity is boosted
// Test: On connection:new for a non-existent edge, an ephemeral edge is created
// Test: Ephemeral edge has weight 1.0, first_seen = now, last_seen = now, raw_count = 1
// Test: On next graph:snapshot, all active glow flags are cleared
// Test: On next graph:snapshot, all ephemeral edges are removed from the scene
```

### 5.2 Recency Fading (Relativistic)

```
// Test: computeRelativeRecency([e1, e2, e3]) — most recently active edge gets score 1.0
// Test: computeRelativeRecency([e1, e2, e3]) — least recently active edge gets score 0.0
// Test: computeRelativeRecency where all edges have the same last_seen → all scores are 1.0 (no fading)
// Test: computeRelativeRecency single-edge graph → score 1.0 (no range → no fading)
// Test: Edge with score 1.0 (most recent) has opacity 1.0
// Test: Edge with score 0.0 (least recent relative to graph) has opacity 0.2
// Test: Edge with score 0.5 has opacity ~0.6
// Test: recency uses material.opacity and does NOT modify material.emissiveIntensity
// Test: When devneural.recencyFading = false, all edges have opacity 1.0 regardless of last_seen distribution
```

### 5.3 Ambient Breathing

```
// Test: breathe(t=0) returns emissiveIntensity 0.0 (minimum)
// Test: breathe(t=period/2) returns emissiveIntensity ~0.4 (maximum)
// Test: breathe uses material.emissiveIntensity and does NOT modify material.opacity
// Test: Node scale at breathe(t=0) is base scale (breathing offset 0)
// Test: Node scale at breathe(t=5s, offset=0) differs from breathe(t=5s, offset=index*100ms)
```

---

## Part 6: Context-Aware Camera

### 6.1 Active Project Detection

```
// Test: active file path matching localPath — exact prefix match returns the correct node id
// Test: active file path matching localPath — non-matching path returns no active nodes
// Test: active file path matching localPath — empty localReposRoot/empty localPath produces no match (no throw)
// Test: setActiveProjects postMessage is sent on editor change with the matched node ids
// Test: setActiveProjects with empty array is sent when no match found (not omitted)
```

### 6.2 Automatic Camera Behavior

```
// Test: camera starts in full-sphere state when activeProjects is empty
// Test: setActiveProjects([nodeId]) transitions to single-focus state
// Test: setActiveProjects([id1, id2]) transitions to multi-focus state
// Test: manual orbit interaction transitions camera to manual state
// Test: "Return to Auto" button event transitions camera back to full-sphere state
// Test: camera state machine does not transition from manual to auto on setActiveProjects while in manual mode
```

---

## Part 7: HUD Overlay

### 7.1 Layout

```
// vitest / jsdom
// Test: HUD container is absolutely positioned and has pointer-events: none
// Test: Individual interactive HUD elements (buttons, inputs) have pointer-events: auto
// Test: WebSocket status indicator updates to "connected" on graph:snapshot receipt
// Test: WebSocket status indicator updates to "disconnected" on connection close
```

### 7.2 Search

```
// Test: Empty query returns all nodes and edges as matches (no dimming)
// Test: Query "tool" returns all tool-type nodes
// Test: Query matching a node label returns that node and its connected edges
// Test: Query matching a stage tag (e.g., "beta") returns project nodes with that tag
// Test: Query "project->tool" returns all project->tool edges
// Test: Reverse query detection: "uses playwright" → finds project nodes connected to "playwright" tool node
// Test: Unrecognized query falls back to substring match on node labels
// Test: Non-matching nodes have opacity reduced to 0.2
// Test: Matching nodes have InstancedMesh color boosted to white (rgb 1,1,1)
// Test: Search debounce: rapid keystrokes within 150ms fire only one search call
```

---

## Part 8: Offline Voice Queries

### 8.0 Prerequisite Spike

```
// Spike POC test (manual validation — not automated):
// Test: VS Code webview POC can call navigator.mediaDevices.getUserMedia({ audio: true })
// Test: Audio capture returns a MediaStream with at least one audio track
// Test: Confirmation that the above works on VS Code desktop (Windows and Mac)
// If any of the above fails → voice feature is deferred; remove voice.ts and hud mic button
```

### 8.1 Whisper via @huggingface/transformers

```
// Test: voice.ts imports from '@huggingface/transformers' (not '@xenova/transformers')
// Test: initVoicePipeline() does not throw if called before microphone permission granted
// Test: "Downloading voice model..." progress state is emitted before model weights are fetched
// Test: transcribe(Float32Array) returns a string (mocked pipeline in unit test)
```

### 8.2 Query Routing

```
// Test: "show all tools" → search query for type:tool
// Test: "search for python" → search query for "python"
// Test: "find python" → search query for "python"
// Test: "zoom out" / "reset" → camera reset event emitted
// Test: "focus on DevNeural" → single-focus camera on node with label "DevNeural"
// Test: "show connections to playwright" → reverse search for "playwright"
// Test: Unrecognized phrase → substring search on all node labels
```

### 8.3 Offline Behavior

```
// Test: voice pipeline invocation makes no network requests after model is cached
// Test: search queries work while WebSocket is disconnected (operates on last-known graph snapshot)
```

---

## Part 9: Node Actions

```
// vitest with vscode mock
// Test: Project node click with valid localPath calls vscode.openFolder with that path
// Test: Project node click when localPath absent falls back to vscode.env.openExternal with GitHub URL
// Test: Project node click when localPath not found on disk falls back to vscode.env.openExternal
// Test: Tool/skill node click sends filterToConnected(nodeId) postMessage to webview
// Test: GitHub button click calls vscode.env.openExternal with the GitHub URL derived from node id
// Test: Hover tooltip is positioned at the screen-space projection of the node's 3D position
// Test: Tooltip shows: label, type, connection count, stage (if present), last_seen
// Test: Raycaster correctly maps instance index to node id in InstancedMesh
```

---

## Part 10: Integration and Build

### Cross-Component Integration Test

```
// @vscode/test-electron or standalone Node integration test
// Test: Write a JSONL event to the data directory → API server broadcasts graph:snapshot → extension host relays via postMessage sink within 5 seconds
// Test: connection:new broadcast triggers extension host to relay to webview postMessage sink
// Test: Extension host correctly unpacks stage/tags/localPath from GraphNode in graph:snapshot
```

### Extension Host Integration Tests (@vscode/test-electron)

```
// Test: Command "devneural.openGraphView" opens a webview panel titled "DevNeural Graph"
// Test: Running the command twice opens only one panel (second call reveals, not creates)
// Test: Settings change to devneural.apiServerPort closes old WebSocket and opens new one
```

### Build Smoke Test

```
// Test: `vsce package --no-dependencies` completes without errors
// Test: .vsix contains dist/extension.js
// Test: .vsix contains dist/webview.js
// Test: .vsix does not contain src/, webview/, or node_modules/ paths
```
