# 04-session-intelligence — Usage Guide

## What Was Built

A Claude Code `SessionStart` hook that queries the DevNeural API for the current project's skill and project connections, then injects relevant context into each session.

## Files

| File | Purpose |
|------|---------|
| `src/session-start.ts` | Entry point — reads stdin hook payload, resolves identity, fetches subgraph, writes formatted context to stdout |
| `src/api-client.ts` | HTTP client — `fetchSubgraph(projectId, config)`, `buildApiConfig()` |
| `src/formatter.ts` | Pure formatter — `formatSubgraph(projectId, response, config)` |
| `src/identity.ts` | Re-export of `resolveProjectIdentity` from `01-data-layer` |
| `src/install-hook.ts` | Patches `~/.claude/settings.json` to register the hook |
| `dist/session-start.js` | Compiled entry point (run by Claude Code) |

## Running

**Build:**
```bash
cd 04-session-intelligence
npm run build
```

**Register the hook:**
```bash
npm run install-hook
```

This patches `~/.claude/settings.json` with 4 hook entries (SessionStart on startup, resume, clear, compact). Idempotent — safe to run again.

**Requires the API server running:**
```bash
node 02-api-server/dist/server.js
```

If the API is offline the hook prints a start-server message and exits 0 — it never blocks a Claude session.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVNEURAL_API_URL` | — | Override full API base URL (takes precedence) |
| `DEVNEURAL_PORT` | `3747` | Override port when `DEVNEURAL_API_URL` is not set |

## Output Format

```
DevNeural Context for <project-id>:

  Skills (top connections):
    • <label> (<weight>/10, <raw_count> uses) — <relative time>
    ...

  Related Projects:
    • <label> (<weight>/10, <raw_count> uses) — last connected <relative time>
    ...
```

If the API is offline:
```
DevNeural: API offline. Start the server with:
  node /path/to/02-api-server/dist/server.js
```

If no connections above threshold:
```
No significant connections found for this project yet.
```

## Tests

```bash
npm test
```

42 tests across 5 files. All integration tests compile and run the binary via async `runBinary` (no blocking spawnSync) so mock servers remain responsive during binary execution.
