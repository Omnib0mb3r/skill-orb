# 04-session-intelligence — Consolidated Specification

## What We're Building

A Claude Code **SessionStart hook** that fires automatically when any Claude Code session opens. The hook queries the DevNeural API for nodes connected to the current project, ranks them by connection weight, and injects a compact context summary into Claude's session via plain stdout.

This prevents duplicate work and surfaces cross-project patterns by reminding Claude what skills and related projects have been heavily used with this codebase.

---

## Inputs & Outputs

### Input: Hook Payload (stdin)

```json
{
  "session_id": "abc123",
  "cwd": "/path/to/current/project",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "transcript_path": "...",
  "model": "claude-sonnet-4-6"
}
```

The `cwd` field is the primary signal for project identification.

### Output: Plain stdout

Claude receives the output as visible context (system-reminder style). Example:

```
DevNeural Context for github.com/user/devneural:

  Skills (top connections):
    • deep-plan (9.2/10) — 92 uses, last used 2 days ago
    • gsd:execute-phase (8.1/10) — 81 uses, last used today
    • gsd:plan-phase (7.5/10) — 75 uses

  Related Projects:
    • github.com/user/skill-connections (7.3/10) — last connected 3 days ago
    • github.com/user/another-repo (4.2/10) — last connected 1 week ago
```

If API is offline:
```
DevNeural: API offline — no connection context available.
Start server: cd C:/dev/tools/DevNeural && npm run dev:api
```

---

## Requirements

### Hook Registration

- Registered in `~/.claude/settings.json` (global — applies to all projects)
- Must fire on **all 4 matchers**: `startup`, `resume`, `clear`, `compact`
  - Reason: known Claude Code bug (issue #10373) where `startup` silently fails to inject context on brand-new sessions. `clear` and `compact` matchers work reliably.
- Hook type: `"command"` (the only type supported for SessionStart)
- Timeout: 10 seconds (leaves 5s margin beyond the API timeout)

### Project Identification

Reuses `resolveProjectIdentity(cwd)` from `01-data-layer`:
1. `git remote get-url origin` → normalized as `github.com/user/repo`
2. Git root path (lowercased, forward slashes)
3. `cwd` (lowercased, forward slashes)

The resolved project ID (e.g., `github.com/user/repo`) is passed to the API as `?project=github.com/user/repo`.

### API Query

```
GET http://localhost:3747/graph/subgraph?project=<projectId>
```

- Timeout: 5 seconds
- If connection refused / timeout: output offline message and exit 0
- Port configurable via `DEVNEURAL_PORT` env var (default: 3747)

### Result Filtering & Ranking

1. Filter edges to only `project->skill` and `project->project` connection types
2. Filter out edges where `weight < 1.0`
3. Sort by `weight` descending
4. Limit to top 10 per type (skills and related projects separately)
5. Ranking algorithm: weight-only (recency display only, not used for ranking)

### Output Format

- Plain stdout (not JSON `additionalContext`)
- Compact and readable — designed to be useful context without overwhelming Claude
- Show weight as `(X.X/10)` and a human-readable "last used" relative time from `last_seen`
- Separate sections for Skills and Related Projects
- If no results above threshold: `DevNeural: No significant connections found for this project yet.`

### Error Handling

- **Always exit 0** — never block or crash the session
- **API offline**: short notice with start command
- **Identity resolution failure**: fall back to directory name, still attempt API query
- **Parse errors / unexpected response**: silent exit 0 (no output noise)
- **No matching project in graph**: output "No significant connections" message

---

## Architecture

### Module Structure

```
04-session-intelligence/
├── src/
│   ├── session-start.ts       # Main entry point (reads stdin, orchestrates)
│   ├── identity.ts            # Re-exports from 01-data-layer identity module
│   ├── api-client.ts          # HTTP client for /graph/subgraph with timeout
│   ├── formatter.ts           # Formats GraphResponse into stdout text
│   └── install-hook.ts        # Install script: patches ~/.claude/settings.json
├── tests/
│   ├── session-start.test.ts  # Integration tests (spawnSync pattern)
│   ├── formatter.test.ts      # Unit tests for formatter
│   └── helpers.ts             # Temp dir helpers (shared pattern)
├── package.json
├── tsconfig.json              # CJS output (matches 01-data-layer pattern)
└── spec.md                    # This spec
```

### Dependency on 01-data-layer

The hook imports `resolveProjectIdentity` and related types directly from `01-data-layer`:

```typescript
import { resolveProjectIdentity } from '../01-data-layer/src/identity/index.js';
```

Or via package.json workspace reference if the repo uses workspaces. This ensures identity normalization is identical to what the PostToolUse hook uses — the same project key is used for both logging and querying.

### Hook Script (compiled)

The hook is compiled from TypeScript via `tsc`:
- Source: `src/session-start.ts`
- Output: `dist/session-start.js`
- Registered in settings.json as: `node "C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js"`

### Install Script

`npm run install-hook` runs `src/install-hook.ts` which:
1. Reads `~/.claude/settings.json` (or creates it if missing)
2. Merges the required SessionStart hook entries (all 4 matchers)
3. Writes back safely (preserves all existing config)
4. Outputs confirmation with the registered command

This is idempotent — safe to run multiple times.

---

## Settings.json Hook Config

The install script registers:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{"type": "command", "command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10, "statusMessage": "Loading DevNeural context..."}]
      },
      {
        "matcher": "resume",
        "hooks": [{"type": "command", "command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10}]
      },
      {
        "matcher": "clear",
        "hooks": [{"type": "command", "command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10}]
      },
      {
        "matcher": "compact",
        "hooks": [{"type": "command", "command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10}]
      }
    ]
  }
}
```

---

## Testing Strategy

### Integration Tests (primary)

Matching the pattern from 01-data-layer:
- Use `spawnSync` to spawn `node dist/session-start.js` with a JSON payload on stdin
- Test cases:
  - Known project with connections → correct formatted output
  - Unknown project → "No significant connections" message
  - API offline → offline message with start command
  - No git context → falls back to cwd, still attempts API
  - API slow (>5s) → offline message (use a test server that delays)

### Unit Tests (formatter)

- `formatter.ts` receives a `GraphResponse` and returns a string
- Test various edge cases: empty graph, single skill, max 10 results, weight filtering

### Test Infrastructure

- Mock API server using a minimal Fastify instance (started in test setup)
- Configurable via `DEVNEURAL_PORT` env var pointing tests at test server
- Temp directory helpers from existing `01-data-layer` pattern

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Output mechanism | Plain stdout | Avoids `additionalContext` plugin bug; simpler; visible |
| Node types | Skills + projects only | Tools are low-signal (every project uses Bash/Edit) |
| Result limits | Top 10 per type, weight ≥ 1.0 | Loose: surface all meaningful connections |
| Matchers | All 4 (startup/resume/clear/compact) | Workaround for known startup injection bug |
| API timeout | 5 seconds | Generous for cold-starting server, not too slow for UX |
| Identity code | Import from 01-data-layer | Single source of truth, DRY |
| Script type | Compiled TypeScript (node dist/) | Aligns with codebase; fast startup; type safety |
| Ranking | Weight-only | Simplest correct approach; recency as display-only |
| Installation | `npm run install-hook` | Part of broader DevNeural PC setup workflow |

---

## Out of Scope

- The `devneural.json` version check / upgrade prompt (future feature, noted in interview)
- `DevNeural.md` per-project gospel document (separate initiative)
- Broader DevNeural PC setup script (this split provides its piece)
- Voice or web UI for the context output
- Real-time WebSocket updates in the hook
