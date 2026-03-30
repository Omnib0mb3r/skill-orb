# Section 01: API Extensions (02-api-server)

## Overview

This section extends the existing `02-api-server` to support voice events. It is the foundation that all other sections depend on. Two changes are made to one existing file and one new file is added:

1. Extend `ServerMessageSchema` in `src/ws/types.ts` with three new discriminated union members
2. Add a new route file `src/routes/voice.ts` registering `POST /voice/command`
3. Wire the new route into `src/server.ts`

No other sections need to be complete before starting this one.

---

## Background: Existing Server Architecture

The 02-api-server is a Fastify ESM application (TypeScript, `"type": "module"`). It runs on port 3747 by default. Key files relevant to this section:

- `C:\dev\tools\DevNeural\02-api-server\src\ws\types.ts` — defines `ServerMessageSchema` as a `z.discriminatedUnion` over a `type` literal field. Currently has two members: `graph:snapshot` and `connection:new`.
- `C:\dev\tools\DevNeural\02-api-server\src\ws\broadcaster.ts` — exports `broadcast(msg: ServerMessage): void`. The `ServerMessage` type is inferred from `ServerMessageSchema`. Any new union members added to the schema automatically widen the accepted type.
- `C:\dev\tools\DevNeural\02-api-server\src\server.ts` — calls `registerGraphRoutes()` and `registerEventsRoutes()`. The new voice route registration follows the same pattern.
- `C:\dev\tools\DevNeural\02-api-server\src\routes\graph.ts` — example of how routes are structured; use this as the pattern for `routes/voice.ts`.

The vitest config in `C:\dev\tools\DevNeural\02-api-server\vitest.config.ts` picks up tests from `tests/**/*.test.ts`.

---

## Tests First

Create `C:\dev\tools\DevNeural\02-api-server\tests\voice.test.ts`.

The test file should use Vitest (`describe`, `it`, `expect`, `vi`). It should import `createServer` from `../src/server.ts` to spin up a real server on port 0 (ephemeral) and tear it down in `afterEach`. Use the native `fetch` API (Node 18+) for HTTP assertions. For WebSocket assertions, use the `ws` package (already a devDependency).

Test cases to implement (stubs are fine — each test should at minimum be named and have an `expect` that would fail before implementation):

### Schema tests (import `ServerMessageSchema` from `../src/ws/types.ts`)

```typescript
// ServerMessageSchema.parse() accepts { type: 'voice:focus', payload: { nodeId: 'project:foo' } }
// ServerMessageSchema.parse() accepts { type: 'voice:highlight', payload: { nodeIds: ['project:foo', 'skill:bar'] } }
// ServerMessageSchema.parse() accepts { type: 'voice:clear', payload: {} }
// ServerMessageSchema.parse() throws on { type: 'voice:unknown', payload: {} }
// ServerMessageSchema.parse() accepts voice:highlight with nodeIds: [] (empty array is valid)
```

### POST /voice/command HTTP tests (spin up a real server)

```typescript
// POST { type: 'voice:focus', payload: { nodeId: 'x' } } → 200
// POST { type: 'voice:highlight', payload: { nodeIds: [] } } → 200
// POST { type: 'voice:clear', payload: {} } → 200
// POST { type: 'voice:invalid', payload: {} } → 400 with error field in body
// POST {} (missing type) → 400
// POST { type: 'graph:snapshot', payload: {} } → 400 (allowlist blocks non-voice types)
```

### WebSocket broadcast integration test

```typescript
// Start server, connect WS client, POST /voice/command voice:focus
//   → WS client receives a message with type 'voice:focus' and correct nodeId
// POST /voice/command voice:highlight with empty nodeIds
//   → WS client receives voice:highlight with nodeIds: []
// POST /voice/command with unknown type
//   → HTTP 400, WS client receives nothing
```

The server setup helper pattern to follow (from `04-session-intelligence/tests/api-client.test.ts`): use `createServer({ port: 0, dataRoot: tmpDir, localReposRoot: undefined })` in `beforeEach` / `afterEach`. Ephemeral port means tests never collide. The `ws` integration tests require a `tmp` data directory — use `os.tmpdir()` or `fs.mkdtemp`.

