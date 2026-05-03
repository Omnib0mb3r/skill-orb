import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { ServerMessageSchema } from '../src/ws/types.js';
import { createServer } from '../src/server.js';
import { createTempDir, removeTempDir } from './helpers/tempDir.js';

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe('ServerMessageSchema — voice union members', () => {
  it('accepts voice:focus with nodeId string', () => {
    expect(() =>
      ServerMessageSchema.parse({ type: 'voice:focus', payload: { nodeId: 'project:foo' } })
    ).not.toThrow();
  });

  it('accepts voice:highlight with nodeIds array', () => {
    expect(() =>
      ServerMessageSchema.parse({ type: 'voice:highlight', payload: { nodeIds: ['project:foo', 'skill:bar'] } })
    ).not.toThrow();
  });

  it('accepts voice:clear with empty payload object', () => {
    expect(() =>
      ServerMessageSchema.parse({ type: 'voice:clear', payload: {} })
    ).not.toThrow();
  });

  it('throws on voice:unknown type', () => {
    expect(() =>
      ServerMessageSchema.parse({ type: 'voice:unknown', payload: {} })
    ).toThrow();
  });

  it('accepts voice:highlight with empty nodeIds array', () => {
    expect(() =>
      ServerMessageSchema.parse({ type: 'voice:highlight', payload: { nodeIds: [] } })
    ).not.toThrow();
  });
});

// ─── HTTP tests ────────────────────────────────────────────────────────────────

let tempDir: string;
let server: Awaited<ReturnType<typeof createServer>>;

function baseUrl() {
  return `http://127.0.0.1:${server.port}`;
}

beforeEach(async () => {
  tempDir = createTempDir();
  await fs.mkdir(path.join(tempDir, 'logs'), { recursive: true });
  server = await createServer({ port: 0, dataRoot: tempDir, localReposRoot: '' });
});

afterEach(async () => {
  await server.stop();
  removeTempDir(tempDir);
});

describe('POST /voice/command — HTTP', () => {
  it('returns 200 for voice:focus with valid payload', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:focus', payload: { nodeId: 'project:foo' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 for voice:highlight with empty nodeIds', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:highlight', payload: { nodeIds: [] } }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 200 for voice:clear with empty payload', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:clear', payload: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown voice type', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:invalid', payload: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it('returns 400 when type is missing', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for graph:snapshot type (allowlist blocks non-voice types)', async () => {
    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'graph:snapshot', payload: {} }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── WebSocket broadcast integration tests ────────────────────────────────────

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return resolve();
    ws.once('close', resolve);
  });
}

describe('POST /voice/command — WebSocket broadcast', () => {
  it('WS client receives voice:focus event after POST', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    // Register snapshot listener before open to avoid missing immediate on-connect message
    const snapshotPromise = waitForMessage(ws);
    await waitForOpen(ws);
    await snapshotPromise;

    const msgPromise = waitForMessage(ws);
    await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:focus', payload: { nodeId: 'project:bar' } }),
    });

    const msg = await Promise.race([
      msgPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS message timed out')), 2000)),
    ]) as { type: string; payload: { nodeId: string } };

    ws.close();
    await waitForClose(ws);

    expect(msg.type).toBe('voice:focus');
    expect(msg.payload.nodeId).toBe('project:bar');
  });

  it('WS client receives voice:highlight with empty nodeIds', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const snapshotPromise = waitForMessage(ws);
    await waitForOpen(ws);
    await snapshotPromise;

    const msgPromise = waitForMessage(ws);
    await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:highlight', payload: { nodeIds: [] } }),
    });

    const msg = await Promise.race([
      msgPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS message timed out')), 2000)),
    ]) as { type: string; payload: { nodeIds: string[] } };

    ws.close();
    await waitForClose(ws);

    expect(msg.type).toBe('voice:highlight');
    expect(msg.payload.nodeIds).toEqual([]);
  });

  it('WS client receives voice:clear event after POST', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const snapshotPromise = waitForMessage(ws);
    await waitForOpen(ws);
    await snapshotPromise;

    const msgPromise = waitForMessage(ws);
    await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:clear', payload: {} }),
    });

    const msg = await Promise.race([
      msgPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS message timed out')), 2000)),
    ]) as { type: string; payload: Record<string, never> };

    ws.close();
    await waitForClose(ws);

    expect(msg.type).toBe('voice:clear');
  });

  it('invalid POST returns 400 and WS client receives no message', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const snapshotPromise = waitForMessage(ws);
    await waitForOpen(ws);
    await snapshotPromise;

    let received = false;
    ws.once('message', () => { received = true; });

    const res = await fetch(`${baseUrl()}/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice:bad', payload: {} }),
    });

    expect(res.status).toBe(400);

    // Wait briefly to confirm no broadcast arrives
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    ws.close();
    await waitForClose(ws);

    expect(received).toBe(false);
  });
});
