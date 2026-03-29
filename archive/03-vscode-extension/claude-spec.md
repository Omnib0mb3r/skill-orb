# Complete Specification — 03-vscode-extension

## Purpose

A VS Code extension (.vsix) that renders the DevNeural skill graph as a live, interactive 3D neural network visualization — a glowing, breathing "orb" of nodes and connections. Connects to the 02-api-server via WebSocket for real-time updates. Includes offline-capable voice queries. Requires prerequisite schema changes to the data layer and API server to support project-level metadata (stage tags).

---

## Pre-Work: Schema Changes Required First

Before any visualization work, the following must be defined and implemented:

### devneural.json — Per-Project Config File
A `devneural.json` file must live at the root of every project tracked by DevNeural. It defines project metadata and enforces the local folder hierarchy. Contents:
- `name`: project display name
- `localPath`: absolute local path (enforces consistent directory structure)
- `githubUrl`: canonical GitHub URL for the project
- `stage`: primary stage tag — one of `alpha | beta | deployed | archived`
- `tags`: array of secondary tags — any combination of `revision-needed | sandbox`
- `description`: short human-readable description

A `devneural.md` file explains this schema to both Claude and VS Code — serves as living documentation for the project registry format.

### Data Layer Changes (01-data-layer)
- The hook logger must read `devneural.json` from the active project root on each invocation
- Stage tags (`stage`, `tags`) must be included in the connection log entry written to JSONL
- The weights file accumulator must propagate stage tags into the WeightsFileEntry structure
- All TDD must be updated to cover the new fields

### API Server Changes (02-api-server)
- `GraphNode` must gain `stage` and `tags` fields sourced from connection data
- `graph:snapshot` WebSocket messages include the new node metadata
- `connection:new` messages include stage tags on the source node
- REST endpoints (`/graph`, `/graph/node/:id`, `/graph/subgraph`) return enriched nodes
- All existing tests must continue to pass; new tests cover the enriched schema

---

## Visualization Design: The Orb

### Structure
The orb is a sphere. Nodes are positioned on or near the sphere's surface using a constrained force-directed layout. **DevNeural itself** (the meta-project representing this entire system) is anchored at the center. Connection lines radiate inward from surface nodes toward center connections and laterally across the sphere between connected nodes.

### Node Visual Encoding

| Node Type | Shape | Visual |
|---|---|---|
| `project` | File icon | Tiny flat rectangle (sheet of paper) |
| `tool` | Cube or gear | Boxy/mechanical shape |
| `skill` | Octahedron / diamond | Faceted gem shape |

Node type is immediately readable from shape alone without requiring color.

Stage tags are shown as subtle **badges or rings** around the node — visual indicators that don't interfere with the connection color system:
- `alpha` / `beta` / `deployed` / `archived`: primary ring color or badge symbol
- `revision-needed`: secondary indicator (e.g., small pulsing ring)
- `sandbox`: distinct badge style (e.g., dashed ring)

### Edge Visual Encoding — Relativistic Color
Edge colors encode connection strength **relative to the current distribution** of all weights. Nothing has a fixed color.

| Relative strength | Color |
|---|---|
| Strongest (top ~20%) | Warm orange → red |
| Medium (middle ~60%) | Cyan → green |
| Weakest (bottom ~20%) | Cool blue |

Colors rebalance dynamically when the graph updates. As usage patterns shift, strong connections become orange and weak ones become blue — always relative.

### Animation
- **Live connection** (`connection:new` event): edge glows brighter, stays highlighted until the next `graph:snapshot` arrives
- **Recency fade**: connections used more recently appear more vivid; older/less-used connections fade slightly (derived from `last_seen` timestamp delta)
- The orb breathes — subtle ambient animations (gentle node drift, edge opacity pulse) make it feel alive even when no new data arrives

---

## Technical Architecture

### Extension Host (Node.js, CJS bundle)
- Owns the WebSocket connection to the API server
- Reads VS Code settings for server URL/port
- Relays graph data to the webview via `postMessage`
- Handles panel lifecycle: create, reveal, dispose
- Serializes last graph state to `ExtensionContext.workspaceState` for restart persistence
- Registers command `devneural.openGraphView`

### Webview (browser IIFE bundle, Three.js + three-forcegraph bundled in)
- Three.js scene with `WebGLRenderer`, `PerspectiveCamera`, `OrbitControls`
- `three-forcegraph` (`ThreeForceGraph` extends `Object3D`) for force-directed layout
- Custom sphere constraint: nodes are attracted to a sphere surface of radius R
- Instanced meshes for nodes (separate `InstancedMesh` per node type for performance)
- Offline-capable voice recognition: `@xenova/transformers` with Whisper model (WebAssembly, runs in webview without internet)

### Message Protocol (extension host ↔ webview)
Using `vscode-messenger` for typed JSON-RPC over postMessage:
```
Extension Host → Webview:
  graphSnapshot(payload: GraphSnapshotPayload)
  connectionNew(payload: ConnectionNewPayload)
  settingsUpdate(payload: SettingsPayload)

Webview → Extension Host:
  openProject(nodeId: string)
  openGitHub(nodeId: string)
  voiceQuery(text: string)   // after speech-to-text conversion in webview
  ready()                     // webview signals it's initialized
```

---

## Camera and Interaction

