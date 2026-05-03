# Research Findings: 04-session-intelligence SessionStart Hook

---

## 1. Claude Code SessionStart Hook Mechanics

### When It Fires

`SessionStart` fires at the beginning of every Claude Code session. The `matcher` field controls exactly when:

| Matcher | Trigger |
|---|---|
| `startup` | Brand-new session |
| `resume` | `--resume`, `--continue`, or `/resume` |
| `clear` | `/clear` command |
| `compact` | Auto or manual context compaction |

Only `"type": "command"` hooks are supported for `SessionStart`.

### JSON Input Payload (stdin)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/you/myproject",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6",
  "agent_type": "optional-agent-name"
}
```

Key fields:
- `cwd` — primary project identification signal (working directory where Claude was launched)
- `source` — mirrors the matcher: `"startup"`, `"resume"`, `"clear"`, or `"compact"`
- `transcript_path` — path to session transcript JSONL (for reading prior context)
- `model` — active Claude model

### How Context Gets Injected

Two mechanisms:

**1. Plain stdout (simplest, recommended):** Any non-JSON text written to stdout is added directly to Claude's context.

```bash
echo "Project: my-app | Branch: main"
exit 0
```

**2. JSON `additionalContext` (structured, more discrete):**

```bash
jq -n --arg ctx "$(cat context.md)" \
  '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": $ctx}}'
exit 0
```

The `additionalContext` is injected into Claude's context but doesn't appear as a visible message. Multiple hooks' values concatenate.

### Exit Code Behavior

| Exit Code | Behavior |
|---|---|
| `0` | Success — stdout added to context, JSON output processed |
| `2` | Blocking error — stderr fed to Claude as feedback |
| Other | Non-blocking — stderr logged but not shown to Claude |

### Environment Variable Persistence

Hooks can write to `CLAUDE_ENV_FILE` to set env vars that persist across all Bash commands in the session:

```bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export DEVNEURAL_SESSION_PROJECT=my-app" >> "$CLAUDE_ENV_FILE"
fi
```

---

## 2. Known Bugs (Active as of March 2026)

**CRITICAL: `startup` source silently fails for brand-new sessions.**
Issue [anthropics/claude-code#10373](https://github.com/anthropics/claude-code/issues/10373) — `SessionStart` with `source: "startup"` executes the hook but the output is never injected into Claude's context for new interactive sessions. The hook runs but Claude never receives the context.

**Workaround:** Add multiple matchers — `startup`, `clear`, and `compact`. The `clear` and `compact` paths work correctly. For new sessions, the user can run `/clear` to trigger proper injection, or we accept that the context appears after first `/clear`.

**Plugin hooks don't surface `additionalContext`.**
Issue [anthropics/claude-code#16538](https://github.com/anthropics/claude-code/issues/16538) — when a SessionStart hook is defined inside a plugin's `hooks.json`, `additionalContext` is silently dropped.
**Workaround:** Define the hook directly in `~/.claude/settings.json`.

**Shell scripts may lack execute permission (644 instead of 755).**
Issue [anthropics/claude-code#38705](https://github.com/anthropics/claude-code/issues/38705) — causes exit code 126.
**Fix:** Always `chmod +x` hook scripts.

---

## 3. settings.json Global Hook Configuration

### File Location for Global Hooks

`~/.claude/settings.json` — applies to every project. Settings are **merged**, not overwritten (project-level adds to global, doesn't replace).

### Exact JSON Schema

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/session-start-hook.js\"",
            "timeout": 10,
            "statusMessage": "Loading DevNeural context..."
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/session-start-hook.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Hook handler fields:**
| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | `"command"` | Only type supported |
| `command` | yes | string | Shell command to execute |
| `timeout` | no | number (seconds) | Keep low for SessionStart (suggest 10) |
| `statusMessage` | no | string | Custom spinner text |
| `async` | no | boolean | Background fire-and-forget (won't inject context) |
| `shell` | no | `"bash"` or `"powershell"` | Default `"bash"` |

**Important:** `async: true` hooks cannot inject context — they run in background after the session opens.

---

## 4. TypeScript vs Shell for Hook Scripts

### Recommendation: Node.js Script

Given the DevNeural codebase uses TypeScript/Node.js, a Node.js script (compiled from TypeScript with `tsc`) is the right choice:

| Factor | Shell | Node.js (compiled) | TypeScript via tsx |
|---|---|---|---|
| Startup time | ~5ms | ~30-80ms | ~200-500ms |
| Portability | Highest | Node required | tsx required |
| Type safety | None | Full | Full |
| JSON parsing | Requires `jq` | Native | Native |
| API calls (fetch/http) | Requires `curl` | Native | Native |
| Codebase consistency | No | **Yes** (matches existing modules) | Yes |

**tsx is too slow for SessionStart** (critical path). A compiled Node.js script (`node dist/session-start.js`) has ~30-80ms startup, acceptable for SessionStart.

**Alternative:** Could be a shell script using `curl` for the API call — but Node.js aligns with the existing TypeScript codebase and avoids `jq`/`curl` dependencies.

**Performance target:** SessionStart hook should complete in **< 500ms total** (API query + formatting + output). The deferred execution (v2.1.72+) means it doesn't block session startup, but users see a spinner — keep it fast.

---

## 5. Git-Based Project Identification

### Existing Implementation in DevNeural (01-data-layer)

The data layer already has a battle-tested implementation:

```typescript
// 01-data-layer/src/identity/index.ts
export async function resolveProjectIdentity(cwd: string): Promise<ProjectIdentity>
export function normalizeGitUrl(url: string): string
export function normalizePath(p: string): string
```

**Priority cascade:**
1. **git-remote** — `git remote get-url origin` → normalized as `github.com/user/repo`
2. **git-root** — path to `.git` directory (lowercased, forward slashes)
3. **cwd** — current working directory (lowercased, forward slashes)

**Normalization:**
- SSH: `git@github.com:user/repo.git` → `github.com/user/repo`
- HTTPS: `https://github.com/user/repo.git` → `github.com/user/repo`
- Paths: lowercase + forward slashes for cross-platform consistency

