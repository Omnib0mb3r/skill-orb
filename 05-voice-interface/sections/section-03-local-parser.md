# Section 03: Local Parser

## Overview

This section implements the local (offline, zero-cost) NL intent parser for the voice interface. It covers `src/intent/local-parser.ts` in `05-voice-interface/`, which provides the first stage of the two-stage parsing pipeline. When the local parser is confident enough, Haiku is never called.

**Depends on:** section-02-voice-foundation (types, project scaffold, `src/intent/types.ts` must exist)

**Blocks:** section-05-parser-pipeline

**Parallelizable with:** section-04-haiku-parser, section-06-routing

---

## Background

The intent space for the voice interface is deliberately narrow: only 6 possible intents. This makes it well-suited for a local BayesClassifier with a small static training set. The local parser keeps the common case fast, free, and offline.

The parser uses two strategies applied in order:

1. **Keyword phrase table fast-path** — exact phrase matching with conflict detection
2. **BayesClassifier fallback** — `natural.BayesClassifier` with ~20 training examples per intent

If neither strategy reaches the confidence threshold (0.75), the pipeline's orchestrator (section-05) calls Haiku. The local parser itself does not call Haiku.

---

## Intent Taxonomy

The six intents, defined in `src/intent/types.ts` (section-02):

| IntentName | Meaning |
|---|---|
| `get_context` | What am I currently working on / what's my context |
| `get_top_skills` | What skills do I use most / top skills |
| `get_connections` | What is connected to X / connections for a project |
| `get_node` | Tell me about X (a named node) |
| `get_stages` | Show projects in alpha/beta/deployed/archived stage |
| `unknown` | Cannot determine intent |

---

## File to Create

`C:\dev\tools\DevNeural\05-voice-interface\src\intent\local-parser.ts`

---

## Tests First

Test file: `C:\dev\tools\DevNeural\05-voice-interface\tests\intent\local-parser.test.ts`

Write these tests before implementing. All tests use Vitest.

### Keyword Fast-Path Tests

```typescript
// Test: "what skills am I using most" → intent: 'get_top_skills', confidence: 0.95, source: 'local'
// Test: "what's my current context" → intent: 'get_context', confidence ≥ 0.90, source: 'local'
// Test: "show me alpha projects" → intent: 'get_stages', confidence ≥ 0.90, source: 'local'
// Test: "what's connected to my current project" — matches keywords from both get_connections
//       AND get_context → does NOT return a fast-path result (defers to classifier, not fast-path match)
```

The ambiguous case test is critical: the fast-path must detect when two or more intents' keyword sets both trigger on the same query, and fall through to the classifier rather than picking arbitrarily.

### BayesClassifier Tests

```typescript
// Test: "list top skills" → intent: 'get_top_skills', confidence ≥ 0.75
// Test: "what tools does DevNeural use" → intent: 'get_connections' or 'get_node'
// Test: "what's the weather" (completely unrelated) → confidence < 0.75 (defers to Haiku)
```

### normalizeConfidence() Tests

This is a pure function; test it directly.

```typescript
// Test: normalizeConfidence(logProbs) → result in 0.0–1.0 range (softmax over top-2)
// Test: top-2 log-probs close together (e.g., [-1.0, -1.1]) → confidence near 0.5
// Test: top-1 log-prob much larger than top-2 (e.g., [-0.1, -5.0]) → confidence near 1.0
```

`normalizeConfidence` must be exported from the module so these edge cases can be tested in isolation.

---

## Implementation Details

### Module Layout

`local-parser.ts` exports two things:

- `parseLocalIntent(query: string): IntentResult | null` — returns `null` when confidence is below 0.75 (the orchestrator in section-05 interprets `null` as "defer to Haiku")
- `normalizeConfidence(logProbs: Array<{ label: string; value: number }>): number` — exported for testability

It imports `IntentResult` and `IntentName` from `../intent/types`.

### Keyword Phrase Table

Define the table as a `const` at module scope — a plain object where each key is an intent name and each value is an array of required-phrase groups. A query matches a group when all phrases in that group appear in the lowercased query.

Example structure (not exhaustive — implementer fills in the full set):

