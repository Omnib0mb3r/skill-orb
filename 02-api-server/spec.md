# 02-api-server — Spec

## Purpose

A Node.js/TypeScript server that reads from the shared data root and serves graph data to all DevNeural consumers (VS Code extension, session intelligence hook, voice interface, NotebookLM integration) via REST and WebSocket.

## Full Requirements Reference

See: `../requirements.md` — section "REST / WebSocket API Server"

## Key Decisions (from interview)

- **Language:** TypeScript / Node.js
- **Data source:** Reads from `C:\dev\data\skill-connections\` (shared data root maintained by 01-data-layer)
- **Consumers:** VS Code extension (WebSocket), SessionStart hook (REST), voice interface (REST), NotebookLM integration (REST)

## What This Split Builds

1. **REST API** — endpoints including:
   - `GET /graph` — full graph (nodes + edges with weights)
   - `GET /graph/node/:id` — single node with its connections
   - `GET /graph/subgraph?project=...` — connections for a specific project
   - `GET /graph/top?limit=N` — top N connections by weight
   - Query/filter support for surfacing relevant context

2. **WebSocket server** — real-time event stream:
   - Emits `connection` events when new log entries arrive
   - Emits `weight-updated` events when weights.json changes
   - Clients (VS Code extension) subscribe and receive live updates

3. **File watching** — monitors shared data root for changes to weights.json and log files, triggers WebSocket events

## Interfaces

**Inputs:**
- `C:\dev\data\skill-connections\weights.json` — graph weight data
- `C:\dev\data\skill-connections\logs\` — raw event logs

**Outputs:**
- REST JSON responses (graph data, subgraphs, node details)
- WebSocket event stream (real-time connection events)

## Dependencies

**Needs from other splits:**
- 01-data-layer: schema definitions for weights.json and log format

**Provides to other splits:**
- REST query interface → 04-session-intelligence, 05-voice-interface, 06-notebooklm-integration
- WebSocket stream → 03-vscode-extension

## Key Unknowns / Design Decisions for /deep-plan

- Framework choice: Express vs. Fastify vs. Hono
- How to watch files efficiently on Windows (fs.watch vs. chokidar)
- Graph query model: in-memory graph vs. query-on-read from JSON
- Authentication/security: is this localhost-only? Any auth needed?
- Port configuration and how consumers discover the server
- Whether to build a graph data structure in memory or compute views on demand
