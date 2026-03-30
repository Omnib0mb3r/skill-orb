# section-01-scaffold

## Overview

Scaffold the Vite + TypeScript + Three.js web app and verify the core pipeline works
end-to-end in a browser: WebSocket connects, graph snapshot is received, Three.js orb renders.

This section is **pre-complete** — the scaffold was created during the pivot from
`03-vscode-extension`. All files listed below already exist and all 14 tests pass.

**Blocks:** All other sections.

---

## Files Created

| File | Description |
|------|-------------|
| `index.html` | Full-viewport canvas entry point |
| `package.json` | Vite 5 + Three.js 0.183 + Vitest 1 |
| `tsconfig.json` | Bundler mode, DOM lib, strict |
| `vite.config.ts` | Dev server on port 5173 |
| `vitest.config.ts` | jsdom environment |
| `src/types.ts` | GraphNode, GraphEdge, GraphSnapshot, WsMessage |
| `src/main.ts` | Entry: scene init, graph init, WebSocket client |
| `webview/renderer.ts` | Three.js scene + camera + OrbitControls + resize |
| `webview/orb.ts` | Force graph + capAndTransform + initOrb + updateRenderPositions |
| `webview/nodes.ts` | InstancedMesh node rendering (project/tool/skill/badge) |
| `webview/edges.ts` | Line2 edge rendering + computeRelativeColor |
| `webview/__tests__/nodes.test.ts` | 8 tests |
| `webview/__tests__/edges.test.ts` | 6 tests |

Stub files for upcoming sections: `webview/animation.ts`, `webview/camera.ts`,
`webview/hud.ts`, `webview/search.ts`, `webview/voice.ts`

---

## Architecture Notes

The browser WebSocket client (`src/main.ts`) replaces the VS Code extension host + webview
postMessage pipeline from the archived extension. Key change:

- **Extension**: VS Code extension host → `panel.webview.postMessage` → `window.addEventListener('message')`
- **Web app**: Python server → `ws://localhost:27182` → `WebSocket.onmessage`

The `connection:new` message is handled in `section-02-animation`. The `src/main.ts` has a
commented placeholder for this.

---

## Running Locally

```bash
cd 03-web-app
npm install
npm run dev       # opens http://localhost:5173
```

Python server must be running: `cd 02-api-server && python server.py`

---

## Test Count

14 tests, all passing. Run: `npm test`
