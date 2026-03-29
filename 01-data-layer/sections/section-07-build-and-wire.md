# Section 07: Build and Wire

## Overview

This is the final section. All modules are implemented and tested. This section covers:

1. Compiling the TypeScript source to CommonJS JavaScript
2. Verifying the compiled output works correctly
3. Registering the hook in `~/.claude/settings.json`

**Depends on:** section-06-hook-runner (all modules implemented and passing tests)

**No automated tests** — verification in this section is manual and build-time only.

---

## Prerequisites

Before starting this section, confirm:

- `npm test` passes all tests (should be green from sections 01–06)
- All source files exist under `src/`:
  - `src/hook-runner.ts`
  - `src/config/index.ts`
  - `src/identity/index.ts`
  - `src/logger/index.ts`, `src/logger/types.ts`
  - `src/weights/index.ts`, `src/weights/types.ts`

---

## Step 1: Build

Run the build from the `01-data-layer/` directory:

```
npm run build
```

The `build` script runs `tsc`. It compiles all TypeScript under `src/` to JavaScript in `dist/` using the settings in `tsconfig.json`:

- `"module": "CommonJS"` — output uses `require()`/`module.exports`, not ESM `import`/`export`
- `"target": "ES2022"` — modern JS features available
- `"strict": true` — full strict mode; zero type errors expected

### Verify the build output

After `npm run build` completes without errors:

1. Confirm `dist/hook-runner.js` exists
2. Open it and verify it is CommonJS — it should contain `require(` calls and no top-level `import` or `export` statements
3. Check that `dist/` contains subdirectory mirrors of `src/`: `dist/config/`, `dist/identity/`, `dist/logger/`, `dist/weights/`

---

## Step 2: Smoke Test via stdin

The hook runner reads its payload from stdin. Test it manually by piping JSON directly.

### Test A: valid Bash payload (should write log + update weights)

Construct a minimal valid PostToolUse payload. The fields required by the hook runner are:

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "test-session-001",
  "cwd": "C:/dev/tools/DevNeural",
  "tool_name": "Bash",
  "tool_input": { "command": "echo hello" },
  "tool_response": "",
  "tool_use_id": "toolu_smoke_test_001",
  "transcript_path": "",
  "permission_mode": "default"
}
```

Run it:

```bash
echo '{"hook_event_name":"PostToolUse","session_id":"test-session-001","cwd":"C:/dev/tools/DevNeural","tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":"","tool_use_id":"toolu_smoke_001","transcript_path":"","permission_mode":"default"}' | node dist/hook-runner.js
```

Expected outcome:
- Process exits with code 0
- A file `C:/dev/data/skill-connections/logs/<today>.jsonl` is created (or appended to)
- The last line of that file is valid JSON containing `"tool_name":"Bash"` and `"connection_type":"project\u2192tool"`
- `C:/dev/data/skill-connections/weights.json` exists and contains a connection with `"source_node":"project:..."` and `"target_node":"tool:Bash"`

### Test B: tool not in allowlist (should exit silently with no writes)

```bash
echo '{"hook_event_name":"PostToolUse","session_id":"test-session-002","cwd":"C:/dev/tools/DevNeural","tool_name":"Read","tool_input":{"file_path":"/tmp/foo"},"tool_response":"","tool_use_id":"toolu_smoke_002","transcript_path":"","permission_mode":"default"}' | node dist/hook-runner.js
```

Expected outcome:
- Process exits with code 0
- No new log entry written (verify by checking the JSONL file timestamp or line count)
- `weights.json` is unchanged (no `tool:Read` connection added)

### Test C: empty stdin (should exit silently)

```bash
echo '' | node dist/hook-runner.js
```

Expected outcome: exits 0, no output, no files written.

### Test D: malformed JSON (should exit silently)

```bash
echo 'not json' | node dist/hook-runner.js
```

Expected outcome: exits 0, may write an error line to stderr beginning with `[DevNeural]`, no files written.

---

## Step 3: Register the Hook

The hook is registered in `~/.claude/settings.json`. This file controls Claude Code's global behavior across all sessions on the machine.

**This step is manual.** Do not automate overwriting `settings.json` — it may contain other hooks you want to preserve.

### Find the absolute path to the compiled hook

The hook command must use an absolute path because it runs from arbitrary working directories. Determine the absolute path to `dist/hook-runner.js`:

```
C:\dev\tools\DevNeural\01-data-layer\dist\hook-runner.js
```

(Adjust if you cloned the repo to a different location.)

### Edit `~/.claude/settings.json`

Open `C:\Users\mcollins\.claude\settings.json` (or wherever your Claude Code settings live).

Add the following under the top-level `"hooks"` key. If the `"hooks"` key does not exist yet, create it. If `"PostToolUse"` already has entries, append to the `"hooks"` array inside it rather than replacing existing entries.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node C:/dev/tools/DevNeural/01-data-layer/dist/hook-runner.js"
          }
        ]
      }
    ]
  }
}
```

