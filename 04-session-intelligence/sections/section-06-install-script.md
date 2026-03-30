# Section 06: Install Script

## Overview

This section implements `src/install-hook.ts`, a standalone Node.js script that patches `~/.claude/settings.json` to register the `session-start.js` compiled hook as a `SessionStart` hook in Claude Code. It is invoked via `npm run install-hook` and has no runtime dependencies beyond Node.js built-ins.

**Dependencies:** Requires `section-01-setup` (package.json, tsconfig.json). The compiled output `dist/session-start.js` does not need to exist at install-script authoring time, but `npm run build` must be run before the installed hook fires.

**File to create:** `C:\dev\tools\DevNeural\04-session-intelligence\src\install-hook.ts`

**Test file to create:** `C:\dev\tools\DevNeural\04-session-intelligence\tests\install-hook.test.ts`

---

## Background: settings.json Format

The real `~/.claude/settings.json` uses a specific structure for hooks. Study this before implementing:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/mcollins/.claude/hooks/gsd-check-update.js\""
          }
        ]
      }
    ]
  }
}
```

Key observations:
- `hooks.SessionStart` is an **array of matcher-group objects**
- Each entry in the array has a nested `hooks` array containing the actual command objects
- Existing entries often have **no `matcher` field** at the top level (the `matcher` field is optional)
- The `type` field on command objects is `"command"`
- A `timeout` field (number, seconds) is optional on command objects
- A `statusMessage` string field is optional on command objects

The install script appends new entries in this same format.

---

## Tests First

**File:** `C:\dev\tools\DevNeural\04-session-intelligence\tests\install-hook.test.ts`

These tests operate on the `mergeHooks` function in isolation. They never touch the real `~/.claude/settings.json`.

### Test stubs

```typescript
import { describe, it, expect } from 'vitest';

// Import the pure helper functions directly (not main)
// The test imports assume named exports from install-hook.ts

describe('mergeHooks', () => {
  it('installs 4 entries when SessionStart is empty', () => {
    // Call mergeHooks with empty settings {}
    // Expect result.hooks.SessionStart to have length 4
    // Expect entries to include matchers: startup, resume, clear, compact
  });

  it('is idempotent: running twice produces no duplicates', () => {
    // Call mergeHooks once, then call mergeHooks again on the result
    // Expect final SessionStart array to still have exactly 4 DevNeural entries
    // (plus any pre-existing entries)
  });

  it('deduplicates when an existing entry has no matcher field', () => {
    // Construct a settings object where SessionStart has one entry
    // with no "matcher" field but whose command contains the path to session-start.js
    // Call mergeHooks
    // Expect no new entries added (already present by command-string scan)
  });

  it('preserves all other settings fields', () => {
    // Call mergeHooks with settings that have env, permissions, statusLine, etc.
    // Expect all those top-level keys to remain unchanged
    // Expect hooks.PostToolUse to remain unchanged if present
  });

  it('produces valid output (all 4 entries have type: command and a command string)', () => {
    // Call mergeHooks on empty settings
    // For each added entry, verify:
    //   - entry.hooks is an array
    //   - entry.hooks[0].type === 'command'
    //   - entry.hooks[0].command is a non-empty string containing 'session-start.js'
  });

  it('only the startup entry has a statusMessage', () => {
    // Call mergeHooks on empty settings
    // Find the startup matcher entry
    // Expect its nested command object to have statusMessage set
    // Expect resume, clear, compact entries to NOT have statusMessage on their command
  });
});
```

> Note: these are unit tests against the exported `mergeHooks` function, not against `main`. Do not call `main()` in tests — it would read/write the real filesystem.

---

## Implementation

**File:** `C:\dev\tools\DevNeural\04-session-intelligence\src\install-hook.ts`

### Public API (named exports for testability)

```typescript
export function getSettingsPath(): string
  /** Returns the absolute path to ~/.claude/settings.json using os.homedir() */

export function readSettings(settingsPath: string): Record<string, unknown>
  /** Reads and JSON-parses settings.json. Returns {} if file does not exist. */

export function buildHookEntry(scriptPath: string, matcher: string, includeStatusMessage: boolean): object
  /** Builds a single matcher-group entry in the correct settings.json format:
   *  { matcher, hooks: [{ type: 'command', command, timeout?, statusMessage? }] }
   *  includeStatusMessage=true only for the 'startup' matcher
   */

export function mergeHooks(
  existing: Record<string, unknown>,
  hookCommand: string,
): Record<string, unknown>
  /** Deep-merges 4 SessionStart entries into existing settings.
   *
   *  Dedup strategy: scan ALL existing SessionStart entries' nested command strings
   *  for the substring from hookCommand. If found anywhere, return existing unchanged.
   *
   *  If not present: append 4 entries (startup, resume, clear, compact).
   *  Returns a new settings object (does not mutate the input).
   */

