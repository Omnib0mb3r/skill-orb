# Research Findings: 01-data-layer

*Generated: 2026-03-28*

---

## Topic 1: Claude Code Hooks — Payload Format

### How Hooks Are Invoked

Hooks are configured in `.claude/settings.json` (project-scoped) or `~/.claude/settings.json` (user-scoped). For `command` hooks, the payload is delivered as JSON on **stdin**; response via stdout + exit code.

**Environment variables available to hook scripts:**
- `$CLAUDE_PROJECT_DIR` — project root directory
- `$CLAUDE_ENV_FILE` — (SessionStart, CwdChanged, FileChanged only) path to file where env vars can be persisted for the session
- `${CLAUDE_PLUGIN_ROOT}` — plugin installation directory
- `${CLAUDE_PLUGIN_DATA}` — plugin persistent data directory

### Common Fields (All Hook Payloads)

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "hook_event_name": "PreToolUse"
}
```

Subagent hooks also include `"agent_id"` and `"agent_type"` (`Explore|Bash|Plan|custom`).

### PostToolUse Payload (Primary Hook for DevNeural)

```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "file content" },
  "tool_response": { "filePath": "/path/to/file.txt", "success": true },
  "tool_use_id": "toolu_01ABC123..."
}
```

`tool_input` varies by tool:

| Tool | Key `tool_input` fields |
|---|---|
| Bash | `command`, `description?`, `timeout?`, `run_in_background?` |
| Write | `file_path`, `content` |
| Edit | `file_path`, `old_string`, `new_string`, `replace_all` |
| Read | `file_path`, `offset?`, `limit?` |
| Glob | `pattern`, `path?` |
| Grep | `pattern`, `path?`, `glob?`, `output_mode`, `-i?`, `multiline?` |
| WebFetch | `url`, `prompt` |
| WebSearch | `query`, `allowed_domains?`, `blocked_domains?` |
| Agent | `prompt`, `description?`, `subagent_type`, `model?` |

**PostToolUse response format:**
```json
{
  "decision": "block",
  "reason": "...",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Additional information for Claude"
  }
}
```

PostToolUse **cannot block** (tool already ran), but can inject context or signal Claude to continue.

### PreToolUse Payload

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "abc123",
  "cwd": "/Users/...",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /tmp/build" },
  "tool_use_id": "toolu_01ABC123..."
}
```

**Response via `hookSpecificOutput`** (top-level `decision`/`reason` deprecated for PreToolUse):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "Reason shown to user/Claude",
    "updatedInput": { "command": "modified command" },
    "additionalContext": "Extra context injected into Claude's context"
  }
}
```

### Other Hooks

| Hook | Fires When | Blocking |
|---|---|---|
| SessionStart | Session begins/resumes | No |
| UserPromptSubmit | Before Claude processes user input | Yes |
| PostToolUseFailure | Tool execution fails | No |
| Stop | Claude about to finish turn | Yes |
| SubagentStop | Subagent about to finish | Yes |
| Notification | Permission dialog appears | No |
| CwdChanged | `cd` executed | No |
| FileChanged | Watched file changed | No |
| PreCompact / PostCompact | Context compaction lifecycle | No |
| SessionEnd | Session terminates | No |

### Exit Code Semantics for Command Hooks

| Exit Code | Behavior |
|---|---|
| 0 | Success — parse stdout for JSON response |
| 2 | Blocking error — use stderr as error message |
| Other | Non-blocking error — show in verbose mode, continue |

### Key Insight for DevNeural

**Hook payloads provide `cwd`, `session_id`, `transcript_path`, `tool_name`, and `tool_input` for free.** These are the primary inputs for the connection logger. No additional context inference is needed for basic logging.

**Sources:**
- [Hooks Reference — Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [ClaudeLog Hooks Guide](https://claudelog.com/mechanics/hooks/)
- [DataCamp Hooks Tutorial](https://www.datacamp.com/tutorial/claude-code-hooks)

---

## Topic 2: TypeScript JSONL Append-Only Logging Patterns

### Core JSONL Contract

Each line must be exactly one complete, valid JSON object. Newlines inside string values must be escaped as `\n`. Never pretty-print across multiple lines.

### `fs.appendFile` Safety

`fs.appendFile` with the `'a'` flag is **not safe for concurrent multi-process use**. Node.js async writes are not guaranteed atomic — a write can be interrupted mid-stream if data is large. This has caused JSONL corruption in Claude Code itself (GitHub issue #20992) with interleaved partial writes.

### Recommended Strategy: Single-Process Write Queue

For same-process concurrency (most common scenario for a hook script), serialize all appends through a promise chain:

```typescript
class JsonlLogger {
  private queue: Promise<void> = Promise.resolve();

