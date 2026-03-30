# Section 05: Parser Pipeline (`src/intent/parser.ts`)

## Overview

This section implements the orchestration layer that combines the local parser (section 03) and the Haiku fallback (section 04) into a single unified pipeline. It also applies confidence gating, producing enriched `ParsedIntent` objects with flags the formatter (section 07) and entry point (section 08) use to choose response tone.

**Dependencies:**
- Section 02 (voice-foundation): types in `src/intent/types.ts`
- Section 03 (local-parser): `src/intent/local-parser.ts` — must be implemented before this section
- Section 04 (haiku-parser): `src/intent/haiku-parser.ts` — must be implemented before this section

**Blocks:**
- Section 08 (entry-point): depends on the unified `parseIntent()` function this section exports

**Test directory:** `05-voice-interface/`

---

## Files to Create

- `05-voice-interface/src/intent/parser.ts` — the orchestration module
- `05-voice-interface/tests/intent/parser.test.ts` — unit tests

---

## Background: Confidence Gates

The pipeline applies three confidence tiers after a final intent is resolved (from either the local parser or Haiku):

| Confidence Range | Behavior |
|-----------------|----------|
| `< 0.60` | Return `intent: 'unknown'` with `clarification: true` — no API call will be made downstream |
| `0.60 – 0.84` (exclusive of 0.85) | Return the resolved intent with `hedging: true` — formatter prefixes text with "I think you're asking about..." |
| `≥ 0.85` | Return the resolved intent with no hedging — confident execution |

---

## Types Extension

The pipeline output needs extra fields beyond `IntentResult`. Define a `ParsedIntent` type in `parser.ts`:

```typescript
interface ParsedIntent extends IntentResult {
  hedging: boolean;       // true when confidence is 0.60–0.84
  clarification: boolean; // true when confidence < 0.60 (intent forced to 'unknown')
  unreachable: boolean;   // true when Haiku API call failed entirely (network/quota)
}
```

Export `ParsedIntent` — it is the return type of `parseIntent()` and consumed by sections 07 and 08.

---

## Pipeline Logic

The orchestration in `parser.ts` follows this decision tree:

1. Call `parseLocalIntent(query)` from `src/intent/local-parser.ts`
2. If local result is non-null and `confidence >= 0.75`, return it directly (do not call Haiku)
3. If local result is null or `confidence < 0.75`, call `parseWithHaiku(query)` from `src/intent/haiku-parser.ts`
4. If Haiku result is the `UNREACHABLE_RESULT` sentinel (API failure), capture `unreachable = true` and use the local result as the best available fallback — if local confidence was also too low, the final result will have `clarification: true`
5. Otherwise use the Haiku result as the authoritative result
6. Apply confidence gates to whichever result was chosen:
   - `< 0.60` → override intent to `'unknown'`, set `clarification: true`, `hedging: false`
   - `0.60–0.84` → keep intent, set `hedging: true`, `clarification: false`
   - `≥ 0.85` → keep intent, `hedging: false`, `clarification: false`

The exported function signature:

```typescript
export async function parseIntent(query: string): Promise<ParsedIntent>
```

---

## Tests

File: `05-voice-interface/tests/intent/parser.test.ts`

The tests mock both `local-parser` and `haiku-parser` using `vi.mock`. Each test controls what those modules return.