```
get_top_skills:  [["skills", "most"], ["skills", "top"], ["top", "skills"]]
get_context:     [["context"], ["working on"], ["current project"]]
get_stages:      [["stage"], ["alpha"], ["beta"], ["deployed"], ["archived"]]
get_connections: [["connected"], ["connections"], ["connects to"]]
get_node:        [["about"], ["tell me"]]
```

**Conflict detection rule:** After scanning all intents' phrase groups, collect the set of intents that had at least one matching group. If that set has more than one member, return `null` to fall through to the classifier. If exactly one intent matched, return it with a fixed confidence of 0.95 (for `get_top_skills`, `get_context`, `get_stages`) or 0.90 (for `get_connections`, `get_node`). If zero intents matched, fall through to the classifier.

### BayesClassifier Setup

The classifier is initialized once at module load time and trained from a static constant `TRAINING_EXAMPLES` defined at module scope. Do not read from external files.

`TRAINING_EXAMPLES` is an array of `{ text: string; intent: IntentName }` objects — approximately 20 examples per intent, covering natural variation in how users ask each question. These are embedded literals in the source file.

The `natural` library may need to be pinned to `6.x` for CommonJS compatibility. Add a note in the implementation that if `require('natural')` fails, a minimal hand-rolled Naive Bayes (~50 lines) is the fallback. The interface is the same either way: `addDocument(text, label)`, `train()`, `getClassifications(text)` returning `Array<{ label: string; value: number }>`.

Classifier initialization sequence:

1. `const classifier = new natural.BayesClassifier()`
2. For each entry in `TRAINING_EXAMPLES`: `classifier.addDocument(entry.text, entry.intent)`
3. `classifier.train()`

This runs once when the module is first `require()`d. The ~10ms cost is acceptable for a subprocess entry point.

### normalizeConfidence Implementation

`getClassifications()` returns log-probabilities (negative numbers). The function:

1. Sort the results array descending by `value` (largest, i.e., least negative, first)
2. Take `top1 = results[0].value` and `top2 = results[1]?.value ?? (top1 - 10)`
3. Apply softmax over the top-2: `confidence = Math.exp(top1) / (Math.exp(top1) + Math.exp(top2))`
4. Clamp to `[0, 1]` (should already be in range but defensive)

Return the label from `results[0]` as the intent, paired with this confidence score.

### parseLocalIntent Logic

```
function parseLocalIntent(query: string): IntentResult | null

1. Normalize query: lowercase, trim
2. Run keyword fast-path:
   a. For each intent, check all phrase groups
   b. Collect matching intents
   c. If exactly 1 match: return IntentResult with fixed confidence, source: 'local'
   d. If 0 or 2+ matches: continue to classifier
3. Run classifier:
   a. classifications = classifier.getClassifications(normalizedQuery)
   b. confidence = normalizeConfidence(classifications)
   c. topLabel = classifications[0].label as IntentName
   d. If confidence >= 0.75: return IntentResult { intent: topLabel, confidence, source: 'local', entities: {} }
   e. If confidence < 0.75: return null
```

Entity extraction (nodeName, stageFilter, limit) is NOT done by the local parser. It is the responsibility of the Haiku parser and the pipeline orchestrator (sections 04 and 05). The local parser returns an `IntentResult` with an empty `entities` object. The orchestrator fills in entities if needed.

---

## Dependency Notes

- `src/intent/types.ts` must exist before this file can be implemented (section-02 delivers it)
- The `natural` npm package must be in `package.json` dependencies (section-02 sets up `package.json`)
- This module has no runtime dependency on the API server, identity resolution, or Haiku — it is purely local NLP

---

## Package Compatibility Note

Before implementing, verify CommonJS compatibility:

```bash
node -e "const n = require('natural'); console.log(typeof n.BayesClassifier)"
```

If this prints `function`, the standard `natural` package works. If it throws an ESM error, pin `"natural": "^6.12.0"` in `package.json`. If pinning to 6.x is insufficient for the project's Node.js version, implement the hand-rolled fallback instead — the interface is identical and the test suite does not care which underlying implementation is used.