### Camera Modes
Two modes, toggleable from HUD:
1. **Automatic**: camera responds to active project detection and search results
   - Active single project → smooth camera orbit/zoom to focus on that node cluster
   - Multiple active projects → zoom out to frame all of them
   - Nothing active → full sphere view
2. **Manual**: user controls everything (orbit, zoom, pan) — Google Earth feel

Manual interaction always overrides automatic behavior immediately.

### Interactions
| Action | Result |
|---|---|
| Hover node | Tooltip: name, type, connection count, stage tags |
| Click project node | Open project folder in VS Code (`vscode.openFolder`) using `localPath` from devneural.json |
| Click tool/skill node | Filter view: highlight all projects connected to this node |
| Click edge | Highlight all edges in the same connection cluster |
| Click GitHub button (tooltip) | Open GitHub URL in browser (`vscode.env.openExternal`) |

### Search
- Text input in HUD
- Queries match: node name, node type, stage tags, connection type
- Matching nodes and their connections pulse/highlight distinctly
- Reverse-searchable: "what connects to X?" shows incoming edges

---

## Voice Queries (Offline-Capable)

### Implementation
- `@xenova/transformers` with the Whisper model (ONNX/WebAssembly)
- Runs entirely inside the VS Code webview — no internet required after initial model download
- Mic button in the HUD: press and speak, release to process
- Speech is transcribed locally → text is routed to the same search/filter logic as typed queries

### Supported Query Patterns
- "Show all sandbox projects"
- "Search for projects that use the playwright skill"
- "Show beta projects with revision needed"
- "Focus on DevNeural"
- "Show all connections to Python skill"
- "Zoom out" / "Reset view"

### Offline Behavior
When offline, voice recognition still works (WebAssembly model). The orb responds to queries about the locally-cached graph data. No cloud dependencies for any voice functionality in this component (section 05 will add AI assistant capabilities on top).

---

## Build System

### Project Structure
```
03-vscode-extension/
├── src/
│   └── extension.ts          # Extension host entry point
├── webview/
│   ├── main.ts               # Three.js scene, orb, voice
│   ├── graph.ts              # three-forcegraph integration
│   ├── camera.ts             # Context-aware camera
│   ├── voice.ts              # Whisper/WebAssembly voice
│   └── hud.ts                # HUD overlay
├── dist/
│   ├── extension.js          # CJS bundle (vscode external)
│   └── webview.js            # IIFE browser bundle (~600-800KB)
├── esbuild.mjs               # Dual bundle build script
├── package.json              # Extension manifest
└── tsconfig.json
```

### esbuild Dual Bundle
- Extension host: `format: 'cjs'`, `platform: 'node'`, `external: ['vscode']`
- Webview: `format: 'iife'`, `platform: 'browser'`, all deps inlined (Three.js + three-forcegraph + transformers)
- Build time: sub-second with esbuild

---

## VS Code Extension Manifest

### Activation Events
```json
"activationEvents": [
  "onCommand:devneural.openGraphView",
  "onWebviewPanel:devneuralGraph"
]
```

### Configuration Settings
```json
"devneural.apiServerUrl": string (default: "http://localhost")
"devneural.apiServerPort": number (default: 3747)
"devneural.localReposRoot": string (default: "")  // root folder for local project path resolution
```

### Webview Options
```json
enableScripts: true
retainContextWhenHidden: true   // Three.js scene persists when panel hidden
localResourceRoots: [dist/]
```

---

## State Persistence

On panel dispose or VS Code close:
- Serialize current graph snapshot to `ExtensionContext.workspaceState['devneural.lastGraph']`
- On panel restore (`onWebviewPanel` activation), send stored graph as initial `graph:snapshot` before WebSocket reconnects
- Prevents blank orb during reconnect window

---

## Performance Requirements
- Instanced meshes: one `InstancedMesh` per node type (project/tool/skill) — single draw call per type
- Level-of-detail: reduce geometry detail for nodes beyond a distance threshold from camera
- Physics: use `ngraph` force engine (faster for 200+ nodes); pre-converge with `warmupTicks(100).cooldownTicks(200)` before first render
- Target: 60fps with up to 500 nodes on modern hardware

---

## Testing Strategy

### Extension Host (unit, no VS Code)
- WebSocket client lifecycle (connect, reconnect, message routing)
- Config reading and validation
- postMessage serialization/deserialization
- State persistence (workspaceState read/write)

### Extension Host (integration, @vscode/test-electron)
- Panel creation and disposal
- Command registration and execution
- Setting change triggers reconnect

### Webview Logic (vitest, jsdom)
- Graph data transformation for three-forcegraph format
- Relativistic color calculation
- Search/filter matching logic
- Camera mode state machine
- Voice query text routing

### Build Verification
- `vsce package --no-dependencies` produces valid .vsix
- Both bundles (extension.js, webview.js) build without errors

---

## Dependencies

**Runtime (extension host):**
- `vscode` (provided by host)
- `ws` (WebSocket client)
- `vscode-messenger` (typed postMessage)

**Runtime (webview bundle):**
- `three`
- `three-forcegraph`
- `@types/three`
- `@xenova/transformers` (offline Whisper)
- `vscode-messenger-webview`

**Dev:**
- `esbuild`
- `typescript`
- `@vscode/vsce`
- `@vscode/test-electron`
- `vitest`
