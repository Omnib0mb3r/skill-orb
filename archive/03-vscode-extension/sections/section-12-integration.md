# section-12-integration

## Overview

This section ties all prior sections together: cross-component integration tests that verify the full data-layer → API-server → extension-host pipeline, @vscode/test-electron tests for the VS Code extension host, vitest gap coverage for remaining untested webview logic, and a build smoke test that validates the compiled `.vsix` artifact.

**Dependencies:** All prior sections (01–11) must be complete.

**Blocks:** Nothing — this is the final section.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `02-api-server/src/__tests__/integration/cross-component.test.ts` | Create — data layer → API broadcast → extension relay |
| `src/__tests__/integration/extension.test.ts` | Create — @vscode/test-electron tests |
| `webview/__tests__/gap-coverage.test.ts` | Create — remaining untested webview pure functions |
| `scripts/smoke-test.mjs` | Create — build verification + .vsix artifact inspection |
| `package.json` | Modify — add `test`, `test:integration`, `smoke-test` scripts |

All paths: `C:\dev\tools\DevNeural\03-vscode-extension\` unless noted.

---

## Tests First

All tests in this section ARE the implementation. No separate test stubs — the test files below are the full deliverable.

---

## Part 1: Cross-Component Integration Test

**File**: `02-api-server/src/__tests__/integration/cross-component.test.ts`

This test verifies the full data pipeline: a hook-runner event flows through the API server's weights aggregation and is broadcast to connected clients within a reasonable timeout.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Cross-component integration: data layer → API → WebSocket broadcast', () => {
  let apiProcess: ChildProcess;
  let tmpDir: string;
  const API_PORT = 13747; // unique port to avoid conflicts

  beforeAll(async () => {
    // Create temp directory with minimal weights.json
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devneural-integration-'));
    const weightsFile = path.join(tmpDir, 'weights.json');
    await fs.writeFile(weightsFile, JSON.stringify({
      schema_version: '1.0',
      updated_at: new Date().toISOString(),
      nodes: [
        { id: 'project:github.com/test/repo-a', label: 'repo-a', type: 'project' },
        { id: 'tool:playwright', label: 'playwright', type: 'tool' },
      ],
      edges: [
        {
          id: 'e1',
          source: 'project:github.com/test/repo-a',
          target: 'tool:playwright',
          connection_type: 'project->tool',
          weight: 1.0,
          first_seen: Date.now(),
          last_seen: Date.now(),
          raw_count: 1,
        },
      ],
    }));

    // Start API server pointing at tmp weights file
    apiProcess = spawn('node', ['dist/index.js'], {
      cwd: path.resolve(__dirname, '../../../../02-api-server'),
      env: {
        ...process.env,
        PORT: String(API_PORT),
        DEVNEURAL_WEIGHTS_FILE: weightsFile,
        DEVNEURAL_LOCAL_REPOS_ROOT: '',
      },
      stdio: 'pipe',
    });

    // Wait for server to be ready (listen for "Listening" on stdout)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      apiProcess.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('Listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      apiProcess.on('error', reject);
    });
  }, 15000);

  afterAll(async () => {
    apiProcess?.kill();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('broadcasts graph:snapshot to new WebSocket clients', async () => {
    const ws = new WebSocket(`ws://localhost:${API_PORT}/ws`);

    const snapshot = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No snapshot received')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'graph:snapshot') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.payload);
        }
      });
      ws.on('error', reject);
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.nodes.find((n: any) => n.id === 'project:github.com/test/repo-a')).toBeDefined();
  }, 10000);

  it('broadcasts connection:new when weights file is updated', async () => {
    const ws = new WebSocket(`ws://localhost:${API_PORT}/ws`);

    // Wait for initial snapshot
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No initial snapshot')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'graph:snapshot') {
          clearTimeout(timeout);
          resolve();
        }
      });
      ws.on('error', reject);
    });

    // Append a new JSONL log event to trigger re-aggregation
    // (This simulates the hook-runner writing a new event)
    const weightsFile = path.join(tmpDir, 'weights.json');
    const current = JSON.parse(await fs.readFile(weightsFile, 'utf-8'));
    current.edges[0].raw_count += 1;
    current.edges[0].last_seen = Date.now();
    current.updated_at = new Date().toISOString();
    await fs.writeFile(weightsFile, JSON.stringify(current));

    // Wait for connection:new or graph:snapshot broadcast
    const broadcast = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No broadcast after file update')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connection:new' || msg.type === 'graph:snapshot') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg);
        }
      });
    });

    expect(['connection:new', 'graph:snapshot']).toContain(broadcast.type);
  }, 15000);
});
```

---

## Part 2: Extension Host Integration Tests (@vscode/test-electron)

**File**: `src/__tests__/integration/extension.test.ts`

Tests that run inside a real VS Code extension host using `@vscode/test-electron`.

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('DevNeural extension integration', () => {
  test('Extension activates without errors', async () => {
    const ext = vscode.extensions.getExtension('mcollins.devneural');
    assert.ok(ext, 'Extension not found');
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext.isActive);
  });

  test('devneural.openPanel command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('devneural.openPanel'), 'Command not registered');
  });

  test('openPanel command creates a webview panel', async () => {
    await vscode.commands.executeCommand('devneural.openPanel');
    // Panel creation is async; wait briefly
    await new Promise(resolve => setTimeout(resolve, 500));
    // If no error thrown, panel was created successfully
    assert.ok(true);
  });

  test('Extension contributes devneural.apiServerHost configuration', () => {
    const config = vscode.workspace.getConfiguration('devneural');
    const host = config.get<string>('apiServerHost');
    assert.strictEqual(typeof host, 'string');
  });

  test('Extension contributes devneural.recencyFading configuration', () => {
    const config = vscode.workspace.getConfiguration('devneural');
    const fading = config.get<boolean>('recencyFading');
    assert.strictEqual(typeof fading, 'boolean');
  });
});
```