  append(filePath: string, record: object): Promise<void> {
    this.queue = this.queue.then(() =>
      fs.promises.appendFile(filePath, JSON.stringify(record) + '\n', 'utf8')
    );
    return this.queue;
  }
}
```

### Atomic Write for State Files (weights.json)

For JSON state files that are read back, **never write in-place**. Write to `.tmp` then rename:

```typescript
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + '.tmp.' + process.pid;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, filePath); // atomic on POSIX; near-atomic on Windows NTFS
}
```

The `write-file-atomic` npm package implements this with queuing and optional `fsync`. Preferred for production use.

### Log Rotation

Date-based rotation recommended for DevNeural (one JSONL file per day):
- Filename pattern: `YYYY-MM-DD.jsonl`
- Implement via date-check on each write; open new file when date changes
- Or use `winston-daily-rotate-file` if using Winston
- Retention: 14–30 days is typical

### Multi-Process Concurrent Write Safety

If multiple Claude sessions write to the same log file simultaneously:
- **Option A:** Per-session JSONL files (`<session_id>.jsonl`) — simplest, avoids all concurrency issues
- **Option B:** Dedicated aggregator process via IPC — most robust but more complex
- **Option C:** File locking via `proper-lockfile` npm package

**Recommendation for DevNeural MVP:** Use per-date files with a single-process write queue. Each hook invocation is its own Node.js process, so multi-process safety is needed. The simplest safe approach is to use `O_APPEND` flag (which is atomic for small writes under PIPE_BUF ~4096 bytes on Linux) and keep log entries under that size.

### Dirty-Flag Batching (for weights.json)

Avoid writing weights.json on every hook event. Use a dirty-flag pattern:

```typescript
let dirty = false;
let weights = loadWeightsFromDisk();

function updateWeight(...) {
  // modify weights in memory
  dirty = true;
}

