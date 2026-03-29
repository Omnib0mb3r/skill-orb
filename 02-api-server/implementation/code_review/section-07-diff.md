diff --git a/02-api-server/src/server.ts b/02-api-server/src/server.ts
index 89acad0..d3c8c91 100644
--- a/02-api-server/src/server.ts
+++ b/02-api-server/src/server.ts
@@ -1,18 +1,111 @@
-import Fastify from 'fastify';
-import { loadConfig } from './config.js';
+import Fastify, { type FastifyInstance } from 'fastify';
+import fastifyCors from '@fastify/cors';
+import fastifyWebsocket from '@fastify/websocket';
+import fs from 'node:fs';
+import path from 'node:path';
+import { fileURLToPath } from 'node:url';
+import type { AddressInfo } from 'node:net';
+import { type ServerConfig, loadConfig } from './config.js';
+import { buildGraph } from './graph/builder.js';
+import type { InMemoryGraph, WeightsFile } from './graph/types.js';
+import { getFullGraph } from './graph/queries.js';
+import { registerGraphRoutes } from './routes/graph.js';
+import { registerEventsRoutes } from './routes/events.js';
+import { setWss, broadcast } from './ws/broadcaster.js';
+import { startWatchers, stopWatchers, getEventBuffer } from './watcher/index.js';
 
-const config = loadConfig();
+export type { ServerConfig };
 
-const app = Fastify({ logger: true });
+const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '' };
 
