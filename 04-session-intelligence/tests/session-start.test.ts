import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { startMockApiServer, runBinary, createTempDir, removeTempDir } from './helpers.js';
import type { MockServer } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(__dirname, '..');

function makePayload(cwd: string = moduleRoot): string {
  return JSON.stringify({ cwd, hook_event_name: 'SessionStart' });
}

function makeSkillEdge(
  sourceId: string,
  skillName: string,
  weight: number,
  rawCount = 5,
) {
  return {
    id: `e-${skillName}`,
    source: sourceId,
    target: `skill:${skillName}`,
    connection_type: 'project->skill',
    raw_count: rawCount,
    weight,
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2024-06-01T00:00:00Z',
  };
}

describe('session-start integration', () => {
  let server: MockServer | null = null;
  let tempDir: string | null = null;

  beforeAll(() => {
    // Compile once; all tests share the built binary.
    // spawnSync is fine here — no mock server needs the event loop during compilation.
    const result = spawnSync('npx', ['tsc'], {
      cwd: moduleRoot,
      encoding: 'utf8',
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`tsc compilation failed:\n${result.stdout}\n${result.stderr}`);
    }
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (tempDir) {
      removeTempDir(tempDir);
      tempDir = null;
    }
  });

  it('happy path: project with skills and related projects', async () => {
    server = await startMockApiServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      const projectId = url.searchParams.get('project') ?? 'unknown';
      const sourceId = `project:${projectId}`;
      const data = {
        nodes: [{ id: 'skill:TDD', type: 'skill', label: 'Test-Driven Development' }],
        edges: [makeSkillEdge(sourceId, 'TDD', 7.5, 42)],
        updated_at: '2024-06-01T00:00:00Z',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });

    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DevNeural Context for');
    expect(result.stdout).toContain('Test-Driven Development');
    expect(result.stdout).toContain('7.5');
    expect(result.stdout).toContain('42');
  });

  it('no connections: project not in graph or all weights below threshold', async () => {
    server = await startMockApiServer((_req, res) => {
      const data = { nodes: [], edges: [], updated_at: '2024-01-01T00:00:00Z' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });

    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No significant connections');
  });

  it('API offline (ECONNREFUSED): port where nothing is listening', async () => {
    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: 'http://127.0.0.1:19987' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('API offline');
  });

  it('API timeout: mock server delays 6 seconds', { timeout: 15000 }, async () => {
    server = await startMockApiServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }, 6000);
    });

    const start = Date.now();
    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
      timeoutMs: 9000,
    });
    const elapsed = Date.now() - start;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('API offline');
    expect(elapsed).toBeLessThan(7000);
  });

  it('malformed JSON on stdin: silent failure', async () => {
    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: '{ not valid json',
      env: { ...process.env },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('CWD with no git: falls back to dirname, still calls API', async () => {
    tempDir = createTempDir();

    server = await startMockApiServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      const projectId = url.searchParams.get('project') ?? 'unknown';
      const sourceId = `project:${projectId}`;
      const data = {
        nodes: [],
        edges: [makeSkillEdge(sourceId, 'SomeSkill', 3.0, 2)],
        updated_at: '2024-01-01T00:00:00Z',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });

    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(tempDir),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
    });

    expect(result.status).toBe(0);
    // Verify the API was actually called: fallback identity produced output
    expect(result.stdout).toContain('DevNeural Context for');
  });

  it('top-10 limit: mock API returns 15 skills, output has exactly 10', async () => {
    server = await startMockApiServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      const projectId = url.searchParams.get('project') ?? 'unknown';
      const sourceId = `project:${projectId}`;
      const edges = Array.from({ length: 15 }, (_, i) =>
        makeSkillEdge(sourceId, `Skill-${String(i + 1).padStart(2, '0')}`, 5.0 + i * 0.1, 10 + i),
      );
      const data = { nodes: [], edges, updated_at: '2024-01-01T00:00:00Z' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });

    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
    });

    expect(result.status).toBe(0);
    const bulletCount = (result.stdout.match(/•/g) ?? []).length;
    expect(bulletCount).toBe(10);
  });

  it('weight filtering: skills with weight 0.5 do not appear', async () => {
    server = await startMockApiServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      const projectId = url.searchParams.get('project') ?? 'unknown';
      const sourceId = `project:${projectId}`;
      const data = {
        nodes: [],
        edges: [
          makeSkillEdge(sourceId, 'HeavySkill', 5.0, 10),
          makeSkillEdge(sourceId, 'LightSkill', 0.5, 3),
        ],
        updated_at: '2024-01-01T00:00:00Z',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });

    const result = await runBinary(['dist/session-start.js'], {
      cwd: moduleRoot,
      input: makePayload(),
      env: { ...process.env, DEVNEURAL_API_URL: server.url },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('LightSkill');
  });
});
