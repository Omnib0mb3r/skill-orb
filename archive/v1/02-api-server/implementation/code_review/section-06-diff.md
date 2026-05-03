diff --git a/02-api-server/src/watcher/index.ts b/02-api-server/src/watcher/index.ts
new file mode 100644
index 0000000..c6402e0
--- /dev/null
+++ b/02-api-server/src/watcher/index.ts
@@ -0,0 +1,142 @@
+import chokidar from 'chokidar';
+import fs from 'node:fs';
+import type { InMemoryGraph, LogEntry, WeightsFile } from '../graph/types.js';
+import { buildGraph } from '../graph/builder.js';
+
+export interface WatcherOptions {
+  /** awaitWriteFinish stabilityThreshold in ms. Default: 300. Set to 50 in tests. */
+  stabilityThreshold?: number;
+}
+
+// Module-level state
+let weightsWatcher: ReturnType<typeof chokidar.watch> | null = null;
+let logsWatcher: ReturnType<typeof chokidar.watch> | null = null;
+const fileOffsets = new Map<string, number>();
+let eventBuffer: LogEntry[] = [];
+
+/**
+ * Starts both file watchers.
+ */
+export function startWatchers(
+  weightsPath: string,
+  logsDir: string,
+  onGraphChange: (graph: InMemoryGraph) => void,
+  onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void,
+  opts?: WatcherOptions
+): void {
+  const stabilityThreshold = opts?.stabilityThreshold ?? 300;
+
+  const handleWeightsRead = async () => {
+    try {
+      const content = await fs.promises.readFile(weightsPath, 'utf-8');
+      const parsed = JSON.parse(content) as WeightsFile;
+      onGraphChange(buildGraph(parsed));
+    } catch (err) {
+      console.error('Failed to read/parse weights.json:', err);
+    }
+  };
+
+  weightsWatcher = chokidar.watch(weightsPath, {
+    awaitWriteFinish: {
+      stabilityThreshold,
+      pollInterval: 50,
+    },
+    ignoreInitial: true,
+  });
+
+  weightsWatcher
+    .on('add', handleWeightsRead)
+    .on('change', handleWeightsRead)
+    .on('unlink', () => {
+      const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '' };
+      onGraphChange(buildGraph(emptyWeights));
+    });
+
+  let isStartupScan = true;
+
+  logsWatcher = chokidar.watch(logsDir, {
+    depth: 0,
+    ignoreInitial: false,
+    awaitWriteFinish: {
+      stabilityThreshold,
+      pollInterval: 50,
+    },
+  });
+
+  logsWatcher
+    .on('add', (filePath: string) => {
+      if (!filePath.endsWith('.jsonl')) return;
+      readNewBytes(filePath, isStartupScan, onNewLogEntry);
+    })
+    .on('change', (filePath: string) => {
+      if (!filePath.endsWith('.jsonl')) return;
+      readNewBytes(filePath, false, onNewLogEntry);
+    })
+    .on('ready', () => {
+      isStartupScan = false;
+    });
+}
+
+async function readNewBytes(
+  filePath: string,
+  startup: boolean,
+  onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void
+): Promise<void> {
+  try {
+    const lastOffset = fileOffsets.get(filePath) ?? 0;
+    const stat = await fs.promises.stat(filePath);
+    if (stat.size <= lastOffset) return;
+
+    const length = stat.size - lastOffset;
+    const buf = Buffer.alloc(length);
+    const fh = await fs.promises.open(filePath, 'r');
+    try {
+      await fh.read(buf, 0, length, lastOffset);
+    } finally {
+      await fh.close();
+    }
+    fileOffsets.set(filePath, stat.size);
+
+    const lines = buf.toString('utf-8').split('\n').filter(l => l.trim().length > 0);
+    for (const line of lines) {
+      try {
+        const entry = JSON.parse(line) as LogEntry;
+        prependToBuffer(entry);
+        onNewLogEntry(entry, startup);
+      } catch (err) {
+        console.error('Failed to parse log line:', err);
+      }
+    }
+  } catch (err) {
+    console.error('Failed to read log file:', err);
+  }
+}
+
+function prependToBuffer(entry: LogEntry): void {
+  eventBuffer.unshift(entry);
+  if (eventBuffer.length > 1000) {
+    eventBuffer.pop();
+  }
+}
+
+/**
+ * Closes both chokidar watchers and resets all module-level state.
+ * Safe to call multiple times.
+ */
+export async function stopWatchers(): Promise<void> {
+  await Promise.all([
+    weightsWatcher?.close(),
+    logsWatcher?.close(),
+  ]);
+  weightsWatcher = null;
+  logsWatcher = null;
+  fileOffsets.clear();
+  eventBuffer = [];
+}
+
+/**
+ * Returns a shallow copy of the current event buffer (newest-first).
+ */
+export function getEventBuffer(): LogEntry[] {
+  return [...eventBuffer];
+}
diff --git a/02-api-server/tests/helpers/tempDir.ts b/02-api-server/tests/helpers/tempDir.ts
new file mode 100644
index 0000000..97fdbe0
--- /dev/null
+++ b/02-api-server/tests/helpers/tempDir.ts
@@ -0,0 +1,11 @@
+import { mkdtempSync, rmSync } from 'node:fs';
+import { join } from 'node:path';
+import { tmpdir } from 'node:os';
+
+export function createTempDir(): string {
+  return mkdtempSync(join(tmpdir(), 'devneural-test-'));
+}
+
+export function removeTempDir(dir: string): void {
+  rmSync(dir, { recursive: true, force: true });
+}
diff --git a/02-api-server/tests/watcher/watcher.test.ts b/02-api-server/tests/watcher/watcher.test.ts
new file mode 100644
index 0000000..ae14b2d
--- /dev/null
+++ b/02-api-server/tests/watcher/watcher.test.ts
@@ -0,0 +1,248 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import { writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
+import { join } from 'node:path';
+import { startWatchers, stopWatchers, getEventBuffer } from '../../src/watcher/index.js';
+import type { InMemoryGraph } from '../../src/graph/types.js';
+import type { WeightsFile } from '../../src/graph/types.js';
+import { createTempDir, removeTempDir } from '../helpers/tempDir.js';
+
+async function pollUntil(
+  fn: () => boolean,
+  intervalMs = 100,
+  timeoutMs = 5000
+): Promise<void> {
+  const deadline = Date.now() + timeoutMs;
+  while (Date.now() < deadline) {
+    if (fn()) return;
+    await new Promise(resolve => setTimeout(resolve, intervalMs));
+  }
+  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
+}
+
+const fixtureWeights: WeightsFile = {
+  connections: {
+    'project:github.com/user/repo||tool:Read': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'tool:Read',
+      connection_type: 'project->tool',
+      raw_count: 5,
+      weight: 0.8,
+      first_seen: '2024-01-01T00:00:00.000Z',
+      last_seen: '2024-01-02T00:00:00.000Z',
+    },
+    'project:github.com/user/repo||tool:Write': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'tool:Write',
+      connection_type: 'project->tool',
+      raw_count: 3,
+      weight: 0.5,
+      first_seen: '2024-01-01T00:00:00.000Z',
+      last_seen: '2024-01-02T00:00:00.000Z',
+    },
+  },
+  last_updated: '2024-01-02T00:00:00.000Z',
+  version: '1.0',
+};
+
+const fixtureJsonlLines = [
+  '{"tool_use_id":"abc1","timestamp":"2024-01-01T00:00:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Read"}',
+  '{"tool_use_id":"abc2","timestamp":"2024-01-01T00:01:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Write"}',
+  '{"tool_use_id":"abc3","timestamp":"2024-01-01T00:02:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Edit"}',
+];
+
+describe('watcher', () => {
+  let tempDir: string;
+  let weightsPath: string;
+  let logsDir: string;
+
+  beforeEach(() => {
+    tempDir = createTempDir();
+    weightsPath = join(tempDir, 'weights.json');
+    logsDir = join(tempDir, 'logs');
+    mkdirSync(logsDir);
+  });
+
+  afterEach(async () => {
+    await stopWatchers();
+    removeTempDir(tempDir);
+  });
+
+  // --- weights.json watcher tests ---
+
+  it('calls onGraphChange when weights.json is written', async () => {
+    let callCount = 0;
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 150));
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await pollUntil(() => callCount >= 1);
+    expect(callCount).toBeGreaterThanOrEqual(1);
+  }, 15000);
+
+  it('onGraphChange receives correctly-parsed InMemoryGraph on change', async () => {
+    let receivedGraph: InMemoryGraph | null = null;
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    startWatchers(weightsPath, logsDir, (g) => { receivedGraph = g; }, () => {}, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 150));
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await pollUntil(() => receivedGraph !== null);
+    expect(receivedGraph!.nodeIndex.size).toBe(3);
+    expect(receivedGraph!.edgeList.length).toBe(2);
+  }, 15000);
+
+  it('onGraphChange called with empty InMemoryGraph when weights.json is deleted', async () => {
+    const graphs: InMemoryGraph[] = [];
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    startWatchers(weightsPath, logsDir, (g) => { graphs.push(g); }, () => {}, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 150));
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await pollUntil(() => graphs.length >= 1);
+    unlinkSync(weightsPath);
+    await pollUntil(() => graphs.length >= 2);
+    const emptyGraph = graphs[graphs.length - 1];
+    expect(emptyGraph.nodeIndex.size).toBe(0);
+    expect(emptyGraph.edgeList.length).toBe(0);
+  }, 15000);
+
+  it('watcher handles weights.json not existing at startup', async () => {
+    let callCount = 0;
+    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 150));
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await pollUntil(() => callCount >= 1);
+    expect(callCount).toBeGreaterThanOrEqual(1);
+  }, 15000);
+
+  it('retains last valid graph when weights.json is overwritten with invalid JSON', async () => {
+    let callCount = 0;
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 150));
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await pollUntil(() => callCount >= 1);
+    const countAfterValid = callCount;
+    writeFileSync(weightsPath, 'invalid json{{{', 'utf-8');
+    await new Promise(resolve => setTimeout(resolve, 500));
+    expect(callCount).toBe(countAfterValid);
+  }, 15000);
+
+  // --- logs/ directory watcher tests ---
+
+  it('startup scan calls onNewLogEntry for each line in existing JSONL file', async () => {
+    let callCount = 0;
+    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
+    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
+    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
+    await pollUntil(() => callCount >= 3);
+    expect(callCount).toBe(3);
+  }, 15000);
+
+  it('offset tracking: appended lines only trigger additional callbacks', async () => {
+    let callCount = 0;
+    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
+    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
+    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
+    await pollUntil(() => callCount >= 3);
+    appendFileSync(jsonlPath, fixtureJsonlLines[0] + '\n', 'utf-8');
+    appendFileSync(jsonlPath, fixtureJsonlLines[1] + '\n', 'utf-8');
+    await pollUntil(() => callCount >= 5);
+    expect(callCount).toBe(5);
+  }, 15000);
+
+  it('new JSONL file added after startup triggers onNewLogEntry for each line', async () => {
+    let callCount = 0;
+    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
+    await new Promise(resolve => setTimeout(resolve, 100));
+    const jsonlPath = join(logsDir, 'new.jsonl');
+    writeFileSync(jsonlPath, fixtureJsonlLines.slice(0, 2).join('\n') + '\n', 'utf-8');
+    await pollUntil(() => callCount >= 2);
+    expect(callCount).toBe(2);
+  }, 15000);
+
+  it('invalid JSON lines are skipped without crashing', async () => {
+    let callCount = 0;
+    const jsonlPath = join(logsDir, 'mixed.jsonl');
+    const content = [
+      fixtureJsonlLines[0],
+      'invalid-json-line',
+      fixtureJsonlLines[1],
+    ].join('\n') + '\n';
+    writeFileSync(jsonlPath, content, 'utf-8');
+    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
+    await pollUntil(() => callCount >= 2);
+    expect(callCount).toBe(2);
+  }, 15000);
+
+  // --- Event buffer tests ---
+
+  it('buffer cap: 1001 entries keeps only 1000, oldest dropped', async () => {
+    const lines: string[] = [];
+    for (let i = 1; i <= 1001; i++) {
+      lines.push(JSON.stringify({
+        tool_use_id: String(i),
+        timestamp: '2024-01-01T00:00:00.000Z',
+        connection_type: 'project->tool',
+        source_node: 'project:a',
+        target_node: 'tool:Read',
+      }));
+    }
+    const jsonlPath = join(logsDir, 'big.jsonl');
+    writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
+    startWatchers(weightsPath, logsDir, () => {}, () => {}, { stabilityThreshold: 50 });
+    await pollUntil(() => getEventBuffer().length === 1000, 100, 10000);
+    const buf = getEventBuffer();
+    expect(buf.length).toBe(1000);
+    expect(buf.find(e => e.tool_use_id === '1')).toBeUndefined();
+  }, 15000);
+
+  it('entries stored newest-first', async () => {
+    let callCount = 0;
+    const lines = ['A', 'B', 'C'].map(id => JSON.stringify({
+      tool_use_id: id,
+      timestamp: '2024-01-01T00:00:00.000Z',
+      connection_type: 'project->tool',
+      source_node: 'project:a',
+      target_node: 'tool:Read',
+    }));
+    const jsonlPath = join(logsDir, 'ordered.jsonl');
+    writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
+    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
+    await pollUntil(() => callCount >= 3);
+    const buf = getEventBuffer();
+    expect(buf[0].tool_use_id).toBe('C');
+    expect(buf[1].tool_use_id).toBe('B');
+    expect(buf[2].tool_use_id).toBe('A');
+  }, 15000);
+
+  it('startup scan populates buffer without broadcasting', async () => {
+    let broadcastCallCount = 0;
+    let callCount = 0;
+    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
+    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
+    const broadcastSpy = () => { broadcastCallCount++; };
+    startWatchers(
+      weightsPath,
+      logsDir,
+      () => {},
+      (_, isStartup) => {
+        callCount++;
+        if (!isStartup) broadcastSpy();
+      },
+      { stabilityThreshold: 50 }
+    );
+    await pollUntil(() => callCount >= 3);
+    expect(broadcastCallCount).toBe(0);
+    expect(getEventBuffer().length).toBe(3);
+  }, 15000);
+
+  // --- stopWatchers test ---
+
+  it('stopWatchers prevents further callbacks after being called', async () => {
+    let callCount = 0;
+    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
+    await stopWatchers();
+    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
+    await new Promise(resolve => setTimeout(resolve, 500));
+    expect(callCount).toBe(0);
+  }, 15000);
+});
