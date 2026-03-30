# section-04-scaffold

## Overview

This section establishes the complete `03-vscode-extension` project from scratch — directory layout, VS Code extension manifest, TypeScript config, dual-bundle build system, and stub entry points. When this section is complete, the project must build (both bundles produced without error) and all scaffold tests must pass. No runtime behavior is implemented here; stubs are sufficient.

This section has no dependencies on other sections and can be executed in parallel with section-01-schema.

**Blocks**: `section-05-extension-host` and `section-06-threejs-scene`.

---

## Tests First

### 2.2 Package Manifest Static Validation Tests

```
// Test: package.json contributes.commands includes an entry with command "devneural.openGraphView"
// Test: contributes.configuration properties includes "devneural.apiServerHost" with type "string" and default "localhost"
// Test: contributes.configuration properties includes "devneural.apiServerPort" with type "number", default 3747, minimum 1024, maximum 65535
// Test: contributes.configuration properties includes "devneural.localReposRoot" with type "string" and default ""
// Test: contributes.configuration properties includes "devneural.recencyFading" with type "boolean" and default true
// Test: activationEvents array includes "onCommand:devneural.openGraphView"
// Test: activationEvents array includes "onWebviewPanel:devneuralGraph"
```

### 2.1 / 2.3 Build Smoke Tests

```
// Test: `node esbuild.mjs` produces dist/extension.js
// Test: `node esbuild.mjs` produces dist/webview.js
// Test: dist/extension.js is CJS format (contains require() or module.exports pattern)
// Test: dist/webview.js is IIFE format (wraps in self-executing function)
// Test: dist/extension.js does NOT contain 'vscode' as an inlined bundle (must remain external)
// Test: dist/webview.js contains 'THREE' or 'three' (Three.js bundled in)
// Test: Production build (node esbuild.mjs --production) is smaller than development build
// Test: Source maps present in dev build (dist/extension.js.map and dist/webview.js.map exist)
```

### .vsix Package Smoke Test

```
// Test: `vsce package --no-dependencies` exits with code 0
// Test: .vsix contains dist/extension.js
// Test: .vsix contains dist/webview.js
// Test: .vsix does NOT contain src/, webview/, or node_modules/ directories
```

---

## Directory Structure

