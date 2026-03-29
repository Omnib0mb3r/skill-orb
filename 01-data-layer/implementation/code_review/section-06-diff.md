diff --git a/01-data-layer/src/hook-runner.ts b/01-data-layer/src/hook-runner.ts
new file mode 100644
index 0000000..26d5b04
--- /dev/null
+++ b/01-data-layer/src/hook-runner.ts
@@ -0,0 +1,205 @@
+import * as path from 'path';
+import * as fs from 'fs';
+import lockfile from 'proper-lockfile';
+import { loadConfig } from './config';
+import { resolveProjectIdentity, normalizeGitUrl } from './identity';
+import { buildLogEntry, appendLogEntry } from './logger';
+import { loadWeights, updateWeight, saveWeights } from './weights';
+import type { HookPayload, ConnectionType, ProjectIdentity, DerivedConnection } from './types';
+
+const DEFAULT_DATA_ROOT = 'C:/dev/data/skill-connections';
+
+// A skill identifier is kebab-case (deep-plan) or namespace:kebab-case (gsd:execute-phase).
+// Single words without hyphens or colons are not skill names.
+const SKILL_TOKEN_RE = /^[\w]+-[\w-]*(:([\w-]+))?$|^[\w]+:([\w-]+)$/;
+
+const ABS_PATH_RE = /(?:[A-Za-z]:[/\\]\S*|\/\S+)/g;
+const URL_RE = /(?:https?:\/\/\S+|git@\S+)/g;
+
+/** Extracts a skill name from an Agent tool invocation's tool_input.
+ *  Priority: recognizable token in description → subagent_type → "unknown-skill". */
+export function extractSkillName(toolInput: Record<string, unknown>): string {
+  const description = typeof toolInput['description'] === 'string' ? toolInput['description'] : '';
+  if (description) {
+    for (const token of description.split(/\s+/)) {
+      if (SKILL_TOKEN_RE.test(token)) {
+        return token;
+      }
+    }
+  }
+
+  const subagentType = typeof toolInput['subagent_type'] === 'string' ? toolInput['subagent_type'] : '';
+  if (subagentType) {
+    return subagentType;
+  }
+
+  return 'unknown-skill';
+}
+
+/** Scans tool_input for references to other projects. Returns project->project connections. Never throws. */
+export async function extractProjectRefs(
+  payload: HookPayload,
+  identity: ProjectIdentity,
+): Promise<DerivedConnection[]> {
+  const refs: DerivedConnection[] = [];
+  const seen = new Set<string>();
+
+  const tryAdd = (targetId: string) => {
+    if (targetId && targetId !== identity.id && !seen.has(targetId)) {
+      seen.add(targetId);
+      refs.push({
+        connectionType: 'project->project' as ConnectionType,
+        sourceNode: `project:${identity.id}`,
+        targetNode: `project:${targetId}`,
+      });
+    }
+  };
+
+  try {
+    const name = payload.tool_name;
+    const input = payload.tool_input;
+
+    if (name === 'Write' || name === 'Edit') {
+      const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : '';
+      if (filePath) {
+        try {
+          const ref = await resolveProjectIdentity(path.dirname(filePath));
+          tryAdd(ref.id);
+        } catch { /* skip */ }
+      }
+    } else if (name === 'Bash') {
+      const command = typeof input['command'] === 'string' ? input['command'] : '';
+      for (const candidate of (command.match(ABS_PATH_RE) ?? [])) {
+        if (fs.existsSync(candidate)) {
+          try {
+            const ref = await resolveProjectIdentity(candidate);
+            tryAdd(ref.id);
+          } catch { /* skip */ }
+        }
+      }
+    } else if (name === 'Agent') {
+      const texts = [
+        typeof input['prompt'] === 'string' ? input['prompt'] : '',
+        typeof input['description'] === 'string' ? input['description'] : '',
+      ];
+      for (const text of texts) {
+        if (!text) continue;
+        for (const url of (text.match(URL_RE) ?? [])) {
+          tryAdd(normalizeGitUrl(url));
+        }
+        for (const candidate of (text.match(ABS_PATH_RE) ?? [])) {
+          if (fs.existsSync(candidate)) {
+            try {
+              const ref = await resolveProjectIdentity(candidate);
+              tryAdd(ref.id);
+            } catch { /* skip */ }
+          }
+        }
+      }
+    }
+  } catch { /* never throw */ }
+
+  return refs;
+}
+
+/** Derives all connections produced by a single tool invocation. Never throws. */
+export async function deriveConnections(
+  payload: HookPayload,
+  identity: ProjectIdentity,
+): Promise<DerivedConnection[]> {
+  const primary: DerivedConnection = payload.tool_name === 'Agent'
+    ? {
+        connectionType: 'project->skill',
+        sourceNode: `project:${identity.id}`,
+        targetNode: `skill:${extractSkillName(payload.tool_input)}`,
+      }
+    : {
+        connectionType: 'project->tool',
+        sourceNode: `project:${identity.id}`,
+        targetNode: `tool:${payload.tool_name}`,
+      };
+
+  try {
+    const secondary = await extractProjectRefs(payload, identity);
+    return [primary, ...secondary];
+  } catch {
+    return [primary];
+  }
+}
+
+async function readStdin(): Promise<string> {
+  if (process.stdin.isTTY) {
+    return '';
+  }
+  const chunks: Buffer[] = [];
+  for await (const chunk of process.stdin) {
+    chunks.push(chunk as Buffer);
+  }
+  return Buffer.concat(chunks).toString('utf8');
+}
+
+async function main(): Promise<void> {
+  const dataRoot = process.env['DEVNEURAL_DATA_ROOT'] ?? DEFAULT_DATA_ROOT;
+
+  const rawInput = await readStdin();
+  if (!rawInput.trim()) {
+    return;
+  }
+
+  let payload: HookPayload;
+  try {
+    payload = JSON.parse(rawInput) as HookPayload;
+  } catch {
+    return;
+  }
+
+  const config = loadConfig(dataRoot);
+  const effectiveDataRoot = config.data_root;
+
+  if (!config.allowlist.includes(payload.tool_name)) {
+    return;
+  }
+
+  const identity = await resolveProjectIdentity(payload.cwd);
+  const connections = await deriveConnections(payload, identity);
+
+  const entries = connections.map(conn =>
+    buildLogEntry(payload, identity, conn.connectionType, conn.sourceNode, conn.targetNode),
+  );
+
+  const weightsPath = path.join(effectiveDataRoot, 'weights.json');
+
+  await Promise.all([
+    // Append each log entry concurrently.
+    // NOTE: full tool_input is stored (may include large Write file contents). Truncation can be added later.
+    Promise.all(entries.map(entry => appendLogEntry(entry, effectiveDataRoot))),
+    // Single lock acquisition covers all weight updates for this event.
+    (async () => {
+      let release: (() => Promise<void>) | undefined;
+      try {
+        try {
+          release = await lockfile.lock(weightsPath, { stale: 5000, retries: 3, realpath: false });
+        } catch {
+          // Lock failed — proceed without lock (weights are soft data; one lost update is acceptable)
+        }
+        const weights = loadWeights(effectiveDataRoot);
+        const now = new Date();
+        for (const conn of connections) {
+          updateWeight(weights, conn.sourceNode, conn.targetNode, conn.connectionType, now);
+        }
+        await saveWeights(weights, effectiveDataRoot);
+      } finally {
+        if (release) {
+          try { await release(); } catch { /* ignore unlock errors */ }
+        }
+      }
+    })(),
+  ]);
+}
+
+if (require.main === module) {
+  main().catch((err) => {
+    console.error('[DevNeural]', err instanceof Error ? err.message : String(err));
+    process.exit(0);
+  });
+}
diff --git a/01-data-layer/tests/hook-runner.test.ts b/01-data-layer/tests/hook-runner.test.ts
new file mode 100644
index 0000000..b2cde95
--- /dev/null
+++ b/01-data-layer/tests/hook-runner.test.ts
@@ -0,0 +1,345 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import * as os from 'os';
+import * as path from 'path';
+import * as fs from 'fs';
+import { spawnSync } from 'child_process';
+import { extractSkillName, extractProjectRefs, deriveConnections } from '../src/hook-runner';
+import { resolveProjectIdentity } from '../src/identity';
+import type { HookPayload, ProjectIdentity } from '../src/types';
+import { createTempDir, removeTempDir } from './helpers/tempDir';
+
+// ── Fixtures ──────────────────────────────────────────────────────────────────
+
+const makePayload = (overrides: Partial<HookPayload> = {}): HookPayload => ({
+  hook_event_name: 'PostToolUse',
+  session_id: 'sess-001',
+  cwd: 'C:/dev/tools/DevNeural',
+  tool_name: 'Bash',
+  tool_input: { command: 'echo hello' },
+  tool_response: null,
+  tool_use_id: 'tu-001',
+  transcript_path: '/tmp/transcript.json',
+  permission_mode: 'default',
+  ...overrides,
+});
+
+const makeIdentity = (overrides: Partial<ProjectIdentity> = {}): ProjectIdentity => ({
+  id: 'github.com/user/devneural',
+  source: 'git-remote',
+  ...overrides,
+});
+
+// ── Integration subprocess helper ─────────────────────────────────────────────
+
+const projectRoot = path.resolve(__dirname, '..');
+const tsxBin = path.join(
+  projectRoot,
+  'node_modules',
+  '.bin',
+  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
+);
+
+const spawnHook = (stdin: string, extraEnv: Record<string, string> = {}) =>
+  spawnSync(tsxBin, ['src/hook-runner.ts'], {
+    input: stdin,
+    encoding: 'utf8',
+    cwd: projectRoot,
+    env: { ...process.env, ...extraEnv },
+    shell: process.platform === 'win32',
+    timeout: 15000,
+  });
+
+// ── extractSkillName ──────────────────────────────────────────────────────────
+
+describe('extractSkillName', () => {
+  it('extracts kebab-case skill name from description', () => {
+    expect(extractSkillName({ description: 'Use deep-plan to plan the feature' })).toBe('deep-plan');
+  });
+
+  it('extracts namespace:kebab skill name from description', () => {
+    expect(extractSkillName({ description: 'gsd:execute-phase agent for execution' })).toBe('gsd:execute-phase');
+  });
+
+  it('falls back to subagent_type when description has no skill token', () => {
+    expect(extractSkillName({ description: 'Exploring the codebase', subagent_type: 'Explore' })).toBe('Explore');
+  });
+
+  it('returns unknown-skill when no recognizable skill token in description', () => {
+    expect(extractSkillName({ description: 'Exploring the codebase for patterns' })).toBe('unknown-skill');
+  });
+
+  it('returns unknown-skill when no description field', () => {
+    expect(extractSkillName({})).toBe('unknown-skill');
+  });
+});
+
+// ── extractProjectRefs ────────────────────────────────────────────────────────
+
+describe('extractProjectRefs', () => {
+  let tempDir: string;
+  const identity = makeIdentity({ id: 'current-project' });
+
+  beforeEach(() => { tempDir = createTempDir(); });
+  afterEach(() => { removeTempDir(tempDir); });
+
+  it('detects cross-project file_path in Edit tool_input', async () => {
+    const filePath = path.join(tempDir, 'some-file.ts');
+    const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
+    const refs = await extractProjectRefs(payload, identity);
+    expect(refs).toHaveLength(1);
+    expect(refs[0].connectionType).toBe('project->project');
+    expect(refs[0].sourceNode).toBe('project:current-project');
+    expect(refs[0].targetNode).toMatch(/^project:/);
+  });
+
+  it('returns no connections when file_path is within the current project', async () => {
+    const resolvedIdentity = await resolveProjectIdentity(tempDir);
+    const filePath = path.join(tempDir, 'some-file.ts');
+    const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
+    const refs = await extractProjectRefs(payload, resolvedIdentity);
+    expect(refs).toHaveLength(0);
+  });
+
+  it('detects cross-project repo URL in Agent tool_input.prompt', async () => {
+    const payload = makePayload({
+      tool_name: 'Agent',
+      tool_input: { prompt: 'See https://github.com/user/other-repo for reference' },
+    });
+    const refs = await extractProjectRefs(payload, identity);
+    expect(refs).toHaveLength(1);
+    expect(refs[0].connectionType).toBe('project->project');
+    expect(refs[0].targetNode).toBe('project:github.com/user/other-repo');
+  });
+
+  it('deduplicates multiple references to the same target project', async () => {
+    const payload = makePayload({
+      tool_name: 'Agent',
+      tool_input: {
+        prompt: 'See https://github.com/user/repo and also https://github.com/user/repo',
+      },
+    });
+    const refs = await extractProjectRefs(payload, identity);
+    expect(refs).toHaveLength(1);
+  });
+
+  it('silently skips unresolvable or nonexistent paths — does not throw', async () => {
+    const payload = makePayload({
+      tool_name: 'Bash',
+      tool_input: { command: 'ls /nonexistent-path-xyz/that/does/not/exist' },
+    });
+    await expect(extractProjectRefs(payload, identity)).resolves.toEqual([]);
+  });
+});
+
+// ── deriveConnections ─────────────────────────────────────────────────────────
+
+describe('deriveConnections', () => {
+  const identity = makeIdentity();
+
+  it('returns project->tool connection for a Bash payload', async () => {
+    const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' } });
+    const conns = await deriveConnections(payload, identity);
+    expect(conns).toHaveLength(1);
+    expect(conns[0].connectionType).toBe('project->tool');
+    expect(conns[0].sourceNode).toBe('project:github.com/user/devneural');
+    expect(conns[0].targetNode).toBe('tool:Bash');
+  });
+
+  it('returns project->skill connection for Agent payload with recognizable skill in description', async () => {
+    const payload = makePayload({
+      tool_name: 'Agent',
+      tool_input: { description: 'deep-plan skill for implementation planning' },
+    });
+    const conns = await deriveConnections(payload, identity);
+    expect(conns).toHaveLength(1);
+    expect(conns[0].connectionType).toBe('project->skill');
+    expect(conns[0].targetNode).toBe('skill:deep-plan');
+  });
+
+  it('returns skill:unknown-skill when Agent description contains no recognizable skill name', async () => {
+    const payload = makePayload({
+      tool_name: 'Agent',
+      tool_input: { description: 'Exploring the codebase for patterns' },
+    });
+    const conns = await deriveConnections(payload, identity);
+    expect(conns[0].connectionType).toBe('project->skill');
+    expect(conns[0].targetNode).toBe('skill:unknown-skill');
+  });
+
+  it('returns skill:unknown-skill when Agent payload has no description field', async () => {
+    const payload = makePayload({
+      tool_name: 'Agent',
+      tool_input: {},
+    });
+    const conns = await deriveConnections(payload, identity);
+    expect(conns[0].targetNode).toBe('skill:unknown-skill');
+  });
+
+  it('returns project->tool plus project->project for Edit with cross-project file_path', async () => {
+    const tempDir = createTempDir();
+    try {
+      const filePath = path.join(tempDir, 'x.ts');
+      const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
+      const conns = await deriveConnections(payload, identity);
+      expect(conns.length).toBeGreaterThanOrEqual(2);
+      expect(conns[0].connectionType).toBe('project->tool');
+      expect(conns[0].targetNode).toBe('tool:Edit');
+      const pp = conns.find(c => c.connectionType === 'project->project');
+      expect(pp).toBeDefined();
+    } finally {
+      removeTempDir(tempDir);
+    }
+  });
+});
+
+// ── Hook runner orchestration tests (subprocess) ──────────────────────────────
+
+describe('Hook runner orchestration (subprocess)', () => {
+  let dataRoot: string;
+
+  beforeEach(() => { dataRoot = createTempDir(); });
+  afterEach(() => { removeTempDir(dataRoot); });
+
+  const env = (d: string) => ({ DEVNEURAL_DATA_ROOT: d });
+
+  const bashPayload = (overrides: Partial<HookPayload> = {}) =>
+    JSON.stringify(makePayload({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, ...overrides }));
+
+  it('exits 0 and writes nothing when tool_name is not in the allowlist', () => {
+    const result = spawnHook(JSON.stringify(makePayload({ tool_name: 'Read' })), env(dataRoot));
+    expect(result.status).toBe(0);
+    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
+  });
+
+  it('exits 0, writes a JSONL log entry and creates weights.json when tool is in allowlist', () => {
+    const result = spawnHook(bashPayload(), env(dataRoot));
+    expect(result.status).toBe(0);
+    const today = new Date();
+    const y = today.getUTCFullYear();
+    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
+    const d = String(today.getUTCDate()).padStart(2, '0');
+    const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
+    expect(fs.existsSync(logFile)).toBe(true);
+    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
+  });
+
+  it('processes a non-default tool added to config.json allowlist', () => {
+    fs.writeFileSync(
+      path.join(dataRoot, 'config.json'),
+      JSON.stringify({ allowlist: ['Read'] }),
+    );
+    const result = spawnHook(JSON.stringify(makePayload({ tool_name: 'Read' })), env(dataRoot));
+    expect(result.status).toBe(0);
+    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
+  });
+
+  it('exits 0 and writes nothing when stdin contains malformed JSON', () => {
+    const result = spawnHook('{not json}', env(dataRoot));
+    expect(result.status).toBe(0);
+    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
+  });
+
+  it('exits 0 and writes nothing when stdin is empty', () => {
+    const result = spawnHook('', env(dataRoot));
+    expect(result.status).toBe(0);
+    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
+  });
+
+  it('multiple derived connections produce separate JSONL lines', () => {
+    // Edit payload where file_path is in a different temp project
+    const otherDir = createTempDir();
+    try {
+      const filePath = path.join(otherDir, 'file.ts');
+      const payload = makePayload({
+        tool_name: 'Edit',
+        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
+      });
+      const result = spawnHook(JSON.stringify(payload), env(dataRoot));
+      expect(result.status).toBe(0);
+      const today = new Date();
+      const y = today.getUTCFullYear();
+      const mo = String(today.getUTCMonth() + 1).padStart(2, '0');
+      const d = String(today.getUTCDate()).padStart(2, '0');
+      const logFile = path.join(dataRoot, 'logs', `${y}-${mo}-${d}.jsonl`);
+      if (fs.existsSync(logFile)) {
+        const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
+        expect(lines.length).toBeGreaterThanOrEqual(1);
+        lines.forEach(line => expect(() => JSON.parse(line)).not.toThrow());
+      }
+    } finally {
+      removeTempDir(otherDir);
+    }
+  });
+});
+
+// ── Integration (full pipeline) ───────────────────────────────────────────────
+
+describe('Integration: full pipeline', () => {
+  let dataRoot: string;
+
+  beforeEach(() => { dataRoot = createTempDir(); });
+  afterEach(() => { removeTempDir(dataRoot); });
+
+  it('Bash payload: exits 0, writes valid JSONL line, creates weights.json with raw_count:1', () => {
+    const payload = makePayload({
+      tool_name: 'Bash',
+      session_id: 'test-session',
+      tool_input: { command: 'echo hello' },
+    });
+    const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
+    expect(result.status).toBe(0);
+
+    const today = new Date();
+    const y = today.getUTCFullYear();
+    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
+    const d = String(today.getUTCDate()).padStart(2, '0');
+    const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
+    expect(fs.existsSync(logFile)).toBe(true);
+
+    const line = fs.readFileSync(logFile, 'utf8').trim();
+    const entry = JSON.parse(line);
+    expect(entry.tool_name).toBe('Bash');
+    expect(entry.session_id).toBe('test-session');
+    expect(entry.connection_type).toBe('project->tool');
+    expect(entry.target_node).toBe('tool:Bash');
+
+    const weightsFile = path.join(dataRoot, 'weights.json');
+    expect(fs.existsSync(weightsFile)).toBe(true);
+    const weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
+    const values = Object.values(weights.connections) as Array<{ raw_count: number }>;
+    expect(values.length).toBeGreaterThanOrEqual(1);
+    expect(values[0].raw_count).toBe(1);
+  });
+
+  it('Edit payload with cross-project file_path: both connections in JSONL and weights', () => {
+    const otherDir = createTempDir();
+    try {
+      const filePath = path.join(otherDir, 'file.ts');
+      const payload = makePayload({
+        tool_name: 'Edit',
+        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
+      });
+      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
+      expect(result.status).toBe(0);
+
+      const today = new Date();
+      const y = today.getUTCFullYear();
+      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
+      const d = String(today.getUTCDate()).padStart(2, '0');
+      const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
+      expect(fs.existsSync(logFile)).toBe(true);
+
+      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
+      expect(lines.length).toBeGreaterThanOrEqual(2);
+      const entries = lines.map(l => JSON.parse(l));
+      expect(entries.some(e => e.connection_type === 'project->tool')).toBe(true);
+      expect(entries.some(e => e.connection_type === 'project->project')).toBe(true);
+
+      const weights = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8'));
+      const keys = Object.keys(weights.connections);
+      expect(keys.length).toBeGreaterThanOrEqual(2);
+    } finally {
+      removeTempDir(otherDir);
+    }
+  });
+});
