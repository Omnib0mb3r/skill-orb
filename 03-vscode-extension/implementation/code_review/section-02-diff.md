diff --git a/01-data-layer/src/hook-runner.ts b/01-data-layer/src/hook-runner.ts
index 7d0a57e..696450a 100644
--- a/01-data-layer/src/hook-runner.ts
+++ b/01-data-layer/src/hook-runner.ts
@@ -135,6 +135,47 @@ export async function deriveConnections(
   }
 }
 
+/**
+ * Walks up from startDir looking for a devneural.json file.
+ * Returns { stage?, tags? } if found, undefined if not found or if JSON is malformed.
+ * Never throws.
+ */
+export async function readDevneuralJson(
+  startDir: string,
+): Promise<{ stage?: string; tags?: string[] } | undefined> {
+  let current = startDir;
+  while (true) {
+    const candidate = path.join(current, 'devneural.json');
+    try {
+      const content = await fs.promises.readFile(candidate, 'utf-8');
+      let parsed: unknown;
+      try {
+        parsed = JSON.parse(content);
+      } catch (err) {
+        console.warn('[DevNeural] devneural.json parse error:', err instanceof Error ? err.message : String(err));
+        return undefined;
+      }
+      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
+        const obj = parsed as Record<string, unknown>;
+        const stage = typeof obj['stage'] === 'string' ? obj['stage'] : undefined;
+        const tags = Array.isArray(obj['tags'])
+          ? (obj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
+          : undefined;
+        return { ...(stage !== undefined ? { stage } : {}), ...(tags !== undefined ? { tags } : {}) };
+      }
+      return undefined;
+    } catch {
+      // File not found at this level — walk up
+    }
+    const parent = path.dirname(current);
+    if (parent === current) {
+      // Reached filesystem root
+      return undefined;
+    }
+    current = parent;
+  }
+}
+
 async function readStdin(): Promise<string> {
   if (process.stdin.isTTY) {
     return '';
@@ -169,9 +210,10 @@ async function main(): Promise<void> {
 
   const identity = await resolveProjectIdentity(payload.cwd);
   const connections = await deriveConnections(payload, identity);
+  const meta = await readDevneuralJson(payload.cwd);
 
   const entries = connections.map(conn =>
-    buildLogEntry(payload, identity, conn.connectionType, conn.sourceNode, conn.targetNode),
+    buildLogEntry(payload, identity, conn.connectionType, conn.sourceNode, conn.targetNode, meta?.stage, meta?.tags),
   );
 
   const weightsPath = path.join(dataRoot, 'weights.json');
diff --git a/01-data-layer/src/logger/index.ts b/01-data-layer/src/logger/index.ts
index 2f552ed..7f6f215 100644
--- a/01-data-layer/src/logger/index.ts
+++ b/01-data-layer/src/logger/index.ts
@@ -20,7 +20,9 @@ export function buildLogEntry(
   identity: ProjectIdentity,
   connectionType: ConnectionType,
   sourceNode: string,
-  targetNode: string
+  targetNode: string,
+  stage?: string,
+  tags?: string[],
 ): LogEntry {
   return {
     schema_version: 1,
@@ -34,6 +36,8 @@ export function buildLogEntry(
     connection_type: connectionType,
     source_node: sourceNode,
     target_node: targetNode,
+    ...(stage !== undefined ? { stage } : {}),
+    ...(tags !== undefined ? { tags } : {}),
   };
 }
 
diff --git a/01-data-layer/src/types.ts b/01-data-layer/src/types.ts
index b3f90a4..88d2664 100644
--- a/01-data-layer/src/types.ts
+++ b/01-data-layer/src/types.ts
@@ -72,6 +72,8 @@ export interface LogEntry {
   connection_type: ConnectionType;
   source_node: string;                    // prefixed: "project:<id>"
   target_node: string;                    // prefixed: "tool:<name>", "skill:<name>", "project:<id>"
+  stage?: string;                         // from devneural.json — log enrichment only
+  tags?: string[];                        // from devneural.json — log enrichment only
 }
 
 // ── Weight graph ──────────────────────────────────────────────────────────────
diff --git a/01-data-layer/tests/hook-runner.test.ts b/01-data-layer/tests/hook-runner.test.ts
index b757990..74717d4 100644
--- a/01-data-layer/tests/hook-runner.test.ts
+++ b/01-data-layer/tests/hook-runner.test.ts
@@ -1,11 +1,11 @@
-import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
 import * as os from 'os';
 import * as path from 'path';
 import * as fs from 'fs';
 import { spawnSync } from 'child_process';
-import { extractSkillName, extractProjectRefs, deriveConnections } from '../src/hook-runner';
+import { extractSkillName, extractProjectRefs, deriveConnections, readDevneuralJson } from '../src/hook-runner';
 import { resolveProjectIdentity } from '../src/identity';
-import type { HookPayload, ProjectIdentity } from '../src/types';
+import type { HookPayload, ProjectIdentity, LogEntry } from '../src/types';
 import { createTempDir, removeTempDir } from './helpers/tempDir';
 
 // ── Fixtures ──────────────────────────────────────────────────────────────────
@@ -344,3 +344,229 @@ describe('Integration: full pipeline', () => {
     }
   });
 });
+
+// ── readDevneuralJson ─────────────────────────────────────────────────────────
+
+describe('readDevneuralJson', () => {
+  let tempDir: string;
+
+  const validConfig = {
+    name: 'TestProject',
+    localPath: 'c:/dev/test',
+    githubUrl: 'https://github.com/user/test',
+    stage: 'beta',
+    tags: ['sandbox'],
+    description: 'Test project',
+  };
+
+  beforeEach(() => { tempDir = createTempDir(); });
+  afterEach(() => { removeTempDir(tempDir); });
+
+  it('reads stage and tags from devneural.json in the current directory', async () => {
+    fs.writeFileSync(path.join(tempDir, 'devneural.json'), JSON.stringify(validConfig), 'utf8');
+    const result = await readDevneuralJson(tempDir);
+    expect(result).toBeDefined();
+    expect(result!.stage).toBe('beta');
+    expect(result!.tags).toEqual(['sandbox']);
+  });
+
+  it('walks up 3 directory levels to find devneural.json', async () => {
+    const deepDir = path.join(tempDir, 'a', 'b', 'c');
+    fs.mkdirSync(deepDir, { recursive: true });
+    fs.writeFileSync(path.join(tempDir, 'devneural.json'), JSON.stringify(validConfig), 'utf8');
+    const result = await readDevneuralJson(deepDir);
+    expect(result).toBeDefined();
+    expect(result!.stage).toBe('beta');
+  });
+
+  it('returns undefined when no devneural.json exists anywhere in the path', async () => {
+    // Use a deeply nested temp path with no devneural.json
+    const deepDir = path.join(tempDir, 'x', 'y', 'z');
+    fs.mkdirSync(deepDir, { recursive: true });
+    const result = await readDevneuralJson(deepDir);
+    expect(result).toBeUndefined();
+  });
+
+  it('returns undefined and emits a warning when devneural.json contains malformed JSON', async () => {
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    fs.writeFileSync(path.join(tempDir, 'devneural.json'), '{ not json', 'utf8');
+    const result = await readDevneuralJson(tempDir);
+    expect(result).toBeUndefined();
+    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[DevNeural]'), expect.anything());
+    warnSpy.mockRestore();
+  });
+
+  it('returns result without stage key when devneural.json is missing the stage field', async () => {
+    const withoutStage = { ...validConfig };
+    delete (withoutStage as Record<string, unknown>)['stage'];
+    fs.writeFileSync(path.join(tempDir, 'devneural.json'), JSON.stringify(withoutStage), 'utf8');
+    const result = await readDevneuralJson(tempDir);
+    expect(result).toBeDefined();
+    expect(result!.stage).toBeUndefined();
+  });
+
+  it('does not throw when called with a non-existent start directory', async () => {
+    await expect(readDevneuralJson('/nonexistent/path/that/does/not/exist')).resolves.toBeUndefined();
+  });
+});
+
+// ── LogEntry type — stage and tags fields ─────────────────────────────────────
+
+describe('LogEntry type — stage and tags', () => {
+  it('LogEntry accepts optional stage and tags fields', () => {
+    const entry: LogEntry = {
+      schema_version: 1,
+      timestamp: new Date().toISOString(),
+      session_id: 'sess',
+      tool_use_id: 'tu',
+      project: 'proj',
+      project_source: 'git-remote',
+      tool_name: 'Bash',
+      tool_input: {},
+      connection_type: 'project->tool',
+      source_node: 'project:proj',
+      target_node: 'tool:Bash',
+      stage: 'beta',
+      tags: ['sandbox'],
+    };
+    expect(entry.stage).toBe('beta');
+    expect(entry.tags).toEqual(['sandbox']);
+  });
+
+  it('LogEntry allows stage and tags to be absent', () => {
+    const entry: LogEntry = {
+      schema_version: 1,
+      timestamp: new Date().toISOString(),
+      session_id: 'sess',
+      tool_use_id: 'tu',
+      project: 'proj',
+      project_source: 'git-remote',
+      tool_name: 'Bash',
+      tool_input: {},
+      connection_type: 'project->tool',
+      source_node: 'project:proj',
+      target_node: 'tool:Bash',
+    };
+    expect(entry.stage).toBeUndefined();
+    expect(entry.tags).toBeUndefined();
+  });
+});
+
+// ── stage/tags not in weights.json ───────────────────────────────────────────
+
+describe('weights.json does not contain stage/tags', () => {
+  let dataRoot: string;
+
+  beforeEach(() => { dataRoot = createTempDir(); });
+  afterEach(() => { removeTempDir(dataRoot); });
+
+  it('ConnectionRecord has no stage or tags fields after hook run', () => {
+    // Create a devneural.json in a temp cwd
+    const cwd = createTempDir();
+    try {
+      fs.writeFileSync(path.join(cwd, 'devneural.json'), JSON.stringify({
+        name: 'Proj',
+        localPath: cwd,
+        githubUrl: 'https://github.com/user/proj',
+        stage: 'beta',
+        tags: ['sandbox'],
+        description: 'Test',
+      }), 'utf8');
+
+      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd });
+      spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
+
+      const weightsFile = path.join(dataRoot, 'weights.json');
+      if (fs.existsSync(weightsFile)) {
+        const weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
+        for (const record of Object.values(weights.connections) as Record<string, unknown>[]) {
+          expect(record).not.toHaveProperty('stage');
+          expect(record).not.toHaveProperty('tags');
+        }
+      }
+    } finally {
+      removeTempDir(cwd);
+    }
+  });
+});
+
+// ── devneural.json enrichment in subprocess ───────────────────────────────────
+
+describe('Hook runner orchestration: devneural.json enrichment (subprocess)', () => {
+  let dataRoot: string;
+
+  beforeEach(() => { dataRoot = createTempDir(); });
+  afterEach(() => { removeTempDir(dataRoot); });
+
+  it('JSONL log entry contains stage and tags when devneural.json is in cwd', () => {
+    const cwd = createTempDir();
+    try {
+      fs.writeFileSync(path.join(cwd, 'devneural.json'), JSON.stringify({
+        name: 'TestProject',
+        localPath: cwd,
+        githubUrl: 'https://github.com/user/testproj',
+        stage: 'deployed',
+        tags: ['revision-needed'],
+        description: 'Test project',
+      }), 'utf8');
+
+      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
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
+      const entries = lines.map(l => JSON.parse(l));
+      const bashEntry = entries.find(e => e.connection_type === 'project->tool');
+      expect(bashEntry?.stage).toBe('deployed');
+      expect(bashEntry?.tags).toEqual(['revision-needed']);
+    } finally {
+      removeTempDir(cwd);
+    }
+  });
+
+  it('JSONL log entry omits stage and tags when no devneural.json in path', () => {
+    const cwd = createTempDir();
+    try {
+      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
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
+      const entries = lines.map(l => JSON.parse(l));
+      for (const entry of entries) {
+        expect(entry).not.toHaveProperty('stage');
+        expect(entry).not.toHaveProperty('tags');
+      }
+    } finally {
+      removeTempDir(cwd);
+    }
+  });
+
+  it('hook runner exits 0 and proceeds normally when devneural.json is malformed', () => {
+    const cwd = createTempDir();
+    try {
+      fs.writeFileSync(path.join(cwd, 'devneural.json'), '{ bad json !!', 'utf8');
+      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
+      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
+      expect(result.status).toBe(0);
+      // Still creates weights.json (tool processing continues)
+      expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
+    } finally {
+      removeTempDir(cwd);
+    }
+  });
+});
diff --git a/01-data-layer/tests/logger.test.ts b/01-data-layer/tests/logger.test.ts
index b1b1b21..40df26a 100644
--- a/01-data-layer/tests/logger.test.ts
+++ b/01-data-layer/tests/logger.test.ts
@@ -113,6 +113,43 @@ describe('buildLogEntry', () => {
     expect(entry.timestamp.endsWith('Z')).toBe(true);
     expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
   });
+
+  it('includes stage and tags in the entry when provided', () => {
+    const entry = buildLogEntry(
+      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
+      'deployed', ['sandbox'],
+    );
+    expect(entry.stage).toBe('deployed');
+    expect(entry.tags).toEqual(['sandbox']);
+  });
+
+  it('omits stage key entirely when stage is undefined', () => {
+    const entry = buildLogEntry(
+      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
+      undefined, undefined,
+    );
+    expect(entry).not.toHaveProperty('stage');
+    expect(entry).not.toHaveProperty('tags');
+  });
+
+  it('includes stage but omits tags when only stage is provided', () => {
+    const entry = buildLogEntry(
+      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
+      'alpha', undefined,
+    );
+    expect(entry.stage).toBe('alpha');
+    expect(entry).not.toHaveProperty('tags');
+  });
+
+  it('serialized JSON entry includes stage and tags only when defined', async () => {
+    const entry = buildLogEntry(
+      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
+      'beta', ['revision-needed'],
+    );
+    const parsed = JSON.parse(JSON.stringify(entry));
+    expect(parsed.stage).toBe('beta');
+    expect(parsed.tags).toEqual(['revision-needed']);
+  });
 });
 
 // ── appendLogEntry ────────────────────────────────────────────────────────────
