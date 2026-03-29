# DevNeural Web App — Sections

## SECTION_MANIFEST

```
section-01-scaffold
section-02-animation
section-03-camera-hud
section-04-node-actions
section-05-voice
section-06-integration
```

## Overview

Standalone Vite + TypeScript + Three.js web app. Connects to the DevNeural Python server
(`02-api-server`) via browser WebSocket. No VS Code API, no extension packaging.

**Pre-scaffolded:** The scaffold (Vite config, HTML entry, `src/main.ts`, `webview/` files
ported from the extension's implemented sections 06–07) is already in place. All 14 existing
tests pass. Run `npm test` to verify.

## Dependencies (inherited from archive)

- `01-data-layer/` — graph data collection (Python)
- `02-api-server/` — WebSocket API server (Python, port 27182)

## What is already built

| Feature | File | Status |
|---------|------|--------|
| Vite + TypeScript scaffold | `package.json`, `vite.config.ts`, `tsconfig.json` | Done |
| Three.js scene + OrbitControls + fog | `webview/renderer.ts` | Done |
| Force-directed graph (d3, sphere constraint) | `webview/orb.ts` | Done |
| InstancedMesh node rendering (4 meshes) | `webview/nodes.ts` | Done |
| Line2 edge rendering + relativistic color | `webview/edges.ts` | Done |
| Browser WebSocket client with reconnect | `src/main.ts` | Done |
| HTML entry with full-viewport canvas | `index.html` | Done |

## What remains (sections 01–06)

Section 01 is the scaffold section — documents the above. Sections 02–06 add features.
