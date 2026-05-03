# Section 02: Identity Module — Code Diff

## Section Plan Summary
Creates `src/identity.ts` — a two-line re-export wrapper over `01-data-layer/dist/`. Provides `resolveProjectIdentity`, `ProjectIdentity`, and `ProjectSource` to the rest of `04-session-intelligence` from a local import path.

## Files Changed

```diff
diff --git a/04-session-intelligence/src/identity.ts b/04-session-intelligence/src/identity.ts
new file mode 100644
--- /dev/null
+++ b/04-session-intelligence/src/identity.ts
@@ -0,0 +1,2 @@
+export type { ProjectIdentity, ProjectSource } from '../../01-data-layer/dist/types';
+export { resolveProjectIdentity } from '../../01-data-layer/dist/identity/index';
diff --git a/04-session-intelligence/tests/identity.test.ts b/04-session-intelligence/tests/identity.test.ts
new file mode 100644
--- /dev/null
+++ b/04-session-intelligence/tests/identity.test.ts
@@ -0,0 +1,29 @@
+import { describe, it, expect } from 'vitest';
+import { resolveProjectIdentity } from '../src/identity';
+import type { ProjectIdentity } from '../src/identity';
+import * as os from 'os';
+import * as fs from 'fs';
+import * as path from 'path';
+
+describe('identity module re-export', () => {
+  it('resolveProjectIdentity is importable from src/identity', async () => {
+    expect(typeof resolveProjectIdentity).toBe('function');
+  });
+
+  it('returns id and source for a known git repo path', async () => {
+    const result: ProjectIdentity = await resolveProjectIdentity('C:/dev/tools/DevNeural');
+    expect(result.id).toBeTruthy();
+    expect(['git-remote', 'git-root', 'cwd']).toContain(result.source);
+  });
+
+  it('falls back to normalized directory name when no .git is present', async () => {
+    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-id-test-'));
+    try {
+      const result: ProjectIdentity = await resolveProjectIdentity(tmpDir);
+      expect(result.source).toBe('cwd');
+      expect(result.id).toBeTruthy();
+    } finally {
+      fs.rmdirSync(tmpDir);
+    }
+  });
+});
```

## Test Results
- 3/3 tests pass
- `tsc --noEmit` exits 0
