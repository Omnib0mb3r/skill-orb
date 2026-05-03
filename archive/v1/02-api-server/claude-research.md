# 02-api-server — Research Findings

---

## Part 1: Codebase Research

### Data Schemas (from 01-data-layer)

#### WeightsFile (weights.json)
```typescript
interface WeightsFile {
  schema_version: 1;
  updated_at: string;           // ISO 8601 UTC
  connections: Record<string, ConnectionRecord>;  // key: "source_node||target_node"
}

interface ConnectionRecord {
  source_node: string;          // e.g. "project:github.com/Omnib0mb3r/DevNeural"
  target_node: string;          // e.g. "tool:Bash"
  connection_type: ConnectionType;
  raw_count: number;            // integer, unbounded
  weight: number;               // 0.0–10.0 (4 decimal places), capped at 100 invocations
  first_seen: string;           // ISO 8601 UTC
  last_seen: string;            // ISO 8601 UTC
}

type ConnectionType = 'project->tool' | 'project->skill' | 'project->project';
```

**Connection key format:** `"source_node||target_node"` — double-pipe ASCII delimiter, no spaces.

**Weight formula:** `Math.round(Math.min(raw_count, 100) / 100 * 10 * 10000) / 10000`
- raw_count=1 → weight=0.1
- raw_count=23 → weight=2.3
- raw_count=100+ → weight=10.0 (cap)

#### LogEntry (daily JSONL files)
```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;             // ISO 8601 UTC
  session_id: string;
  tool_use_id: string;           // deduplication key
  project: string;               // canonical project identifier
  project_source: 'git-remote' | 'git-root' | 'cwd';
  tool_name: string;
  tool_input: Record<string, unknown>;  // full input, may be large (Edit/Write contents)
  connection_type: ConnectionType;
  source_node: string;
  target_node: string;
}
```

**Node naming conventions:**
- `project:<canonical-id>` — e.g. `project:github.com/Omnib0mb3r/DevNeural`
- `tool:<name>` — e.g. `tool:Bash`, `tool:Edit`
- `skill:<name>` — e.g. `skill:deep-plan`, `skill:gsd:execute-phase`

#### Data Root Layout
```
C:/dev/data/skill-connections/
├── weights.json           (single file, atomically written via write-file-atomic)
├── logs/
│   └── 2026-03-29.jsonl  (UTC date, one LogEntry JSON per line)
└── config.json            (optional: allowlist, data_root override)
```

### Public API Surface (from dist/)

The API server can import these modules directly if needed:
```typescript
// weights module
import { loadWeights } from '01-data-layer/dist/weights';
// → WeightsFile (synchronous read)

// logger module
import { getLogFilePath } from '01-data-layer/dist/logger';
// → generates path: <dataRoot>/logs/<YYYY-MM-DD>.jsonl
```

Or it can read the files directly (simpler, avoids cross-package coupling).

### Concurrency Considerations
- `weights.json` is written atomically (write-file-atomic: temp file + rename)
- Multiple hook processes may write concurrently (proper-lockfile: 5s stale timeout)
- Log files are append-only; no lock needed for reading
- The API server is read-only — it will never hold the weights lock

### Live Data (as of 2026-03-29)
- 40 JSONL log entries collected
- 3 unique connections: DevNeural→Bash (×23, weight=2.3), DevNeural→Edit (×1), DevNeural→c:/dev/tools (×6)
- 2 projects identified

### Testing Setup (01-data-layer)
- Framework: **vitest** (v1.6.1)
- Config: `vitest.config.ts` in project root
- Helpers: `tests/helpers/tempDir.ts` — `createTempDir()` / `removeTempDir()`
- Pattern: `beforeEach` / `afterEach` with temp dirs for all I/O tests
- Subprocess tests: `spawnSync` with `tsx` (not compiled `dist/`)
- 71 tests across 5 modules

---

## Part 2: Web Research — Best Practices

### Framework: Fastify (recommended)

**Decision: Fastify over Hono and Express.**

Performance at this scale is irrelevant (localhost tool), but the integrated ecosystem matters:
- `@fastify/websocket` shares HTTP+WS on one port with zero extra server management — WebSocket routes participate in Fastify's plugin/hook system (auth, validation, logging all apply)
- Native TypeScript support with TypeBox schema validation (optional but well-integrated)
- Pino logger built in (structured JSON logging)
- 7+ years production hardening, stable plugin ecosystem

Hono is the better choice if the server ever needs to run on Cloudflare Workers or Deno edge runtimes. For a fixed Node.js/Windows localhost deployment, Fastify's Node-native design is an advantage, not a limitation. Hono's `@hono/node-ws` WebSocket adapter is an extra indirection layer compared to Fastify's first-class plugin.

