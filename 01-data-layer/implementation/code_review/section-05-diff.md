diff --git a/01-data-layer/src/weights/index.ts b/01-data-layer/src/weights/index.ts
new file mode 100644
index 0000000..ac2fdb8
--- /dev/null
+++ b/01-data-layer/src/weights/index.ts
@@ -0,0 +1,79 @@
+import * as path from 'path';
+import * as fs from 'fs';
+import writeFileAtomic from 'write-file-atomic';
+import type { ConnectionType } from '../types';
+import type { WeightsFile, ConnectionRecord } from './types';
+
+/** Returns the connection graph key for a directed edge. Format: "sourceNode||targetNode". */
+export function connectionKey(sourceNode: string, targetNode: string): string {
+  return `${sourceNode}||${targetNode}`;
+}
+
+/** Reads weights.json from dataRoot. Returns an empty graph if the file is absent. Never throws. */
+export function loadWeights(dataRoot: string): WeightsFile {
+  const filePath = path.join(dataRoot, 'weights.json');
+
+  const empty = (): WeightsFile => ({
+    schema_version: 1,
+    updated_at: new Date().toISOString(),
+    connections: {},
+  });
+
+  let content: string;
+  try {
+    content = fs.readFileSync(filePath, 'utf8');
+  } catch {
+    return empty();
+  }
+
+  try {
+    return JSON.parse(content) as WeightsFile;
+  } catch (err: unknown) {
+    const message = err instanceof Error ? err.message : String(err);
+    console.error('[DevNeural] weights parse error:', message);
+    return empty();
+  }
+}
+
+/** Increments the edge counter for (sourceNode → targetNode) in place. Returns the same weights reference. */
+export function updateWeight(
+  weights: WeightsFile,
+  sourceNode: string,
+  targetNode: string,
+  connectionType: ConnectionType,
+  now: Date,
+): WeightsFile {
+  const key = connectionKey(sourceNode, targetNode);
+
+  if (!weights.connections[key]) {
+    weights.connections[key] = {
+      source_node: sourceNode,
+      target_node: targetNode,
+      connection_type: connectionType,
+      raw_count: 0,
+      weight: 0,
+      first_seen: now.toISOString(),
+      last_seen: now.toISOString(),
+    } as ConnectionRecord;
+  }
+
+  const record = weights.connections[key];
+  record.raw_count += 1;
+  record.weight = Math.round(Math.min(record.raw_count, 100) / 100 * 10 * 10000) / 10000;
+  record.last_seen = now.toISOString();
+
+  return weights;
+}
+
+/** Atomically writes weights.json to dataRoot. Sets updated_at. Never throws. */
+export async function saveWeights(weights: WeightsFile, dataRoot: string): Promise<void> {
+  weights.updated_at = new Date().toISOString();
+  const filePath = path.join(dataRoot, 'weights.json');
+
+  try {
+    await writeFileAtomic(filePath, JSON.stringify(weights, null, 2), { encoding: 'utf8' });
+  } catch (err: unknown) {
+    const message = err instanceof Error ? err.message : String(err);
+    console.error('[DevNeural] weights save error:', message);
+  }
+}
diff --git a/01-data-layer/src/weights/types.ts b/01-data-layer/src/weights/types.ts
new file mode 100644
index 0000000..bb0625d
--- /dev/null
+++ b/01-data-layer/src/weights/types.ts
@@ -0,0 +1 @@
+export type { WeightsFile, ConnectionRecord } from '../types';
diff --git a/01-data-layer/tests/weights.test.ts b/01-data-layer/tests/weights.test.ts
new file mode 100644
index 0000000..718d263
--- /dev/null
+++ b/01-data-layer/tests/weights.test.ts
@@ -0,0 +1,234 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import * as os from 'os';
+import * as path from 'path';
+import * as fs from 'fs';
+import { connectionKey, loadWeights, updateWeight, saveWeights } from '../src/weights/index';
+import type { WeightsFile } from '../src/weights/types';
+
+// ── Helpers ───────────────────────────────────────────────────────────────────
+
+const emptyWeights = (): WeightsFile => ({
+  schema_version: 1,
+  updated_at: new Date().toISOString(),
+  connections: {},
+});
+
+// ── connectionKey ─────────────────────────────────────────────────────────────
+
+describe('connectionKey', () => {
+  it('returns "a||b" for source "a" and target "b"', () => {
+    expect(connectionKey('a', 'b')).toBe('a||b');
+  });
+});
+
+// ── loadWeights ───────────────────────────────────────────────────────────────
+
+describe('loadWeights', () => {
+  let dataRoot: string;
+
+  beforeEach(() => {
+    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
+  });
+
+  afterEach(() => {
+    if (dataRoot && fs.existsSync(dataRoot)) {
+      fs.rmSync(dataRoot, { recursive: true });
+    }
+  });
+
+  it('returns a valid empty WeightsFile when weights.json does not exist', () => {
+    const result = loadWeights(dataRoot);
+    expect(result.schema_version).toBe(1);
+    expect(result.connections).toEqual({});
+    expect(result.updated_at).toBeTruthy();
+    expect(new Date(result.updated_at).toISOString()).toBe(result.updated_at);
+  });
+
+  it('returns the parsed WeightsFile when the file is valid JSON', () => {
+    const weights: WeightsFile = {
+      schema_version: 1,
+      updated_at: '2026-01-01T00:00:00.000Z',
+      connections: {
+        'project:foo||tool:Bash': {
+          source_node: 'project:foo',
+          target_node: 'tool:Bash',
+          connection_type: 'project->tool',
+          raw_count: 5,
+          weight: 0.5,
+          first_seen: '2026-01-01T00:00:00.000Z',
+          last_seen: '2026-01-01T01:00:00.000Z',
+        },
+      },
+    };
+    fs.writeFileSync(path.join(dataRoot, 'weights.json'), JSON.stringify(weights));
+    const result = loadWeights(dataRoot);
+    expect(result.schema_version).toBe(1);
+    expect(result.connections['project:foo||tool:Bash'].raw_count).toBe(5);
+  });
+
+  it('returns an empty graph and logs to stderr when the file contains invalid JSON', () => {
+    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
+    fs.writeFileSync(path.join(dataRoot, 'weights.json'), '{not valid json}');
+
+    const result = loadWeights(dataRoot);
+    expect(result.schema_version).toBe(1);
+    expect(result.connections).toEqual({});
+    expect(stderrSpy).toHaveBeenCalledWith(
+      expect.stringContaining('[DevNeural]'),
+      expect.anything(),
+    );
+
+    stderrSpy.mockRestore();
+  });
+});
+
+// ── updateWeight ──────────────────────────────────────────────────────────────
+
+describe('updateWeight', () => {
+  it('creates a new ConnectionRecord with raw_count=1, weight=0.1, and first_seen set', () => {
+    const weights = emptyWeights();
+    const now = new Date('2026-03-28T12:00:00.000Z');
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', now);
+
+    const record = weights.connections['project:foo||tool:Bash'];
+    expect(record).toBeDefined();
+    expect(record.raw_count).toBe(1);
+    expect(record.weight).toBe(0.1);
+    expect(record.first_seen).toBe('2026-03-28T12:00:00.000Z');
+  });
+
+  it('increments raw_count and recalculates weight correctly for an existing connection (raw_count=2 → weight=0.2)', () => {
+    const weights = emptyWeights();
+    const t1 = new Date('2026-03-28T12:00:00.000Z');
+    const t2 = new Date('2026-03-28T12:01:00.000Z');
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t1);
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t2);
+
+    const record = weights.connections['project:foo||tool:Bash'];
+    expect(record.raw_count).toBe(2);
+    expect(record.weight).toBe(0.2);
+  });
+
+  it('caps weight at 10.0 when raw_count >= 100 (raw_count=200 → weight=10.0)', () => {
+    const weights = emptyWeights();
+    const now = new Date('2026-03-28T12:00:00.000Z');
+    weights.connections['project:foo||tool:Bash'] = {
+      source_node: 'project:foo',
+      target_node: 'tool:Bash',
+      connection_type: 'project->tool',
+      raw_count: 199,
+      weight: 10,
+      first_seen: now.toISOString(),
+      last_seen: now.toISOString(),
+    };
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', now);
+
+    const record = weights.connections['project:foo||tool:Bash'];
+    expect(record.raw_count).toBe(200);
+    expect(record.weight).toBe(10.0);
+  });
+
+  it('updates last_seen but does not change first_seen on a subsequent call', () => {
+    const weights = emptyWeights();
+    const t1 = new Date('2026-03-28T12:00:00.000Z');
+    const t2 = new Date('2026-03-28T13:00:00.000Z');
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t1);
+    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t2);
+
+    const record = weights.connections['project:foo||tool:Bash'];
+    expect(record.first_seen).toBe('2026-03-28T12:00:00.000Z');
+    expect(record.last_seen).toBe('2026-03-28T13:00:00.000Z');
+  });
+
+  it('mutates in place — the returned reference is the same object passed in', () => {
+    const weights = emptyWeights();
+    const result = updateWeight(weights, 'a', 'b', 'project->tool', new Date());
+    expect(result).toBe(weights);
+  });
+});
+
+// ── saveWeights ───────────────────────────────────────────────────────────────
+
+describe('saveWeights', () => {
+  let dataRoot: string;
+
+  beforeEach(() => {
+    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
+  });
+
+  afterEach(() => {
+    if (dataRoot && fs.existsSync(dataRoot)) {
+      fs.rmSync(dataRoot, { recursive: true });
+    }
+  });
+
+  it('writes valid JSON to weights.json in dataRoot', async () => {
+    const weights = emptyWeights();
+    await saveWeights(weights, dataRoot);
+
+    const filePath = path.join(dataRoot, 'weights.json');
+    expect(fs.existsSync(filePath)).toBe(true);
+    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
+    expect(parsed.schema_version).toBe(1);
+    expect(parsed.connections).toBeDefined();
+  });
+
+  it('sets updated_at on the written file to a current UTC timestamp', async () => {
+    const weights = emptyWeights();
+    const before = new Date();
+    await saveWeights(weights, dataRoot);
+    const after = new Date();
+
+    const parsed = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8'));
+    const savedAt = new Date(parsed.updated_at);
+    expect(savedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
+    expect(savedAt.getTime()).toBeLessThanOrEqual(after.getTime());
+  });
+
+  it('atomic write — concurrent saves produce valid non-corrupt JSON', async () => {
+    const w1 = emptyWeights();
+    const w2 = emptyWeights();
+    await Promise.all([saveWeights(w1, dataRoot), saveWeights(w2, dataRoot)]);
+
+    const content = fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8');
+    expect(() => JSON.parse(content)).not.toThrow();
+  });
+});
+
+// ── Concurrency ───────────────────────────────────────────────────────────────
+
+describe('Concurrency', () => {
+  let dataRoot: string;
+
+  beforeEach(() => {
+    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
+  });
+
+  afterEach(() => {
+    if (dataRoot && fs.existsSync(dataRoot)) {
+      fs.rmSync(dataRoot, { recursive: true });
+    }
+  });
+
+  it('two simulated concurrent read-modify-write cycles produce a valid, non-corrupt weights.json', async () => {
+    const cycle = async (source: string) => {
+      const w = loadWeights(dataRoot);
+      updateWeight(w, source, 'tool:Bash', 'project->tool', new Date());
+      await saveWeights(w, dataRoot);
+    };
+
+    await Promise.all([cycle('project:foo'), cycle('project:bar')]);
+
+    const content = fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8');
+    expect(() => JSON.parse(content)).not.toThrow();
+    const parsed = JSON.parse(content);
+    expect(parsed.schema_version).toBe(1);
+  });
+
+  it('lock fallback — saveWeights resolves without throwing when called without a lock wrapper', async () => {
+    // proper-lockfile coordination lives in section-06 hook-runner.
+    // saveWeights is lock-agnostic and must never throw regardless.
+    const weights = emptyWeights();
+    await expect(saveWeights(weights, dataRoot)).resolves.toBeUndefined();
+  });
+});
