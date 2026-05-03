# Section 02: Identity Module

## Overview

This section creates `src/identity.ts` — a thin re-export wrapper that makes `resolveProjectIdentity` available to the rest of `04-session-intelligence` from a local import path. The wrapper exists to decouple the rest of the codebase from the direct cross-package path, making future refactoring easier.

**Depends on:** section-01-setup (package.json, tsconfig.json must exist; `01-data-layer` must be built)
**Blocks:** section-05-entry-point

---

## Prerequisite: Build 01-data-layer

This module imports from the compiled output of `01-data-layer`. Before `04-session-intelligence` will compile, you must have run `npm run build` in `C:/dev/tools/DevNeural/01-data-layer/`. The build produces:

```
01-data-layer/dist/
  identity/index.js       ← exports resolveProjectIdentity
  identity/index.d.ts
  types.js                ← exports ProjectIdentity, ProjectSource
  types.d.ts
  ...
```

The `01-data-layer` `tsconfig.json` has `rootDir: "./src"` and `outDir: "./dist"`, so every file in `src/` maps directly to `dist/` at the same relative sub-path.

If `01-data-layer/dist/` does not exist when you run `tsc` in `04-session-intelligence`, you will get a `Cannot find module` error.

---

## File to Create

**`C:/dev/tools/DevNeural/04-session-intelligence/src/identity.ts`**

This file is a two-line re-export module. It imports from the compiled `dist/` paths (not the TypeScript source) because both packages use CommonJS and `04-session-intelligence/tsconfig.json` omits `rootDir` (which is what allows cross-directory relative imports to resolve).

```typescript
// src/identity.ts
export type { ProjectIdentity, ProjectSource } from '../../01-data-layer/dist/types';
export { resolveProjectIdentity } from '../../01-data-layer/dist/identity/index';
```

Note: The import paths use `../../01-data-layer/dist/...` (two levels up from `src/`) because the file lives in `04-session-intelligence/src/`. Omit the `.js` extension — TypeScript under `"moduleResolution": "node"` resolves these correctly without it.

### What is exported

- `resolveProjectIdentity(cwd: string): Promise<ProjectIdentity>` — resolves a working directory path to a canonical project identifier. Implementation lives in `01-data-layer`. Behavior:
  - Walks up the directory tree looking for `.git`
  - If found, runs `git remote get-url origin` and normalizes the URL to `github.com/user/repo` format
  - If no remote, returns the git root path (normalized to forward slashes, lowercased)
  - If no `.git` at all, returns the `cwd` path (normalized)
  - **Never throws** — all errors are caught internally; the fallback is always the normalized `cwd`

- `ProjectIdentity` — interface with fields:
  - `id: string` — the canonical identifier (e.g., `github.com/mcollins/devneural`)
  - `source: ProjectSource` — how it was resolved

- `ProjectSource` — union type: `'git-remote' | 'git-root' | 'cwd'`

---

## Tests to Write First

File: **`C:/dev/tools/DevNeural/04-session-intelligence/tests/identity.test.ts`**

These tests verify the re-export wrapper compiles and that the underlying function works correctly when called from `04-session-intelligence`.

### Test stubs

```typescript
import { describe, it, expect } from 'vitest';
import { resolveProjectIdentity } from '../src/identity';
import type { ProjectIdentity } from '../src/identity';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('identity module re-export', () => {
  it('resolveProjectIdentity is importable from src/identity', async () => {
    /** Compile-time check: if this import fails to compile, the test file will not load.
     *  Runtime check: verify the function is callable and returns the right shape. */
  });

  it('returns id and source for a known git repo path', async () => {
    /** Call resolveProjectIdentity with a path known to be inside a git repo
     *  (e.g., C:/dev/tools/DevNeural itself). Assert result.id is a non-empty string
     *  and result.source is one of 'git-remote', 'git-root', 'cwd'. */
  });

  it('falls back to normalized directory name when no .git is present', async () => {
    /** Create a temp directory with no .git.
     *  Call resolveProjectIdentity with that path.
     *  Assert result.source === 'cwd' and result.id contains the directory name. */
  });
});
```

### Test expectations

1. **Import check** — the mere act of importing `resolveProjectIdentity` from `'../src/identity'` succeeds. If `01-data-layer` is not built, this will throw a `Cannot find module` error. The test itself can just assert `typeof resolveProjectIdentity === 'function'`.

2. **Known git repo path** — use the DevNeural repo root (`C:/dev/tools/DevNeural`) as the `cwd`. The result should have `source: 'git-remote'` (if a remote is configured) or `source: 'git-root'`, and `id` should be a non-empty string.

3. **No-git fallback** — create a temp dir using `fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-id-test-'))`. Pass it to `resolveProjectIdentity`. Assert:
   - `result.source === 'cwd'`
   - `result.id` is a non-empty string (the normalized path)
   - Clean up the temp dir after the test

---

## Key Design Notes

**Why re-export from dist/ not src/?**

Both `01-data-layer` and `04-session-intelligence` use `"module": "CommonJS"`. TypeScript cross-project imports in CommonJS must point at compiled JS (or declaration files), not raw `.ts` source. The `tsconfig.json` for `04-session-intelligence` deliberately omits `rootDir` so TypeScript does not complain about files being imported from outside the project's root directory.

**Why does `resolveProjectIdentity` never throw?**

The function is used in both the PostToolUse hook (writes data) and the SessionStart hook (reads data). In both contexts, a crash would degrade the Claude Code session. The implementation in `01-data-layer/src/identity/index.ts` wraps everything in `try/catch` and returns `{ id: normalizePath(cwd), source: 'cwd' }` as the ultimate fallback.

**Path normalization**

`normalizePath` (internal to `01-data-layer`) converts backslashes to forward slashes and lowercases the entire string. This ensures Windows paths like `C:\dev\tools\DevNeural` become `c:/dev/tools/devneural` — consistent across OS environments and matching the keys used in `weights.json`.

---

## TODO List for Implementer

1. [x] Confirm `01-data-layer` is built
2. [x] Create `tests/identity.test.ts` with three test stubs
3. [x] Run `npm test` — confirm tests fail (module not found)
4. [x] Create `src/identity.ts` with the two re-export lines
5. [x] Run `npm test` — all three pass
6. [x] Run `tsc --noEmit` — exits 0

## Implementation Notes (Actual)

### Files Created
- `04-session-intelligence/src/identity.ts` — two re-export lines, exact paths from plan
- `04-session-intelligence/tests/identity.test.ts` — 3 tests, all pass

### Deviations from Plan
- Test 2: replaced hardcoded `'C:/dev/tools/DevNeural'` with `path.resolve(__dirname, '../../')` for portability
- Test 2: assertion changed from `toContain(['git-remote', 'git-root', 'cwd'])` to `not.toBe('cwd')` — stricter
- Test 3: replaced `fs.rmdirSync` (deprecated) with `fs.rmSync({ recursive: true, force: true })`
- Test 3: strengthened `result.id` assertion to verify exact normalized path form