Express is not recommended — unmaintained middleware ecosystem, no built-in WebSocket, slowest performance.

### File Watching: chokidar v4

**Decision: chokidar v4 (native mode) over fs.watch.**

`fs.watch` on Windows has well-documented reliability issues:
- Event coalescing misses up to 97% of rapid writes
- Rename vs. replace ambiguity (both surface as `'rename'`)
- No events on folder moves, inconsistent junction behavior
- Duplicate events on single writes

chokidar v4 normalizes and deduplicates OS events, adds stat-verification, and emits clean `add`/`change`/`unlink` events.

**Critical: use `awaitWriteFinish`** for `weights.json`:
```
awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }
```
This prevents reading a partial file during `write-file-atomic`'s temp-rename sequence.

chokidar v5 is ESM-only (Node 20+). Use v4 for compatibility with the existing CommonJS setup.

### WebSocket: ws via @fastify/websocket + Zod discriminated union

**Decision: ws (via @fastify/websocket), not Socket.IO or uWebSockets.js.**

Socket.IO adds ~60KB bundle overhead, fallback transports, and a custom envelope format — all unnecessary when both ends are controlled (localhost server + VS Code extension webview on the same machine).

uWebSockets.js achieves 3–8× more connections with lower CPU, but requires native C++ binaries (version-locked to Node.js), adding build complexity with no benefit at this scale.

**Message schema pattern** — discriminated union on `type` field, Zod-validated:
```typescript
type ServerMessage =
  | { type: 'graph:update'; payload: GraphData }
  | { type: 'weights:changed'; payload: WeightsFile }
  | { type: 'connection:new'; payload: LogEntry }
```

**Broadcasting pattern** — iterate `wss.clients`, pre-serialize once:
```typescript
function broadcast(msg: ServerMessage): void {
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(raw);
  }
}
```

**Client reconnection** — `ws` has no auto-reconnect; VS Code extension client needs ~15 lines of exponential-backoff reconnect logic (not the server's responsibility).

### Graph Storage: In-Memory Adjacency List + chokidar Hot Reload

**Decision: in-memory graph loaded at startup, reloaded on file change — not query-on-read.**

Memory footprint at realistic sizes:
- 100 nodes / 200 edges → ~24KB heap
- 1,000 nodes / 2,000 edges → ~240KB heap
- 10,000 nodes / 20,000 edges → ~2.4MB heap

Query-on-read (parsing weights.json on every REST request) takes ~1–5ms per call and gets slower as the graph grows. The in-memory adjacency list gives sub-millisecond lookups at any realistic scale.

**Cache invalidation via chokidar** (recommended pattern):
```
chokidar.watch(weightsPath, { awaitWriteFinish: { stabilityThreshold: 300 } })
  .on('change', () => {
    graph = buildGraph(loadWeights(dataRoot));
    broadcast({ type: 'graph:update', payload: serializeGraph(graph) });
  });
```

Data structure: `Map<string, Node>` for node index, `Map<string, Set<string>>` for adjacency list. No graph library needed for MVP — add `graphology` later if centrality / community detection algorithms are required.

---

## Summary: Decisions Resolved by Research

| Question | Decision | Rationale |
|---|---|---|
| Framework | **Fastify** | Integrated WS plugin, Node-native, mature ecosystem |
| File watching | **chokidar v4** | Reliable on Windows; `awaitWriteFinish` for atomic writes |
| WebSocket library | **ws (via @fastify/websocket)** | Sufficient for localhost, zero protocol overhead |
| WS message format | **Zod discriminated union on `type`** | Type-safe both compile-time and runtime |
| Graph storage | **In-memory + hot reload** | Sub-ms reads; trivial memory footprint |
| Graph data structure | **Map + Set adjacency list** | O(1) lookup, O(degree) traversal, no extra deps |
| Client reconnect | **Client-side exponential backoff** | Server is stateless; client owns reconnect |

---

## Testing Approach

The 01-data-layer uses vitest with temp directories. The API server should follow the same pattern:

- **Unit tests** (`vitest`): graph builder functions, query logic, route handlers (with mocked file I/O)
- **Integration tests**: start actual Fastify server on a random port, hit REST endpoints, verify responses
- **WebSocket tests**: connect a test `ws` client, trigger file changes via temp dir, assert broadcast events

Key test helpers to carry over: `createTempDir()` / `removeTempDir()` from `tests/helpers/tempDir.ts`.
