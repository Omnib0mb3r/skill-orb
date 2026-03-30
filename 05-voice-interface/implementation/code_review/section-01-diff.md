diff --git a/02-api-server/src/routes/voice.ts b/02-api-server/src/routes/voice.ts
new file mode 100644
index 0000000..95fc27a
--- /dev/null
+++ b/02-api-server/src/routes/voice.ts
@@ -0,0 +1,30 @@
+import type { FastifyInstance } from 'fastify';
+import { z } from 'zod';
+import { ServerMessageSchema, type ServerMessage } from '../ws/types.js';
+
+const VoiceCommandSchema = z.object({
+  type: z.enum(['voice:focus', 'voice:highlight', 'voice:clear']),
+  payload: z.unknown(),
+});
+
+export function registerVoiceRoutes(
+  app: FastifyInstance,
+  broadcastFn: (msg: ServerMessage) => void
+): void {
+  app.post('/voice/command', async (request, reply) => {
+    // Step 1: validate type against allowlist
+    const typeResult = VoiceCommandSchema.safeParse(request.body);
+    if (!typeResult.success) {
+      return reply.status(400).send({ error: typeResult.error.message });
+    }
+
+    // Step 2: validate full body (type + payload shape) against ServerMessageSchema
+    const fullResult = ServerMessageSchema.safeParse(request.body);
+    if (!fullResult.success) {
+      return reply.status(400).send({ error: fullResult.error.message });
+    }
+
+    broadcastFn(fullResult.data);
+    return reply.status(200).send({ ok: true });
+  });
+}
diff --git a/02-api-server/src/server.ts b/02-api-server/src/server.ts
index 1893cd6..58d9504 100644
--- a/02-api-server/src/server.ts
+++ b/02-api-server/src/server.ts
@@ -13,6 +13,7 @@ import type { InMemoryGraph, WeightsFile, ProjectRegistry } from './graph/types.
 import { getFullGraph } from './graph/queries.js';
 import { registerGraphRoutes } from './routes/graph.js';
 import { registerEventsRoutes } from './routes/events.js';
+import { registerVoiceRoutes } from './routes/voice.js';
 import { setWss, broadcast } from './ws/broadcaster.js';
 import { startWatchers, stopWatchers, getEventBuffer } from './watcher/index.js';
 
