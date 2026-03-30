# Code Review: section-04-haiku-parser

## HIGH

**Plan mandates messages.parse() but implementation uses messages.create() with manual JSON.parse().**
SDK v0.24.3 doesn't have messages.parse(). The deviation is correct but undocumented in source.
**Decision:** Auto-fix — add code comment explaining the workaround.

**UNREACHABLE_RESULT sentinel: section-05 plan shows Symbol mock, but real export is a plain object.**
Object identity check works in real code; section-05 just needs to import the real sentinel in its tests rather than using a Symbol mock. No change needed to the design.
**Decision:** Accept — document for section-05 handoff: import UNREACHABLE_RESULT from haiku-parser, don't substitute a Symbol.

## MEDIUM

**Collapsed catch block loses diagnostic signal** between JSON.parse failure and Zod validation failure.
**Decision:** Auto-fix — add instanceof ZodError check.

**Empty content array path is untested.**
**Decision:** Auto-fix — add test for `{ content: [] }` response.

## LOW

**System prompt example only shows empty entities.** Models follow examples; will under-extract entities.
**Decision:** Auto-fix — show a populated entities example in the system prompt.

**stageFilter and limit entity fields have no test coverage.**
**Decision:** Auto-fix — add two tests.

**Redundant type guard after .find() at line 82.**
**Decision:** Auto-fix — simplify.

**`import { IntentResult }` should be `import type { IntentResult }`.**
**Decision:** Auto-fix.
