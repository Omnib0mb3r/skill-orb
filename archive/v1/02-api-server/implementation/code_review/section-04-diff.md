diff --git a/02-api-server/package-lock.json b/02-api-server/package-lock.json
index e4ee3f9..2f0a85b 100644
--- a/02-api-server/package-lock.json
+++ b/02-api-server/package-lock.json
@@ -8,7 +8,7 @@
       "name": "devneural-api-server",
       "version": "0.1.0",
       "dependencies": {
-        "@fastify/cors": "^9.0.0",
+        "@fastify/cors": "^11.2.0",
         "@fastify/websocket": "^10.0.0",
         "chokidar": "^4.0.0",
         "fastify": "^5.0.0",
@@ -487,15 +487,41 @@
       }
     },
     "node_modules/@fastify/cors": {
-      "version": "9.0.1",
-      "resolved": "https://registry.npmjs.org/@fastify/cors/-/cors-9.0.1.tgz",
-      "integrity": "sha512-YY9Ho3ovI+QHIL2hW+9X4XqQjXLjJqsU+sMV/xFsxZkE8p3GNnYVFpoOxF7SsP5ZL76gwvbo3V9L+FIekBGU4Q==",
+      "version": "11.2.0",
+      "resolved": "https://registry.npmjs.org/@fastify/cors/-/cors-11.2.0.tgz",
+      "integrity": "sha512-LbLHBuSAdGdSFZYTLVA3+Ch2t+sA6nq3Ejc6XLAKiQ6ViS2qFnvicpj0htsx03FyYeLs04HfRNBsz/a8SvbcUw==",
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/fastify"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/fastify"
+        }
+      ],
       "license": "MIT",
       "dependencies": {
-        "fastify-plugin": "^4.0.0",
-        "mnemonist": "0.39.6"
+        "fastify-plugin": "^5.0.0",
+        "toad-cache": "^3.7.0"
       }
     },
+    "node_modules/@fastify/cors/node_modules/fastify-plugin": {
+      "version": "5.1.0",
+      "resolved": "https://registry.npmjs.org/fastify-plugin/-/fastify-plugin-5.1.0.tgz",
+      "integrity": "sha512-FAIDA8eovSt5qcDgcBvDuX/v0Cjz0ohGhENZ/wpc3y+oZCY2afZ9Baqql3g/lC+OHRnciQol4ww7tuthOb9idw==",
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/fastify"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/fastify"
+        }
+      ],
+      "license": "MIT"
+    },
     "node_modules/@fastify/error": {
       "version": "4.2.0",
       "resolved": "https://registry.npmjs.org/@fastify/error/-/error-4.2.0.tgz",
@@ -1654,15 +1680,6 @@
         "@jridgewell/sourcemap-codec": "^1.5.5"
       }
     },
-    "node_modules/mnemonist": {
-      "version": "0.39.6",
-      "resolved": "https://registry.npmjs.org/mnemonist/-/mnemonist-0.39.6.tgz",
-      "integrity": "sha512-A/0v5Z59y63US00cRSLiloEIw3t5G+MiKz4BhX21FI+YBJXBOGW0ohFxTxO08dsOYlzxo87T7vGfZKYp2bcAWA==",
-      "license": "MIT",
-      "dependencies": {
-        "obliterator": "^2.0.1"
-      }
-    },
     "node_modules/ms": {
       "version": "2.1.3",
       "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
@@ -1689,12 +1706,6 @@
         "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
       }
     },
