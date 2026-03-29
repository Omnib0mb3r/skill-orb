# Claude Spec: 01-data-layer

*Synthesized from: spec.md + research findings + interview*
*Date: 2026-03-28*

---

## What We're Building

A TypeScript/Node.js **connection logger** — the MVP foundation of DevNeural. It intercepts Claude Code hook events and maintains a persistent weighted dependency graph in a shared data directory (`C:\dev\data\skill-connections\`) accessible to all projects on the machine.

This is a **standalone module** that must work before anything else in DevNeural is built. It has zero runtime dependencies on other DevNeural splits.

---

## Connection Model

The logger tracks directed weighted edges between entities of the following types: `project`, `tool`, `skill`.

### Edge Types

| Edge Type | Meaning | Example |
|---|---|---|
| `project→tool` | A tool was invoked within a project | DevNeural used Bash |
| `project→skill` | A skill was invoked within a project | DevNeural used deep-plan |
| `skill→tool` | A tool was invoked by a skill (via Agent) | deep-plan called Bash |
| `project→project` | Two projects are related (future, via manual) | DevNeural ↔ skill-connections |

**Node ID formats:**
- `project:<canonical-id>` — e.g., `project:github.com/user/DevNeural` or `project:c:/dev/tools/devneural`
- `tool:<tool-name>` — e.g., `tool:Bash`, `tool:Write`, `tool:Agent`
- `skill:<skill-name>` — e.g., `skill:deep-plan`, `skill:gsd:execute-phase`

**Entity normalization:**
- Project IDs are derived via cascade: git remote URL (normalized) → git root path → CWD
- Tool names come directly from the hook payload `tool_name` field
- Skill names are extracted from Agent tool calls (PostToolUse where `tool_name == "Agent"`)

---

## Hook Integration

### Primary Hook: PostToolUse

Configured in `~/.claude/settings.json` (global, applies to all projects):

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

The hook receives a JSON payload on stdin with:
- `session_id` — Claude session identifier
- `cwd` — working directory at time of tool use
- `tool_name` — name of the tool invoked
- `tool_input` — arguments passed to the tool (varies by tool type)
- `tool_response` — result from the tool
- `tool_use_id` — unique ID for this tool use event

### Tool Allowlist

The logger only processes tools in a configurable allowlist. Default: `["Bash", "Write", "Edit", "Agent"]`. Read-only tools (Read, Glob, Grep, WebSearch, WebFetch) are excluded by default to avoid noise.

Config location: `C:\dev\data\skill-connections\config.json`

```json
{
  "allowlist": ["Bash", "Write", "Edit", "Agent"]
}
```

### Skill Detection via Agent Tool

When `tool_name == "Agent"`, the hook attempts to extract the skill name from `tool_input`:
- Check `tool_input.description` for skill name patterns
- Check `tool_input.subagent_type` for known skill subagent types
- Fall back to `"unknown-skill"` if not determinable

For an Agent call, the logger records:
1. A `project→skill` edge
2. A `skill→tool` edge is not inferrable from PostToolUse alone (the agent's internal tool calls are separate events if SubagentStop is hooked). For MVP, only `project→skill` is recorded from Agent calls.

---

## Data Outputs

### 1. JSONL Log Files

**Location:** `C:\dev\data\skill-connections\logs\YYYY-MM-DD.jsonl`
**Format:** One JSON object per line (no pretty-printing), `\n` terminated
**Rotation:** One file per calendar day. No deletion (keep forever).
**Concurrency:** Each hook invocation is a separate short-lived Node.js process. `fs.appendFile` with `O_APPEND` flag provides sufficient atomicity for small writes (< 4KB) on Linux; acceptable on Windows for this use case.

**Log entry schema (v1):**
```json
{
  "schema_version": 1,
  "timestamp": "2026-03-28T10:22:00.123Z",
  "session_id": "abc123",
  "project": "github.com/user/DevNeural",
  "project_source": "git-remote",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "connection_type": "project→tool",
  "source_node": "project:github.com/user/DevNeural",
  "target_node": "tool:Bash"
}
```

Fields:
- `schema_version` — integer, starts at 1
- `timestamp` — ISO 8601 UTC
- `session_id` — from hook payload
- `project` — canonical project identifier (string)
- `project_source` — one of `"git-remote"`, `"git-root"`, `"cwd"`
- `tool_name` — raw tool name from hook payload
- `tool_input` — raw tool input object from hook payload
- `connection_type` — one of `"project→tool"`, `"project→skill"`, `"skill→tool"`
- `source_node` — prefixed node ID (e.g., `"project:github.com/user/repo"`)
- `target_node` — prefixed node ID (e.g., `"tool:Bash"`)

### 2. Weights File

**Location:** `C:\dev\data\skill-connections\weights.json`
**Format:** JSON, pretty-printed (2-space indent) for readability
**Writes:** Atomic (write to `.tmp` file, then `fs.rename`)

**Schema (v1):**
```json
{
  "schema_version": 1,
  "updated_at": "2026-03-28T10:22:00.123Z",
  "connections": {
    "project:github.com/user/DevNeural||tool:Bash": {
      "source_node": "project:github.com/user/DevNeural",
      "target_node": "tool:Bash",
      "connection_type": "project→tool",
      "raw_count": 23,
      "weight": 2.3,
      "first_seen": "2026-01-10T00:00:00Z",
      "last_seen": "2026-03-28T10:22:00Z"
    }
  }
}
```

**Weight calculation:** `weight = min(raw_count, 100) / 100 * 10`
- Raw count increments by 1 on each logged event for that connection
- Weight is capped at 10.0 (achieved at 100 interactions)
- Weight is recalculated and stored on every update

**Connection key:** `"<source_node>||<target_node>"` — double-pipe delimiter, both sides fully qualified.

---

## Project Identity Resolution

Given `cwd` from the hook payload, derive a canonical project ID:

1. Walk up from `cwd` using `find-up` to locate the nearest `.git` directory → `gitRoot`
2. If `gitRoot` found: run `git -C <gitRoot> remote get-url origin`
   - If remote URL exists: normalize to `host/owner/repo` form (strip `.git`, normalize SSH→HTTPS-style)
   - Use normalized remote URL as project ID, `project_source = "git-remote"`
3. If no remote: use normalized `gitRoot` path as project ID, `project_source = "git-root"`
4. If no `.git` at all: use normalized `cwd` as project ID, `project_source = "cwd"`

Path normalization: forward slashes, lowercase drive letter (`C:\dev` → `c:/dev`).

---

## Error Handling

- **Silent fail always:** Any unhandled error causes the script to exit 0. Never exit 2 (blocking).
- Log errors to stderr for debugging: `console.error('[DevNeural]', error.message)`
- If `weights.json` is corrupt (parse fails): overwrite with empty graph and continue
- If log directory doesn't exist: create it (recursive `mkdir`)
- If tool not in allowlist: exit 0 immediately (no-op, no stderr)
- If project identity resolution fails at all steps: use raw `cwd` as fallback (never skip logging)

---

## Module Structure

```
01-data-layer/
├── src/
│   ├── hook-runner.ts        # Entry point: reads stdin, calls logger, exits
│   ├── logger/
│   │   ├── index.ts          # LogEntry interface, appendLogEntry()
│   │   └── types.ts          # LogEntry, WeightsFile, ConnectionKey types
│   ├── weights/
│   │   ├── index.ts          # loadWeights(), updateWeight(), saveWeights()
│   │   └── types.ts          # WeightsFile, ConnectionRecord types
│   ├── identity/
│   │   └── index.ts          # resolveProjectIdentity() cascade
│   └── config/
│       └── index.ts          # loadConfig(), default allowlist
├── dist/                     # Compiled JS (hook-runner.js must be here)
├── tests/
│   ├── logger.test.ts
│   ├── weights.test.ts
│   ├── identity.test.ts
│   └── hook-runner.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| `find-up` | ^7.0.0 (ESM) | Walk up directories for `.git` |
| `simple-git` | ^3.x | `git remote get-url origin` |
| `write-file-atomic` | ^6.x | Atomic JSON writes (temp+rename) |
| TypeScript | ^5.x | Language |
| `vitest` | ^2.x | Test runner |
| `tsx` | ^4.x | Dev-time TypeScript execution |

---

## Out of Scope (This Split)

- Manual connection creation CLI
- `project→project` edges (no hook event triggers these)
- `skill→tool` edges from subagent internals (SubagentStop hook not wired)
- Log aggregation, querying, or visualization
- API server (that's 02-api-server)
- Multi-machine sync
