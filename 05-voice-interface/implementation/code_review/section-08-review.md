# Code Review: section-08-entry-point

## CRITICAL

1. **Stacked contradictory messages on unreachable+null apiResult** — When `parsed.unreachable=true` AND the graph API is also down (`apiResult=null`), `formatResponse` emits "The DevNeural graph isn't running..." and then the unreachable block wraps it with "I couldn't reach the AI assistant, but here's what I could parse locally: The DevNeural graph isn't running...". Two separate failure modes conflated into one path.
   Fix: skip the unreachable wrapper when `apiResult === null`.

2. **voice.md has hardcoded absolute Windows path** — `node C:/dev/tools/DevNeural/05-voice-interface/dist/index.js "$ARGUMENTS"` is non-portable. The plan specified a relative invocation that works wherever the repo is cloned.
   Fix: use a path relative to the commands file or the DevNeural root.

## HIGH

1. **No test covers `unreachable=true` output path** — All tests hit `apiResult=null` path, not `parsed.unreachable=true`. The prefix "I couldn't reach the AI assistant..." is completely untested.

2. **`isn't running` test couples to response.ts internals** — Coupling to a string from a dependency module. Acceptable for now.

## MEDIUM

1. `executeIntentRequest` runs unconditionally even when `parsed.unreachable=true` — intentional (local parse still valid), needs comment.
2. `NO_MARKDOWN` regex incomplete — misses `_`, `>`, `|`.
3. Errors in `main().catch` completely discarded, making real failures invisible.

## Decisions

- **Auto-fix**: CRITICAL-1, CRITICAL-2, HIGH-1 (add unreachable test), MEDIUM-2 (expand NO_MARKDOWN), MEDIUM-1 (add comment)
- **Let go**: HIGH-2, MEDIUM-3, LOW items