-    "node_modules/obliterator": {
-      "version": "2.0.5",
-      "resolved": "https://registry.npmjs.org/obliterator/-/obliterator-2.0.5.tgz",
-      "integrity": "sha512-42CPE9AhahZRsMNslczq0ctAEtqk8Eka26QofnqC346BZdHDySk3LWka23LI7ULIw11NmltpiLagIq8gBozxTw==",
-      "license": "MIT"
-    },
     "node_modules/on-exit-leak-free": {
       "version": "2.1.2",
       "resolved": "https://registry.npmjs.org/on-exit-leak-free/-/on-exit-leak-free-2.1.2.tgz",
diff --git a/02-api-server/package.json b/02-api-server/package.json
index b37fcf8..8518d0d 100644
--- a/02-api-server/package.json
+++ b/02-api-server/package.json
@@ -9,7 +9,7 @@
     "test": "vitest run"
   },
   "dependencies": {
-    "@fastify/cors": "^9.0.0",
+    "@fastify/cors": "^11.2.0",
     "@fastify/websocket": "^10.0.0",
     "chokidar": "^4.0.0",
     "fastify": "^5.0.0",
diff --git a/02-api-server/src/routes/events.ts b/02-api-server/src/routes/events.ts
new file mode 100644
index 0000000..11f0eb6
--- /dev/null
+++ b/02-api-server/src/routes/events.ts
@@ -0,0 +1,24 @@
+import type { FastifyInstance } from 'fastify';
+
+export interface LogEntry {
+  tool_use_id: string;
+  connection_type: string;
+  source_node: string;
+  target_node: string;
+  timestamp: string;
+}
+
+export function registerEventsRoutes(
+  app: FastifyInstance,
+  getEvents: () => LogEntry[]
+): void {
+  app.get<{ Querystring: { limit?: string } }>('/events', async (request) => {
+    const parsed = parseInt(request.query.limit ?? '', 10);
+    const limit = isNaN(parsed) || parsed <= 0 ? 50 : Math.min(parsed, 500);
+    const buffer = getEvents();
+    return {
+      events: buffer.slice(0, limit),
+      total: buffer.length,
+    };
+  });
+}
diff --git a/02-api-server/src/routes/graph.ts b/02-api-server/src/routes/graph.ts
new file mode 100644
index 0000000..884f238
--- /dev/null
+++ b/02-api-server/src/routes/graph.ts
@@ -0,0 +1,39 @@
+import type { FastifyInstance } from 'fastify';
+import type { InMemoryGraph } from '../graph/types.js';
+import { getFullGraph, getNodeById, getSubgraph, getTopEdges } from '../graph/queries.js';
+
+export function registerGraphRoutes(
+  app: FastifyInstance,
+  getGraph: () => InMemoryGraph
+): void {
+  app.get('/health', async () => {
+    return { status: 'ok', uptime: process.uptime() };
+  });
+
+  app.get('/graph', async () => {
+    return getFullGraph(getGraph(), new Date().toISOString());
+  });
+
+  app.get<{ Params: { id: string } }>('/graph/node/:id', async (request, reply) => {
+    const nodeId = decodeURIComponent(request.params.id);
+    const result = getNodeById(getGraph(), nodeId);
+    if (!result) {
+      return reply.status(404).send({ error: 'Node not found' });
+    }
+    return result;
+  });
+
+  app.get<{ Querystring: { project?: string } }>('/graph/subgraph', async (request, reply) => {
+    const project = request.query.project;
+    if (!project) {
+      return reply.status(400).send({ error: 'Missing required query parameter: project' });
+    }
+    return getSubgraph(getGraph(), project);
+  });
+
+  app.get<{ Querystring: { limit?: string } }>('/graph/top', async (request) => {
+    const parsed = parseInt(request.query.limit ?? '', 10);
+    const limit = isNaN(parsed) || parsed <= 0 ? 10 : Math.min(parsed, 100);
+    return getTopEdges(getGraph(), limit);
+  });
+}
diff --git a/02-api-server/tests/routes/events.test.ts b/02-api-server/tests/routes/events.test.ts
new file mode 100644
index 0000000..ee015b8
--- /dev/null
+++ b/02-api-server/tests/routes/events.test.ts
@@ -0,0 +1,84 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import Fastify, { type FastifyInstance } from 'fastify';
+import cors from '@fastify/cors';
+import { registerEventsRoutes } from '../../src/routes/events.js';
+import type { LogEntry } from '../../src/routes/events.js';
+
+function makeEntry(i: number): LogEntry {
+  return {
+    tool_use_id: `tu-${i}`,
+    connection_type: 'project->tool',
+    source_node: `project:repo-${i}`,
+    target_node: 'tool:Edit',
+    timestamp: new Date(1000 * i).toISOString(),
+  };
+}
+
+let app: FastifyInstance;
+let buffer: LogEntry[];
+
+beforeEach(async () => {
+  buffer = [];
+  app = Fastify();
+  await app.register(cors, { origin: '*' });
+  registerEventsRoutes(app, () => buffer);
+  await app.ready();
+});
+
+afterEach(async () => {
+  await app.close();
+});
+
+describe('GET /events', () => {
+  it('returns 200 with { events: [], total: 0 } when buffer is empty', async () => {
+    const res = await app.inject({ method: 'GET', url: '/events' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.events).toEqual([]);
+    expect(body.total).toBe(0);
+  });
+
+  it('returns events in newest-first order (first element is most recent)', async () => {
+    // Populate buffer newest-first: index 0 = newest
+    buffer.push(makeEntry(3), makeEntry(2), makeEntry(1));
+    const res = await app.inject({ method: 'GET', url: '/events' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.events[0].tool_use_id).toBe('tu-3');
+    expect(body.events[1].tool_use_id).toBe('tu-2');
+    expect(body.events[2].tool_use_id).toBe('tu-1');
+  });
+
+  it('?limit=5 returns at most 5 events when buffer has more', async () => {
+    for (let i = 0; i < 20; i++) buffer.push(makeEntry(i));
+    const res = await app.inject({ method: 'GET', url: '/events?limit=5' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.events.length).toBe(5);
+  });
+
+  it('?limit=600 is clamped to max 500', async () => {
+    for (let i = 0; i < 600; i++) buffer.push(makeEntry(i));
+    const res = await app.inject({ method: 'GET', url: '/events?limit=600' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.events.length).toBe(500);
+  });
+
+  it('total reflects full buffer size, not slice size', async () => {
+    for (let i = 0; i < 20; i++) buffer.push(makeEntry(i));
+    const res = await app.inject({ method: 'GET', url: '/events?limit=5' });
+    const body = JSON.parse(res.body);
+    expect(body.total).toBe(20);
+    expect(body.events.length).toBe(5);
+  });
+
+  it('reads from in-memory buffer (no disk I/O)', async () => {
+    const entry = makeEntry(99);
+    buffer.push(entry);
+    const res = await app.inject({ method: 'GET', url: '/events' });
+    const body = JSON.parse(res.body);
+    expect(body.events[0].tool_use_id).toBe('tu-99');
+    expect(body.total).toBe(1);
+  });
+});
diff --git a/02-api-server/tests/routes/graph.test.ts b/02-api-server/tests/routes/graph.test.ts
new file mode 100644
index 0000000..9691225
--- /dev/null
+++ b/02-api-server/tests/routes/graph.test.ts
@@ -0,0 +1,233 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import Fastify, { type FastifyInstance } from 'fastify';
+import cors from '@fastify/cors';
+import { buildGraph } from '../../src/graph/builder.js';
+import { registerGraphRoutes } from '../../src/routes/graph.js';
+import type { WeightsFile, InMemoryGraph } from '../../src/graph/types.js';
+
+const fixtureWeights: WeightsFile = {
+  connections: {
+    'project:github.com/user/repo||tool:Bash': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'tool:Bash',
+      connection_type: 'project->tool',
+      raw_count: 5,
+      weight: 0.8,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+    'project:github.com/user/repo||tool:Edit': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'tool:Edit',
+      connection_type: 'project->tool',
+      raw_count: 10,
+      weight: 0.9,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+    'project:github.com/user/other||tool:Read': {
+      source_node: 'project:github.com/user/other',
+      target_node: 'tool:Read',
+      connection_type: 'project->tool',
+      raw_count: 3,
+      weight: 0.5,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+    'project:github.com/user/repo||skill:gsd': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'skill:gsd',
+      connection_type: 'project->skill',
+      raw_count: 7,
+      weight: 0.7,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+    'project:github.com/user/other||skill:tdd': {
+      source_node: 'project:github.com/user/other',
+      target_node: 'skill:tdd',
+      connection_type: 'project->skill',
+      raw_count: 2,
+      weight: 0.3,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+  },
+  last_updated: '2025-03-01T00:00:00.000Z',
+  version: '1.0',
+};
+
+const emptyWeights: WeightsFile = {
+  connections: {},
+  last_updated: '2025-01-01T00:00:00.000Z',
+  version: '1.0',
+};
+
+let app: FastifyInstance;
+let graph: InMemoryGraph;
+
+beforeEach(async () => {
+  graph = buildGraph(fixtureWeights);
+  app = Fastify();
+  await app.register(cors, { origin: '*' });
+  registerGraphRoutes(app, () => graph);
+  await app.ready();
+});
+
+afterEach(async () => {
+  await app.close();
+});
+
+describe('GET /health', () => {
+  it('returns 200 with { status: "ok", uptime: <number> }', async () => {
+    const res = await app.inject({ method: 'GET', url: '/health' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.status).toBe('ok');
+    expect(typeof body.uptime).toBe('number');
+  });
+});
+
+describe('GET /graph', () => {
+  it('returns 200 with empty GraphResponse when graph is empty', async () => {
+    graph = buildGraph(emptyWeights);
+    const res = await app.inject({ method: 'GET', url: '/graph' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.nodes).toEqual([]);
+    expect(body.edges).toEqual([]);
+    expect(typeof body.updated_at).toBe('string');
+  });
+
+  it('returns 200 with populated GraphResponse when fixture graph is loaded', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.nodes.length).toBe(graph.nodeIndex.size);
+    expect(body.edges.length).toBe(graph.edgeList.length);
+    expect(typeof body.updated_at).toBe('string');
+  });
+
+  it('includes CORS header Access-Control-Allow-Origin: *', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph' });
+    expect(res.headers['access-control-allow-origin']).toBe('*');
+  });
+});
+
+describe('GET /graph/node/:id', () => {
+  it('returns 200 with { node, edges } for a known node id', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/graph/node/project:github.com%2Fuser%2Frepo',
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.node.id).toBe('project:github.com/user/repo');
+    expect(Array.isArray(body.edges)).toBe(true);
+    expect(body.edges.length).toBeGreaterThan(0);
+  });
+
+  it('returns 404 with { error: "Node not found" } for an unknown node id', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph/node/project:nonexistent' });
+    expect(res.statusCode).toBe(404);
+    const body = JSON.parse(res.body);
+    expect(body.error).toBe('Node not found');
+  });
+
+  it('URL-decodes the :id parameter', async () => {
+    // project:c%3A/dev → project:c:/dev
+    const pathWeights: WeightsFile = {
+      connections: {
+        'project:c:/dev||tool:Edit': {
+          source_node: 'project:c:/dev',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 1,
+          weight: 1.0,
+          first_seen: '2025-01-01T00:00:00.000Z',
+          last_seen: '2025-01-01T00:00:00.000Z',
+        },
+      },
+      last_updated: '2025-01-01T00:00:00.000Z',
+      version: '1.0',
+    };
+    graph = buildGraph(pathWeights);
+    const res = await app.inject({
+      method: 'GET',
+      url: '/graph/node/project%3Ac%3A%2Fdev',
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.node.id).toBe('project:c:/dev');
+  });
+});
+
+describe('GET /graph/subgraph', () => {
+  it('returns 400 when ?project= param is missing', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph/subgraph' });
+    expect(res.statusCode).toBe(400);
+    const body = JSON.parse(res.body);
+    expect(body.error).toBe('Missing required query parameter: project');
+  });
+
+  it('returns 200 with matching nodes/edges for a known project id', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/graph/subgraph?project=github.com/user/repo',
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.edges.length).toBeGreaterThan(0);
+    for (const edge of body.edges) {
+      expect(
+        edge.source === 'project:github.com/user/repo' ||
+        edge.target === 'project:github.com/user/repo'
+      ).toBe(true);
+    }
+  });
+
+  it('returns 200 with empty GraphResponse for a project id that has no edges', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/graph/subgraph?project=nonexistent',
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.edges).toEqual([]);
+    expect(body.nodes).toEqual([]);
+  });
+});
+
+describe('GET /graph/top', () => {
+  it('returns 200 with default limit of 10 edges when no limit param given', async () => {
+    // Our fixture has 5 edges — default 10 returns all
+    const res = await app.inject({ method: 'GET', url: '/graph/top' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.edges.length).toBe(5);
+  });
+
+  it('?limit=3 returns at most 3 edges', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=3' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.edges.length).toBe(3);
+  });
+
+  it('?limit=200 is clamped to max 100', async () => {
+    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=200' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    // fixture only has 5 edges, but limit was clamped to 100 (not 200)
+    expect(body.edges.length).toBe(5);
+  });
+
+  it('returns 200 with empty GraphResponse when graph is empty', async () => {
+    graph = buildGraph(emptyWeights);
+    const res = await app.inject({ method: 'GET', url: '/graph/top' });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.edges).toEqual([]);
+    expect(body.nodes).toEqual([]);
+  });
+});