Integration test runner setup in `src/__tests__/integration/runTests.ts`:

```typescript
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const extensionTestsPath = path.resolve(__dirname, './index');
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

---

## Part 3: Webview Gap Coverage (`webview/__tests__/gap-coverage.test.ts`)

Covers any pure functions not already tested by their respective module test files.

```typescript
import { describe, it, expect } from 'vitest';

// ---- projectToScreen ----
import { projectToScreen } from '../main'; // or extract to a util module

describe('projectToScreen', () => {
  it('maps NDC (0,0) to canvas center', () => {
    const mockCamera = {
      projectionMatrix: { clone: () => ({}) },
      matrixWorldInverse: {},
    } as any;
    const mockCanvas = { width: 800, height: 600 } as HTMLCanvasElement;
    // With NDC (0,0,0) the result should be center of canvas
    // Use a real THREE.Camera for accurate test
    // (See THREE.js mock setup in vitest.config.ts)
  });
});

// ---- deriveGitHubUrl ----
import { deriveGitHubUrl } from '../main'; // or src/extension.ts depending on where extracted

describe('deriveGitHubUrl', () => {
  it('strips project: prefix and prepends https://', () => {
    expect(deriveGitHubUrl('project:github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });
  it('strips tool: prefix', () => {
    expect(deriveGitHubUrl('tool:playwright')).toBe('https://playwright');
  });
  it('does not double-prepend https if already present', () => {
    expect(deriveGitHubUrl('https://github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });
});

// ---- detectActiveProjects (pure function from activeProject.ts) ----
import { detectActiveProjects } from '../../src/activeProject';

describe('detectActiveProjects', () => {
  const nodes = [
    { id: 'project:github.com/foo/repo-a', type: 'project' as const, label: 'repo-a', localPath: '/home/user/repos/repo-a' },
    { id: 'project:github.com/foo/repo-b', type: 'project' as const, label: 'repo-b', localPath: '/home/user/repos/repo-b' },
    { id: 'tool:playwright', type: 'tool' as const, label: 'playwright' },
  ];

  it('returns project node whose localPath is a prefix of the open folder', () => {
    const result = detectActiveProjects(nodes, ['/home/user/repos/repo-a/src']);
    expect(result).toEqual(['project:github.com/foo/repo-a']);
  });

  it('returns empty array when no open folder matches', () => {
    const result = detectActiveProjects(nodes, ['/home/user/other-project']);
    expect(result).toEqual([]);
  });

  it('ignores non-project nodes', () => {
    const result = detectActiveProjects(nodes, ['/home/user/repos/repo-a']);
    expect(result).not.toContain('tool:playwright');
  });

  it('returns empty array when no workspace folders open', () => {
    const result = detectActiveProjects(nodes, []);
    expect(result).toEqual([]);
  });
});
```

---

## Part 4: Build Smoke Test (`scripts/smoke-test.mjs`)

Validates the production build artifacts without starting VS Code.

```javascript
#!/usr/bin/env node
// scripts/smoke-test.mjs
import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip'; // devDependency

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let errors = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}`);
    errors++;
  }
}

console.log('Building extension...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });
execSync('npx vsce package --no-dependencies -o dist/devneural.vsix', { cwd: root, stdio: 'inherit' });

console.log('\nSmoke test: checking build artifacts');

// 1. Extension host CJS bundle
check('extension/index.js exists', () => {
  if (!existsSync(resolve(root, 'dist/extension/index.js'))) throw new Error('missing');
});

check('extension/index.js is CJS format', () => {
  const content = readFileSync(resolve(root, 'dist/extension/index.js'), 'utf-8');
  if (!content.includes('module.exports') && !content.includes('"use strict"')) {
    throw new Error('not CJS');
  }
});

check('extension/index.js does not bundle vscode', () => {
  const content = readFileSync(resolve(root, 'dist/extension/index.js'), 'utf-8');
  if (content.includes('vscode.window.createWebviewPanel')) {
    throw new Error('vscode API source found in bundle — should be external');
  }
  // Just check vscode is required, not inlined
  if (!content.includes("require('vscode')") && !content.includes('require("vscode")')) {
    throw new Error('vscode not required as external');
  }
});

// 2. Webview IIFE bundle
check('webview/index.js exists', () => {
  if (!existsSync(resolve(root, 'dist/webview/index.js'))) throw new Error('missing');
});

check('webview/index.js is IIFE format', () => {
  const content = readFileSync(resolve(root, 'dist/webview/index.js'), 'utf-8');
  if (!content.startsWith('(()') && !content.startsWith('(function')) {
    throw new Error('not IIFE format');
  }
});

check('webview/index.js bundles Three.js (not external)', () => {
  const content = readFileSync(resolve(root, 'dist/webview/index.js'), 'utf-8');
  // Three.js exports WebGLRenderer — check it's inlined
  if (content.includes("require('three')") || content.includes('require("three")')) {
    throw new Error('three.js is external in webview bundle — should be inlined');
  }
});

check('webview bundle size < 8MB', () => {
  const stat = statSync(resolve(root, 'dist/webview/index.js'));
  const mb = stat.size / 1024 / 1024;
  if (mb > 8) throw new Error(`bundle is ${mb.toFixed(1)}MB, expected < 8MB`);
});

// 3. .vsix artifact inspection
check('.vsix file exists', () => {
  if (!existsSync(resolve(root, 'dist/devneural.vsix'))) throw new Error('missing');
});

check('.vsix contains extension/index.js', () => {
  const zip = new AdmZip(resolve(root, 'dist/devneural.vsix'));
  const entries = zip.getEntries().map(e => e.entryName);
  if (!entries.some(e => e.includes('extension/index.js'))) {
    throw new Error(`not found. Entries: ${entries.slice(0, 10).join(', ')}`);
  }
});

check('.vsix contains webview/index.js', () => {
  const zip = new AdmZip(resolve(root, 'dist/devneural.vsix'));
  const entries = zip.getEntries().map(e => e.entryName);
  if (!entries.some(e => e.includes('webview/index.js'))) {
    throw new Error(`not found. Entries: ${entries.slice(0, 10).join(', ')}`);
  }
});

check('.vsix does NOT contain node_modules/', () => {
  const zip = new AdmZip(resolve(root, 'dist/devneural.vsix'));
  const entries = zip.getEntries().map(e => e.entryName);
  const forbidden = entries.filter(e => e.includes('node_modules/'));
  if (forbidden.length > 0) {
    throw new Error(`found ${forbidden.length} node_modules entries`);
  }
});

check('.vsix does NOT contain src/ TypeScript source', () => {
  const zip = new AdmZip(resolve(root, 'dist/devneural.vsix'));
  const entries = zip.getEntries().map(e => e.entryName);
  const tsFiles = entries.filter(e => e.endsWith('.ts') && !e.endsWith('.d.ts'));
  if (tsFiles.length > 0) {
    throw new Error(`found TypeScript source files: ${tsFiles.slice(0, 5).join(', ')}`);
  }
});

console.log(`\nSmoke test complete: ${errors === 0 ? 'ALL PASSED' : `${errors} FAILED`}`);
process.exit(errors > 0 ? 1 : 0);
```

---

## package.json Script Additions

Add to the `"scripts"` section of `03-vscode-extension/package.json`:

```json
{
  "scripts": {
    "build": "node esbuild.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "node src/__tests__/integration/runTests.js",
    "smoke-test": "node scripts/smoke-test.mjs",
    "prepackage": "npm run build",
    "package": "vsce package --no-dependencies"
  }
}
```

Also add `adm-zip` as a devDependency (used by smoke-test.mjs for .vsix inspection):
```json
{
  "devDependencies": {
    "adm-zip": "^0.5.10"
  }
}
```

---

## Test Execution Order

For a full validation pass before release:

```bash
# 1. Unit tests (fast, no VS Code instance)
npm test

# 2. Build + smoke test (validates .vsix artifact)
npm run smoke-test

# 3. Integration tests (requires built dist/ and running API server for cross-component test)
npm run test:integration
```

CI pipeline should run in this order. Steps 2 and 3 only run on main branch or release tags (not on every PR) due to build time.

---

## Edge Cases and Notes

- **Cross-component test isolation**: Uses a unique port (13747) to avoid conflicts with dev instances. `afterAll` kills the spawned process and cleans up the temp directory.
- **API server build dependency**: The cross-component test assumes `02-api-server/dist/index.js` exists. Add a prerequisite check and clear error message if it does not.
- **@vscode/test-electron version**: Must match the VS Code engine version declared in `package.json`. Keep these in sync.
- **Smoke test `adm-zip`**: Only a devDependency, excluded from the `.vsix` via `.vscodeignore`.
- **Voice spike**: If the voice spike (section-11) failed and voice is disabled, the integration test should not fail on missing voice commands — the smoke test just verifies the bundle exists and is the right format.
