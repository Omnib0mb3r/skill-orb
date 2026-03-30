diff --git a/06-notebooklm-integration/src/config.ts b/06-notebooklm-integration/src/config.ts
new file mode 100644
index 0000000..d6bc585
--- /dev/null
+++ b/06-notebooklm-integration/src/config.ts
@@ -0,0 +1,57 @@
+import { z } from 'zod';
+import { readFileSync } from 'node:fs';
+import { resolve, dirname } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import type { ObsidianSyncConfig } from './types.js';
+
+const __dirname = dirname(fileURLToPath(import.meta.url));
+
+const ConfigSchema = z.object({
+  vault_path: z.string().min(1),
+  data_root: z.string().min(1),
+  notes_subfolder: z.string().default('DevNeural/Projects'),
+  api_base_url: z.string().default('http://localhost:3747'),
+  prepend_sessions: z.boolean().default(true),
+  claude_model: z.string().default('claude-haiku-4-5-20251001'),
+});
+
+export function loadConfig(configPath?: string): ObsidianSyncConfig {
+  const resolved =
+    configPath ??
+    process.env.DEVNEURAL_OBSIDIAN_CONFIG ??
+    resolve(__dirname, 'config.json');
+
+  let raw: string;
+  try {
+    raw = readFileSync(resolved, 'utf-8');
+  } catch {
+    throw new Error(
+      `Config file not found: ${resolved}. Copy config.example.json and fill in vault_path and data_root.`,
+    );
+  }
+
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(raw);
+  } catch {
+    throw new Error(`Config file is not valid JSON: ${resolved}`);
+  }
+
+  const result = ConfigSchema.safeParse(parsed);
+  if (!result.success) {
+    const first = result.error.errors[0];
+    const fieldPath = first.path.join('.') || '(root)';
+    throw new Error(`Config validation error at '${fieldPath}': ${first.message}`);
+  }
+
+  return result.data as ObsidianSyncConfig;
+}
+
+export function checkApiKey(): void {
+  if (!process.env.ANTHROPIC_API_KEY) {
+    process.stderr.write(
+      'Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.\n',
+    );
+    process.exit(1);
+  }
+}
diff --git a/06-notebooklm-integration/src/types.ts b/06-notebooklm-integration/src/types.ts
new file mode 100644
index 0000000..3dd919c
--- /dev/null
+++ b/06-notebooklm-integration/src/types.ts
@@ -0,0 +1,54 @@
+export interface ObsidianSyncConfig {
+  vault_path: string;
+  notes_subfolder: string;
+  data_root: string;
+  api_base_url: string;
+  prepend_sessions: boolean;
+  claude_model: string;
+}
+
+export interface LogEntry {
+  timestamp: string;
+  project: string;
+  source_node: string;
+  target_node: string;
+  connection_type: string;
+  stage?: string;
+  tags?: string[];
+  tool_name?: string;
+  tool_input?: Record<string, unknown>;
+}
+
+export interface ConnectionEvent {
+  source_node: string;
+  target_node: string;
+  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
+  timestamp: string;
+}
+
+export interface SessionData {
+  date: string;
+  primary_project: string;
+  all_projects: string[];
+  entries: LogEntry[];
+  session_start: string;
+  session_end: string;
+  connection_events: ConnectionEvent[];
+}
+
+export interface GraphInsight {
+  type: 'new_connection' | 'high_weight' | 'weight_milestone';
+  source_node: string;
+  target_node: string;
+  weight: number;
+  raw_count: number;
+  description: string;
+}
+
+export interface SessionSummary {
+  date: string;
+  project: string;
+  what_i_worked_on: string;
+  graph_insights: string[];
+  lessons_learned: string;
+}
diff --git a/06-notebooklm-integration/tests/config.test.ts b/06-notebooklm-integration/tests/config.test.ts
new file mode 100644
index 0000000..d97f53b
--- /dev/null
+++ b/06-notebooklm-integration/tests/config.test.ts
@@ -0,0 +1,121 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { writeFileSync, unlinkSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+import { loadConfig, checkApiKey } from '../src/config.js';
+
+const validConfig = {
+  vault_path: '/home/user/vault',
+  data_root: '/home/user/devneural/data',
+};
+
+function writeTempConfig(content: unknown): string {
+  const p = join(tmpdir(), `devneural-test-${Date.now()}-${Math.random()}.json`);
+  writeFileSync(p, JSON.stringify(content), 'utf-8');
+  return p;
+}
+
+describe('loadConfig', () => {
+  it('returns valid config when all required fields present', () => {
+    const p = writeTempConfig(validConfig);
+    try {
+      const cfg = loadConfig(p);
+      expect(cfg.vault_path).toBe('/home/user/vault');
+      expect(cfg.data_root).toBe('/home/user/devneural/data');
+    } finally {
+      unlinkSync(p);
+    }
+  });
+
+  it('throws with descriptive message when vault_path is missing', () => {
+    const p = writeTempConfig({ data_root: '/home/user/data' });
+    try {
+      expect(() => loadConfig(p)).toThrow(/vault_path/);
+    } finally {
+      unlinkSync(p);
+    }
+  });
+
+  it('throws with descriptive message when data_root is missing', () => {
+    const p = writeTempConfig({ vault_path: '/home/user/vault' });
+    try {
+      expect(() => loadConfig(p)).toThrow(/data_root/);
+    } finally {
+      unlinkSync(p);
+    }
+  });
+
+  it('applies defaults for optional fields', () => {
+    const p = writeTempConfig(validConfig);
+    try {
+      const cfg = loadConfig(p);
+      expect(cfg.notes_subfolder).toBe('DevNeural/Projects');
+      expect(cfg.api_base_url).toBe('http://localhost:3747');
+      expect(cfg.prepend_sessions).toBe(true);
+      expect(cfg.claude_model).toBe('claude-haiku-4-5-20251001');
+    } finally {
+      unlinkSync(p);
+    }
+  });
+
+  it('throws when config file does not exist', () => {
+    expect(() => loadConfig('/tmp/devneural-nonexistent-config-99999.json')).toThrow(/Config file not found/);
+  });
+
+  it('reads path from DEVNEURAL_OBSIDIAN_CONFIG env var when no arg provided', () => {
+    const p = writeTempConfig(validConfig);
+    const prev = process.env.DEVNEURAL_OBSIDIAN_CONFIG;
+    process.env.DEVNEURAL_OBSIDIAN_CONFIG = p;
+    try {
+      const cfg = loadConfig();
+      expect(cfg.vault_path).toBe('/home/user/vault');
+    } finally {
+      if (prev === undefined) {
+        delete process.env.DEVNEURAL_OBSIDIAN_CONFIG;
+      } else {
+        process.env.DEVNEURAL_OBSIDIAN_CONFIG = prev;
+      }
+      unlinkSync(p);
+    }
+  });
+
+  it('throws when config JSON is malformed', () => {
+    const p = join(tmpdir(), `devneural-bad-${Date.now()}.json`);
+    writeFileSync(p, '{ not valid json }', 'utf-8');
+    try {
+      expect(() => loadConfig(p)).toThrow(/not valid JSON/);
+    } finally {
+      unlinkSync(p);
+    }
+  });
+});
+
+describe('checkApiKey', () => {
+  let prevKey: string | undefined;
+  let exitSpy: ReturnType<typeof vi.spyOn> | null = null;
+  let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;
+
+  beforeEach(() => {
+    prevKey = process.env.ANTHROPIC_API_KEY;
+  });
+
+  afterEach(() => {
+    if (prevKey === undefined) {
+      delete process.env.ANTHROPIC_API_KEY;
+    } else {
+      process.env.ANTHROPIC_API_KEY = prevKey;
+    }
+    exitSpy?.mockRestore();
+    stderrSpy?.mockRestore();
+  });
+
+  it('config check throws with clear message when ANTHROPIC_API_KEY env var is missing', () => {
+    delete process.env.ANTHROPIC_API_KEY;
+    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
+      throw new Error('process.exit called');
+    }) as never);
+    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
+    expect(() => checkApiKey()).toThrow(/process\.exit called/);
+    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
+  });
+});
