# 02-api-server — Interview Transcript

---

## Q1: Is this server localhost-only, and does it need any authentication?

**Answer:** Localhost-only, no auth.

Binds to 127.0.0.1 only. All consumers (VS Code extension, session hook, voice interface) run on the same machine — no auth tokens needed.

---

## Q2: How should the server be started and what port should it use?

**Answer:** Manual `npm start`, fixed port 3747 with env override.

Port 3747 is distinctive and unlikely to collide with other local services. Hardcoded default, overridable via env var. Server is started manually — not auto-spawned by the VS Code extension.

---

## Q3: When the VS Code extension or session hook queries /graph at startup, what does it actually need?

**Answer:** Full graph — all nodes, all edges, weights.

Clients receive the complete graph and filter/render client-side. Simplest server logic, maximally flexible for consumers.

---

## Q4: What should the server return as the graph node/edge format?

**Answer:** Normalize to `{ nodes: [...], edges: [...] }`.

Server extracts unique nodes and emits edges as structured objects (`{ source, target, weight, connection_type }`). Decouples consumers from the storage key format (`"source||target"`). Clean for Three.js rendering and session intelligence queries.

---

## Q5: What should happen when weights.json doesn't exist yet (fresh install)?

**Answer:** Return empty graph `{ nodes: [], edges: [] }` with 200 OK.

Graceful degradation. Server starts fine even before any data is collected. Clients handle empty state at the UI layer.

---

## Q6: How should WebSocket broadcast work when weights.json updates?

**Answer:** Full graph snapshot on every change.

Simple and stateless. Clients replace their entire state on each broadcast. Suitable for small-to-medium graphs (the expected size for a developer tool). Diffing deferred to a future optimization if needed.

---

## Q7: All 4 REST endpoints in MVP, or just GET /graph?

**Answer:** All 4 endpoints in MVP.

- `GET /graph` — full graph
- `GET /graph/node/:id` — single node with connections
- `GET /graph/subgraph?project=<id>` — connections for a specific project
- `GET /graph/top?limit=N` — top N connections by weight

The session intelligence hook (04) needs subgraph; the visualization (03) needs top. Build all 4 now.

---

## Q8: Should the server serve recent log entries, or just the graph?

**Answer:** Add `GET /events?limit=N` — recent log entries from the JSONL files.

Useful for the session intelligence hook to see what happened recently (not just cumulative weights). Returns the most recent N entries across all log files, newest-first.
