# Section 07: Obsidian Writer (`obsidian/writer.ts`)

## Overview

This section implements the Obsidian vault file manager. It is the final piece before the CLI integration and is responsible for reading and writing per-project `.md` files in the user's Obsidian vault. It depends on section-02 (types/config) and section-05 (renderer) being complete.

**Dependencies:**
- section-02-types-config: provides `ObsidianSyncConfig` and `SessionSummary` types
- section-05-renderer: the `rendered` string argument to `writeSessionEntry()` comes from `renderSummary()` defined there

**Blocks:** section-08-cli-integration

---

## Files to Create

- `C:\dev\tools\DevNeural\06-notebooklm-integration\src\obsidian\writer.ts`
- `C:\dev\tools\DevNeural\06-notebooklm-integration\tests\writer.test.ts`

---

## Tests First

**Test file:** `tests/writer.test.ts`

All tests use a temporary directory fixture (e.g., `fs.mkdtempSync` in `beforeEach`, cleaned up in `afterEach`). No real Obsidian vault is needed.

Write stubs for every test case below before implementing:

```
# Test: deriveSlug strips 'project:' prefix before processing
# Test: deriveSlug extracts last path component and lowercases (URL path)
# Test: deriveSlug extracts last path component and lowercases (Windows path with backslashes)
# Test: deriveSlug uses '<penultimate>-<last>' form when two projects would produce the same slug

# Test: writeSessionEntry creates new file with heading and DEVNEURAL_SESSIONS_START marker when file does not exist
# Test: writeSessionEntry returns early (no write) and logs message when Session: YYYY-MM-DD heading already exists and --force not set
# Test: writeSessionEntry overwrites existing session block when --force is set
# Test: writeSessionEntry inserts session after DEVNEURAL_SESSIONS_START marker when prepend_sessions = true
# Test: writeSessionEntry appends to end when prepend_sessions = false
# Test: writeSessionEntry inserts after first heading when DEVNEURAL_SESSIONS_START marker is absent (fallback)
# Test: writeSessionEntry creates parent directories when they do not exist (mkdirSync recursive)
# Test: writeSessionEntry reads and writes files with { encoding: 'utf-8' } (verify no BOM)
```

The `deriveSlug` tests cover both the simple happy path and the collision case. For the collision test, call `deriveSlug` twice with two different project IDs that reduce to the same last component (e.g., `github.com/user/devneural` and `c:/dev/devneural`) and verify the returned slugs are different (using the `<penultimate>-<last>` form).

Important: `deriveSlug` needs to be **exported** from `writer.ts` so it can be tested in isolation.

---

## Implementation: `src/obsidian/writer.ts`

This module uses Node's built-in `fs` module only. It is synchronous throughout — no `async`/`await`. Import types from `../types.js` (NodeNext resolution requires `.js` extensions on relative imports).

### Slug Derivation

The exported `deriveSlug` function signature:

```typescript
export function deriveSlug(projectId: string, existingSlugs?: Map<string, string>): string
```