// Flush periodically or on process exit
process.on('exit', () => { if (dirty) atomicWriteJsonSync(WEIGHTS_FILE, weights); });
```

Since hook scripts are short-lived processes (not daemons), flush on exit is the right pattern.

**Sources:**
- [Claude Code Issue #20992 — JSONL Concurrent Write Corruption](https://github.com/anthropics/claude-code/issues/20992)
- [write-file-atomic — npm/GitHub](https://github.com/npm/write-file-atomic)
- [Winston Production Logging — Dash0](https://www.dash0.com/guides/winston-production-logging-nodejs)
- [JSONL for Log Processing — jsonl.help](https://jsonl.help/use-cases/log-processing/)

---

## Topic 3: Weighted Graph / Connection Strength Persistence in JSON

### Canonical Schema Approach

Based on [JSON Graph Specification v2](https://jsongraphformat.info/), weights go in edge metadata. For DevNeural's simpler use case (project/skill/tool pairs, not a full graph), a flat map structure is more practical than full JGF:

```json
{
  "schema_version": 1,
  "updated_at": "2026-03-28T00:00:00Z",
  "connections": {
    "project:github.com/user/repo||tool:Bash": {
      "weight": 6.4,
      "interaction_count": 23,
      "first_seen": "2026-01-10T00:00:00Z",
      "last_seen": "2026-03-28T10:22:00Z"
    }
  }
}
```

Connection key format: `<entity_type>:<id>||<entity_type>:<id>`

### Weight Update Strategies

**1. Simple increment** — naive, unbounded growth, no forgetting. Not recommended for long-running installs.

**2. Exponential Moving Average (EMA) — Recommended**
```typescript
const alpha = 0.2; // 0.1–0.3; higher = faster to forget
edge.weight = alpha * 1.0 + (1 - alpha) * edge.weight; // newObservation = 1.0 (binary event)
```
Bounded (converges), naturally forgets old data, requires storing only one number. Recommended for connection strength.

**3. Time-decay (half-life)**
```typescript
function getDecayedWeight(weight: number, lastSeen: string, halfLifeDays = 7): number {
  const ageSeconds = (Date.now() - Date.parse(lastSeen)) / 1000;
  const halfLifeSeconds = halfLifeDays * 24 * 3600;
  return weight * Math.exp(-0.693 * ageSeconds / halfLifeSeconds);
}
```
Apply on read rather than write to avoid updating all edges on a timer.

**4. Recency-weighted hybrid** — most expressive, stores weight + last_seen + count, good for MVP extensibility.

**Recommended approach for MVP:** Start with **simple increment stored as raw count** (easy to reason about), but normalize to 0–10 scale for the API. Can swap to EMA in v2.

### Schema Versioning

Embed `schema_version` at top level. Handle migration on read:
```typescript
function loadWeights(raw: unknown): Weights {
  const v = (raw as any).schema_version ?? 1;
  if (v < 2) raw = migrateV1toV2(raw);
  return raw as Weights;
}
```

### Performance

For < 1 MB files (expected for DevNeural MVP): synchronous `JSON.parse` + `JSON.stringify` + atomic rename is fast and simple. Move to SQLite only if the graph grows beyond 10 MB.

**Sources:**
- [JSON Graph Specification — GitHub](https://github.com/jsongraph/json-graph-specification)
- [Facebook EdgeRank — Affinity/Weight/Decay](https://www.ashokcharan.com/Marketing-Analytics/~fb-facebook-edge.php)
- [Exponential Smoothing Guide](https://mbrenndoerfer.com/writing/exponential-smoothing-ets-time-series-forecasting)

---

## Topic 4: Node.js Project Identity from CWD / Git Remote

### The Core Challenge

No single signal is perfectly reliable. Use a **priority-ordered cascade**.

### Recommended Cascade

1. **Git remote URL** (strongest — cross-machine stable, uniquely identifies upstream repo)
2. **`package.json` name** (strong for Node.js projects, but not globally unique)
3. **Git root path** (local-only repos without remotes)
4. **CWD** (last resort fallback)

```typescript
async function resolveProjectIdentity(cwd: string): Promise<{
  id: string;
  root: string;
  source: 'git-remote' | 'package-json' | 'git-root' | 'cwd';
}> {
  const gitRoot = await findGitRoot(cwd);        // findUp('.git')
  if (gitRoot) {
    const remoteUrl = await getGitRemoteUrl(gitRoot);
    if (remoteUrl) return { id: normalizeGitUrl(remoteUrl), root: gitRoot, source: 'git-remote' };
    const pkgName = await getPackageName(gitRoot);
    if (pkgName) return { id: pkgName, root: gitRoot, source: 'package-json' };
    return { id: normalizePath(gitRoot), root: gitRoot, source: 'git-root' };
  }
  const pkgId = await getPackageJsonIdentity(cwd);
  if (pkgId?.name) return { id: pkgId.name, root: pkgId.root, source: 'package-json' };
  return { id: normalizePath(cwd), root: cwd, source: 'cwd' };
}
```

### SSH vs HTTPS URL Normalization

```typescript
function normalizeGitUrl(url: string): string {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  try {
    const parsed = new URL(url.replace(/\.git$/, ''));
    return parsed.hostname + parsed.pathname;
  } catch { return url; }
}
```

### Cross-Platform Path Normalization (Windows)

```typescript
function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}
```

### Key Insight for DevNeural

**The hook payload already provides `cwd`.** No need to call `process.cwd()`. Use `cwd` from the payload + `findUp('.git')` + git remote URL for reliable project identity. The `cwd` in the hook payload is the Claude session's working directory at the time the tool fired.

### Relevant Libraries

| Library | Use |
|---|---|
| `simple-git` (v3.x) | `git.getRemotes(true)` for remote URLs |
| `find-up` (v7.x, ESM) | Walk up directory tree for `.git`, `package.json`, `CLAUDE.md` |
| `normalize-git-url` (npm) | Normalize git URL fragments/protocols (not SSH/HTTPS equivalence) |

**Sources:**
- [simple-git — npm](https://www.npmjs.com/package/simple-git)
- [find-up — npm](https://www.npmjs.com/package/find-up)
- [Managing remote repositories — GitHub Docs](https://docs.github.com/en/get-started/git-basics/managing-remote-repositories)
- [Determine Project Root in Node.js — tutorialpedia.org](https://www.tutorialpedia.org/blog/determine-project-root-from-a-running-node-js-application/)

---

## Cross-Cutting Synthesis for DevNeural 01-data-layer

1. **Hook payloads give `cwd`, `session_id`, `transcript_path`, `tool_name`, `tool_input` for free** — these map directly to the log entry format.

2. **Project identity:** Use `cwd` from payload + `findUp('.git')` + git remote URL as the canonical project key. Normalize to forward slashes, lowercase drive letter for cross-platform storage keys.

3. **JSONL logging:** Each hook invocation is a short-lived process. Use `fs.appendFile` with `O_APPEND` for small (<4KB) entries — this is atomic at the kernel level on Linux. On Windows, it is not guaranteed but practically reliable for small writes. For safety, write queue is better if we ever run as a daemon.

4. **Weights JSON:** EMA (alpha=0.2) is the best long-term choice. For MVP, a simple increment (raw count) stored with `last_seen` is easier to debug and can be migrated to EMA later. Use atomic write (temp + rename) since weights.json is read back by other components.

5. **Schema versioning:** Include `schema_version: 1` in weights.json from day one. The cost is one field; the benefit is future migration safety.

## Testing Preferences (New Project)

Since this is a greenfield TypeScript project:
- **Framework:** Vitest (modern, fast, ESM-native, works with Node.js/TypeScript without extra config)
- **Test types needed:** Unit tests (logger, weight updater, project identity resolver), integration tests (actual file writes to temp directory), hook simulation tests (feed mock stdin payloads)
- **Coverage target:** Focus on correctness of weight calculations and atomic write behavior