The 04-session-intelligence hook **should import and reuse** this existing identity resolution rather than reimplementing it.

### How Projects Are Keyed in weights.json

Node IDs use a `type:identifier` prefix format:
- Projects: `project:github.com/user/repo`
- Tools: `tool:Bash`
- Skills: `skill:deep-plan`

The `/graph/subgraph?project=<projectId>` endpoint accepts the normalized project ID (without the `project:` prefix), e.g., `?project=github.com/user/repo`.

---

## 6. DevNeural Codebase Patterns (Relevant to 04-session-intelligence)

### Existing API Endpoint

```
GET /graph/subgraph?project=<projectId>

Response: {
  nodes: GraphNode[],  // Reachable nodes (tools, skills, other projects)
  edges: GraphEdge[],  // Connections with weights
  updated_at: string   // ISO 8601 UTC
}
```

Nodes have `type: "project" | "tool" | "skill"` and edges have `weight: number` in [0.0, 10.0] scale.

### TypeScript/Node.js Conventions

- **Module format:** CJS for scripts (like hook-runner) — use `"module": "CommonJS"` in tsconfig
- **Build:** `tsc` directly (no bundler)
- **Runtime:** `node dist/session-start.js` for production hook
- **Dev:** `tsx src/session-start.ts` during development
- **Target:** ES2022, strict mode enabled

### Testing Setup

- **Framework:** Vitest
- **Pattern:** Integration tests spawn the actual process via `spawnSync`
- **Test utilities:** Temp directory helpers in `test/helpers.ts` (createTempDir/removeTempDir)
- **Test location:** `tests/` directory at module root
- **Run:** `vitest run` (single pass) or `vitest` (watch)

### Hook-Runner Pattern (PostToolUse reference implementation)

`01-data-layer/src/hook-runner.ts` is the reference:
- Reads JSON from **stdin** (`process.stdin`)
- Parses and validates payload
- Calls async logic wrapped in try/catch
- **Always exits with code 0** (silent failures)
- Errors go to `process.stderr` only

### Error Handling Convention

