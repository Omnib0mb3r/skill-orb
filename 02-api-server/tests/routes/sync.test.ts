// tests/routes/sync.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSyncRoute } from '../../src/routes/sync.js';

describe('POST /sync', () => {
  it('returns 200 with sync summary on success', async () => {
    const mockSync = vi.fn().mockResolvedValue({
      created: ['NewProject'],
      moved: ['DevNeural'],
      errors: [],
    });

    const app = Fastify();
    registerSyncRoute(app, mockSync);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/sync' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ created: string[]; moved: string[]; errors: unknown[] }>();
    expect(body.created).toContain('NewProject');
    expect(body.moved).toContain('DevNeural');

    await app.close();
  });

  it('returns 500 with error message when sync throws', async () => {
    const mockSync = vi.fn().mockRejectedValue(new Error('MCP server not running'));

    const app = Fastify({ logger: false });
    registerSyncRoute(app, mockSync);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/sync' });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toContain('MCP server not running');

    await app.close();
  });
});
