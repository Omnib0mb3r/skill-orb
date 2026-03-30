diff --git a/05-voice-interface/package.json b/05-voice-interface/package.json
new file mode 100644
index 0000000..682eeb3
--- /dev/null
+++ b/05-voice-interface/package.json
@@ -0,0 +1,22 @@
+{
+  "name": "devneural-voice-interface",
+  "version": "0.1.0",
+  "private": true,
+  "scripts": {
+    "build": "tsc",
+    "test": "vitest run",
+    "test:watch": "vitest"
+  },
+  "dependencies": {
+    "natural": "^6.12.0",
+    "zod": "^3.22.0"
+  },
+  "devDependencies": {
+    "@anthropic-ai/sdk": "^0.24.0",
+    "@types/natural": "^6.0.1",
+    "@types/node": "^20.0.0",
+    "tsx": "^4.7.0",
+    "typescript": "^5.4.0",
+    "vitest": "^1.6.0"
+  }
+}
diff --git a/05-voice-interface/src/identity/index.ts b/05-voice-interface/src/identity/index.ts
new file mode 100644
index 0000000..9ef931a
--- /dev/null
+++ b/05-voice-interface/src/identity/index.ts
@@ -0,0 +1,2 @@
+export type { ProjectIdentity, ProjectSource } from '../../../01-data-layer/dist/types';
+export { resolveProjectIdentity } from '../../../01-data-layer/dist/identity/index';
diff --git a/05-voice-interface/src/intent/types.ts b/05-voice-interface/src/intent/types.ts
new file mode 100644
index 0000000..8d9cd80
--- /dev/null
+++ b/05-voice-interface/src/intent/types.ts
@@ -0,0 +1,36 @@
+export type IntentName =
+  | 'get_context'
+  | 'get_top_skills'
+  | 'get_connections'
+  | 'get_node'
+  | 'get_stages'
+  | 'unknown';
+
+export interface IntentResult {
+  intent: IntentName;
+  /** Normalized confidence in the range 0.0–1.0. */
+  confidence: number;
+  entities: {
+    /** Project or skill name mentioned in the query, as typed by the user. */
+    nodeName?: string;
+    /** Stage filter string: 'alpha' | 'beta' | 'deployed' | 'archived'. */
+    stageFilter?: string;
+    /** Requested result count for top-N queries. */
+    limit?: number;
+  };
+  /** Which parser resolved the intent. */
+  source: 'local' | 'haiku';
+}
+
+export interface VoiceResponse {
+  /** Formatted natural-language text for the Claude chat output. */
+  text: string;
+  /**
+   * Optional WebSocket event to send to the orb.
+   * Undefined if no visual action is needed (e.g., clarification responses).
+   */
+  orbEvent?: {
+    type: 'voice:focus' | 'voice:highlight' | 'voice:clear';
+    payload: unknown;
+  };
+}
diff --git a/05-voice-interface/tests/identity/identity.test.ts b/05-voice-interface/tests/identity/identity.test.ts
new file mode 100644
index 0000000..f66abff
--- /dev/null
+++ b/05-voice-interface/tests/identity/identity.test.ts
@@ -0,0 +1,14 @@
+import { describe, it, expect } from 'vitest';
+import { resolveProjectIdentity } from '../../src/identity/index';
+
+describe('identity re-export', () => {
+  it('resolveProjectIdentity is a function', () => {
+    expect(typeof resolveProjectIdentity).toBe('function');
+  });
+
+  it('resolves a project identity for the current directory', async () => {
+    const identity = await resolveProjectIdentity(process.cwd());
+    expect(typeof identity.id).toBe('string');
+    expect(['git-remote', 'git-root', 'cwd']).toContain(identity.source);
+  });
+});
diff --git a/05-voice-interface/tests/intent/types.test.ts b/05-voice-interface/tests/intent/types.test.ts
new file mode 100644
index 0000000..9549131
--- /dev/null
+++ b/05-voice-interface/tests/intent/types.test.ts
@@ -0,0 +1,41 @@
+import { describe, it, expect } from 'vitest';
+import type { IntentResult, VoiceResponse } from '../../src/intent/types';
+
+describe('IntentResult type', () => {
+  it('accepts a valid IntentResult with all required fields', () => {
+    const result: IntentResult = {
+      intent: 'get_top_skills',
+      confidence: 0.95,
+      entities: {},
+      source: 'local',
+    };
+    expect(result.intent).toBe('get_top_skills');
+    expect(typeof result.confidence).toBe('number');
+  });
+
+  it('allows entities with optional fields omitted', () => {
+    const result: IntentResult = {
+      intent: 'unknown',
+      confidence: 0,
+      entities: {},
+      source: 'haiku',
+    };
+    expect(result.entities.nodeName).toBeUndefined();
+  });
+
+  it('accepts VoiceResponse with orbEvent undefined', () => {
+    const response: VoiceResponse = { text: 'Hello' };
+    expect(response.orbEvent).toBeUndefined();
+  });
+
+  it('accepts VoiceResponse with a voice:highlight orbEvent', () => {
+    const response: VoiceResponse = {
+      text: 'You use these skills most.',
+      orbEvent: {
+        type: 'voice:highlight',
+        payload: { nodeIds: ['skill:typescript', 'skill:node'] },
+      },
+    };
+    expect(response.orbEvent?.type).toBe('voice:highlight');
+  });
+});
diff --git a/05-voice-interface/tsconfig.json b/05-voice-interface/tsconfig.json
new file mode 100644
index 0000000..78c9cfa
--- /dev/null
+++ b/05-voice-interface/tsconfig.json
@@ -0,0 +1,17 @@
+{
+  "compilerOptions": {
+    "target": "ES2022",
+    "lib": ["ES2022"],
+    "module": "CommonJS",
+    "moduleResolution": "node",
+    "outDir": "./dist",
+    "strict": true,
+    "esModuleInterop": true,
+    "skipLibCheck": true,
+    "declaration": true,
+    "declarationMap": true,
+    "sourceMap": true
+  },
+  "include": ["src/**/*"],
+  "exclude": ["node_modules", "dist", "tests"]
+}
diff --git a/05-voice-interface/vitest.config.ts b/05-voice-interface/vitest.config.ts
new file mode 100644
index 0000000..4b6c7e3
--- /dev/null
+++ b/05-voice-interface/vitest.config.ts
@@ -0,0 +1,9 @@
+import { defineConfig } from 'vitest/config';
+
+export default defineConfig({
+  test: {
+    globals: false,
+    environment: 'node',
+    testTimeout: 15000,
+  },
+});
