diff --git a/.claude/commands/voice.md b/.claude/commands/voice.md
new file mode 100644
index 0000000..4e529a4
--- /dev/null
+++ b/.claude/commands/voice.md
@@ -0,0 +1,9 @@
+---
+description: Query the DevNeural graph with a natural language voice command
+---
+
+Run a voice query against the DevNeural graph:
+
+```bash
+node C:/dev/tools/DevNeural/05-voice-interface/dist/index.js "$ARGUMENTS"
+```
diff --git a/05-voice-interface/src/index.ts b/05-voice-interface/src/index.ts
new file mode 100644
index 0000000..2f410e4
--- /dev/null
+++ b/05-voice-interface/src/index.ts
@@ -0,0 +1,43 @@
+import { resolveProjectIdentity } from './identity/index';
+import { parseIntent } from './intent/parser';
+import { executeIntentRequest } from './routing/intent-map';
+import { buildApiConfig } from './routing/api-client';
+import { formatResponse } from './formatter/response';
+import { sendOrbEvents } from './formatter/orb-events';
+
+const CLARIFICATION_MSG =
+  "I'm not sure what you mean — try asking about connections, skills, or your current project.\n";
+
+async function main(): Promise<void> {
+  const query = (process.argv[2] ?? '').trim();
+
+  if (!query) {
+    process.stdout.write(CLARIFICATION_MSG);
+    return;
+  }
+
+  const identity = await resolveProjectIdentity(process.cwd());
+  const projectId = identity?.id ?? '';
+  const parsed = await parseIntent(query);
+
+  if (parsed.clarification) {
+    process.stdout.write(CLARIFICATION_MSG);
+    return;
+  }
+
+  const config = buildApiConfig();
+  const apiResult = await executeIntentRequest(parsed, projectId, config);
+  const text = formatResponse(parsed, apiResult?.data ?? null, parsed.hedging);
+
+  let output = text;
+  if (parsed.unreachable) {
+    output = `I couldn't reach the AI assistant, but here's what I could parse locally: ${text}`;
+  }
+
+  sendOrbEvents(parsed, apiResult?.data ?? null).catch(() => { /* best-effort */ });
+  process.stdout.write(output + '\n');
+}
+
+main().catch(() => {
+  process.stdout.write('An unexpected error occurred.\n');
+});
diff --git a/05-voice-interface/tests/entry-point.test.ts b/05-voice-interface/tests/entry-point.test.ts
new file mode 100644
index 0000000..2789f6c
--- /dev/null
+++ b/05-voice-interface/tests/entry-point.test.ts
@@ -0,0 +1,54 @@
+import { describe, it, expect } from 'vitest';
+import { spawnSync } from 'child_process';
+import path from 'path';
+
+const ENTRY = path.resolve(__dirname, '../dist/index.js');
+const NO_MARKDOWN = /[*#`•\[\]]/;
+
+function run(args: string[], env?: Record<string, string>) {
+  return spawnSync('node', [ENTRY, ...args], {
+    encoding: 'utf8',
+    timeout: 15000,
+    env: { ...process.env, ...env },
+  });
+}
+
+describe('entry-point subprocess', () => {
+  it('exits 0 on a skills query', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.status).toBe(0);
+    expect(result.stdout.trim()).toBeTruthy();
+  });
+
+  it('stdout contains no markdown characters', () => {
+    const result = run(['what skills am I using most?']);
+    expect(result.stdout).not.toMatch(NO_MARKDOWN);
+  });
+
+  it('exits 0 with clarification message for empty string argument', () => {
+    const result = run(['']);
+    expect(result.status).toBe(0);
+    expect(result.stdout).toMatch(/not sure what you mean/i);
+  });
+
+  it('exits 0 with clarification message when no argument given', () => {
+    const result = run([]);
+    expect(result.status).toBe(0);
+    expect(result.stdout).toMatch(/not sure what you mean/i);
+  });
+
+  it("exits 0 and includes \"isn't running\" when API is unavailable", () => {
+    const result = run(['what skills am I using most?'], {
+      DEVNEURAL_API_URL: 'http://localhost:19998',
+    });
+    expect(result.status).toBe(0);
+    expect(result.stdout).toContain("isn't running");
+  });
+
+  it('server path in unavailable message ends with 02-api-server/dist/server.js', () => {
+    const result = run(['what skills am I using most?'], {
+      DEVNEURAL_API_URL: 'http://localhost:19998',
+    });
+    expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
+  });
+});
