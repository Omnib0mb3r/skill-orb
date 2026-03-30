# Section 04: Haiku Parser

## Overview

This section implements `src/intent/haiku-parser.ts` in `05-voice-interface`. It is the AI fallback for intent parsing when the local parser returns low confidence. The Haiku parser calls `claude-haiku-4-5` via the Anthropic SDK with a Zod-validated structured output schema, and maps the response to an `IntentResult`. Two distinct error paths are handled: the model returning `unknown`, and the API being unreachable.

Tests run in: `05-voice-interface/`

## Dependencies

- **section-02-voice-foundation** must be complete: `package.json`, `tsconfig.json`, `vitest.config.ts`, and `src/intent/types.ts` (defining `IntentResult`, `IntentName`) must exist.
- The Anthropic SDK (`@anthropic-ai/sdk`) and `zod` must be listed as dependencies in `package.json` (added in section-02).
- This section is **parallel-safe** with section-03 (local parser) and section-06 (routing). They share no files.

## Files to Create

```
05-voice-interface/
  src/intent/
    haiku-parser.ts       ← implement here
  tests/intent/
    haiku-parser.test.ts  ← write tests first
```

## Tests First

File: `C:\dev\tools\DevNeural\05-voice-interface\tests\intent\haiku-parser.test.ts`

All tests mock `@anthropic-ai/sdk` — no real API calls are made. The mock must intercept `client.messages.parse()` (the structured output method).

Test cases to implement:

```typescript
// Test: haiku-parser calls Anthropic SDK with correct model ('claude-haiku-4-5') and max_tokens (256)
// Test: haiku-parser returns IntentResult matching the Zod schema shape
// Test: haiku-parser returns { intent: 'unknown', confidence: 0, source: 'haiku' } on API network failure
// Test: haiku-parser returns { intent: 'unknown', confidence: 0, source: 'haiku' } on API 429 (quota)
// Test: haiku-parser — mock Haiku returning intent: 'get_top_skills' → passes through correctly
// Test: haiku-parser — Zod schema enforces that confidence is a number between 0 and 1
```

Test structure guidance:

- Use `vi.mock('@anthropic-ai/sdk')` at the top of the test file to intercept all SDK calls.
- Provide a factory (`vi.fn()`) for `client.messages.parse` that returns a `Promise` resolving to a structured-output-shaped response object.
- For network failure tests, make the mock reject with `new Error('fetch failed')`.
- For quota tests, make the mock reject with an error that has `status: 429` or a message matching `'rate_limit'` — whichever matches the SDK's actual error shape (check `@anthropic-ai/sdk` error classes: `APIStatusError` or similar).
- The "Zod schema enforces confidence" test should verify that if the mock returns a confidence value outside `0–1` (e.g., `1.5`), the parser either rejects it or normalizes it — document which behavior you implement.

## Implementation

File: `C:\dev\tools\DevNeural\05-voice-interface\src\intent\haiku-parser.ts`

### Purpose

The Haiku parser is called by `parser.ts` (section-05) when local confidence falls below 0.75. It takes a raw query string and returns a fully typed `IntentResult` with `source: "haiku"`.

### Anthropic SDK Structured Output

Use `client.messages.parse()` with a Zod schema passed as the `response_format`. This ensures the returned content is automatically validated and typed — no manual JSON parsing.

The Zod schema defines the same shape as `IntentResult` (minus `source`, which is added post-parse):

```typescript
// Zod schema stub — exact field names must match IntentResult from types.ts
const IntentResultSchema = z.object({
  intent: z.enum(["get_context", "get_top_skills", "get_connections", "get_node", "get_stages", "unknown"]),
  confidence: z.number().min(0).max(1),
  entities: z.object({
    nodeName: z.string().optional(),
    stageFilter: z.string().optional(),
    limit: z.number().optional(),
  }),
});
// source is added by the parser, not by the model — do NOT include source in the Zod schema
```

### System Prompt

Keep the system prompt concise. It should describe:
1. The 6 valid intent names with one-line descriptions of each
2. The entity fields to extract (nodeName, stageFilter, limit)
3. An instruction to set confidence to 0.0 and intent to `"unknown"` if the query does not fit any intent

Intent descriptions to include:
- `get_context`: user asks about current project or what they are working on
- `get_top_skills`: user asks for top/most-used skills
- `get_connections`: user asks what a named thing is connected to
- `get_node`: user asks for details about a specific node by name
- `get_stages`: user asks about project stages (alpha, beta, deployed, archived)
- `unknown`: query does not fit any of the above

### SDK Call Parameters

