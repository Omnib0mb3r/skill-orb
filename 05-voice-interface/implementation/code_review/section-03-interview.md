# Interview Transcript: section-03-local-parser

## Mode: Autonomous (no user prompts)

## Fix 1: CRITICAL — normalizeConfidence probability arithmetic
**Finding:** `natural.BayesClassifier` returns real positive probabilities, not log-probabilities. `Math.exp(top1)/(Math.exp(top1)+Math.exp(top2))` collapses to ~0.5 for all real inputs, making the 0.75 threshold non-functional.
**Decision:** Auto-fix — replace with `top1/(top1+top2)`. Rename parameter from `logProbs` to `probs`. Update fallback from `top1-10` to `top1 * 0.0001`. Update all unit tests to use positive probability values.

## Fix 2: HIGH — remove ['about'] single-word keyword from get_node
**Finding:** 'about' fires get_node at 0.90 for any query containing the word.
**Decision:** Auto-fix — remove ['about'] group. Keep ['tell me about'], ['what is'], ['describe'], ['info on'], ['information about'] as sufficient.

## Fix 3: LOW — remove redundant in-place sort
**Finding:** `classifications.sort()` on line 264 is unnecessary; apparatus already returns sorted results.
**Decision:** Auto-fix — remove the sort, access `classifications[0]` directly.

## Accept 1: MEDIUM — null as deferral signal for 'unknown'
**Finding:** 'unknown' intent can never be emitted; null doubles as the deferral signal.
**Decision:** Accept design — add a comment documenting this. null is the correct per-spec deferral mechanism.

## Accept 2: MEDIUM — ['what is'] / get_stages conflict
**Finding:** "what is deployed" matches both get_node (['what is']) and get_stages (['deployed']).
**Decision:** Accept — conflict detection correctly falls through to classifier, which resolves such queries.