@@ -44,6 +45,7 @@ export async function createServer(config: ServerConfig): Promise<{
   // Register REST routes (closures over graph reference for live reads)
   registerGraphRoutes(fastify, () => graph);
   registerEventsRoutes(fastify, getEventBuffer);
+  registerVoiceRoutes(fastify, broadcast);
 
   // Register WebSocket route — send snapshot directly to the connecting client only
   fastify.get('/ws', { websocket: true }, (socket) => {
diff --git a/02-api-server/src/ws/types.ts b/02-api-server/src/ws/types.ts
index 81af8f8..f8352d0 100644
--- a/02-api-server/src/ws/types.ts
+++ b/02-api-server/src/ws/types.ts
@@ -37,6 +37,9 @@ const LogEntrySchema = z.object({
 export const ServerMessageSchema = z.discriminatedUnion('type', [
   z.object({ type: z.literal('graph:snapshot'), payload: GraphResponseSchema }),
   z.object({ type: z.literal('connection:new'), payload: LogEntrySchema }),
+  z.object({ type: z.literal('voice:focus'), payload: z.object({ nodeId: z.string() }) }),
+  z.object({ type: z.literal('voice:highlight'), payload: z.object({ nodeIds: z.array(z.string()) }) }),
+  z.object({ type: z.literal('voice:clear'), payload: z.object({}) }),
 ]);
 
 export type ServerMessage = z.infer<typeof ServerMessageSchema>;
diff --git a/02-api-server/tests/voice.test.ts b/02-api-server/tests/voice.test.ts
new file mode 100644
index 0000000..9859a72
--- /dev/null
+++ b/02-api-server/tests/voice.test.ts
@@ -0,0 +1,224 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import fs from 'node:fs/promises';
+import path from 'node:path';
+import WebSocket from 'ws';
+import { ServerMessageSchema } from '../src/ws/types.js';
+import { createServer } from '../src/server.js';
+import { createTempDir, removeTempDir } from './helpers/tempDir.js';
+
+// ─── Schema tests ─────────────────────────────────────────────────────────────
+
+describe('ServerMessageSchema — voice union members', () => {
+  it('accepts voice:focus with nodeId string', () => {
+    expect(() =>
+      ServerMessageSchema.parse({ type: 'voice:focus', payload: { nodeId: 'project:foo' } })
+    ).not.toThrow();
+  });
+
+  it('accepts voice:highlight with nodeIds array', () => {
+    expect(() =>
+      ServerMessageSchema.parse({ type: 'voice:highlight', payload: { nodeIds: ['project:foo', 'skill:bar'] } })
+    ).not.toThrow();
+  });
+
+  it('accepts voice:clear with empty payload object', () => {
+    expect(() =>
+      ServerMessageSchema.parse({ type: 'voice:clear', payload: {} })
+    ).not.toThrow();
+  });
+
+  it('throws on voice:unknown type', () => {
+    expect(() =>
+      ServerMessageSchema.parse({ type: 'voice:unknown', payload: {} })
+    ).toThrow();
+  });
+
+  it('accepts voice:highlight with empty nodeIds array', () => {
+    expect(() =>
+      ServerMessageSchema.parse({ type: 'voice:highlight', payload: { nodeIds: [] } })
+    ).not.toThrow();
+  });
+});
+
+// ─── HTTP tests ────────────────────────────────────────────────────────────────
+
+let tempDir: string;
+let server: Awaited<ReturnType<typeof createServer>>;
+
+function baseUrl() {
+  return `http://127.0.0.1:${server.port}`;
+}
+
+beforeEach(async () => {
+  tempDir = createTempDir();
+  await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });
+  server = await createServer({ port: 0, dataRoot: tempDir, localReposRoot: '' });
+});
+
+afterEach(async () => {
+  await server.stop();
+  removeTempDir(tempDir);
+});
+
+describe('POST /voice/command — HTTP', () => {
+  it('returns 200 for voice:focus with valid payload', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:focus', payload: { nodeId: 'project:foo' } }),
+    });
+    expect(res.status).toBe(200);
+    const body = await res.json() as { ok: boolean };
+    expect(body.ok).toBe(true);
+  });
+
+  it('returns 200 for voice:highlight with empty nodeIds', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:highlight', payload: { nodeIds: [] } }),
+    });
+    expect(res.status).toBe(200);
+  });
+
+  it('returns 200 for voice:clear with empty payload', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:clear', payload: {} }),
+    });
+    expect(res.status).toBe(200);
+  });
+
+  it('returns 400 for unknown voice type', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:invalid', payload: {} }),
+    });
+    expect(res.status).toBe(400);
+    const body = await res.json() as { error: string };
+    expect(body.error).toBeDefined();
+  });
+
+  it('returns 400 when type is missing', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({}),
+    });
+    expect(res.status).toBe(400);
+  });
+
+  it('returns 400 for graph:snapshot type (allowlist blocks non-voice types)', async () => {
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'graph:snapshot', payload: {} }),
+    });
+    expect(res.status).toBe(400);
+  });
+});
+
+// ─── WebSocket broadcast integration tests ────────────────────────────────────
+
+function waitForOpen(ws: WebSocket): Promise<void> {
+  return new Promise((resolve, reject) => {
+    if (ws.readyState === WebSocket.OPEN) return resolve();
+    ws.once('open', resolve);
+    ws.once('error', reject);
+  });
+}
+
+function waitForMessage(ws: WebSocket): Promise<unknown> {
+  return new Promise((resolve, reject) => {
+    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
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
+describe('POST /voice/command — WebSocket broadcast', () => {
+  it('WS client receives voice:focus event after POST', async () => {
+    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
+    // Register snapshot listener before open to avoid missing immediate on-connect message
+    const snapshotPromise = waitForMessage(ws);
+    await waitForOpen(ws);
+    await snapshotPromise;
+
+    const msgPromise = waitForMessage(ws);
+    await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:focus', payload: { nodeId: 'project:bar' } }),
+    });
+
+    const msg = await Promise.race([
+      msgPromise,
+      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS message timed out')), 5000)),
+    ]) as { type: string; payload: { nodeId: string } };
+
+    ws.close();
+    await waitForClose(ws);
+
+    expect(msg.type).toBe('voice:focus');
+    expect(msg.payload.nodeId).toBe('project:bar');
+  });
+
+  it('WS client receives voice:highlight with empty nodeIds', async () => {
+    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
+    const snapshotPromise = waitForMessage(ws);
+    await waitForOpen(ws);
+    await snapshotPromise;
+
+    const msgPromise = waitForMessage(ws);
+    await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:highlight', payload: { nodeIds: [] } }),
+    });
+
+    const msg = await Promise.race([
+      msgPromise,
+      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS message timed out')), 5000)),
+    ]) as { type: string; payload: { nodeIds: string[] } };
+
+    ws.close();
+    await waitForClose(ws);
+
+    expect(msg.type).toBe('voice:highlight');
+    expect(msg.payload.nodeIds).toEqual([]);
+  });
+
+  it('invalid POST returns 400 and WS client receives no message', async () => {
+    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
+    const snapshotPromise = waitForMessage(ws);
+    await waitForOpen(ws);
+    await snapshotPromise;
+
+    let received = false;
+    ws.once('message', () => { received = true; });
+
+    const res = await fetch(`${baseUrl()}/voice/command`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type: 'voice:bad', payload: {} }),
+    });
+
+    expect(res.status).toBe(400);
+
+    // Wait briefly to confirm no broadcast arrives
+    await new Promise<void>((resolve) => setTimeout(resolve, 200));
+
+    ws.close();
+    await waitForClose(ws);
+
+    expect(received).toBe(false);
+  });
+});
