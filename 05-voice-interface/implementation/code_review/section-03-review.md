# Code Review: section-03-local-parser

## CRITICAL

**normalizeConfidence treats real probabilities as log-probabilities** — the core confidence math is wrong.

`natural.BayesClassifier.getClassifications()` returns real positive floats (unnormalized posteriors), NOT log-probabilities. The current formula `Math.exp(top1)/(Math.exp(top1)+Math.exp(top2))` applied to small values like 0.0008 and 0.00009 yields ~0.5 regardless of actual class separation (9x here), because `exp(0.0008) ≈ 1.0008` and `exp(0.00009) ≈ 1.00009`. Confidence will cluster near 0.5, the 0.75 threshold almost never fires, and the parser returns null and defers to Haiku on queries it should handle locally.

**Fix:** Replace with `top1 / (top1 + top2)`. Rename parameter from `logProbs` to `probs`. Update fallback from `top1 - 10` to `top1 * 0.0001` (equivalent intent: second class has negligible probability). Update all unit tests to use realistic positive probability values.

## HIGH

**Single-word keyword `['about']` in `get_node` is too broad.** Any query containing the word "about" fires `get_node` at 0.90 confidence: "I am about to check my skills", "tell me about alpha projects", etc. The single-word match contradicts the plan's "exact phrase matching" contract.

**Fix:** Remove `['about']` from get_node. Keep only multi-word phrases.

## MEDIUM

**`unknown` intent can never be returned.** TRAINING_EXAMPLES has zero entries for `unknown`; apparatus never emits it. `null` does double duty as the defer-to-Haiku signal but is undocumented. **Decision:** Accept this design — null is the correct deferral signal per the section plan. Add a comment to document the intent.

**`['what is']` in get_node conflicts with get_stages single-word groups.** "what is deployed" would match both, triggering conflict detection and classifier fallthrough. **Decision:** Accept — the classifier is likely to resolve this correctly, and the conflict detection is working as designed.

**`top2 = top1 - 10` magic constant** assumes log-space. Once critical bug is fixed to use real probabilities, this fallback must also be corrected. Covered by the critical fix above.

## LOW

**Redundant in-place sort on line 264.** `apparatus` already returns results sorted descending. Auto-fix: remove the sort.
