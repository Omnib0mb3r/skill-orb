# Integration Notes — Opus Review Feedback

## Integrating

### 1. Chokidar version and ESM decision (HIGH — showstopper)
**Integrating.** The review correctly identifies that chokidar v4 is ESM-only. Since the API server is a standalone process (never imported by hook scripts), using ESM is clean and forward-looking. The plan will be updated to explicitly declare the server as an ESM project (`"type": "module"` in package.json), use chokidar v4 (ESM), and note this is intentional and differs from 01-data-layer (CJS). The misleading `awaitWriteFinish` rationale will also be corrected to describe the actual failure mode (stabilization after rename, not mid-read partial files).

### 2. In-memory event buffer specification (HIGH)
**Integrating.** The plan referenced an "in-memory event buffer used by `GET /events`" without defining it. Adding: a capped ring buffer of the 1000 most recent `LogEntry` objects, populated by the log watcher. `GET /events` reads from this buffer (not from disk). Buffer is bounded by count, not bytes — acceptable at this scale.

### 3. Log offset tracking claim corrected (MEDIUM)
**Integrating.** The phrase "even after a server restart" is wrong — offsets are in-memory only. On restart, the watcher re-reads all existing log files to populate the event buffer (startup scan), but does NOT broadcast these as new WebSocket events. This behavior is intentional and acceptable — clarifying the language in the plan.

### 4. getSubgraph: exact match (MEDIUM)
**Integrating.** Changing to exact match (not prefix match). The normalization rule: if the caller passes a value that already starts with `project:`, use it as-is; if not, prepend `project:`. This prevents double-prefixing. Exact match is what the session-intelligence hook needs.

### 5. CORS headers (MEDIUM)
**Integrating.** Adding `@fastify/cors` with `origin: '*'` to the plan. VS Code webview requests originate from `vscode-webview://` and will be rejected without CORS headers. Localhost-only binding makes `origin: '*'` safe.

### 6. SIGTERM on Windows (MEDIUM)
**Integrating.** SIGTERM is unreliable on Windows. Plan updated: register `process.on('SIGINT', ...)` only (Ctrl+C). Note that the server holds no locks and no writes are in-flight, so abrupt termination via taskkill is safe — no data is lost. The `beforeExit` event is not needed for this read-only server.

### 7. Edge index for O(1) lookup (LOW)
**Integrating.** Adding `edgeIndex: Map<string, GraphEdge>` to `InMemoryGraph`. The adjacency map maps node IDs to edge IDs (strings), and the edge index maps edge IDs to `GraphEdge` objects, enabling O(1) lookup in `getNodeById` and `getSubgraph`.

### 8. Config validation (LOW)
**Integrating.** Adding PORT validation (must be integer 1–65535) to config.ts description. Invalid config fails fast with a clear error on startup.

### 9. npm run dev script (LOW)
**Integrating.** Adding `tsx --watch src/server.ts` as `npm run dev` to Section 01.

### 10. weights.json deletion handling (LOW)
**Integrating.** Adding `unlink` event handling: if `weights.json` is deleted while running, the server reverts to an empty graph and broadcasts a `graph:snapshot` with empty nodes/edges.

### 11. Async file I/O in watcher (from finding #2)
**Integrating.** The watcher will use `fs.promises.readFile` (async) when reading `weights.json`, not `readFileSync`. Since the server writes its own file-reading code (not importing from 01-data-layer), this is straightforward.

### 12. Broadcast debounce mention (LOW)
**Integrating.** Adding a note: if burst writes arrive within the chokidar stabilization window, a single event fires. This provides natural throttling. No additional debounce in MVP — the 300ms stabilization window is sufficient at this scale.

### 13. Test timing: concrete polling strategy (LOW)
**Integrating.** Updating integration test descriptions to specify: poll every 100ms with a 5-second timeout. Use Promise-based await on events rather than fixed sleeps.

---

## Not Integrating

### WebSocket backpressure (LOW)
**Skipping.** The VS Code extension is the only WebSocket client and is on localhost. Slow-client buffering is a non-issue at this scale. Adding complexity to handle a scenario that cannot happen in the current deployment is speculative engineering.

### Duplicate log entries / deduplication (LOW)
**Skipping (partially).** The review correctly notes that a single tool invocation produces multiple log entries (one per connection_type). This is correct behavior and expected — the watcher emits one `connection:new` per line. The plan already documents that deduplication is not the server's responsibility. Adding a brief acknowledgment to the Key Constraints section that this is intentional is enough; no API changes needed.

### Hardcoded data root default (LOW)
**Partially integrating.** Adding a comment in config.ts description noting the default is machine-specific/Windows-only and is intentional for this personal tool. No path resolution changes — the override via env var is sufficient.

### Spec/plan ws structure mismatch (observation)
**No action needed.** The plan's two-file approach (`ws/types.ts` + `ws/broadcaster.ts`) is correct. The spec's single `ws/index.ts` was an earlier draft. The plan takes precedence for implementation.
