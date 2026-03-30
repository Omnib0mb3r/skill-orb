# Code Review Interview: section-01-api-extensions

## Auto-fixes Applied (no user input needed)

1. **Removed unused `vi` import** from `voice.test.ts` — import was leftover from initial draft
2. **Added `voice:clear` WS broadcast integration test** — spec called for it; added alongside focus/highlight tests
3. **Improved ZodError messages** — replaced `.message` (JSON blob) with `.issues.map(i => i.message).join('; ')` in both error paths in `voice.ts`
4. **Reduced inner WS timeout from 5000ms to 2000ms** — prevents confusing simultaneous timeout/vitest failures

## Let Go

- `z.object({})` for voice:clear payload: matches plan spec exactly; Zod v3 strip behavior is acceptable for this case
