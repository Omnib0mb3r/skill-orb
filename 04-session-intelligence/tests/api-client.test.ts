import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { fetchSubgraph, buildApiConfig } from '../src/api-client';

interface MockServer {
  port: number;
  stop: () => Promise<void>;
}

function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        stop: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

describe('fetchSubgraph', () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    delete process.env.DEVNEURAL_API_URL;
    delete process.env.DEVNEURAL_PORT;
  });

  it('returns parsed GraphResponse on success', async () => {
    const mockData = {
      nodes: [{ id: 'proj-1', type: 'project', label: 'DevNeural' }],
      edges: [],
      updated_at: '2024-01-01T00:00:00Z',
    };
    server = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockData));
    });
    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${server.port}`,
      timeoutMs: 5000,
    });
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(result!.edges).toEqual([]);
  });

  it('returns null when server is offline (ECONNREFUSED)', async () => {
    // Start then immediately stop a server to get a guaranteed-free port
    const tmp = await startMockServer((_req, res) => res.end());
    const freedPort = tmp.port;
    await tmp.stop();

    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${freedPort}`,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null when server delays 6 seconds (timeout)', { timeout: 15000 }, async () => {
    server = await startMockServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }, 6000);
    });
    const start = Date.now();
    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${server.port}`,
      timeoutMs: 5000,
    });
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(5500);
  });

  it('returns empty GraphResponse (not null) for empty graph', async () => {
    const mockData = { nodes: [], edges: [], updated_at: '2024-01-01T00:00:00Z' };
    server = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockData));
    });
    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${server.port}`,
      timeoutMs: 5000,
    });
    expect(result).not.toBeNull();
    expect(result!.nodes).toEqual([]);
    expect(result!.edges).toEqual([]);
  });

  it('returns null when server returns malformed JSON', async () => {
    server = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{invalid json');
    });
    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${server.port}`,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
  });

  it('returns null on non-OK HTTP status', async () => {
    server = await startMockServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const result = await fetchSubgraph('proj-1', {
      apiUrl: `http://localhost:${server.port}`,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
  });

  it('uses DEVNEURAL_API_URL when set, ignoring DEVNEURAL_PORT', async () => {
    server = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes: [], edges: [], updated_at: '' }));
    });
    process.env.DEVNEURAL_API_URL = `http://localhost:${server.port}`;
    process.env.DEVNEURAL_PORT = '19999';
    const config = buildApiConfig();
    expect(config.apiUrl).toBe(`http://localhost:${server.port}`);
    const result = await fetchSubgraph('proj-1', config);
    expect(result).not.toBeNull();
  });

  it('defaults to port 3747 when no env vars are set', async () => {
    delete process.env.DEVNEURAL_API_URL;
    delete process.env.DEVNEURAL_PORT;
    const config = buildApiConfig();
    expect(config.apiUrl).toBe('http://localhost:3747');
    const result = await fetchSubgraph('proj-1', config);
    expect(result).toBeNull();
  });
});