Key details:

- `"matcher": ""` — matches every tool invocation. The allowlist filtering happens inside the script, not here.
- `"type": "command"` — Claude Code passes the event payload as JSON on stdin and expects exit code 0.
- Use forward slashes in the path even on Windows — Node.js and Claude Code both accept them.

### Verify the hook is active

Start a new Claude Code session (the hook config is read at session startup, not hot-reloaded). Run any Bash or Edit command. Then confirm:

1. `C:/dev/data/skill-connections/logs/<today>.jsonl` has a new entry
2. `C:/dev/data/skill-connections/weights.json` has been updated

---

## Build Checklist

Work through this list top to bottom before considering this section complete:

- [ ] `npm test` passes (all modules green)
- [ ] `npm run build` completes without TypeScript errors
- [ ] `dist/hook-runner.js` exists
- [ ] `dist/hook-runner.js` contains `require(` (CommonJS confirmed)
- [ ] Smoke test A passes: Bash payload → JSONL entry + weights entry created
- [ ] Smoke test B passes: Read payload → no files written
- [ ] Smoke test C passes: empty stdin → exits 0
- [ ] Smoke test D passes: malformed JSON → exits 0
- [ ] `~/.claude/settings.json` updated with PostToolUse hook entry
- [ ] New Claude Code session started after settings update
- [ ] Live hook verified: real tool call produces JSONL + weights entries

---

## Troubleshooting

**`tsc` reports module resolution errors for `write-file-atomic` or `proper-lockfile`:**

These packages may not ship their own TypeScript declarations. If `@types/write-file-atomic` or `@types/proper-lockfile` are not installed, add them as devDependencies. Alternatively, add a `declare module 'write-file-atomic'` stub in `src/types.d.ts` with the minimum signatures you use.

**`dist/hook-runner.js` contains `import`/`export` (ESM output):**

Check `tsconfig.json` — `"module"` must be `"CommonJS"` (exact case). A value of `"ESNext"` or `"NodeNext"` will produce ESM output that cannot be run with a bare `node` command.

**Smoke test exits 0 but nothing is written to JSONL:**

1. Check that `tool_name` is in the allowlist (`Bash` is in the default list)
2. Check stderr output — the hook logs errors to stderr with `[DevNeural]` prefix
3. Check that `C:/dev/data/skill-connections/` is writable (create it manually if needed, or let the first write create it)

**Hook fires but `weights.json` grows but JSONL does not (or vice versa):**

The log append and weight update run in parallel via `Promise.all`. If one fails silently, check stderr in the Claude Code output panel. Both writes are independent — a failure in one does not affect the other.

**Settings.json already has a PostToolUse block:**

Do not replace the existing block. Append a new object to the `"hooks"` array inside the existing `PostToolUse` entry. Multiple hook commands can run for the same event.

**Hook is not firing at all after settings update:**

Claude Code reads `settings.json` at session startup. Fully restart the session (close and reopen, or run `/reset`). Confirm the JSON in `settings.json` is valid — a syntax error anywhere in the file will silently disable all hooks.
