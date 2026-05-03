# 02-api-server — Complete Specification

---

## Purpose

A Node.js/TypeScript server that reads from the shared data root (`C:/dev/data/skill-connections/`) and serves graph data to all DevNeural consumers via REST and WebSocket. It is the single read interface for the data collected by 01-data-layer.

---

## Resolved Decisions

| Question | Decision |
|---|---|
| Language | TypeScript / Node.js (CommonJS, matching 01-data-layer) |
| Framework | **Fastify** — integrated @fastify/websocket, mature plugin ecosystem |
| File watching | **chokidar v4** — reliable on Windows; `awaitWriteFinish` for atomic writes |
| WebSocket library | **ws via @fastify/websocket** — shared HTTP+WS port |
| WS message format | Zod discriminated union on `type` field |
| Graph storage | **In-memory adjacency list** + chokidar hot reload (sub-ms lookups) |
| Security | Localhost-only (127.0.0.1), no auth |
| Port | 3747 (default), overridable via `PORT` env var |
| Lifecycle | Manual `npm start` |
| Response shape | Normalized `{ nodes: [...], edges: [...] }` — not raw WeightsFile |
| Empty state | `{ nodes: [], edges: [] }` with 200 OK |
| WS broadcast | Full graph snapshot on every weights.json change |
| REST scope | All 4 graph endpoints + GET /events |

---

## Data Sources

**From 01-data-layer (read-only):**

### weights.json schema
```typescript
interface WeightsFile {
  schema_version: 1;
  updated_at: string;           // ISO 8601 UTC
  connections: Record<string, ConnectionRecord>;  // key: "source||target"
}

interface ConnectionRecord {
  source_node: string;    // "project:github.com/user/repo", "tool:Bash", "skill:deep-plan"
  target_node: string;
  connection_type: 'project->tool' | 'project->skill' | 'project->project';
  raw_count: number;
  weight: number;         // 0.0–10.0, formula: min(count,100)/100*10
  first_seen: string;
  last_seen: string;
}
```

### Log entry schema (daily JSONL)
```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;
  session_id: string;
  tool_use_id: string;
  project: string;
  project_source: 'git-remote' | 'git-root' | 'cwd';
  tool_name: string;
  tool_input: Record<string, unknown>;
  connection_type: 'project->tool' | 'project->skill' | 'project->project';
  source_node: string;
  target_node: string;
}
```

### Data root layout
```
C:/dev/data/skill-connections/
├── weights.json
├── logs/
│   ├── 2026-03-29.jsonl
│   └── 2026-03-30.jsonl
└── config.json   (optional)
```

---

## API Shape

### Normalized Graph Format (outbound)

```typescript
interface GraphNode {
  id: string;              // e.g. "project:github.com/user/repo"
  type: 'project' | 'tool' | 'skill';
  label: string;           // the part after the colon prefix
}

interface GraphEdge {
  id: string;              // source + "||" + target
  source: string;          // node id
  target: string;          // node id
  connection_type: 'project->tool' | 'project->skill' | 'project->project';
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;      // from WeightsFile
}
```

### REST Endpoints

| Method | Path | Query params | Description |
|---|---|---|---|
| GET | `/health` | — | `{ status: "ok", uptime: N }` |
| GET | `/graph` | — | Full normalized graph |
| GET | `/graph/node/:id` | — | Single node + its edges |
| GET | `/graph/subgraph` | `project=<id>` | All edges involving a specific project node |
| GET | `/graph/top` | `limit=N` (default 10) | Top N edges by weight, descending |
| GET | `/events` | `limit=N` (default 50) | Most recent N log entries, newest-first |

All responses: `Content-Type: application/json`. Errors: `{ error: string }` with appropriate HTTP status.

### WebSocket

**Endpoint:** `ws://127.0.0.1:3747/ws`

**Server → client messages (discriminated union on `type`):**
```typescript
type ServerMessage =
  | { type: 'graph:snapshot'; payload: GraphResponse }
  | { type: 'connection:new'; payload: LogEntry }
```

