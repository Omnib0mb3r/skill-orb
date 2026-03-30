import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
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

function run(args: string[], env?: Record<string, string>) {
  return spawnSync('node', [ENTRY, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, DEVNEURAL_PORT, ...env },
  });
}

describe('e2e: skills query with mock server', () => {
  beforeEach(() => {
    recordedPosts.length = 0;
  });

  it('exit code 0', () => {
    const result = run(['what skills am I using most?']);
    expect(result.status).toBe(0);
  });

  it('stdout is readable text (no markdown characters)', () => {
    const result = run(['what skills am I using most?']);
    expect(result.stdout).not.toMatch(/[*#`•\[\]_>|]/);
  });

  it('stdout contains no raw skill: node ID prefixes', () => {
    const result = run(['what skills am I using most?']);
    expect(result.stdout).not.toContain('skill:');
  });

  it('POST /voice/command received with type voice:highlight', () => {
    const result = run(['what skills am I using most?']);
    expect(result.status).toBe(0);
    const post = recordedPosts.find(p => p.type === 'voice:highlight');
    expect(post).toBeDefined();
  });
});

describe('e2e: context query with mock server', () => {
  beforeEach(() => {
    recordedPosts.length = 0;
  });

  it('exit code 0', () => {
    const result = run(["what's my current context"]);
    expect(result.status).toBe(0);
  });

  it('sends voice:focus then voice:highlight (two POSTs total)', () => {
    const result = run(["what's my current context"]);
    expect(result.status).toBe(0);

    const types = recordedPosts.map(p => p.type);
    expect(types).toContain('voice:focus');
    expect(types).toContain('voice:highlight');
    expect(recordedPosts).toHaveLength(2);
  });

  it('first POST is voice:focus', () => {
    run(["what's my current context"]);
    expect(recordedPosts[0]?.type).toBe('voice:focus');
  });

  it('second POST is voice:highlight', () => {
    run(["what's my current context"]);
    expect(recordedPosts[1]?.type).toBe('voice:highlight');
  });
});

describe('e2e: API unavailable', () => {
  it('exit code 0 when API unreachable', () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.status).toBe(0);
  });

  it("stdout contains \"isn't running\" message", () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.stdout).toContain("isn't running");
  });

  it('path in message ends with 02-api-server/dist/server.js', () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
  });
});