-app.get('/health', async () => {
-  return { status: 'ok' };
-});
+export async function createServer(config: ServerConfig): Promise<{
+  fastify: FastifyInstance;
+  port: number;
+  stop: () => Promise<void>;
+}> {
+  const fastify = Fastify({ logger: true });
+  let graph: InMemoryGraph = buildGraph(emptyWeights);
 
-app.listen({ host: '127.0.0.1', port: config.port }, (err, address) => {
-  if (err) {
-    app.log.error(err);
-    process.exit(1);
+  // Register plugins (CORS first so headers apply to all routes including errors)
+  await fastify.register(fastifyCors, { origin: '*' });
+  await fastify.register(fastifyWebsocket);
+
+  // Register REST routes (closures over graph reference for live reads)
+  registerGraphRoutes(fastify, () => graph);
+  registerEventsRoutes(fastify, getEventBuffer);
+
+  // Register WebSocket route — send snapshot directly to the connecting client only
+  fastify.get('/ws', { websocket: true }, (socket) => {
+    const snapshot = getFullGraph(graph, new Date().toISOString());
+    socket.send(JSON.stringify({ type: 'graph:snapshot', payload: snapshot }));
+  });
+
+  // Start file watchers with reduced stabilityThreshold when running tests (port 0)
+  const stabilityThreshold = config.port === 0 ? 50 : 300;
+  startWatchers(
+    path.join(config.dataRoot, 'weights.json'),
+    path.join(config.dataRoot, 'logs'),
+    (newGraph) => {
+      graph = newGraph;
+      broadcast({ type: 'graph:snapshot', payload: getFullGraph(newGraph, new Date().toISOString()) });
+    },
+    (entry, isStartup) => {
+      if (!isStartup) {
+        const { tool_use_id, connection_type, source_node, target_node, timestamp } = entry;
+        broadcast({ type: 'connection:new', payload: { tool_use_id, connection_type, source_node, target_node, timestamp } });
+      }
+    },
+    { stabilityThreshold }
+  );
+
+  // Pre-load graph from weights.json if it exists so first request gets real data
+  try {
+    const raw = await fs.promises.readFile(path.join(config.dataRoot, 'weights.json'), 'utf-8');
+    graph = buildGraph(JSON.parse(raw) as WeightsFile);
+  } catch (err) {
+    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
+      console.error('Failed to load initial weights.json:', err);
+    }
+  }
+
+  try {
+    await fastify.listen({ port: config.port, host: '127.0.0.1' });
+  } catch (err) {
+    // Clean up watchers if bind fails (e.g. port already in use)
+    await stopWatchers();
+    throw err;
   }
-  app.log.info(`Server listening at ${address}`);
-});
+
+  const resolvedPort = (fastify.server.address() as AddressInfo).port;
+
+  // websocketServer is only available after listen() completes
+  setWss((fastify as any).websocketServer);
+
+  let stopped = false;
+  const stop = async () => {
+    if (stopped) return;
+    stopped = true;
+    await stopWatchers();
+    try {
+      await fastify.close();
+    } catch {
+      // ignore errors from already-closed instance
+    }
+  };
+
+  return { fastify, port: resolvedPort, stop };
+}
+
+// ESM entry-point guard — only runs when the file is executed directly, not when imported by tests
+const __filename = fileURLToPath(import.meta.url);
+if (process.argv[1] === __filename) {
+  (async () => {
+    const config = loadConfig();
+    const { fastify } = await createServer(config);
+    process.on('SIGINT', async () => {
+      await stopWatchers();
+      await fastify.close();
+      process.exit(0);
+    });
+  })();
+}
diff --git a/02-api-server/tests/server.integration.test.ts b/02-api-server/tests/server.integration.test.ts
new file mode 100644
index 0000000..2687761
--- /dev/null
+++ b/02-api-server/tests/server.integration.test.ts
@@ -0,0 +1,151 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import path from 'node:path';
+import fs from 'node:fs/promises';
+import WebSocket from 'ws';
+import { createServer } from '../src/server.js';
+import { createTempDir, removeTempDir } from './helpers/tempDir.js';
+
+const fixtureWeights = {
+  connections: {
+    'project:test-project||tool:test-tool': {
+      source_node: 'project:test-project',
+      target_node: 'tool:test-tool',
+      connection_type: 'project->tool',
+      raw_count: 3,
+      weight: 0.75,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-03-01T00:00:00.000Z',
+    },
+  },
+  last_updated: '2025-03-01T00:00:00.000Z',
+  version: '1.0',
+};
+
+async function pollUntil(
+  fn: () => Promise<boolean>,
+  intervalMs = 100,
+  timeoutMs = 5000
+): Promise<void> {
+  const deadline = Date.now() + timeoutMs;
+  while (Date.now() < deadline) {
+    if (await fn()) return;
+    await new Promise<void>((r) => setTimeout(r, intervalMs));
+  }
+  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
+}
+
+function waitForMessage(ws: WebSocket): Promise<unknown> {
+  return new Promise((resolve, reject) => {
+    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
+    ws.once('error', reject);
+  });
+}
+
+function waitForOpen(ws: WebSocket): Promise<void> {
+  return new Promise((resolve, reject) => {
+    if (ws.readyState === WebSocket.OPEN) return resolve();
+    ws.once('open', resolve);
+    ws.once('error', reject);
+  });
+}
+
+function waitForClose(ws: WebSocket): Promise<void> {
+  return new Promise((resolve) => {
+    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return resolve();
+    ws.once('close', resolve);
+  });
+}
+
+let tempDir: string;
+let server: Awaited<ReturnType<typeof createServer>>;
+
+beforeEach(async () => {
+  tempDir = createTempDir();
+  await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });
+  server = await createServer({ port: 0, dataRoot: tempDir });
+});
+
+afterEach(async () => {
+  await server.stop();
+  removeTempDir(tempDir);
+});
+
+describe('server integration', () => {
+  it('GET /health returns 200 with status ok and numeric uptime', async () => {
+    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
+    expect(res.status).toBe(200);
+    const body = (await res.json()) as { status: string; uptime: number };
+    expect(body.status).toBe('ok');
+    expect(typeof body.uptime).toBe('number');
+  });
+
+  it('GET /graph returns empty nodes and edges when no weights.json exists', async () => {
+    const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
+    expect(res.status).toBe(200);
+    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
+    expect(body.nodes).toEqual([]);
+    expect(body.edges).toEqual([]);
+  });
+
+  it('writing weights.json triggers watcher and updates /graph', async () => {
+    await fs.writeFile(path.join(tempDir, 'weights.json'), JSON.stringify(fixtureWeights));
+
+    await pollUntil(async () => {
+      const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
+      const body = (await res.json()) as { nodes: unknown[] };
+      return body.nodes.length > 0;
+    });
+
+    const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
+    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
+    expect(body.nodes.length).toBeGreaterThan(0);
+    expect(body.edges.length).toBeGreaterThan(0);
+  });
+
+  it('connected WS client receives graph:snapshot broadcast when weights.json is written', async () => {
+    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
+
+    // Set up message listener before awaiting open to avoid missing the immediate on-connect snapshot
+    const initialMsg = (await waitForMessage(ws)) as { type: string; payload: { nodes: unknown[] } };
+    expect(initialMsg.type).toBe('graph:snapshot');
+    expect(initialMsg.payload.nodes).toEqual([]);
+
+    const broadcastPromise = waitForMessage(ws);
+    await fs.writeFile(path.join(tempDir, 'weights.json'), JSON.stringify(fixtureWeights));
+
+    const broadcastMsg = (await Promise.race([
+      broadcastPromise,
+      new Promise<never>((_, reject) =>
+        setTimeout(() => reject(new Error('broadcast timed out after 5s')), 5000)
+      ),
+    ])) as { type: string; payload: { nodes: unknown[] } };
+
+    ws.close();
+    await waitForClose(ws);
+
+    expect(broadcastMsg.type).toBe('graph:snapshot');
+    expect(broadcastMsg.payload.nodes.length).toBeGreaterThan(0);
+  });
+
+  it('second createServer on the same port rejects', async () => {
+    const port = server.port;
+    const tempDir2 = createTempDir();
+    await fs.mkdir(path.join(tempDir2, 'logs'), { recursive: true });
+    try {
+      await expect(createServer({ port, dataRoot: tempDir2 })).rejects.toThrow();
+    } finally {
+      removeTempDir(tempDir2);
+    }
+  });
+
+  it('stop() closes the server and connected WebSocket clients receive a close frame', async () => {
+    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
+    await waitForMessage(ws); // consume initial on-connect snapshot
+
+    const closePromise = waitForClose(ws);
+    await server.stop();
+    await closePromise;
+
+    expect(ws.readyState).toBe(WebSocket.CLOSED);
+  });
+});
