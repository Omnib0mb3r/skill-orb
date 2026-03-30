# Research Findings — 03-vscode-extension

## 1. 02-api-server Interface (What the Extension Consumes)

### Server Configuration
- Default port: **3747** (env: `PORT`)
- Data root: `C:/dev/data/skill-connections` (env: `DEVNEURAL_DATA_ROOT`)
- Host: `127.0.0.1` only
- WebSocket endpoint: `ws://localhost:3747/ws`

### WebSocket Protocol — Two Message Types

**`graph:snapshot`** — sent immediately on connect, and on every weights.json change:
```typescript
{
  type: "graph:snapshot",
  payload: {
    nodes: GraphNode[],
    edges: GraphEdge[],
    updated_at: string  // ISO 8601
  }
}
```

**`connection:new`** — sent for each new live log entry (not startup):
```typescript
{
  type: "connection:new",
  payload: {
    tool_use_id: string,
    connection_type: string,
    source_node: string,    // full node id e.g. "project:github.com/user/repo"
    target_node: string,
    timestamp: string       // ISO 8601
  }
}
```

### Graph Data Types

```typescript
interface GraphNode {
  id: string;   // format: "type:label" e.g. "project:repo", "tool:github", "skill:Python"
  type: 'project' | 'tool' | 'skill';
  label: string;  // everything after first colon
}

interface GraphEdge {
  id: string;                 // "source||target"
  source: string;             // full node id
  target: string;             // full node id
  connection_type: 'project->tool' | 'project->project' | 'project->skill' | 'tool->skill';
  raw_count: number;
  weight: number;             // normalized 0–1, edges pre-sorted descending
  first_seen: string;         // ISO 8601
  last_seen: string;          // ISO 8601
}
```

### REST Endpoints
| Endpoint | Description |
|---|---|
| `GET /health` | `{ status: 'ok', uptime: number }` |
| `GET /graph` | Full graph (all nodes + edges) |
| `GET /graph/node/:id` | Single node + its edges |
| `GET /graph/subgraph?project=<id>` | Edges touching one project |
| `GET /graph/top?limit=N` | Top N edges by weight |
| `GET /events?limit=N` | Recent log entries (default 50, max 500) |

### Key Design Facts
- Node types: `project`, `tool`, `skill` (parsed from ID prefix)
- Edges are sorted descending by weight at build time
- Full graph rebuild on every weights.json change (no incremental)
- Server binds to `127.0.0.1` only — never a remote address

---

## 2. VS Code Webview CSP + WebSocket + Three.js

### Content Security Policy
The minimal CSP for a webview loading a local JS bundle:
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src ${webview.cspSource} 'nonce-{NONCE}';
           style-src ${webview.cspSource};
           img-src ${webview.cspSource} https:;
           connect-src ws://localhost:3747 ws://127.0.0.1:3747;">
```

- `${webview.cspSource}` is a VS Code-provided token — never hardcode `vscode-webview://`
- Inline scripts require `nonce-{NONCE}` (generate per-panel, not `'unsafe-inline'`)
- WebSocket to localhost: add `connect-src ws://localhost:PORT ws://127.0.0.1:PORT`
- No `'unsafe-eval'` needed — Three.js works fine when bundled ahead of time

### WebSocket Architecture Decision: postMessage Relay (Recommended)

**Direct WebSocket from webview to localhost is fragile** — works on local desktop but breaks in GitHub Codespaces and Remote Development. The correct architecture:

```
API Server → WebSocket → Extension Host (Node.js) → postMessage → Webview
```

- Extension host opens and owns the WebSocket connection
- Graph updates relayed to webview via `panel.webview.postMessage()`
- Webview sends messages back via `vscode.postMessage()` → `panel.webview.onDidReceiveMessage`
- Use **`vscode-messenger`** (`vscode-messenger`, `vscode-messenger-webview`, `vscode-messenger-common` packages) for typed JSON-RPC over the postMessage channel

### Loading Three.js Safely
1. Bundle Three.js into the webview JS file (esbuild — see section 4)
2. Convert path in extension host: `webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'))`
3. Set `localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]`
4. Reference the resulting URI in the webview HTML `<script src>` tag
5. Never use raw `file://` paths — always use `asWebviewUri()`

---

## 3. Three.js Force-Directed 3D Graph

### Library Choice: `three-forcegraph`

Two library tiers from the same author (Vasturiano):

| Library | npm | Use when |
|---|---|---|
| `3d-force-graph` | standalone | You want a self-contained component with its own renderer |
| **`three-forcegraph`** | THREE.Object3D | **You control the Three.js scene** — correct choice here |

**Use `three-forcegraph`** — it extends `THREE.Object3D`, plugs into our scene, and we call `graph.tickFrame()` each animation frame.

### Physics Engine: d3 vs ngraph

| Engine | Flag | Best for |
|---|---|---|
| `d3-force-3d` (default) | `forceEngine('d3')` | Rich config, DAG support, ≤200 nodes |
| `ngraph.forcelayout` | `forceEngine('ngraph')` | Better perf, 200–500 nodes |

### Performance Guidelines (50–500 nodes)
- **50–200 nodes**: Both engines fine at 60fps with defaults
- **200–500 nodes**: Switch to `ngraph`; reduce `nodeResolution` from 8 → 4–6; use `warmupTicks(100).cooldownTicks(200)` to pre-converge before first render
- **500+ nodes**: Physics on main thread becomes problematic; Web Worker required (not built-in to library)