export function writeSettings(settingsPath: string, settings: Record<string, unknown>): void
  /** Writes settings back to disk with 2-space indentation via JSON.stringify */

async function main(): Promise<void>
  /** Orchestrates the install:
   *  1. Resolve scriptPath from __dirname
   *  2. Read existing settings
   *  3. Merge hooks
   *  4. Write settings
   *  5. Print confirmation message to stdout
   */
```

### The 4 Matchers

Register exactly these 4 `matcher` values, one entry per:
- `"startup"` — fires when a new session opens; this entry gets the `statusMessage`
- `"resume"` — fires when a session is resumed
- `"clear"` — fires when the conversation is cleared
- `"compact"` — fires when the conversation is compacted

### Hook entry format

Each entry in the `SessionStart` array must look like:

```json
{
  "matcher": "startup",
  "hooks": [
    {
      "type": "command",
      "command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\"",
      "timeout": 10,
      "statusMessage": "Loading DevNeural context..."
    }
  ]
}
```

For non-startup matchers, omit `statusMessage`. The `timeout` value is 10 (seconds) for all entries — this is intentionally larger than the 5-second API timeout because it covers startup overhead in addition to the HTTP call.

### Script path resolution

The installed command path is derived from `__dirname` at runtime:

```typescript
import path from 'node:path';
const scriptPath = path.resolve(__dirname, '..', 'dist', 'session-start.js');
```

On Windows, convert backslashes to forward slashes in the command string before writing, since Claude Code's settings.json uses forward-slash paths even on Windows. Use `.split(path.sep).join('/')` or `path.normalize(...).replace(/\\/g, '/')`.

The full command string written to settings.json:
```
node "C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js"
```

Quote the path with double-quotes to handle spaces in directory names.

### Deduplication logic

Before appending entries, scan all existing `SessionStart` entries by extracting every command string found in nested `hooks` arrays:

```typescript
const existingCommands = (existingSessionStart ?? [])
  .flatMap((entry: any) => entry.hooks ?? [])
  .map((h: any) => h.command ?? '');

const alreadyInstalled = existingCommands.some(cmd => cmd.includes('session-start.js'));
```

If `alreadyInstalled` is true, return the existing settings unchanged. This handles both:
- Entries that have a `matcher` field (normal re-install case)
- Entries that lack a `matcher` field (manually added or from other tools)

### Success output

After a successful install, print to stdout:

```
DevNeural SessionStart hook installed.
Script: C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js
Registered in: C:/Users/<user>/.claude/settings.json

Matchers: startup, resume, clear, compact

Note: Run 'npm run build' first to compile the hook script.
      The hook is bound to the path above — moving the DevNeural repo will break it.
Open a new Claude Code session to verify the hook fires.
```

If already installed (idempotent path), print:

```
DevNeural hook already registered in settings.json — no changes made.
```

### Error handling

Wrap the entire `main()` in a `.catch()` that prints the error message to `process.stderr` and exits with code 1 (unlike the session hook itself, an install failure should be visible):

```typescript
main().catch((err) => {
  process.stderr.write(`install-hook error: ${err.message}\n`);
  process.exit(1);
});
```

---

## Integration with `package.json`

The `install-hook` script in `package.json` (established in section-01-setup) invokes this file:

```json
"install-hook": "tsx src/install-hook.ts"
```

This uses `tsx` for direct TypeScript execution, so no prior `npm run build` is needed to run the installer itself.

---

## Important Notes

- **Do not use `path.join` for the JSON command string** — `path.join` uses OS separator. Build the command string with explicit forward slashes.
- **Export `mergeHooks` and other helpers** so the test file can import and unit-test them without triggering filesystem I/O.
- **`main()` is not exported** — it runs directly at the bottom of the file via the `.catch()` wrapper.
- **The installer reads the real `settings.json` path (via `getSettingsPath`)** — tests must not call `main()` directly; they test `mergeHooks` with constructed objects.
- **Moving the DevNeural repo breaks the hook** — the install output explicitly tells the user this. The absolute path is baked in at install time.
- **No `rootDir` in tsconfig** means `__dirname` in the compiled output will reflect the full relative path structure — verify with a test run that the resolved script path is correct.

---

## Implementation Status

**Files created:**
- `src/install-hook.ts` — 102 lines; exports `getSettingsPath`, `readSettings`, `buildHookEntry`, `mergeHooks`, `writeSettings`
- `tests/install-hook.test.ts` — 8 tests covering all spec stubs plus `buildHookEntry`

**Deviations from plan:**
- `buildHookEntry` takes `command: string` (the full pre-formed command string) instead of `scriptPath: string`. Callers construct `node "path"` before calling, keeping the function composable.
- `readSettings` rethrows non-ENOENT errors (EPERM, etc.) rather than swallowing all errors.
- `writeSettings` uses atomic write (`.tmp` → `rename`) to protect against process-kill corruption.

**All 42 tests pass.**
