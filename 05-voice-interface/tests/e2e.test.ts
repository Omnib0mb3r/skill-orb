import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';

const ENTRY = path.resolve(__dirname, '../dist/index.js');
let MOCK_PORT = 0;
let DEVNEURAL_PORT = '';

interface RecordedPost {
  type: string;
  payload: unknown;
}

let mockServer: http.Server;
const recordedPosts: RecordedPost[] = [];

const skillEdgesFixture = [
  {
    id: 'e1',
    source: 'project:devneural',
    target: 'skill:typescript',
    weight: 8,
    connection_type: 'uses',
    raw_count: 8,
    first_seen: '2024-01-01',
    last_seen: '2024-03-01',
  },
  {
    id: 'e2',
    source: 'project:devneural',
    target: 'skill:react',
    weight: 5,
    connection_type: 'uses',
    raw_count: 5,
    first_seen: '2024-01-01',
    last_seen: '2024-03-01',
  },
];

const graphFixture = {
  nodes: [
    { id: 'project:devneural', type: 'project', label: 'DevNeural' },
    { id: 'skill:typescript', type: 'skill', label: 'TypeScript' },
  ],
  edges: skillEdgesFixture,
};

const subgraphFixture = {
  nodes: [
    { id: 'project:devneural', type: 'project', label: 'DevNeural' },
    { id: 'skill:typescript', type: 'skill', label: 'TypeScript' },
  ],
  edges: [
    {
      id: 'e1',
      source: 'project:devneural',
      target: 'skill:typescript',
      weight: 8,
      connection_type: 'uses',
      raw_count: 8,
      first_seen: '2024-01-01',
      last_seen: '2024-03-01',
    },
  ],
};

beforeAll(() => {
  return new Promise<void>((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        const url = req.url ?? '';

        if (req.method === 'POST' && url === '/voice/command') {
          try {
            const parsed = JSON.parse(body) as RecordedPost;
            recordedPosts.push(parsed);
          } catch { /* ignore */ }
          res.writeHead(200);
          res.end('{}');
          return;
        }

        if (req.method === 'GET' && url.startsWith('/graph/top')) {
          res.writeHead(200);
          res.end(JSON.stringify(skillEdgesFixture));
          return;
        }

        if (req.method === 'GET' && url.startsWith('/graph/subgraph')) {
          res.writeHead(200);
          res.end(JSON.stringify(subgraphFixture));
          return;
        }

        if (req.method === 'GET' && (url === '/graph' || url.startsWith('/graph?'))) {
          res.writeHead(200);
          res.end(JSON.stringify(graphFixture));
          return;
        }

        res.writeHead(404);
        res.end('{}');
      });
    });

    mockServer.listen(0, () => {
      const addr = mockServer.address() as { port: number };
      MOCK_PORT = addr.port;
      DEVNEURAL_PORT = String(MOCK_PORT);
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });
});

function run(args: string[], env?: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('node', [ENTRY, ...args], {
      env: { ...process.env, DEVNEURAL_PORT, ...env },
    });
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      // Resolve with null status so timeout-sensitive tests fail clearly.
      // Tests that assert status === 0 will fail with null, signalling a hang.
      resolve({ status: null, stdout, stderr });
    }, 15000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

describe('e2e: skills query with mock server', () => {
  beforeEach(() => {
    recordedPosts.length = 0;
  });

  it('exit code 0', async () => {
    const result = await run(['what skills am I using most?']);
    expect(result.status).toBe(0);
  });

  it('stdout is readable text (no markdown characters)', async () => {
    const result = await run(['what skills am I using most?']);
    expect(result.stdout).not.toMatch(/[*#`•\[\]_>|]/);
  });

  it('stdout contains no raw skill: node ID prefixes', async () => {
    const result = await run(['what skills am I using most?']);
    expect(result.stdout).not.toContain('skill:');
  });

  it('POST /voice/command received with type voice:highlight', async () => {
    const result = await run(['what skills am I using most?']);
    expect(result.status).toBe(0);
    const post = recordedPosts.find(p => p.type === 'voice:highlight');
    expect(post).toBeDefined();
  });
});

describe('e2e: context query with mock server', () => {
  beforeEach(() => {
    recordedPosts.length = 0;
  });

  it('exit code 0', async () => {
    const result = await run(["what's my current context"]);
    expect(result.status).toBe(0);
  });

  it('sends voice:focus then voice:highlight (two POSTs total)', async () => {
    const result = await run(["what's my current context"]);
    expect(result.status).toBe(0);

    const types = recordedPosts.map(p => p.type);
    expect(types).toContain('voice:focus');
    expect(types).toContain('voice:highlight');
    expect(recordedPosts).toHaveLength(2);
  });

  it('first POST is voice:focus', async () => {
    await run(["what's my current context"]);
    expect(recordedPosts[0]?.type).toBe('voice:focus');
  });

  it('second POST is voice:highlight', async () => {
    await run(["what's my current context"]);
    expect(recordedPosts[1]?.type).toBe('voice:highlight');
  });
});

describe('e2e: unknown intent', () => {
  beforeEach(() => {
    recordedPosts.length = 0;
  });

  it('exit code 0 for unrecognized query', async () => {
    const result = await run(['unknown gibberish xyzzy']);
    expect(result.status).toBe(0);
  });

  it('stdout contains clarification message', async () => {
    const result = await run(['unknown gibberish xyzzy']);
    expect(result.stdout).toMatch(/not sure|clarif/i);
  });

  it('POST /voice/command received with type voice:clear', async () => {
    await run(['unknown gibberish xyzzy']);
    const post = recordedPosts.find(p => p.type === 'voice:clear');
    expect(post).toBeDefined();
  });
});

describe('e2e: API unavailable', () => {
  it('exit code 0 when API unreachable', async () => {
    const result = await run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.status).toBe(0);
  });

  it("stdout contains \"isn't running\" message", async () => {
    const result = await run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.stdout).toContain("isn't running");
  });

  it('path in message ends with 02-api-server/dist/server.js', async () => {
    const result = await run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
  });
});
