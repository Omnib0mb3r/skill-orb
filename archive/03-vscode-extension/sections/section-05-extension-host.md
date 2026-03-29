# section-05-extension-host

## Overview

This section implements `src/extension.ts` — the VS Code extension host entry point. The extension host owns the WebSocket connection to the DevNeural API server, manages a single Webview panel, relays server messages to the webview via postMessage, caches the last graph snapshot in `workspaceState`, and detects the active project by watching the text editor. Nothing in this section touches Three.js or the webview bundle.

## Dependencies

- **section-04-scaffold**: Project structure, `package.json`, `tsconfig.json`, `esbuild.mjs`, stub `src/extension.ts`, and npm deps must exist.
- **section-03-api-server**: The extension host consumes `GraphNode` objects that include `stage`, `tags`, and `localPath` fields.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `03-vscode-extension/src/extension.ts` | Replace stub — full implementation |
| `03-vscode-extension/src/types.ts` | Create — shared TypeScript types |
| `03-vscode-extension/src/wsClient.ts` | Create — WebSocket client with reconnect logic |
| `03-vscode-extension/src/panelManager.ts` | Create — panel lifecycle + webview HTML |
| `03-vscode-extension/src/activeProject.ts` | Create — active project detection logic |
| `03-vscode-extension/src/graphCache.ts` | Create — workspaceState cache with edge cap |
| `03-vscode-extension/src/__tests__/extension.test.ts` | Create — vitest unit tests |

All paths are absolute: `C:\dev\tools\DevNeural\03-vscode-extension\src\...`

---

## Tests First

Tests run with vitest using the VS Code API mock from `src/__mocks__/vscode.ts` (created in section-04-scaffold).

### Panel lifecycle tests (3.1)

```typescript
describe('panel lifecycle', () => {
  it('openGraphView creates a new panel when none exists')
  it('openGraphView called a second time calls panel.reveal instead of creating a duplicate')
  it('panel.onDidDispose sets currentPanel to undefined')
  it('panel.onDidDispose closes the WebSocket connection')
  it('panel.onDidDispose cancels any pending reconnect timer (clearTimeout is called)')
  it('panel is created with retainContextWhenHidden: true')
})
```

### WebSocket client tests (3.2)

```typescript
describe('WebSocket client', () => {
  it('connects to ws://HOST:PORT/ws using apiServerHost and apiServerPort from settings')
  it('on message type "graph:snapshot", relays parsed payload to webview via postMessage')
  it('on message type "connection:new", relays parsed payload to webview via postMessage')
  it('on WebSocket close, schedules reconnect with 1-second initial delay')
  it('reconnect delays follow exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (hard cap)')
  it('reconnect loop does not fire after panel is disposed')
  it('config change on a devneural.* key tears down current WebSocket and starts new connection')
  it('graph:snapshot caches at most 500 edges sorted by weight descending to workspaceState')
})
```

### State persistence tests (3.3)

```typescript
describe('state persistence', () => {
  it('on panel creation, sends cached snapshot from workspaceState to webview if it exists')
  it('on first live graph:snapshot, updates workspaceState with the capped snapshot')
  it('workspaceState.get on a fresh context returns undefined without throwing')
  it('cached snapshot with more than 500 edges is trimmed to 500 by weight before storing')
})
```

### Webview HTML generation tests (3.4)

```typescript
describe('getWebviewContent', () => {
  it('returns HTML containing a <canvas> element')
  it('includes a nonce attribute on the <script> tag')
  it('CSP contains connect-src https:')
  it('CSP does NOT contain connect-src ws://')
  it('CSP contains script-src with webview.cspSource and the nonce')
  it('script src uses a webview URI (starts with vscode-webview://)')
})
```

### Active project detection tests (6.1)

```typescript
describe('active project detection', () => {
  it('active file path that starts with a known localPath returns that node id')
  it('active file path that matches no localPath returns an empty array')
  it('empty localPath on all nodes produces no match and does not throw')
  it('sends setActiveProjects postMessage with matched node ids on editor change')
  it('sends setActiveProjects with empty array when no project matches (not omitted)')
})
```

---

## Implementation Details

### `src/types.ts`

```typescript
export interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  weight: number;
  raw_count: number;
  first_seen: string;
  last_seen: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WsMessage =
  | { type: 'graph:snapshot'; payload: GraphSnapshot }
  | { type: 'connection:new'; payload: Pick<GraphEdge, 'id' | 'source' | 'target' | 'connection_type'> & { timestamp: string } };

export type CachedSnapshot = GraphSnapshot; // edges already capped to 500
```

### `src/graphCache.ts`

```typescript
const CACHE_KEY = 'devneural.lastGraph';
const MAX_CACHED_EDGES = 500;

export function readCachedSnapshot(
  workspaceState: { get<T>(key: string): T | undefined }
): CachedSnapshot | undefined

export async function writeCachedSnapshot(
  workspaceState: { update(key: string, value: unknown): Thenable<void> },
  snapshot: GraphSnapshot
): Promise<void>
// writeCachedSnapshot sorts edges by weight descending and slices to 500 before storing
```

### `src/activeProject.ts`

