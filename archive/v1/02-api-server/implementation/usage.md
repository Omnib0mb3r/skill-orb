# DevNeural API Server — Usage Guide

## Quick Start

```bash
cd 02-api-server
npm install

# Development (watch mode)
DEVNEURAL_DATA_ROOT=C:/dev/data/skill-connections npm run dev

# Production
npm run build
DEVNEURAL_DATA_ROOT=C:/dev/data/skill-connections npm start
```

Server binds to `http://127.0.0.1:3747` by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3747` | HTTP port (1–65535) |
| `DEVNEURAL_DATA_ROOT` | `C:/dev/data/skill-connections` | Directory containing `weights.json` and `logs/` |

## REST API

### Health
```
GET /health
→ { "status": "ok", "uptime": 42.3 }
```

### Full Graph
```
GET /graph
→ { "nodes": [...], "edges": [...], "updated_at": "2025-03-01T00:00:00.000Z" }
```

### Node by ID
```
GET /graph/node/project%3Agithub.com%2Fuser%2Frepo
→ { "node": { "id": "...", "type": "project", "label": "..." }, "edges": [...] }
```

### Project Subgraph
```
GET /graph/subgraph?project=github.com/user/repo
→ { "nodes": [...], "edges": [...], "updated_at": "..." }
```

### Top Edges by Weight
```
GET /graph/top?limit=10
→ { "nodes": [...], "edges": [...], "updated_at": "..." }
```

### Recent Connection Events
```
GET /events?limit=50
→ { "events": [...], "total": 42 }
```

## WebSocket

```javascript
const ws = new WebSocket('ws://127.0.0.1:3747/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg.type === 'graph:snapshot' → full graph update
  // msg.type === 'connection:new' → new log entry
};
```

On connect, the server immediately sends a `graph:snapshot` with current data.

## Live Reload

The server watches `$DEVNEURAL_DATA_ROOT/weights.json` and `$DEVNEURAL_DATA_ROOT/logs/*.jsonl`. Any change triggers a `graph:snapshot` broadcast to all connected WebSocket clients.

## Running Tests

```bash
cd 02-api-server
npm test
```

78 tests across 7 test files covering graph builder, queries, REST routes, WebSocket broadcaster, file watcher, and server integration.

## Source Layout

```
src/
  config.ts          — PORT + DEVNEURAL_DATA_ROOT validation
  server.ts          — createServer() factory, ESM entry-point
  graph/
    types.ts         — GraphNode, GraphEdge, InMemoryGraph, WeightsFile
    builder.ts       — buildGraph() pure function
    queries.ts       — getFullGraph, getNodeById, getSubgraph, getTopEdges
  routes/
    graph.ts         — REST route handlers (health, graph, node, subgraph, top)
    events.ts        — GET /events handler
  ws/
    types.ts         — ServerMessage Zod schema
    broadcaster.ts   — broadcast(), setWss(), getClientCount()
  watcher/
    index.ts         — startWatchers(), stopWatchers(), getEventBuffer()
```
