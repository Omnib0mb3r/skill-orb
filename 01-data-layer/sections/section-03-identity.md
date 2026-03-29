# Section 03: Identity

**Depends on:** section-01-foundation (types and project scaffold must exist)
**Blocks:** section-06-hook-runner
**Parallelizable with:** section-02-config, section-04-logger, section-05-weights

---

## Purpose

Implement the identity resolution module. Given a `cwd` string from a hook payload, produce a canonical project identifier using the best available source: a git remote URL, a git root path, or the raw `cwd`. This identifier is used as the `source_node` in every log entry and weight edge.

---

## Files to Create

- `src/identity/index.ts` — all implementation
- `tests/identity.test.ts` — all tests

---

## Tests First

Write these tests in `tests/identity.test.ts` before implementing. All tests should pass when the implementation is complete.

**`normalizeGitUrl`:**
- Converts SSH format `git@github.com:user/repo.git` → `github.com/user/repo`
- Converts HTTPS format `https://github.com/user/repo.git` → `github.com/user/repo`
- Strips trailing `.git` only (not mid-path occurrences)
- Returns input unchanged for unrecognized formats: bare paths, `file://`, `git://`, ported SSH URLs

**`normalizePath`:**
- Converts backslashes to forward slashes
- Lowercases the Windows drive letter (e.g., `C:/` → `c:/`)

**`resolveProjectIdentity`:**
- Returns `source: 'git-remote'` and a normalized URL when a git remote exists
- Returns `source: 'git-root'` and a normalized path when `.git` exists but no remote
- Returns `source: 'cwd'` and a normalized path when no `.git` directory exists anywhere in the tree
- Returns `source: 'cwd'` when the `git` binary is not on PATH (simulated by passing a bad binary path or mocking `execSync`)
- Returns `source: 'cwd'` when `cwd` is an empty string
- Never throws — returns a fallback result on any filesystem or subprocess error

Total: 11 tests.

---

## Background and Context

### Why project identity matters

Every log entry and weight edge is keyed on a project identifier. Consistent, canonical identifiers are essential — if the same project resolves to two different strings in two sessions, the weights file will contain duplicate edges that never merge.

The priority cascade is:
1. **git remote URL** — most stable; survives directory moves and machine migrations
2. **git root path** — stable for a given machine and checkout location
3. **raw `cwd`** — last resort; works in non-git directories

### The `findUp` helper

`find-up` v7 is ESM-only and incompatible with the CommonJS output target. Inline a simple recursive helper instead of adding a dependency:

```typescript
function findUp(name: string, from: string): string | null
```

Walk upward from `from` looking for a directory or file named `name`. Return the directory containing it, or `null` if the filesystem root is reached without finding it. Handle empty or invalid `from` strings gracefully (return `null`).

### The git remote subprocess

Use `child_process.execSync` (not `simple-git`). Only one command is needed:

```
git -C <gitRoot> remote get-url origin
```

Wrap in `try/catch`. The command throws on non-zero exit (no remote configured) and also if `git` is not on PATH. In both cases, fall back to the `git-root` source using the normalized `gitRoot` path.

### URL normalization rules

Two formats to handle:

- SSH: `git@github.com:user/repo.git` → `github.com/user/repo`
- HTTPS: `https://github.com/user/repo.git` → `github.com/user/repo`

For any other format (bare path, `file://`, `git://`, etc.) — return the input string unchanged. Do not attempt to normalize formats you don't recognize; it's safer to leave them as-is than to mangle them.

### Path normalization rules

Applied to both git root paths and raw `cwd` values when used as project identifiers:

- Replace all backslashes with forward slashes
- Lowercase the drive letter if present (matches regex `/^[A-Z]:/`)

Example: `C:\dev\tools\DevNeural` → `c:/dev/tools/devneural`

---

## Implementation

### `src/identity/index.ts` — signatures and stubs

```typescript
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Re-export relevant types (defined in src/types.ts from section-01)
import type { ProjectIdentity, ProjectSource } from '../types';

export { ProjectIdentity };

/** Walk up the directory tree from `from`, looking for a directory entry named `name`.
 *  Returns the parent directory containing `name`, or null if not found. */
function findUp(name: string, from: string): string | null { /* ... */ }

/** Normalize SSH or HTTPS git remote URLs to host/owner/repo format.
 *  Returns input unchanged for unrecognized formats. */
export function normalizeGitUrl(url: string): string { /* ... */ }

/** Convert backslashes to forward slashes; lowercase the drive letter. */
export function normalizePath(p: string): string { /* ... */ }

/** Resolve the canonical project identity from a working directory path.
 *  Priority: git-remote > git-root > cwd. Never throws. */
export async function resolveProjectIdentity(cwd: string): Promise<ProjectIdentity> { /* ... */ }
```

The function is `async` for interface consistency with the hook runner's `Promise.all` flow, even though the current implementation is synchronous internally (no async I/O — `execSync` and `fs.existsSync` are used).

### Notes on `resolveProjectIdentity` internals

1. Guard against empty `cwd` up front — return `{ id: '', source: 'cwd' }` immediately
2. Call `findUp('.git', cwd)` to locate `gitRoot`
3. If `gitRoot` is found, call `execSync(...)` in a try/catch:
   - On success: trim output, call `normalizeGitUrl`, return `{ id, source: 'git-remote' }`
   - On any error: call `normalizePath(gitRoot)`, return `{ id, source: 'git-root' }`
4. If no `.git` found: call `normalizePath(cwd)`, return `{ id, source: 'cwd' }`
5. Wrap the entire function body in a try/catch — on any unexpected error, return `{ id: normalizePath(cwd), source: 'cwd' }`

---

## Types Reference (from section-01)

These interfaces are defined in `src/types.ts` (created in section-01). Do not redefine them here — import from `../types`.

```typescript
type ProjectSource = 'git-remote' | 'git-root' | 'cwd';

interface ProjectIdentity {
  id: string;
  source: ProjectSource;
}
```

---

## Test Setup Notes

Testing `resolveProjectIdentity` requires control over the filesystem and the `git` subprocess:

- For git-remote and git-root cases: create a temp directory with a `.git` subdirectory. You can mock `child_process.execSync` (or use `vi.spyOn`) to control what the git command returns — no real git repo required.
- For the cwd fallback: pass a temp directory path with no `.git` anywhere in its ancestors (use `os.tmpdir()` + a unique suffix; verify it has no `.git` above it, which is true for standard temp directories).
- For the missing-git-binary case: mock `execSync` to throw an error with `code: 'ENOENT'` or a non-zero exit code.
- For the empty `cwd` case: pass `''` directly — no filesystem setup needed.

Use `vi.mock('child_process')` or `vi.spyOn(cp, 'execSync')` within individual test cases to simulate subprocess behavior without shelling out.