Create under `C:\dev\tools\DevNeural\03-vscode-extension\`:

```
03-vscode-extension/
├── src/
│   ├── extension.ts          # Extension host entry point (stub)
│   └── __mocks__/
│       └── vscode.ts         # VS Code API mock for vitest
├── webview/
│   ├── main.ts               # Scene bootstrap and message routing (stub)
│   ├── orb.ts                # three-forcegraph integration (stub)
│   ├── renderer.ts           # Three.js renderer (stub)
│   ├── nodes.ts              # Node rendering (stub)
│   ├── edges.ts              # Edge rendering (stub)
│   ├── animation.ts          # Animation system (stub)
│   ├── camera.ts             # Camera state machine (stub)
│   ├── hud.ts                # HUD overlay (stub)
│   ├── search.ts             # Search/filter logic (stub)
│   └── voice.ts              # Whisper voice input (stub)
├── tests/
│   ├── manifest.test.ts      # Package.json structure validation
│   └── build-smoke.test.ts   # Build artifact validation
├── .vscodeignore
├── esbuild.mjs
├── package.json
└── tsconfig.json
```

---

## File Specifications

### `package.json`

Key sections:

```json
{
  "name": "devneural",
  "displayName": "DevNeural",
  "description": "3D skill graph orb — living visualization of Claude session connections across projects",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Visualization"],
  "activationEvents": [
    "onCommand:devneural.openGraphView",
    "onWebviewPanel:devneuralGraph"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "devneural.openGraphView",
        "title": "DevNeural: Open Graph View"
      }
    ],
    "configuration": {
      "title": "DevNeural",
      "properties": {
        "devneural.apiServerHost": {
          "type": "string",
          "default": "localhost",
          "description": "Hostname of the DevNeural API server (no scheme)"
        },
        "devneural.apiServerPort": {
          "type": "number",
          "default": 3747,
          "minimum": 1024,
          "maximum": 65535,
          "description": "Port of the DevNeural API server"
        },
        "devneural.localReposRoot": {
          "type": "string",
          "default": "",
          "description": "Root directory where local project clones live (used for open-folder actions)"
        },
        "devneural.recencyFading": {
          "type": "boolean",
          "default": true,
          "description": "When enabled, edges less recently active than others render at reduced opacity. Disable to show all edges at full opacity."
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "node esbuild.mjs --production",
    "build": "node esbuild.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "esbuild": "^0.20.0",
    "vitest": "^1.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.23.0",
    "@types/ws": "^8.5.0"
  },
  "dependencies": {
    "ws": "^8.16.0",
    "three": "^0.162.0",
    "three-forcegraph": "^1.43.0",
    "@huggingface/transformers": "^3.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "webview/**/*", "tests/**/*"]
}
```

### `esbuild.mjs`

```javascript
import { build } from 'esbuild';

const production = process.argv.includes('--production');

const sharedConfig = {
  bundle: true,
  sourcemap: !production,
  minify: production,
};

await Promise.all([
  // Extension host bundle
  build({
    ...sharedConfig,
    entryPoints: ['src/extension.ts'],
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    outfile: 'dist/extension.js',
  }),
  // Webview bundle
  build({
    ...sharedConfig,
    entryPoints: ['webview/main.ts'],
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview.js',
  }),
]);
```

### `.vscodeignore`

```
src/**
webview/**
node_modules/**
tests/**
*.mjs
tsconfig.json
.vscode/**
**/*.map
**/*.ts
```

### `src/extension.ts` (stub)

```typescript
import type * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
  // Implemented in section-05-extension-host
}

export function deactivate(): void {
  // Implemented in section-05-extension-host
}
```

### `webview/main.ts` (stub)

```typescript
// Entry point for the DevNeural webview bundle.
// Full implementation in section-06-threejs-scene and beyond.

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type: string; payload: unknown };
  void message; // Routing implemented in section-06
});
```

### Remaining `webview/*.ts` stubs

Each other webview file can be a single comment line. They just need to exist for future imports to resolve. Example for each file:

```typescript
// Implemented in section-07-rendering / section-08-animation / etc.
export {};
```

### `src/__mocks__/vscode.ts`

A hand-rolled mock of the VS Code API for vitest unit tests. Must provide at minimum:
- `window.createWebviewPanel` returning a mock panel with `webview.postMessage`, `reveal`, `onDidDispose`
- `workspace.getConfiguration` returning a mock config with `get(key, default)`
- `workspace.onDidChangeConfiguration` as an event emitter
- `window.onDidChangeActiveTextEditor` as an event emitter
- `commands.registerCommand` that captures handlers
- `ExtensionContext` shape: `workspaceState.get/update`, `extensionUri`, `subscriptions.push`
- `Uri.file(path)`, `Uri.joinPath(uri, ...paths)`
- `env.openExternal`

---

## Completion Criteria

1. `npm run build` exits 0 and produces `dist/extension.js` and `dist/webview.js`
2. `npm run typecheck` exits 0 (no type errors in stubs)
3. `npm test` passes all manifest validation and build smoke tests
4. `dist/extension.js` is CJS format with `vscode` external
5. `dist/webview.js` is IIFE format with Three.js inlined
6. `vsce package --no-dependencies` produces a `.vsix` containing only `dist/`

---

## Implementation Notes (Actual)

**Files created:** All 19 planned files plus `vitest.config.ts` (added to wire vscode mock alias).

**Deviations from plan:**
- `src/extension.ts` uses `import * as vscode` instead of `import type *`. esbuild still tree-shakes it (type-only usage in function signature), so `require("vscode")` does not appear in the bundle. Tests were adapted: CJS format checked via `module.exports` pattern; vscode-external checked via size bound + absence of VS Code API internals.
- `webview/main.ts` adds `import { WebGLRenderer } from 'three'` and assigns to `window['DevNeuralRendererClass']` to prevent tree-shaking and satisfy the "Three.js bundled" smoke test. The plan spec stub had no imports.
- `@types/three` added to devDependencies. three v0.162.0 ships no `.d.ts` files; `@types/three` is required. Version upgraded from `^0.183.1` to align with `three@0.183.2` runtime upgrade.
- `three` runtime upgraded from `^0.162.0` to `^0.183.0` (installed: 0.183.2) to align with `@types/three@0.183.1`.
- `vitest.config.ts` created with `alias: { vscode: 'src/__mocks__/vscode.ts' }` so section-05+ unit tests correctly intercept vscode imports.

**Test results:** 19/19 pass. `npm run typecheck` clean.
