import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import { buildGraph } from '../../src/graph/builder.js';
import { getFullGraph } from '../../src/graph/queries.js';
import { setWss, broadcast, getClientCount } from '../../src/ws/broadcaster.js';
import type { WeightsFile } from '../../src/graph/types.js';

const fixtureWeights: WeightsFile = {
  connections: {
    'project:github.com/user/repo||tool:Agent': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Agent',
      connection_type: 'project->tool',
      raw_count: 3,
      weight: 0.9,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
  },
  schema_version: 1,
  updated_at: '2025-03-01T00:00:00.000Z',
};

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
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve);
  });
}

let app: FastifyInstance;
let port: number;
const graph = buildGraph(fixtureWeights);

beforeEach(async () => {
  app = Fastify();
  await app.register(fastifyWebsocket);
  app.get('/ws', { websocket: true }, (socket) => {
    const snapshot = getFullGraph(graph, new Date().toISOString());
    socket.send(JSON.stringify({ type: 'graph:snapshot', payload: snapshot }));
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
  setWss((app as any).websocketServer);
});

afterEach(async () => {
  await app.close();
});

describe('WebSocket /ws route', () => {
  it('connecting a client immediately receives a graph:snapshot message', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msg = await waitForMessage(ws) as any;
    ws.close();
    expect(msg.type).toBe('graph:snapshot');
  });

  it('graph:snapshot payload is a valid GraphResponse', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msg = await waitForMessage(ws) as any;
    ws.close();
    expect(Array.isArray(msg.payload.nodes)).toBe(true);
    expect(Array.isArray(msg.payload.edges)).toBe(true);
    expect(typeof msg.payload.updated_at).toBe('string');
    expect(() => new Date(msg.payload.updated_at)).not.toThrow();
  });
});

describe('broadcast()', () => {
  it('sends the message to all OPEN clients', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    // Consume the connection snapshots
    await Promise.all([waitForMessage(ws1), waitForMessage(ws2)]);

    // Now broadcast a new message
    const broadcastMsg = {
      type: 'graph:snapshot' as const,
      payload: getFullGraph(graph, '2025-06-01T00:00:00.000Z'),
    };
    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);
    broadcast(broadcastMsg);

    const [m1, m2] = await Promise.all([p1, p2]) as any[];
    ws1.close();
    ws2.close();

    expect(m1.type).toBe('graph:snapshot');
    expect(m2.type).toBe('graph:snapshot');
    expect(m1.payload.updated_at).toBe('2025-06-01T00:00:00.000Z');
    expect(m2.payload.updated_at).toBe('2025-06-01T00:00:00.000Z');
  });

  it('does not send to CLOSED clients and does not throw', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitForMessage(ws); // consume snapshot
    ws.close();
    await waitForClose(ws);

    // Allow event loop to propagate close to wss.clients
    await new Promise((r) => setTimeout(r, 10));

    expect(() =>
      broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) })
    ).not.toThrow();
  });

  it('serializes the message only once regardless of client count', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([waitForMessage(ws1), waitForMessage(ws2)]);

    const spy = vi.spyOn(JSON, 'stringify');
    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);
    broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, '2025-01-01T00:00:00.000Z') });
    await Promise.all([p1, p2]);

    // Check calls BEFORE restoring (mockRestore clears call history)
    const broadcastCalls = spy.mock.calls.filter(
      (args) => typeof args[0] === 'object' && args[0] !== null && 'type' in (args[0] as object)
    );
    spy.mockRestore();
    ws1.close();
    ws2.close();

    // JSON.stringify called once by broadcast (not once per client)
    expect(broadcastCalls.length).toBe(1);
  });
});

describe('getClientCount()', () => {
  it('returns 0 before any connections', async () => {
    // Fresh server, no clients yet — wss is set but empty
    expect(getClientCount()).toBe(0);
  });

  it('returns 1 after first client connects, 2 after second', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitForMessage(ws1);
    expect(getClientCount()).toBe(1);

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitForMessage(ws2);
    expect(getClientCount()).toBe(2);

    ws1.close();
    ws2.close();
  });

  it('decrements after a client disconnects', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([waitForMessage(ws1), waitForMessage(ws2)]);
    expect(getClientCount()).toBe(2);

    ws1.close();
    await waitForClose(ws1);
    await new Promise((r) => setTimeout(r, 10));
    expect(getClientCount()).toBe(1);

    ws2.close();
  });
});