```typescript
/**
 * Returns node IDs for all project nodes whose localPath is a prefix of activeFilePath.
 * Returns [] if activeFilePath is undefined, empty, or no node has a matching localPath.
 */
export function detectActiveProjects(
  activeFilePath: string | undefined,
  nodes: GraphNode[]
): string[]
```

### `src/wsClient.ts`

Encapsulates WebSocket lifecycle with exponential backoff reconnect:

```typescript
export interface WsClientOptions {
  url: string;
  onMessage: (msg: WsMessage) => void;
  onClose: () => void;
}

export function createWsClient(options: WsClientOptions): {
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;
}
```

Backoff: initial 1000ms, multiplier 2, cap 30000ms. Resets to 1000ms on successful connection. `disconnect()` calls `clearTimeout` on any pending reconnect timer and calls `ws.close()`.

### `src/panelManager.ts`

```typescript
export function createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel
// Sets retainContextWhenHidden: true, enableScripts: true,
// localResourceRoots: [Uri.joinPath(context.extensionUri, 'dist')]

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string
// CSP: default-src 'none'; script-src ${webview.cspSource} 'nonce-{nonce}';
//      style-src ${webview.cspSource} 'unsafe-inline'; connect-src https:
// NOTE: No connect-src ws:// — webview never opens a WebSocket directly
// HTML: <canvas id="devneural-canvas"> + <script nonce="..." src="webviewUri">
```

### `src/extension.ts`

Exports `activate` and `deactivate`. Module-level state:
- `currentPanel: vscode.WebviewPanel | undefined`
- `wsClient: ReturnType<typeof createWsClient> | undefined`
- `currentNodes: GraphNode[]`

`activate(context)`:
1. Register `devneural.openGraphView` command → `openOrRevealPanel(context)`
2. Register `onDidChangeConfiguration` → if affects `devneural.*`, call `reconnectWs(context)`
3. Register `onDidChangeActiveTextEditor` → `detectActiveProjects` + send `setActiveProjects` postMessage

`openOrRevealPanel(context)`:
- If panel exists: `currentPanel.reveal(); return`
- Otherwise: create panel, set HTML, send cached snapshot, start WebSocket

`disposePanel()`: set `currentPanel = undefined`, call `wsClient?.disconnect()`, set `wsClient = undefined`

`startWs(context)`:
- Read `apiServerHost` and `apiServerPort` from config
- Construct `ws://HOST:PORT/ws`
- On `graph:snapshot`: write to cache, update `currentNodes`, postMessage to webview
- On `connection:new`: postMessage to webview

`deactivate()`: `wsClient?.disconnect(); currentPanel?.dispose()`

---

## postMessage shapes sent to webview

```typescript
{ type: 'graph:snapshot', payload: CachedSnapshot }
{ type: 'connection:new', payload: <connection:new payload from server> }
{ type: 'setActiveProjects', payload: { nodeIds: string[] } }
```

---

## Key Constraints

- **WebSocket ownership**: Extension host only — not the webview. CSP intentionally omits `connect-src ws://`.
- **retainContextWhenHidden: true**: Mandatory — prevents WebGL context loss on tab switch.
- **500-edge cap**: Prevents unbounded `workspaceState` JSON growth on large graphs.
- **Config isolation**: `onDidChangeConfiguration` must check `e.affectsConfiguration('devneural')` before acting.

---

## Run Tests

```bash
cd C:\dev\tools\DevNeural\03-vscode-extension
npm test
```

All extension host unit tests must pass.

---

## Implementation Notes (Actual)

### Files Created / Modified
- `src/extension.ts` — full implementation as planned
- `src/types.ts` — as planned
- `src/wsClient.ts` — as planned; `onClose` callback removed from `WsClientOptions` (was vestigial dead code; reconnect is internal)
- `src/panelManager.ts` — as planned
- `src/activeProject.ts` — as planned; path prefix check uses `startsWith(localPath + '/')` not `startsWith(localPath)` to avoid string prefix false-positives
- `src/graphCache.ts` — as planned; exports `CACHE_KEY` and `MAX_CACHED_EDGES` for test assertions
- `src/__mocks__/vscode.ts` — extended with `ViewColumn`, `_configChangeEmitter`, `_activeEditorChangeEmitter`, `ExtensionContext` class, `Uri` class
- `src/__tests__/extension.test.ts` — 38 tests (one extra: path prefix false-positive regression)
- `tests/build-smoke.test.ts` — removed misleading string regex check; kept 500KB size cap
- `tsconfig.json` — exclude `src/__tests__/**` and `src/__mocks__/**` from tsc (tests use vitest alias, not tsc)
- `vitest.config.ts` — added `alias: { vscode: 'src/__mocks__/vscode.ts' }`

### Deviations from Plan
- `WsClientOptions.onClose` removed (simplification; was always `() => {}` at the only call site)
- `detectActiveProjects` uses `startsWith(localPath + '/')` (bug fix vs. plan spec)
- 38 tests instead of planned ~37 (one regression test added for path prefix bug)
- `tsconfig.json` excludes test/mock files (tests typecheck via vitest config, not tsc)

### Final Test Count
57 tests passing (7 manifest + 38 extension + 12 build-smoke)