- `graph:snapshot` — emitted immediately on client connect (current state), and on every weights.json change
- `connection:new` — emitted when a new log entry appears in the logs directory (new JSONL line written by 01-data-layer)

**Client → server:** No messages expected in MVP. Server ignores inbound messages.

---

## File Watching

Two watchers running at all times:

1. **weights.json watcher** — chokidar watching `<dataRoot>/weights.json`
   - On `change`: reload in-memory graph, broadcast `graph:snapshot` to all WS clients
   - `awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }` (critical for atomic writes)

2. **logs/ directory watcher** — chokidar watching `<dataRoot>/logs/`
   - On `add` (new file): start tailing it
   - On `change` (existing file): read new lines appended since last read, emit `connection:new` per entry
   - `depth: 0` (flat directory, no recursion)

---

## In-Memory Graph

Built from `weights.json` at startup and rebuilt on every file change.

Internal representation:
- `nodeIndex: Map<string, GraphNode>` — O(1) node lookup
- `edgeList: GraphEdge[]` — ordered by weight descending for efficient `top` queries
- `adjacency: Map<string, string[]>` — node id → list of edge ids it participates in

Graph builder function (pure, no I/O):
- Input: `WeightsFile`
- Output: `{ nodeIndex, edgeList, adjacency }`
- Extracts unique node ids from `source_node` and `target_node` in each `ConnectionRecord`
- Parses node type from prefix: `project:` → type `'project'`, `tool:` → type `'tool'`, `skill:` → type `'skill'`

---

## Configuration

```typescript
interface ServerConfig {
  port: number;        // default: 3747, from PORT env var
  host: string;        // always: '127.0.0.1'
  dataRoot: string;    // default: 'C:/dev/data/skill-connections', from DEVNEURAL_DATA_ROOT
}
```

Config is read at startup only. No hot-reload of server config.

---

## Error Handling

- **Data root missing at startup:** log warning, start server anyway — return empty graph until data appears
- **weights.json parse error:** log error to stderr, keep serving last valid graph
- **JSONL line parse error:** log error, skip line — do not crash or stop watching
- **WS client disconnect:** remove from `wss.clients` set, no error
- **File watcher error:** log error, attempt to re-attach watcher after 5s delay

The server never crashes due to bad data. It is a read-only observer.

---

## Project Layout

```
02-api-server/
├── src/
│   ├── server.ts          — Fastify instance, route registration, startup
│   ├── graph/
│   │   ├── builder.ts     — WeightsFile → in-memory graph (pure function)
│   │   ├── queries.ts     — subgraph, top, node lookup
│   │   └── types.ts       — GraphNode, GraphEdge, GraphResponse
│   ├── watcher/
│   │   └── index.ts       — chokidar setup, file change handlers
│   ├── routes/
│   │   ├── graph.ts       — REST route handlers
│   │   └── events.ts      — GET /events handler + log file reader
│   ├── ws/
│   │   └── index.ts       — WebSocket broadcast, message types
│   └── config.ts          — ServerConfig, env var loading
├── tests/
│   ├── graph/
│   │   ├── builder.test.ts
│   │   └── queries.test.ts
│   ├── routes/
│   │   ├── graph.test.ts
│   │   └── events.test.ts
│   └── ws/
│       └── broadcast.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Dependencies

**Runtime:**
- `fastify` — HTTP server
- `@fastify/websocket` — WebSocket on shared port (wraps `ws`)
- `chokidar` v4 — file watching
- `zod` — runtime schema validation + TypeScript inference

**Dev:**
- `typescript`
- `vitest`
- `@types/node`
- `tsx` (dev server / test runner)

---

## Consumers and What They Use

| Consumer | Transport | Endpoints/Events Used |
|---|---|---|
| 03-vscode-extension | WebSocket | `graph:snapshot` + `connection:new` |
| 04-session-intelligence | REST | `GET /graph/subgraph?project=<cwd-project>` |
| 05-voice-interface | REST | `GET /graph`, `GET /graph/top?limit=N` |
| 06-notebooklm-integration | REST | `GET /graph` (full graph for clustering) |
