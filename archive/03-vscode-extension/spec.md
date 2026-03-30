# 03-vscode-extension — Spec

## Purpose

A proper VS Code extension (.vsix) that opens a floating, non-blocking webview panel rendering the DevNeural graph as a live 3D neural network using Three.js. Connects to the API server via WebSocket for real-time updates.

## Full Requirements Reference

See: `../requirements.md` — section "Three.js Neural Network Visualization"

## Key Decisions (from interview)

- **Delivery:** Proper VS Code extension (.vsix) with package.json — not a browser tab or API-served page
- **Language:** TypeScript (extension host) + Three.js (webview)
- **Real-time:** WebSocket connection to 02-api-server for live updates
- **Panel:** Non-blocking, dismissible floating panel

## What This Split Builds

1. **VS Code extension** (`package.json`, extension host TypeScript):
   - Registers a command to open the DevNeural panel
   - Manages webview panel lifecycle (create, show, dispose)
   - Passes API server connection config to the webview
   - Handles extension activation/deactivation

2. **Three.js webview** (rendered inside VS Code webview):
   - 3D graph visualization with nodes (projects, skills, tools) and edges
   - **Visual encoding:** uniform line thickness; color encodes connection strength (cool blues = weak, warm oranges/reds = strong)
   - **Active connections:** pulse and glow animation on recently-fired connections
   - WebSocket client connecting to the API server for live updates
   - Interactive: click/hover nodes to see connection details

3. **Build pipeline** — bundle webview assets (Three.js + TS → JS) for use inside VS Code webview CSP

## Interfaces

**Inputs:**
- WebSocket stream from 02-api-server (graph data + real-time events)
- VS Code API (webview, commands, extension context)

**Outputs:**
- Visual 3D neural network panel in VS Code

## Dependencies

**Needs from other splits:**
- 02-api-server: WebSocket endpoint URL/protocol, graph data shape

**Provides to other splits:** Nothing (terminal consumer)

## Key Unknowns / Design Decisions for /deep-plan

- Three.js graph layout algorithm: force-directed (d3-force-3d?) vs. manual positioning
- VS Code Content Security Policy constraints for webview (what's allowed for WebSocket, Three.js)
- How to bundle webview assets for the extension (esbuild? webpack?)
- Node type visual differentiation (projects vs. skills vs. tools — shape? size? icon?)
- Interaction model: orbit camera, click-to-expand, search/filter
- How to configure API server URL from the extension (settings.json entry?)
- Performance with large graphs (LOD, culling, lazy loading)