```typescript
// model: 'claude-haiku-4-5'
// max_tokens: 256
// system: <system prompt string>
// messages: [{ role: 'user', content: query }]
// response_format: { type: 'json_schema', ... } via the Zod integration
```

### Function Signature

```typescript
/**
 * Parse a voice query using claude-haiku-4-5.
 * Returns an IntentResult with source: 'haiku'.
 * On any API failure, returns { intent: 'unknown', confidence: 0, entities: {}, source: 'haiku' }.
 */
export async function parseWithHaiku(query: string): Promise<IntentResult>;
```

### Error Handling

Two error paths — both return the same fallback shape but callers distinguish them via the `unreachable` flag in section-05:

1. **Model returns `unknown` intent**: This is a valid, non-error response. The structured output succeeded; the model just couldn't classify the query. Return the result as-is (with `source: "haiku"` added). The confidence will be `0` or low, which section-05's pipeline will handle.

2. **API call fails** (network error, timeout, HTTP 429, HTTP 5xx, any thrown exception): Catch all errors from `client.messages.parse()`. Return:
   ```typescript
   { intent: "unknown", confidence: 0, entities: {}, source: "haiku" }
   ```
   Do not rethrow. Log the error to `stderr` so it is visible during development without polluting `stdout` (which carries the user-facing response).

The distinction between "Haiku returned unknown" and "Haiku was unreachable" is signaled via a separate exported constant or by returning a special sentinel value. Section-05's pipeline needs to distinguish these to set the `unreachable` flag. One clean approach: export an `UNREACHABLE_RESULT` constant that the parser returns on failure, and let section-05 check `result === UNREACHABLE_RESULT` or check a distinct field. Coordinate the exact contract before implementing section-05.

### SDK Client Initialization

Instantiate the Anthropic client at module scope (singleton):

```typescript
const client = new Anthropic();
```

The API key comes from `process.env.ANTHROPIC_API_KEY`. If missing, the SDK throws on the first call, which is caught by the error handler above.

### Zod Confidence Clamp

The model is instructed to return confidence between 0 and 1, and the Zod schema enforces `.min(0).max(1)`. If the SDK's Zod integration rejects a value outside this range (throws a parse error), that exception is caught by the error handler and returns the fallback unknown result.

## Checklist

1. Write `haiku-parser.test.ts` with all test cases above (mocked SDK)
2. Implement `haiku-parser.ts` with `parseWithHaiku(query)` export
3. Define `IntentResultSchema` (Zod) inside `haiku-parser.ts` — do not export it
4. Add `source: "haiku"` to the result after destructuring from the parsed response
5. Wrap the entire SDK call in try/catch; return fallback on any error
6. Log caught errors to `stderr`, not `stdout`
7. Export `UNREACHABLE_RESULT` or equivalent sentinel for section-05 to detect API failure
8. Run `npm test -- tests/intent/haiku-parser.test.ts` and verify all tests pass
9. Run `npx tsc --noEmit` to verify TypeScript is clean

## Key Constraints

- CommonJS module (`esModuleInterop: true` is set in tsconfig from section-02, so `import Anthropic from '@anthropic-ai/sdk'` works)
- Max tokens: 256 — do not increase
- Model: `claude-haiku-4-5` — do not substitute
- `source` field is NOT in the Zod schema; added after parsing
- No confidence thresholding in this module — that is section-05's responsibility

---

## Implementation Notes (Actual)

**Files created:**
- `05-voice-interface/src/intent/haiku-parser.ts`
- `05-voice-interface/tests/intent/haiku-parser.test.ts`

**Deviations from plan:**

1. **`messages.create()` used instead of `messages.parse()`.** SDK v0.24.3 has no `messages.parse()` method. The implementation uses `messages.create()` + `JSON.parse()` + `IntentResultSchema.parse()`. A comment in the source documents this workaround.

2. **`import type` used for IntentResult.** TypeScript interface-only import uses `import type`.

3. **Catch block distinguishes ZodError from SyntaxError** for better operational diagnostics.

4. **System prompt updated** to show populated entities examples (nodeName, stageFilter, limit) to bias the model toward extraction.

5. **Tests use `vi.hoisted()`** for the mock function to avoid Vitest hoisting issues.

**UNREACHABLE_RESULT note for section-05:** Object identity check (`result === UNREACHABLE_RESULT`) requires importing the real constant. Do NOT substitute a Symbol mock — import `UNREACHABLE_RESULT` from `../intent/haiku-parser` in section-05's tests.

**Final test count:** 14 tests (2 SDK params, 3 success paths, 4 error paths, 4 Zod enforcement + entities)
