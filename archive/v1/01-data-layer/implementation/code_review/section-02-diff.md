diff --git a/01-data-layer/src/config/index.ts b/01-data-layer/src/config/index.ts
new file mode 100644
index 0000000..3111c93
--- /dev/null
+++ b/01-data-layer/src/config/index.ts
@@ -0,0 +1,44 @@
+import * as fs from 'fs';
+import * as path from 'path';
+import type { Config } from '../types';
+
+const DEFAULT_DATA_ROOT = 'C:/dev/data/skill-connections';
+const DEFAULT_ALLOWLIST = ['Bash', 'Write', 'Edit', 'Agent'];
+
+export function loadConfig(dataRoot: string): Config {
+  const envDataRoot = process.env['DEVNEURAL_DATA_ROOT'];
+  const effectiveDataRoot = (envDataRoot && envDataRoot.length > 0)
+    ? envDataRoot
+    : DEFAULT_DATA_ROOT;
+
+  const defaults: Config = {
+    allowlist: DEFAULT_ALLOWLIST,
+    data_root: effectiveDataRoot,
+  };
+
+  try {
+    const raw = fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8');
+    let parsed: Record<string, unknown>;
+    try {
+      parsed = JSON.parse(raw) as Record<string, unknown>;
+    } catch (err) {
+      console.error('[DevNeural] config parse error:', (err as Error).message);
+      return defaults;
+    }
+
+    return {
+      allowlist: Array.isArray(parsed['allowlist'])
+        ? (parsed['allowlist'] as string[])
+        : DEFAULT_ALLOWLIST,
+      data_root: (envDataRoot && envDataRoot.length > 0)
+        ? envDataRoot
+        : (typeof parsed['data_root'] === 'string' ? parsed['data_root'] : DEFAULT_DATA_ROOT),
+    };
+  } catch (err: unknown) {
+    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
+      return defaults;
+    }
+    // Unexpected error — return defaults silently
+    return defaults;
+  }
+}
diff --git a/01-data-layer/tests/config.test.ts b/01-data-layer/tests/config.test.ts
new file mode 100644
index 0000000..7fb5e64
--- /dev/null
+++ b/01-data-layer/tests/config.test.ts
@@ -0,0 +1,63 @@
+import * as fs from 'fs';
+import * as path from 'path';
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { createTempDir, removeTempDir } from './helpers/tempDir';
+import { loadConfig } from '../src/config/index';
+
+let dataRoot: string;
+
+beforeEach(() => {
+  dataRoot = createTempDir();
+  delete process.env['DEVNEURAL_DATA_ROOT'];
+});
+
+afterEach(() => {
+  removeTempDir(dataRoot);
+  delete process.env['DEVNEURAL_DATA_ROOT'];
+});
+
+describe('loadConfig', () => {
+  it('returns defaults when config.json does not exist', () => {
+    const config = loadConfig(dataRoot);
+    expect(config.allowlist).toEqual(['Bash', 'Write', 'Edit', 'Agent']);
+    expect(config.data_root).toBe('C:/dev/data/skill-connections');
+  });
+
+  it('reads and merges custom allowlist from config.json', () => {
+    fs.writeFileSync(
+      path.join(dataRoot, 'config.json'),
+      JSON.stringify({ allowlist: ['Bash', 'Edit'] })
+    );
+    const config = loadConfig(dataRoot);
+    expect(config.allowlist).toEqual(['Bash', 'Edit']);
+    expect(config.data_root).toBe('C:/dev/data/skill-connections');
+  });
+
+  it('returns defaults and logs to stderr when config.json contains invalid JSON', () => {
+    fs.writeFileSync(path.join(dataRoot, 'config.json'), 'this is not json');
+    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
+    const config = loadConfig(dataRoot);
+    expect(config.allowlist).toEqual(['Bash', 'Write', 'Edit', 'Agent']);
+    expect(config.data_root).toBe('C:/dev/data/skill-connections');
+    expect(spy).toHaveBeenCalledWith(
+      expect.stringContaining('[DevNeural] config parse error:'),
+      expect.anything()
+    );
+    spy.mockRestore();
+  });
+
+  it('reads data_root field from config.json when present', () => {
+    fs.writeFileSync(
+      path.join(dataRoot, 'config.json'),
+      JSON.stringify({ data_root: '/custom/path' })
+    );
+    const config = loadConfig(dataRoot);
+    expect(config.data_root).toBe('/custom/path');
+  });
+
+  it('DEVNEURAL_DATA_ROOT env var overrides the compiled-in default', () => {
+    process.env['DEVNEURAL_DATA_ROOT'] = '/env/override';
+    const config = loadConfig(dataRoot);
+    expect(config.data_root).toBe('/env/override');
+  });
+});
