diff --git a/04-session-intelligence/src/install-hook.ts b/04-session-intelligence/src/install-hook.ts
new file mode 100644
index 0000000..de76e08
--- /dev/null
+++ b/04-session-intelligence/src/install-hook.ts
@@ -0,0 +1,103 @@
+import * as fs from 'node:fs';
+import * as os from 'node:os';
+import * as path from 'node:path';
+
+// ─── Public helpers (exported for unit testing) ───────────────────────────────
+
+export function getSettingsPath(): string {
+  return path.join(os.homedir(), '.claude', 'settings.json');
+}
+
+export function readSettings(settingsPath: string): Record<string, unknown> {
+  try {
+    const raw = fs.readFileSync(settingsPath, 'utf8');
+    return JSON.parse(raw) as Record<string, unknown>;
+  } catch {
+    return {};
+  }
+}
+
+export function buildHookEntry(
+  command: string,
+  matcher: string,
+  includeStatusMessage: boolean,
+): object {
+  const hookObj: Record<string, unknown> = {
+    type: 'command',
+    command,
+    timeout: 10,
+  };
+  if (includeStatusMessage) {
+    hookObj.statusMessage = 'Loading DevNeural context...';
+  }
+  return { matcher, hooks: [hookObj] };
+}
+
+export function mergeHooks(
+  existing: Record<string, unknown>,
+  hookCommand: string,
+): Record<string, unknown> {
+  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
+  const existingSessionStart = (existingHooks.SessionStart as unknown[]) ?? [];
+
+  // Scan all nested command strings across ALL entries (with or without matcher)
+  const existingCommands = existingSessionStart
+    .flatMap((entry: unknown) => ((entry as Record<string, unknown>).hooks as unknown[]) ?? [])
+    .map((h: unknown) => ((h as Record<string, unknown>).command as string) ?? '');
+
+  if (existingCommands.some((cmd) => cmd.includes('session-start.js'))) {
+    return existing; // already installed — return same reference for identity check
+  }
+
+  const matchers = ['startup', 'resume', 'clear', 'compact'];
+  const newEntries = matchers.map((m) => buildHookEntry(hookCommand, m, m === 'startup'));
+
+  return {
+    ...existing,
+    hooks: {
+      ...existingHooks,
+      SessionStart: [...existingSessionStart, ...newEntries],
+    },
+  };
+}
+
+export function writeSettings(
+  settingsPath: string,
+  settings: Record<string, unknown>,
+): void {
+  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
+}
+
+// ─── Entry point ──────────────────────────────────────────────────────────────
+
+async function main(): Promise<void> {
+  const scriptPath = path.resolve(__dirname, '..', 'dist', 'session-start.js')
+    .split(path.sep).join('/');
+  const hookCommand = `node "${scriptPath}"`;
+
+  const settingsPath = getSettingsPath();
+  const existing = readSettings(settingsPath);
+  const merged = mergeHooks(existing, hookCommand);
+
+  if (merged === existing) {
+    process.stdout.write('DevNeural hook already registered in settings.json — no changes made.\n');
+    return;
+  }
+
+  writeSettings(settingsPath, merged);
+
+  process.stdout.write(
+    `DevNeural SessionStart hook installed.\n` +
+    `Script: ${scriptPath}\n` +
+    `Registered in: ${settingsPath}\n\n` +
+    `Matchers: startup, resume, clear, compact\n\n` +
+    `Note: Run 'npm run build' first to compile the hook script.\n` +
+    `      The hook is bound to the path above — moving the DevNeural repo will break it.\n` +
+    `Open a new Claude Code session to verify the hook fires.\n`,
+  );
+}
+
+main().catch((err: Error) => {
+  process.stderr.write(`install-hook error: ${err.message}\n`);
+  process.exit(1);
+});
diff --git a/04-session-intelligence/tests/install-hook.test.ts b/04-session-intelligence/tests/install-hook.test.ts
new file mode 100644
index 0000000..441a045
--- /dev/null
+++ b/04-session-intelligence/tests/install-hook.test.ts
@@ -0,0 +1,101 @@
+import { describe, it, expect } from 'vitest';
+import { mergeHooks, buildHookEntry } from '../src/install-hook';
+
+const FAKE_COMMAND = 'node "/some/test/path/session-start.js"';
+
+describe('mergeHooks', () => {
+  it('installs 4 entries when SessionStart is empty', () => {
+    const result = mergeHooks({}, FAKE_COMMAND);
+    const sessionStart = (result.hooks as Record<string, unknown[]>).SessionStart;
+    expect(sessionStart).toHaveLength(4);
+    const matchers = sessionStart.map((e: any) => e.matcher);
+    expect(matchers).toContain('startup');
+    expect(matchers).toContain('resume');
+    expect(matchers).toContain('clear');
+    expect(matchers).toContain('compact');
+  });
+
+  it('is idempotent: running twice produces no duplicates', () => {
+    const result1 = mergeHooks({}, FAKE_COMMAND);
+    const result2 = mergeHooks(result1, FAKE_COMMAND);
+    const sessionStart = (result2.hooks as Record<string, unknown[]>).SessionStart;
+    expect(sessionStart).toHaveLength(4);
+  });
+
+  it('deduplicates when an existing entry has no matcher field', () => {
+    const settingsWithMatcherlessEntry = {
+      hooks: {
+        SessionStart: [
+          {
+            hooks: [
+              {
+                type: 'command',
+                command: 'node "/old/install/path/session-start.js"',
+              },
+            ],
+          },
+        ],
+      },
+    };
+    const result = mergeHooks(settingsWithMatcherlessEntry, FAKE_COMMAND);
+    const sessionStart = (result.hooks as Record<string, unknown[]>).SessionStart;
+    // Already present by command-string scan — no new entries added
+    expect(sessionStart).toHaveLength(1);
+  });
+
+  it('preserves all other settings fields', () => {
+    const settings = {
+      env: { FOO: 'bar' },
+      permissions: { allow: ['Bash'] },
+      hooks: {
+        PostToolUse: [{ hooks: [{ type: 'command', command: 'echo test' }] }],
+      },
+    };
+    const result = mergeHooks(settings, FAKE_COMMAND);
+    expect((result as any).env).toEqual({ FOO: 'bar' });
+    expect((result as any).permissions).toEqual({ allow: ['Bash'] });
+    expect((result.hooks as any).PostToolUse).toHaveLength(1);
+  });
+
+  it('produces valid output: all 4 entries have type "command" and command containing session-start.js', () => {
+    const result = mergeHooks({}, FAKE_COMMAND);
+    const sessionStart = (result.hooks as Record<string, any[]>).SessionStart;
+    for (const entry of sessionStart) {
+      expect(Array.isArray(entry.hooks)).toBe(true);
+      expect(entry.hooks[0].type).toBe('command');
+      expect(entry.hooks[0].command).toContain('session-start.js');
+    }
+  });
+
+  it('only the startup entry has a statusMessage', () => {
+    const result = mergeHooks({}, FAKE_COMMAND);
+    const sessionStart = (result.hooks as Record<string, any[]>).SessionStart;
+
+    const startupEntry = sessionStart.find((e: any) => e.matcher === 'startup');
+    expect(startupEntry).toBeDefined();
+    expect(startupEntry.hooks[0].statusMessage).toBeDefined();
+
+    const nonStartupEntries = sessionStart.filter((e: any) => e.matcher !== 'startup');
+    for (const entry of nonStartupEntries) {
+      expect(entry.hooks[0].statusMessage).toBeUndefined();
+    }
+  });
+});
+
+describe('buildHookEntry', () => {
+  it('returns correct structure for startup (with statusMessage)', () => {
+    const entry = buildHookEntry(FAKE_COMMAND, 'startup', true) as any;
+    expect(entry.matcher).toBe('startup');
+    expect(entry.hooks[0].type).toBe('command');
+    expect(entry.hooks[0].command).toBe(FAKE_COMMAND);
+    expect(entry.hooks[0].timeout).toBe(10);
+    expect(entry.hooks[0].statusMessage).toBeDefined();
+  });
+
+  it('returns correct structure for non-startup (no statusMessage)', () => {
+    const entry = buildHookEntry(FAKE_COMMAND, 'resume', false) as any;
+    expect(entry.matcher).toBe('resume');
+    expect(entry.hooks[0].statusMessage).toBeUndefined();
+    expect(entry.hooks[0].timeout).toBe(10);
+  });
+});
