import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerEventsRoutes } from '../../src/routes/events.js';
import type { LogEntry } from '../../src/routes/events.js';

function makeEntry(i: number): LogEntry {
  return {
    tool_use_id: `tu-${i}`,
    connection_type: 'project->tool',
    source_node: `project:repo-${i}`,
    target_node: 'tool:Edit',
    timestamp: new Date(1000 * i).toISOString(),
  };
}

let app: FastifyInstance;
let buffer: LogEntry[];

beforeEach(async () => {
  buffer = [];
  app = Fastify();
  await app.register(cors, { origin: '*' });
  registerEventsRoutes(app, () => buffer);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /events', () => {
  it('returns 200 with { events: [], total: 0 } when buffer is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/events' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns events in newest-first order (first element is most recent)', async () => {
    // Populate buffer newest-first: index 0 = newest
    buffer.push(makeEntry(3), makeEntry(2), makeEntry(1));
    const res = await app.inject({ method: 'GET', url: '/events' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events[0].tool_use_id).toBe('tu-3');
    expect(body.events[1].tool_use_id).toBe('tu-2');
    expect(body.events[2].tool_use_id).toBe('tu-1');
  });

  it('?limit=5 returns at most 5 events when buffer has more', async () => {
    for (let i = 0; i < 20; i++) buffer.push(makeEntry(i));
    const res = await app.inject({ method: 'GET', url: '/events?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events.length).toBe(5);
  });

  it('?limit=600 is clamped to max 500', async () => {
    for (let i = 0; i < 600; i++) buffer.push(makeEntry(i));
    const res = await app.inject({ method: 'GET', url: '/events?limit=600' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events.length).toBe(500);
  });

  it('total reflects full buffer size, not slice size', async () => {
    for (let i = 0; i < 20; i++) buffer.push(makeEntry(i));
    const res = await app.inject({ method: 'GET', url: '/events?limit=5' });
    const body = JSON.parse(res.body);
    expect(body.total).toBe(20);
    expect(body.events.length).toBe(5);
  });

  it('reads from in-memory buffer (no disk I/O)', async () => {
    const entry = makeEntry(99);
    buffer.push(entry);
    const res = await app.inject({ method: 'GET', url: '/events' });
    const body = JSON.parse(res.body);
    expect(body.events[0].tool_use_id).toBe('tu-99');
    expect(body.total).toBe(1);
  });

  it('invalid ?limit= value falls back to default of 50', async () => {
    for (let i = 0; i < 60; i++) buffer.push(makeEntry(i));
    const res = await app.inject({ method: 'GET', url: '/events?limit=abc' });
    const body = JSON.parse(res.body);
    expect(body.events.length).toBe(50);
  });

  it('?limit=0 falls back to default of 50', async () => {
    for (let i = 0; i < 60; i++) buffer.push(makeEntry(i));
    const res = await app.inject({ method: 'GET', url: '/events?limit=0' });
    const body = JSON.parse(res.body);
    expect(body.events.length).toBe(50);
  });

  it('includes CORS header Access-Control-Allow-Origin: *', async () => {
    const res = await app.inject({ method: 'GET', url: '/events' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
