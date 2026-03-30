# Code Review Interview: section-08-entry-point

## Auto-fixes Applied

1. **CRITICAL-1 — Stacked messages on unreachable+null**: Added guard `if (parsed.unreachable && apiResult !== null)` — skips the "I couldn't reach the AI assistant" prefix when the API is down (formatResponse already handles that case). Added comment explaining the distinction.

2. **CRITICAL-2 — Hardcoded voice.md path**: Changed to portable form using `$(dirname ...)` expansion for shell and a DevNeural-root-relative note.

3. **HIGH-1 — Missing unreachable test**: Added test verifying that when API is down with a local parse, the output does NOT contain the stacked "couldn't reach AI assistant" + "isn't running" compound message.

4. **MEDIUM-1 — No comment on unconditional executeIntentRequest**: Added inline comment explaining this is intentional (local parse succeeded; still query graph API to get data).

5. **MEDIUM-2 — NO_MARKDOWN regex incomplete**: Expanded to `/[*#\`•\[\]_>|]/` to also catch italic, blockquotes, tables.

## Let Go

- **HIGH-2**: Acceptable test coupling to response.ts wording for now.
- **MEDIUM-3**: Silently discarded errors in `main().catch` — out of scope for this section.
- LOW items: cosmetic or low-risk.
