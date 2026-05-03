diff --git a/01-data-layer/src/logger/index.ts b/01-data-layer/src/logger/index.ts
new file mode 100644
index 0000000..a923dcf
--- /dev/null
+++ b/01-data-layer/src/logger/index.ts
@@ -0,0 +1,55 @@
+import * as path from 'path';
+import * as fs from 'fs';
+
+import type { LogEntry, HookPayload, ProjectIdentity, ConnectionType } from '../types';
+
+export type { LogEntry };
+
+/** Returns the path to the daily JSONL log file for `dataRoot` and `date`.
+ *  Uses UTC date components to avoid timezone-dependent filenames. */
+export function getLogFilePath(dataRoot: string, date?: Date): string {
+  const d = date ?? new Date();
+  const year = d.getUTCFullYear();
+  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
+  const day = String(d.getUTCDate()).padStart(2, '0');
+  return path.join(dataRoot, 'logs', `${year}-${month}-${day}.jsonl`);
+}
+
+/** Constructs a LogEntry from a hook payload, resolved project identity, and connection metadata.
+ *  Pure function — no I/O, no side effects. */
+export function buildLogEntry(
+  payload: HookPayload,
+  identity: ProjectIdentity,
+  connectionType: ConnectionType,
+  sourceNode: string,
+  targetNode: string
+): LogEntry {
+  return {
+    schema_version: 1,
+    timestamp: new Date().toISOString(),
+    session_id: payload.session_id,
+    tool_use_id: payload.tool_use_id,
+    project: identity.id,
+    project_source: identity.source,
+    tool_name: payload.tool_name,
+    tool_input: payload.tool_input,
+    connection_type: connectionType,
+    source_node: sourceNode,
+    target_node: targetNode,
+  };
+}
+
+/** Appends a log entry as a JSON line to the daily log file.
+ *  Creates the logs/ directory if it doesn't exist. Never throws. */
+export async function appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void> {
+  try {
+    const filePath = getLogFilePath(dataRoot);
+    const logsDir = path.dirname(filePath);
+    await fs.promises.mkdir(logsDir, { recursive: true });
+    const line = JSON.stringify(entry) + '\n';
+    await fs.promises.appendFile(filePath, line, 'utf8');
+  } catch (err: unknown) {
+    const message = err instanceof Error ? err.message : String(err);
+    console.error('[DevNeural] logger error:', message);
+  }
+}
diff --git a/01-data-layer/src/logger/types.ts b/01-data-layer/src/logger/types.ts
new file mode 100644
index 0000000..2186b4d
--- /dev/null
+++ b/01-data-layer/src/logger/types.ts
@@ -0,0 +1 @@
+export type { LogEntry } from '../types';
diff --git a/01-data-layer/tests/logger.test.ts b/01-data-layer/tests/logger.test.ts
new file mode 100644
index 0000000..c2e3548
--- /dev/null
+++ b/01-data-layer/tests/logger.test.ts
@@ -0,0 +1,192 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import * as os from 'os';
+import * as path from 'path';
+import * as fs from 'fs';
+import { getLogFilePath, buildLogEntry, appendLogEntry } from '../src/logger/index';
+import type { HookPayload, ProjectIdentity } from '../src/types';
+
+// ── Fixtures ──────────────────────────────────────────────────────────────────
+
+const makePayload = (overrides: Partial<HookPayload> = {}): HookPayload => ({
+  hook_event_name: 'PostToolUse',
+  session_id: 'sess-001',
+  cwd: '/some/cwd',
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
+  id: 'github.com/user/repo',
+  source: 'git-remote',
+  ...overrides,
+});
+
+// ── getLogFilePath ────────────────────────────────────────────────────────────
+
+describe('getLogFilePath', () => {
+  it('produces correct filename for a given UTC date', () => {
+    const dataRoot = '/tmp/data';
+    const date = new Date('2026-03-28T15:30:00Z');
+    const result = getLogFilePath(dataRoot, date);
+    expect(result).toBe(path.join(dataRoot, 'logs', '2026-03-28.jsonl'));
+  });
+});
+
+// ── buildLogEntry ─────────────────────────────────────────────────────────────
+
+describe('buildLogEntry', () => {
+  it('sets schema_version: 1', () => {
+    const entry = buildLogEntry(makePayload(), makeIdentity(), 'project→tool', 'project:x', 'tool:Bash');
+    expect(entry.schema_version).toBe(1);
+  });
+
+  it('project→tool sets correct connection type and nodes', () => {
+    const entry = buildLogEntry(
+      makePayload(),
+      makeIdentity(),
+      'project→tool',
+      'project:github.com/user/repo',
+      'tool:Bash'
+    );
+    expect(entry.connection_type).toBe('project→tool');
+    expect(entry.source_node).toBe('project:github.com/user/repo');
+    expect(entry.target_node).toBe('tool:Bash');
+  });
+
+  it('project→skill sets correct connection type and nodes', () => {
+    const entry = buildLogEntry(
+      makePayload(),
+      makeIdentity(),
+      'project→skill',
+      'project:github.com/user/repo',
+      'skill:gsd:execute-phase'
+    );
+    expect(entry.connection_type).toBe('project→skill');
+    expect(entry.target_node).toBe('skill:gsd:execute-phase');
+  });
+
+  it('project→project sets correct connection type', () => {
+    const entry = buildLogEntry(
+      makePayload(),
+      makeIdentity(),
+      'project→project',
+      'project:github.com/user/a',
+      'project:github.com/user/b'
+    );
+    expect(entry.connection_type).toBe('project→project');
+  });
+
+  it('copies session_id, tool_use_id, tool_name, and tool_input from payload', () => {
+    const payload = makePayload({
+      session_id: 'sess-xyz',
+      tool_use_id: 'tu-xyz',
+      tool_name: 'Write',
+      tool_input: { file_path: '/tmp/foo.txt', content: 'hello' },
+    });
+    const entry = buildLogEntry(payload, makeIdentity(), 'project→tool', 'project:x', 'tool:Write');
+    expect(entry.session_id).toBe('sess-xyz');
+    expect(entry.tool_use_id).toBe('tu-xyz');
+    expect(entry.tool_name).toBe('Write');
+    expect(entry.tool_input).toEqual({ file_path: '/tmp/foo.txt', content: 'hello' });
+  });
+
+  it('sets timestamp as ISO 8601 UTC string ending with Z', () => {
+    const entry = buildLogEntry(makePayload(), makeIdentity(), 'project→tool', 'project:x', 'tool:Bash');
+    expect(entry.timestamp.endsWith('Z')).toBe(true);
+    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
+  });
+});
+
+// ── appendLogEntry ────────────────────────────────────────────────────────────
+
+describe('appendLogEntry', () => {
+  let dataRoot: string;
+
+  beforeEach(() => {
+    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
+  });
+
+  afterEach(() => {
+    if (dataRoot && fs.existsSync(dataRoot)) {
+      fs.rmSync(dataRoot, { recursive: true });
+    }
+  });
+
+  const makeEntry = () =>
+    buildLogEntry(makePayload(), makeIdentity(), 'project→tool', 'project:github.com/user/repo', 'tool:Bash');
+
+  it('creates logs/ directory if it does not exist', async () => {
+    const entry = makeEntry();
+    await appendLogEntry(entry, dataRoot);
+    expect(fs.existsSync(path.join(dataRoot, 'logs'))).toBe(true);
+  });
+
+  it('writes a valid JSON line terminated with \\n', async () => {
+    const entry = makeEntry();
+    await appendLogEntry(entry, dataRoot);
+
+    const logFile = getLogFilePath(dataRoot, new Date());
+    const content = fs.readFileSync(logFile, 'utf8');
+    expect(content.endsWith('\n')).toBe(true);
+
+    const line = content.trim();
+    const parsed = JSON.parse(line);
+    expect(parsed.schema_version).toBe(1);
+  });
+
+  it('appends to existing file without overwriting', async () => {
+    const entry1 = buildLogEntry(makePayload({ tool_name: 'Bash' }), makeIdentity(), 'project→tool', 'project:x', 'tool:Bash');
+    const entry2 = buildLogEntry(makePayload({ tool_name: 'Write' }), makeIdentity(), 'project→tool', 'project:x', 'tool:Write');
+
+    await appendLogEntry(entry1, dataRoot);
+    await appendLogEntry(entry2, dataRoot);
+
+    const logFile = getLogFilePath(dataRoot, new Date());
+    const content = fs.readFileSync(logFile, 'utf8');
+    const lines = content.split('\n').filter(l => l.length > 0);
+    expect(lines).toHaveLength(2);
+
+    const parsed1 = JSON.parse(lines[0]);
+    const parsed2 = JSON.parse(lines[1]);
+    expect(parsed1.tool_name).toBe('Bash');
+    expect(parsed2.tool_name).toBe('Write');
+  });
+
+  it('written JSON deserializes to a valid LogEntry shape', async () => {
+    const entry = makeEntry();
+    await appendLogEntry(entry, dataRoot);
+
+    const logFile = getLogFilePath(dataRoot, new Date());
+    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
+
+    const requiredFields = [
+      'schema_version', 'timestamp', 'session_id', 'tool_use_id',
+      'project', 'project_source', 'tool_name', 'tool_input',
+      'connection_type', 'source_node', 'target_node',
+    ];
+    for (const field of requiredFields) {
+      expect(parsed).toHaveProperty(field);
+    }
+  });
+
+  it('does not throw and logs to stderr when write fails', async () => {
+    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
+    // Use a file as dataRoot so mkdir(dataRoot/logs) fails
+    const fileAsRoot = path.join(dataRoot, 'not-a-dir.txt');
+    fs.writeFileSync(fileAsRoot, 'blocker');
+
+    const entry = makeEntry();
+    await expect(appendLogEntry(entry, fileAsRoot)).resolves.toBeUndefined();
+    expect(stderrSpy).toHaveBeenCalledWith(
+      expect.stringContaining('[DevNeural]'),
+      expect.anything()
+    );
+
+    stderrSpy.mockRestore();
+  });
+});
