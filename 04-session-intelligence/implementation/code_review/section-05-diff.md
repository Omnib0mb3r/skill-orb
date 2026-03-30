diff --git a/04-session-intelligence/src/session-start.ts b/04-session-intelligence/src/session-start.ts
new file mode 100644
index 0000000..0f526dc
--- /dev/null
+++ b/04-session-intelligence/src/session-start.ts
@@ -0,0 +1,66 @@
+import { resolveProjectIdentity } from './identity';
+import { fetchSubgraph, buildApiConfig } from './api-client';
+import { formatSubgraph } from './formatter';
+import type { FormatterConfig } from './formatter';
+import * as path from 'node:path';
+
+interface HookPayload {
+  session_id?: string;
+  cwd: string;
+  hook_event_name: string;
+  source?: string;
+  transcript_path?: string;
+  model?: string;
+}
+
+async function main(): Promise<void> {
+  // 1. Read stdin
+  process.stdin.setEncoding('utf8');
+  let rawStdin = '';
+  for await (const chunk of process.stdin) {
+    rawStdin += chunk;
+  }
+
+  // 2. Parse payload — silent exit on bad input
+  let payload: HookPayload;
+  try {
+    payload = JSON.parse(rawStdin) as HookPayload;
+  } catch {
+    process.exit(0);
+  }
+  if (!payload.cwd) {
+    process.exit(0);
+  }
+
+  // 3. Resolve project identity (never throws; falls back to dirname/basename)
+  const identity = await resolveProjectIdentity(payload.cwd);
+
+  // 4. Build API config and fetch subgraph
+  const apiConfig = buildApiConfig();
+  const response = await fetchSubgraph(identity.id, apiConfig);
+
+  // 5. Handle offline API
+  if (response === null) {
+    const serverPath = path
+      .resolve(__dirname, '../../02-api-server/dist/server.js')
+      .replace(/\\/g, '/');
+    process.stdout.write(`DevNeural: API offline. Start the server with:\n  node ${serverPath}\n`);
+    process.exit(0);
+  }
+
+  // 6. Format and write output
+  const formatterConfig: FormatterConfig = {
+    maxResultsPerType: 10,
+    minWeight: 1.0,
+  };
+  const output = formatSubgraph(identity.id, response, formatterConfig);
+  process.stdout.write(output + '\n');
+
+  // 7. Explicit exit prevents hanging async handles
+  process.exit(0);
+}
+
+main().catch((err) => {
+  process.stderr.write(String(err) + '\n');
+  process.exit(0);
+});
diff --git a/04-session-intelligence/tests/helpers.ts b/04-session-intelligence/tests/helpers.ts
new file mode 100644
index 0000000..ae0c6f4
--- /dev/null
+++ b/04-session-intelligence/tests/helpers.ts
@@ -0,0 +1,83 @@
+import { createServer, IncomingMessage, ServerResponse } from 'node:http';
+import { spawn } from 'node:child_process';
+import { mkdtempSync, rmSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+
+export interface MockServer {
+  url: string;
+  port: number;
+  close(): Promise<void>;
+}
+
+export function startMockApiServer(
+  handler: (req: IncomingMessage, res: ServerResponse) => void,
+): Promise<MockServer> {
+  return new Promise((resolve) => {
+    const server = createServer(handler);
+    server.listen(0, '127.0.0.1', () => {
+      const addr = server.address() as { port: number };
+      resolve({
+        url: `http://127.0.0.1:${addr.port}`,
+        port: addr.port,
+        close: () =>
+          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
+      });
+    });
+  });
+}
+
+export interface RunResult {
+  stdout: string;
+  stderr: string;
+  status: number;
+}
+
+/**
+ * Async alternative to spawnSync for running the binary.
+ * spawnSync blocks the Node.js event loop, which prevents mock HTTP servers
+ * (running in the same process) from handling requests.
+ */
+export function runBinary(
+  args: string[],
+  opts: {
+    cwd: string;
+    input: string;
+    env: NodeJS.ProcessEnv;
+    timeoutMs?: number;
+  },
+): Promise<RunResult> {
+  return new Promise((resolve, reject) => {
+    const proc = spawn('node', args, {
+      cwd: opts.cwd,
+      env: opts.env,
+      stdio: ['pipe', 'pipe', 'pipe'],
+    });
+
+    let stdout = '';
+    let stderr = '';
+
+    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
+    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
+    proc.on('close', (code) => resolve({ stdout, stderr, status: code ?? 1 }));
+    proc.on('error', reject);
+
+    proc.stdin.write(opts.input, () => proc.stdin.end());
+
+    if (opts.timeoutMs) {
+      const timer = setTimeout(() => {
+        proc.kill();
+        reject(new Error(`Process timed out after ${opts.timeoutMs}ms`));
+      }, opts.timeoutMs);
+      proc.on('close', () => clearTimeout(timer));
+    }
+  });
+}
+
+export function createTempDir(): string {
+  return mkdtempSync(join(tmpdir(), 'devneural-test-'));
+}
+
+export function removeTempDir(dir: string): void {
+  rmSync(dir, { recursive: true, force: true });
+}
diff --git a/04-session-intelligence/tests/session-start.test.ts b/04-session-intelligence/tests/session-start.test.ts
new file mode 100644
index 0000000..3162e1c
--- /dev/null
+++ b/04-session-intelligence/tests/session-start.test.ts
@@ -0,0 +1,224 @@
+import { describe, it, expect, beforeAll, afterEach } from 'vitest';
+import { spawnSync } from 'node:child_process';
+import { fileURLToPath } from 'node:url';
+import * as path from 'node:path';
+import { startMockApiServer, runBinary, createTempDir, removeTempDir } from './helpers.js';
+import type { MockServer } from './helpers.js';
+
+const __dirname = path.dirname(fileURLToPath(import.meta.url));
+const moduleRoot = path.resolve(__dirname, '..');
+
+function makePayload(cwd: string = moduleRoot): string {
+  return JSON.stringify({ cwd, hook_event_name: 'SessionStart' });
+}
+
+function makeSkillEdge(
+  sourceId: string,
+  skillName: string,
+  weight: number,
+  rawCount = 5,
+) {
+  return {
+    id: `e-${skillName}`,
+    source: sourceId,
+    target: `skill:${skillName}`,
+    connection_type: 'project->skill',
+    raw_count: rawCount,
+    weight,
+    first_seen: '2024-01-01T00:00:00Z',
+    last_seen: '2024-06-01T00:00:00Z',
+  };
+}
+
+describe('session-start integration', () => {
+  let server: MockServer | null = null;
+  let tempDir: string | null = null;
+
+  beforeAll(() => {
+    // Compile once; all tests share the built binary.
+    // spawnSync is fine here — no mock server needs the event loop during compilation.
+    const result = spawnSync('npx', ['tsc'], {
+      cwd: moduleRoot,
+      encoding: 'utf8',
+      shell: true,
+    });
+    if (result.status !== 0) {
+      throw new Error(`tsc compilation failed:\n${result.stdout}\n${result.stderr}`);
+    }
+  });
+
+  afterEach(async () => {
+    if (server) {
+      await server.close();
+      server = null;
+    }
+    if (tempDir) {
+      removeTempDir(tempDir);
+      tempDir = null;
+    }
+  });
+
+  it('happy path: project with skills and related projects', async () => {
+    server = await startMockApiServer((req, res) => {
+      const url = new URL(req.url!, 'http://localhost');
+      const projectId = url.searchParams.get('project') ?? 'unknown';
+      const sourceId = `project:${projectId}`;
+      const data = {
+        nodes: [{ id: 'skill:TDD', type: 'skill', label: 'Test-Driven Development' }],
+        edges: [makeSkillEdge(sourceId, 'TDD', 7.5, 42)],
+        updated_at: '2024-06-01T00:00:00Z',
+      };
+      res.writeHead(200, { 'Content-Type': 'application/json' });
+      res.end(JSON.stringify(data));
+    });
+
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+    });
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).toContain('DevNeural Context for');
+    expect(result.stdout).toContain('Test-Driven Development');
+    expect(result.stdout).toContain('7.5');
+    expect(result.stdout).toContain('42');
+  });
+
+  it('no connections: project not in graph or all weights below threshold', async () => {
+    server = await startMockApiServer((_req, res) => {
+      const data = { nodes: [], edges: [], updated_at: '2024-01-01T00:00:00Z' };
+      res.writeHead(200, { 'Content-Type': 'application/json' });
+      res.end(JSON.stringify(data));
+    });
+
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+    });
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).toContain('No significant connections');
+  });
+
+  it('API offline (ECONNREFUSED): port where nothing is listening', async () => {
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: 'http://127.0.0.1:19987' },
+    });
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).toContain('API offline');
+  });
+
+  it('API timeout: mock server delays 6 seconds', { timeout: 15000 }, async () => {
+    server = await startMockApiServer((_req, res) => {
+      setTimeout(() => {
+        res.writeHead(200, { 'Content-Type': 'application/json' });
+        res.end('{}');
+      }, 6000);
+    });
+
+    const start = Date.now();
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+      timeoutMs: 9000,
+    });
+    const elapsed = Date.now() - start;
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).toContain('API offline');
+    expect(elapsed).toBeLessThan(7000);
+  });
+
+  it('malformed JSON on stdin: silent failure', async () => {
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: '{ not valid json',
+      env: { ...process.env },
+    });
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).toBe('');
+  });
+
+  it('CWD with no git: falls back to dirname, still calls API', async () => {
+    tempDir = createTempDir();
+
+    server = await startMockApiServer((req, res) => {
+      const url = new URL(req.url!, 'http://localhost');
+      const projectId = url.searchParams.get('project') ?? 'unknown';
+      const sourceId = `project:${projectId}`;
+      const data = {
+        nodes: [],
+        edges: [makeSkillEdge(sourceId, 'SomeSkill', 3.0, 2)],
+        updated_at: '2024-01-01T00:00:00Z',
+      };
+      res.writeHead(200, { 'Content-Type': 'application/json' });
+      res.end(JSON.stringify(data));
+    });
+
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(tempDir),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+    });
+
+    expect(result.status).toBe(0);
+  });
+
+  it('top-10 limit: mock API returns 15 skills, output has exactly 10', async () => {
+    server = await startMockApiServer((req, res) => {
+      const url = new URL(req.url!, 'http://localhost');
+      const projectId = url.searchParams.get('project') ?? 'unknown';
+      const sourceId = `project:${projectId}`;
+      const edges = Array.from({ length: 15 }, (_, i) =>
+        makeSkillEdge(sourceId, `Skill-${String(i + 1).padStart(2, '0')}`, 5.0 + i * 0.1, 10 + i),
+      );
+      const data = { nodes: [], edges, updated_at: '2024-01-01T00:00:00Z' };
+      res.writeHead(200, { 'Content-Type': 'application/json' });
+      res.end(JSON.stringify(data));
+    });
+
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+    });
+
+    expect(result.status).toBe(0);
+    const bulletCount = (result.stdout.match(/•/g) ?? []).length;
+    expect(bulletCount).toBe(10);
+  });
+
+  it('weight filtering: skills with weight 0.5 do not appear', async () => {
+    server = await startMockApiServer((req, res) => {
+      const url = new URL(req.url!, 'http://localhost');
+      const projectId = url.searchParams.get('project') ?? 'unknown';
+      const sourceId = `project:${projectId}`;
+      const data = {
+        nodes: [],
+        edges: [
+          makeSkillEdge(sourceId, 'HeavySkill', 5.0, 10),
+          makeSkillEdge(sourceId, 'LightSkill', 0.5, 3),
+        ],
+        updated_at: '2024-01-01T00:00:00Z',
+      };
+      res.writeHead(200, { 'Content-Type': 'application/json' });
+      res.end(JSON.stringify(data));
+    });
+
+    const result = await runBinary(['dist/session-start.js'], {
+      cwd: moduleRoot,
+      input: makePayload(),
+      env: { ...process.env, DEVNEURAL_API_URL: server.url },
+    });
+
+    expect(result.status).toBe(0);
+    expect(result.stdout).not.toContain('LightSkill');
+  });
+});