**Slug algorithm (step by step):**
1. Strip `project:` prefix if present (e.g., `project:github.com/user/repo` → `github.com/user/repo`)
2. Split on both `/` and `\` (for Windows paths) to get components
3. Filter out empty components
4. Take the **last** component, lowercase it — this is the candidate slug
5. **Collision check:** if `existingSlugs` is provided and another project ID already maps to this candidate slug, use `<penultimate>-<last>` form instead (e.g., `user-repo`), also lowercased

**Examples:**
- `github.com/Omnib0mb3r/DevNeural` → `devneural`
- `project:github.com/Omnib0mb3r/DevNeural` → `devneural`
- `c:/dev/tools/DevNeural` → `devneural` (collision would yield `tools-devneural`)

The `existingSlugs` map holds `projectId → slug` for previously processed projects in the same run. The caller (CLI entry point in section-08) is responsible for building and passing this map if multiple projects are written in one invocation. For most single-project runs, `existingSlugs` will be `undefined` and collision handling is skipped.

### File Path

The vault file path is constructed as:

```
<config.vault_path>/<config.notes_subfolder>/<slug>.md
```

Using `path.join()` for cross-platform safety.

### Write Session Entry

The exported `writeSessionEntry` function signature:

```typescript
export function writeSessionEntry(
  summary: SessionSummary,
  rendered: string,
  config: ObsidianSyncConfig,
  options?: { force?: boolean; existingSlugs?: Map<string, string> }
): void
```

**Behavior decision tree:**

1. Derive the slug from `summary.project`
2. Build the full file path
3. Ensure parent directories exist: `fs.mkdirSync(dir, { recursive: true })`
4. **If file does not exist:**
   - Create with:
     ```
     # <slug>\n<!-- DEVNEURAL_SESSIONS_START -->\n<rendered>
     ```
   - Write with `{ encoding: 'utf-8' }`
   - Return
5. **If file exists:**
   - Read with `{ encoding: 'utf-8' }`
   - Check if `## Session: <summary.date>` already appears in the content
   - If yes and `options?.force` is not set:
     - Print to stdout: `Session for <date> already exists in <path>. Use --force to overwrite.`
     - Return (do not write)
   - If yes and `options?.force` is set:
     - Remove the existing session block (from `## Session: <date>` up to and including the next `---` line) before inserting the new one
   - **Prepend mode** (`config.prepend_sessions === true`, default):
     - Find the `<!-- DEVNEURAL_SESSIONS_START -->` marker
     - If found: insert `rendered` immediately after the marker line
     - If not found (manually created file): insert after the first line that starts with `#`
   - **Append mode** (`config.prepend_sessions === false`):
     - Append `rendered` to the end of the file content
   - Write the modified content with `{ encoding: 'utf-8' }`

### Removing an Existing Session Block (for `--force`)

When overwriting, the old session block must be removed before reinserting. The block starts at the `## Session: YYYY-MM-DD` line and ends at the next `---` line (inclusive). Use a line-by-line approach: find the start index, scan forward for the `---` line, splice those lines out of the array, then proceed with the normal insert logic.

### UTF-8 and BOM

Always pass `{ encoding: 'utf-8' }` to both `fs.readFileSync` and `fs.writeFileSync`. Do not use `Buffer` operations — string reads/writes are sufficient and avoid inadvertent BOM injection.

---

## Key Constraints and Edge Cases

- **Platform path handling in slugs:** `path.basename()` only handles the platform's native separator. Since the project IDs may be URLs (always `/`) or Windows paths (using `\`), split manually on both `'/'` and `'\\'` rather than using `path.basename()`.
- **Case sensitivity:** Obsidian is case-sensitive on Linux. Always lowercase slugs regardless of input.
- **Synchronous I/O:** No async. The caller (CLI) awaits all async work before calling `writeSessionEntry`.
- **No third-party file write libraries:** Use `fs.writeFileSync` directly. Lost writes are acceptable (Obsidian vault is not a shared database).
- **Marker insertion is string/line manipulation only:** No markdown parsers — split on `\n`, find the marker by exact string match, splice in the new lines, rejoin.

---

## Imports and Module Shape

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { SessionSummary, ObsidianSyncConfig } from '../types.js';

export function deriveSlug(projectId: string, existingSlugs?: Map<string, string>): string { /* ... */ }

export function writeSessionEntry(
  summary: SessionSummary,
  rendered: string,
  config: ObsidianSyncConfig,
  options?: { force?: boolean; existingSlugs?: Map<string, string> }
): void { /* ... */ }
```

No default export. Named exports only.

---

## Test Fixture Pattern

In `tests/writer.test.ts`, set up a temp directory before each test and clean it up after:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deriveSlug, writeSessionEntry } from '../src/obsidian/writer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

Build a minimal `ObsidianSyncConfig` stub for each test — only populate the fields `writeSessionEntry` actually reads: `vault_path`, `notes_subfolder`, and `prepend_sessions`. Point `vault_path` at `tmpDir`.

Build a minimal `SessionSummary` stub with at least `date` and `project` populated.