```typescript
// Test: local confidence >= 0.75 → Haiku is NOT called; local result returned
//   Setup: parseLocalIntent mock returns { confidence: 0.95, intent: 'get_top_skills', source: 'local', entities: {} }
//   Assert: parseWithHaiku was not called
//   Assert: returned ParsedIntent has intent 'get_top_skills', hedging: false, clarification: false

// Test: local confidence < 0.75 → Haiku IS called
//   Setup: parseLocalIntent mock returns { confidence: 0.60, intent: 'get_connections', source: 'local', entities: {} }
//   Assert: parseWithHaiku was called once with the original query string

// Test: local returns null → Haiku called
//   Setup: parseLocalIntent mock returns null
//   Assert: parseWithHaiku was called

// Test: final confidence < 0.60 → clarification flag set, intent overridden to 'unknown'
//   Setup: localParse → { confidence: 0.40, intent: 'get_node', ... }
//          haikuParse → { confidence: 0.50, intent: 'get_node', ... }
//   Assert: result.intent === 'unknown'
//   Assert: result.clarification === true
//   Assert: result.hedging === false

// Test: final confidence 0.60–0.84 → hedging flag set
//   Setup: haikuParse → { confidence: 0.72, intent: 'get_stages', ... }
//   Assert: result.intent === 'get_stages'
//   Assert: result.hedging === true
//   Assert: result.clarification === false

// Test: final confidence >= 0.85 → confident result, no hedging
//   Setup: haikuParse → { confidence: 0.90, intent: 'get_context', ... }
//   Assert: result.hedging === false
//   Assert: result.clarification === false

// Test: Haiku unreachable (returns UNREACHABLE_RESULT sentinel) → unreachable=true, falls back to local
//   Setup: parseLocalIntent → { confidence: 0.65, intent: 'get_connections', ... }
//          parseWithHaiku → UNREACHABLE_RESULT
//   Assert: result.unreachable === true
//   Assert: result.intent === 'get_connections' (local fallback used)
//   Assert: result.source === 'local'

// Test: Haiku unreachable AND local too low → unknown + clarification + unreachable
//   Setup: parseLocalIntent → null (or confidence 0.30)
//          parseWithHaiku → UNREACHABLE_RESULT
//   Assert: result.unreachable === true
//   Assert: result.clarification === true
//   Assert: result.intent === 'unknown'
```

### Test setup pattern

Use `vi.mock` at the top of the test file to stub both dependency modules:

```typescript
vi.mock('../../src/intent/local-parser', () => ({
  parseLocalIntent: vi.fn(),
}));

vi.mock('../../src/intent/haiku-parser', () => ({
  parseWithHaiku: vi.fn(),
  UNREACHABLE_RESULT: Symbol('unreachable'),
}));
```

Import the mocks and call `.mockResolvedValue()` / `.mockReturnValue()` within each test. Reset mocks between tests using `vi.clearAllMocks()` in a `beforeEach`.

---

## Implementation Notes

**Haiku unreachable detection:** The haiku-parser (section 04) exports an `UNREACHABLE_RESULT` sentinel. After calling `parseWithHaiku(query)`, check `result === UNREACHABLE_RESULT` to determine if the API was unreachable vs. if the model returned a valid low-confidence result. Read the section 04 implementation to confirm the exact sentinel contract.

**Async:** Both `parseLocalIntent` and `parseWithHaiku` may be async. Keep `parseIntent` as `async` throughout.

**No side effects:** `parser.ts` orchestrates but does not make HTTP calls, read files, or modify state. All side effects happen downstream in sections 06–08.

**Entity extraction:** The local parser (section 03) returns `entities: {}` (empty). The Haiku parser (section 04) may return populated entities if the model extracts them. The pipeline passes through whichever result's entities to the caller — no additional entity extraction here.

---

## Implementation Notes (Actual)

**Files created:**
- `05-voice-interface/src/intent/parser.ts`
- `05-voice-interface/tests/intent/parser.test.ts`

**Deviations from plan:**

1. **`await parseLocalIntent(query)` used** despite current synchronous implementation. Plan specified it may be async; `await` is a no-op on sync return values but future-proofs the pipeline.

2. **`parseWithHaiku` wrapped in try/catch** for defense against unexpected throws (parseWithHaiku should never throw per its contract but the contract is external).

3. **Null fallback `base` uses `source: 'haiku'`** (not `'local'`) to reflect the last attempted parser when neither succeeded.

4. **Tests use `vi.importActual`** to get the real `UNREACHABLE_RESULT` frozen object. This ensures the `===` identity check in the pipeline is tested against the actual exported sentinel, not a Symbol mock.

5. **Confidence gate boundary tests added** at exactly 0.74 (Haiku called) and 0.75 (Haiku not called).

6. **parseWithHaiku throw test added** to verify pipeline survives unexpected rejections.

7. **Empty query test added** — voice transcription can produce empty strings.

**Final test count:** 17 tests