```typescript
try {
  // main logic
} catch (error) {
  // Never throw — just log to stderr
  process.stderr.write(`[devneural] session-start error: ${error}\n`);
  process.exit(0);  // Always exit 0
}
```

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DEVNEURAL_DATA_ROOT` | `C:/dev/data/skill-connections` | Shared data directory |
| `PORT` | `3747` | API server port |
| `DEVNEURAL_API_URL` | `http://localhost:3747` | Should be derived from PORT |

---

## 7. Context Formatting Strategy

### Signal-to-Noise Tradeoff

From the spec's key unknowns: "How much context to surface — too much is noise, too little misses the point."

**Recommendation based on research:**

The official docs suggest: "For injecting context on every session start, consider using CLAUDE.md instead." SessionStart hooks are best for **dynamic** context that changes session-to-session.

For DevNeural, the right approach is a **compact ranked list** — not a full graph dump:

```
DevNeural Context:
  Project: github.com/user/devneural (weight connections: 47)

  Top Skills Used:
    • deep-plan (9.2/10) — 92 uses
    • gsd:execute-phase (8.1/10) — 81 uses

  Top Tools Used:
    • Bash (10.0/10) — frequent
    • Edit (9.5/10) — frequent

  Connected Projects:
    • github.com/user/skill-connections (7.3/10)
```

**Suggested limits:**
- Max 5 skills
- Max 5 tools
- Max 3 related projects
- Minimum weight threshold: 3.0/10 (noise filter)

### Graceful Fallback When API Offline

```
DevNeural: API server not running (http://localhost:3747)
Start with: cd C:/dev/tools/DevNeural && npm run dev:api
```

Output this and exit 0. Never block the session.

---

## 8. Ranking Algorithm

### Simple Weight-Only Ranking

Sort by `edge.weight` descending (already in [0.0, 10.0] scale). This is the simplest approach and directly reflects connection strength.

### Optional: Recency-Weighted Ranking

```
score = weight * recency_factor
recency_factor = 1.0 if last_seen within 7 days
               = 0.8 if within 30 days
               = 0.5 if within 90 days
               = 0.3 if older
```

This surfaces recently-used connections more prominently. The `last_seen` field is available on every edge.

**Recommendation:** Start with weight-only; recency can be added later as a configuration option.

---

## 9. Architecture Decision: Where to Run Logic

### Option A: Hook calls compiled Node.js binary

```json
"command": "node \"C:/dev/tools/DevNeural/04-session-intelligence/dist/session-start.js\""
```

Pros: Full TypeScript, reuse identity module, fast (compiled)
Cons: Requires running `tsc` build before the hook works; path must be absolute

### Option B: Hook is a shell script that calls the API

```bash
#!/bin/bash
CWD=$(echo "$INPUT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.cwd)")
PROJECT=$(git -C "$CWD" config --get remote.origin.url | sed ...)
curl -s "http://localhost:3747/graph/subgraph?project=$PROJECT" | node -e "..."
```

Pros: No build step, simple to maintain
Cons: Harder to maintain, less type safety, more brittle parsing

### Recommendation: Option A (compiled TypeScript)

The DevNeural codebase is TypeScript-first. The hook should be a TypeScript module that:
1. Compiles to `dist/session-start.js` via `tsc`
2. Is registered in settings.json as `node "...dist/session-start.js"`
3. Imports the identity resolver from 01-data-layer (or copies the pure functions)

The 01-data-layer has an export-ready structure — the identity module can be imported directly.

---

## 10. Testing Approach

Following the codebase pattern (Vitest + spawnSync integration tests):

```typescript
// tests/session-start.test.ts
import { spawnSync } from 'child_process';

describe('session-start hook', () => {
  it('outputs context for a known project', () => {
    const payload = JSON.stringify({
      session_id: 'test-123',
      cwd: '/path/to/test-project',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });

    const result = spawnSync('node', ['dist/session-start.js'], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, DEVNEURAL_API_URL: 'http://localhost:3747' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DevNeural Context');
  });

  it('exits 0 gracefully when API is offline', () => {
    // ... test fallback behavior
  });
});
```

Tests should mock the API response using Vitest's mock server or a test helper that starts a minimal Fastify instance.