---

## Implementation

### 1. Extend `src/ws/types.ts`

Add three new members to the `ServerMessageSchema` discriminated union. The existing union is:

```typescript
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('graph:snapshot'), payload: GraphResponseSchema }),
  z.object({ type: z.literal('connection:new'), payload: LogEntrySchema }),
]);
```

Append three new members following the same shape:

- `voice:focus` — payload is `{ nodeId: z.string() }`
- `voice:highlight` — payload is `{ nodeIds: z.array(z.string()) }`
- `voice:clear` — payload is `z.object({})` (empty object, no required fields)

The `ServerMessage` type export is inferred automatically — no change needed there.

**Note:** Downstream consumers that pattern-match on `ServerMessage` (the WebSocket snapshot handler in `server.ts`) are unaffected because they only handle `graph:snapshot` and `connection:new`. TypeScript will not require exhaustive handling of the new members unless the consumer uses a switch with a `never` exhaustiveness check, which the current code does not.

### 2. Create `src/routes/voice.ts`

New file. Exports `registerVoiceRoutes(app: FastifyInstance, broadcastFn: (msg: ServerMessage) => void): void`.

The route handles `POST /voice/command`. Its responsibilities:

- Parse the request body as JSON with a Zod schema (define inline in this file):
  ```typescript
  const VoiceCommandSchema = z.object({
    type: z.enum(['voice:focus', 'voice:highlight', 'voice:clear']),
    payload: z.unknown(),
  });
  ```
- If validation fails, return `reply.status(400).send({ error: validationError.message })`.
- If the `type` passes the allowlist but the payload doesn't match its expected shape, return 400 with a descriptive error. (Parse the combined body against `ServerMessageSchema` after the type allowlist check to get full payload validation.)
- On success, call `broadcastFn(validatedEvent)` and return `reply.status(200).send({ ok: true })`.

The two-step validation approach: first check `type` against the enum allowlist (gives clear 400 on `graph:snapshot` or `voice:invalid`), then parse the full body against `ServerMessageSchema` to validate payload shape. This produces specific error messages rather than a generic union parse failure.

**Why inject `broadcastFn` rather than import directly?** Testability — tests can pass a `vi.fn()` spy to verify `broadcast` was called with the correct event without needing a live WebSocket server.

### 3. Wire into `src/server.ts`

Import `registerVoiceRoutes` from `./routes/voice.js` and call it after the existing route registrations, passing the imported `broadcast` function:

```typescript
registerVoiceRoutes(fastify, broadcast);
```

This is a one-line change after the `registerEventsRoutes` call.

---

## File Summary

| File | Action |
|------|--------|
| `C:\dev\tools\DevNeural\02-api-server\src\ws\types.ts` | Modify — add 3 new union members to `ServerMessageSchema` |
| `C:\dev\tools\DevNeural\02-api-server\src\routes\voice.ts` | Create — `registerVoiceRoutes` with Zod validation and broadcast |
| `C:\dev\tools\DevNeural\02-api-server\src\server.ts` | Modify — import and call `registerVoiceRoutes` |
| `C:\dev\tools\DevNeural\02-api-server\tests\voice.test.ts` | Create — schema tests, HTTP tests, WS broadcast integration tests |

---

## Acceptance Criteria

- `npm test` in `C:\dev\tools\DevNeural\02-api-server` passes all tests in `tests/voice.test.ts`
- `ServerMessageSchema.parse({ type: 'voice:focus', payload: { nodeId: 'x' } })` succeeds
- `POST /voice/command` with a valid voice type returns 200 and calls `broadcast`
- `POST /voice/command` with `type: 'graph:snapshot'` returns 400
- `POST /voice/command` with missing `type` returns 400
- A connected WebSocket client receives the event after a successful POST
- Existing tests (if any) continue to pass
- `npm run build` (tsc) passes with no type errors