### Integration Pattern
```typescript
import * as THREE from 'three';
import ThreeForceGraph from 'three-forcegraph';

const graph = new ThreeForceGraph()
  .graphData({ nodes: [...], links: [...] })
  .nodeLabel('id')
  .nodeAutoColorBy('type')     // color by node type
  .forceEngine('ngraph')       // better perf for our scale
  .nodeResolution(6)
  .warmupTicks(100)
  .cooldownTicks(200);

scene.add(graph);

function animate() {
  requestAnimationFrame(animate);
  graph.tickFrame();           // advance physics + update Three.js objects
  renderer.render(scene, camera);
}
```

---

## 4. Webview Asset Bundling: esbuild (Recommended)

### Why esbuild over webpack/vite
- webpack: official docs still use it, but slow (10–50s builds); legacy choice
- Vite: dropped CJS in v6 — VS Code extensions require CJS API; avoid
- **esbuild**: sub-second builds, minimal config, handles TS natively; community standard in 2025/2026

### Dual-Bundle Structure
```
project/
├── src/
│   └── extension.ts        # Extension host (Node.js CJS)
├── webview/
│   └── main.ts             # Webview UI (browser, Three.js bundled in)
├── dist/
│   ├── extension.js        # CJS bundle, 'vscode' external
│   └── webview.js          # IIFE browser bundle, Three.js inlined (~500KB)
├── esbuild.mjs
└── package.json
```

### esbuild Configuration
```javascript
// Bundle 1: Extension host
{ entryPoints: ['src/extension.ts'], format: 'cjs', platform: 'node',
  external: ['vscode'], outfile: 'dist/extension.js' }

// Bundle 2: Webview (Three.js + three-forcegraph bundled in)
{ entryPoints: ['webview/main.ts'], format: 'iife', platform: 'browser',
  outfile: 'dist/webview.js' }
```

### vsce Packaging
- `"main": "./dist/extension.js"` in package.json
- `"vscode:prepublish": "node esbuild.mjs --production"`
- `.vscodeignore`: exclude `src/**`, `webview/**`, `node_modules/**`; include `dist/**`

---

## 5. Extension Settings + Activation + Lifecycle

### Activation Events
```json
"activationEvents": [
  "onCommand:devneural.openGraphView",
  "onWebviewPanel:devneuralGraph"
]
```
- `onCommand` fires when user runs the command
- `onWebviewPanel` restores panel state after VS Code restart

### Configuration Contributions
```json
"contributes": {
  "configuration": {
    "title": "DevNeural",
    "properties": {
      "devneural.apiServerUrl": {
        "type": "string", "default": "http://localhost",
        "description": "Base URL of the DevNeural API server"
      },
      "devneural.apiServerPort": {
        "type": "number", "default": 3747, "minimum": 1024, "maximum": 65535,
        "description": "Port for the DevNeural API server"
      }
    }
  }
}
```

### `retainContextWhenHidden`
| Setting | Effect |
|---|---|
| `true` | Webview JS heap + WebGL context kept alive when hidden — Three.js scene persists |
| `false` (default) | Webview fully destroyed; WebGL context lost and must be rebuilt on reveal |

**Use `retainContextWhenHidden: true`** for Three.js. Rebuilding the renderer + scene + force layout is expensive. Memory cost is justified.

### Panel Lifecycle Pattern
```typescript
let currentPanel: vscode.WebviewPanel | undefined;

function openGraphView(context: vscode.ExtensionContext) {
  if (currentPanel) { currentPanel.reveal(); return; }

  currentPanel = vscode.window.createWebviewPanel(
    'devneuralGraph', 'DevNeural Graph', vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] }
  );

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    // cancel WebSocket, timers, etc.
  }, null, context.subscriptions);
}
```

---

## 6. Testing Approach

### Extension Host Tests
- Use **`@vscode/test-electron`** (formerly `vscode-test`) for integration tests that run inside a VS Code instance
- Unit tests (config parsing, message routing, WebSocket reconnect logic) can use **vitest** or **mocha** without VS Code
- Mock the `vscode` module for pure unit tests

### Webview Tests
- Webview JS (Three.js scene logic, graph update handlers) can be unit-tested with **vitest** in `jsdom` environment
- Three.js requires a mock WebGL context — use **`jest-canvas-mock`** or similar, or skip GL-dependent tests and focus on data transformation logic

### Build Verification
- `vsce package --no-dependencies` to verify the .vsix builds clean
- Check that `dist/webview.js` loads in a minimal HTML page (sanity check before full extension test)

---

## Sources

- VS Code Extension API — Webview: https://code.visualstudio.com/api/extension-guides/webview
- VS Code Bundling Extensions: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- VS Code Activation Events: https://code.visualstudio.com/api/references/activation-events
- Supporting Remote Development: https://code.visualstudio.com/api/advanced-topics/remote-extensions
- vscode-messenger (TypeFox): https://www.typefox.io/blog/vs-code-messenger/
- three-forcegraph: https://github.com/vasturiano/three-forcegraph
- 3d-force-graph: https://github.com/vasturiano/3d-force-graph
- VS Code WebSocket issue #105982: https://github.com/microsoft/vscode/issues/105982
- esbuild for VS Code extensions (Medium): https://medium.com/@aga1laoui/create-advanced-vscode-extension-w-react-webview-esbuild-bundler-eslint-airbnb-and-prettier-2ba2e3893667
- Vite for VS Code (Elio Struyf): https://www.eliostruyf.com/vite-bundling-visual-studio-code-extension/
