# Section 01: Setup — Code Diff

## Section Plan Summary
Creates `package.json`, `tsconfig.json`, and `vitest.config.ts` for the `04-session-intelligence` TypeScript package. Key requirement: no `rootDir` in tsconfig to allow cross-package imports from `../01-data-layer/dist/`.

## Files Changed

```diff
diff --git a/04-session-intelligence/package.json b/04-session-intelligence/package.json
new file mode 100644
index 0000000..2317ae5
--- /dev/null
+++ b/04-session-intelligence/package.json
@@ -0,0 +1,18 @@
+{
+  "name": "devneural-session-intelligence",
+  "version": "1.0.0",
+  "private": true,
+  "scripts": {
+    "build": "tsc",
+    "dev": "tsx src/session-start.ts",
+    "install-hook": "tsx src/install-hook.ts",
+    "test": "vitest run",
+    "test:watch": "vitest"
+  },
+  "devDependencies": {
+    "@types/node": "^20.0.0",
+    "tsx": "^4.7.0",
+    "typescript": "^5.4.0",
+    "vitest": "^1.6.0"
+  }
+}
diff --git a/04-session-intelligence/src/index.ts b/04-session-intelligence/src/index.ts
new file mode 100644
--- /dev/null
+++ b/04-session-intelligence/src/index.ts
@@ -0,0 +1 @@
+export {};
diff --git a/04-session-intelligence/tsconfig.json b/04-session-intelligence/tsconfig.json
new file mode 100644
--- /dev/null
+++ b/04-session-intelligence/tsconfig.json
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
diff --git a/04-session-intelligence/vitest.config.ts b/04-session-intelligence/vitest.config.ts
new file mode 100644
--- /dev/null
+++ b/04-session-intelligence/vitest.config.ts
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
```

## Build Validation
- `tsc --noEmit` exits 0
- `npm run build` exits 0, produces `dist/`
- `01-data-layer/dist/` confirmed present
