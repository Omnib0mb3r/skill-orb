import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { createTempDir, removeTempDir } from './helpers/tempDir.js';

const fixtureWeights = {
  connections: {
    'project:test-project||tool:test-tool': {
      source_node: 'project:test-project',
      target_node: 'tool:test-tool',
      connection_type: 'project->tool',
      raw_count: 3,
      weight: 0.75,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
  },
  schema_version: 1,
  updated_at: '2025-03-01T00:00:00.000Z',
};

async function pollUntil(
  fn: () => Promise<boolean>,
  intervalMs = 100,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.once('error', reject);
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return resolve();
    ws.once('close', resolve);
  });
}

let tempDir: string;
let server: Awaited<ReturnType<typeof createServer>>;

beforeEach(async () => {
  tempDir = createTempDir();
  await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });
  server = await createServer({ port: 0, dataRoot: tempDir, localReposRoot: '' });
});

afterEach(async () => {
  await server.stop();
  removeTempDir(tempDir);
});

describe('server integration', () => {
  it('GET /health returns 200 with status ok and numeric uptime', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /graph returns empty nodes and edges when no weights.json exists', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it('writing weights.json triggers watcher and updates /graph', async () => {
    await fs.writeFile(path.join(tempDir, 'weights.json'), JSON.stringify(fixtureWeights));

    await pollUntil(async () => {
      const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
      const body = (await res.json()) as { nodes: unknown[] };
      return body.nodes.length > 0;
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/graph`);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('connected WS client receives graph:snapshot broadcast when weights.json is written', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

    // Set up message listener before awaiting open to avoid missing the immediate on-connect snapshot
    const initialMsg = (await waitForMessage(ws)) as { type: string; payload: { nodes: unknown[] } };
    expect(initialMsg.type).toBe('graph:snapshot');
    expect(initialMsg.payload.nodes).toEqual([]);

    const broadcastPromise = waitForMessage(ws);
    await fs.writeFile(path.join(tempDir, 'weights.json'), JSON.stringify(fixtureWeights));

    const broadcastMsg = (await Promise.race([
      broadcastPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('broadcast timed out after 5s')), 5000)
      ),
    ])) as { type: string; payload: { nodes: unknown[] } };

    ws.close();
    await waitForClose(ws);

    expect(broadcastMsg.type).toBe('graph:snapshot');
    expect(broadcastMsg.payload.nodes.length).toBeGreaterThan(0);
  });

  it('second createServer on the same port rejects', async () => {
    const port = server.port;
    const tempDir2 = createTempDir();
    await fs.mkdir(path.join(tempDir2, 'logs'), { recursive: true });
    try {
      await expect(createServer({ port, dataRoot: tempDir2 })).rejects.toThrow();
    } finally {
      removeTempDir(tempDir2);
    }
  });

  it('stop() closes the server and connected WebSocket clients receive a close frame', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await waitForMessage(ws); // consume initial on-connect snapshot

    const closePromise = waitForClose(ws);
    await server.stop();
    await closePromise;

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});
