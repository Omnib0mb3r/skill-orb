# Section 08: Entry Point

## Overview

Implements `05-voice-interface/src/index.ts` (the pipeline entry point) and `.claude/commands/voice.md` (the Claude Code skill definition).

**Depends on:** section-05-parser-pipeline (`parseIntent()`), section-07-formatter (`formatResponse()`, `sendOrbEvents()`)

**Blocks:** section-12-integration

Tests run in `05-voice-interface/` using Vitest with subprocess execution.

---

## Files to Create

```
05-voice-interface/src/index.ts
.claude/commands/voice.md
05-voice-interface/tests/entry-point.test.ts
```

---

## Background

The entry point runs as a Node.js subprocess. Each invocation:
1. Reads the query string from `process.argv[2]`
2. Resolves the current project identity via `resolveProjectIdentity(process.cwd())`
3. Calls `parseIntent(query)` — orchestrated local → Haiku pipeline
4. Calls `executeIntentRequest(parsed, projectId, config)` from routing (if not a clarification)
5. Calls `formatResponse(parsed, apiResult?.data ?? null, parsed.hedging)` for readable text
6. Calls `sendOrbEvents(parsed, apiResult?.data ?? null)` fire-and-forget
7. Writes text to stdout and exits 0 always

**Exit behavior:** Never exits with code 1. All failures produce a readable message on stdout.

**Clarification path:** When `parsed.clarification === true` (confidence < 0.60), skip the API call entirely. Print: `"I'm not sure what you mean — try asking about connections, skills, or your current project."`

**Unreachable path:** When `parsed.unreachable === true`, prefix the formatted response with: `"I couldn't reach the AI assistant, but here's what I could parse locally: "`

**`spawnSync` is intentional:** Claude Code skills are synchronous subprocess invocations from the shell's perspective. The bounded latency (~500ms Haiku + HTTP) is acceptable.

---

## Tests First

File: `05-voice-interface/tests/entry-point.test.ts`

Uses `spawnSync` from `child_process`. Build must be current before running.

```typescript
import { spawnSync } from 'child_process';
import path from 'path';

const ENTRY = path.resolve(__dirname, '../dist/index.js');

// Test: node dist/index.js "what skills am I using most?"
//   → exit code 0
//   → stdout is non-empty string
//   → stdout contains no markdown characters

// Test: node dist/index.js "" (empty string)
//   → exit code 0
//   → stdout contains clarification message

// Test: node dist/index.js (no argument)
//   → exit code 0
//   → stdout contains clarification message

// Test: API server not running (default in test env)
//   → exit code 0
//   → stdout contains "isn't running"
//   → stdout path ends with "02-api-server/dist/server.js" (dynamic, not hardcoded absolute)

// Optional test: mock HTTP server on port 3747
//   → spawn http.createServer in beforeAll
//   → stub GET /graph/top to return fixture edges
//   → stub POST /voice/command to return 200
//   → node dist/index.js "what skills am I using?"
//   → stdout contains readable skill names, no raw node IDs
//   → POST /voice/command was received
//   → exit code 0
```

---

## Implementation: `src/index.ts`

```typescript
import { resolveProjectIdentity } from './identity/index';
import { parseIntent } from './intent/parser';
import { executeIntentRequest, buildApiConfig } from './routing/intent-map';
import { formatResponse } from './formatter/response';
import { sendOrbEvents } from './formatter/orb-events';

async function main(): Promise<void> {
  const query = process.argv[2] ?? '';

  if (!query.trim()) {
    process.stdout.write(
      "I'm not sure what you mean — try asking about connections, skills, or your current project.\n"
    );
    return;
  }

  const identity = await resolveProjectIdentity(process.cwd());
  const projectId = identity?.id ?? '';
  const parsed = await parseIntent(query);

  if (parsed.clarification) {
    process.stdout.write(
      "I'm not sure what you mean — try asking about connections, skills, or your current project.\n"
    );
    return;
  }

  const config = buildApiConfig();
  const apiResult = await executeIntentRequest(parsed, projectId, config);
  const text = formatResponse(parsed, apiResult?.data ?? null, parsed.hedging);

  let output = text;
  if (parsed.unreachable) {
    output = `I couldn't reach the AI assistant, but here's what I could parse locally: ${text}`;
  }

  sendOrbEvents(parsed, apiResult?.data ?? null).catch(() => { /* swallowed */ });
  process.stdout.write(output + '\n');
}

main().catch(() => {
  process.stdout.write("An unexpected error occurred.\n");
});
```

Key points:
- `process.stdout.write` not `console.log` — avoids buffering differences in subprocess tests
- `resolveProjectIdentity` may return null — always coerce to `''`
- `sendOrbEvents` is not awaited before writing stdout — text appears immediately

---

## Implementation: `.claude/commands/voice.md`

```markdown
---
description: Query the DevNeural graph in natural language
---

node ./05-voice-interface/dist/index.js "$@"
```

If the working directory when running skills is not guaranteed to be the repo root, use an alternative form:

```markdown
---
description: Query the DevNeural graph in natural language
---

node $(node -e "console.log(require('path').resolve(__dirname, '05-voice-interface/dist/index.js'))") "$@"
```

The user invokes as: `/voice what skills am I using most?`

---

## Checklist

1. Run `npm run build` in `05-voice-interface/` — `dist/index.js` emitted
2. Create `tests/entry-point.test.ts` with all stubs (failing)
3. Create `src/index.ts` with full pipeline wiring
4. Re-run `npm run build` — confirm `dist/index.js` updated
5. Manual test: `node dist/index.js "what skills am I using?"` → stdout output, exit code 0
6. Run `npm test` — entry-point tests pass
7. Create `.claude/commands/voice.md`
8. Test `/voice what skills am I using?` in Claude Code — confirm text response in chat
