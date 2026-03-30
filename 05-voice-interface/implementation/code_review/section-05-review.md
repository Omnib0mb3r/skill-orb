# Code Review: section-05-parser-pipeline

## CRITICAL

**UNREACHABLE_RESULT test uses Symbol — never tests real object-identity check.**
The Symbol mock forms a closed loop: test creates Symbol, mock uses Symbol, identity check compares Symbol === Symbol. The real sentinel is `Object.freeze({intent:'unknown',...})`. The test never exercises the actual contract.
**Decision:** Auto-fix — use `vi.importActual` to get the real UNREACHABLE_RESULT in the mock.

## HIGH

**`parseLocalIntent` called without `await` — breaks if function becomes async.**
Plan explicitly says "Both parseLocalIntent and parseWithHaiku may be async." If local parser adds lazy initialization, `localResult` would be a Promise (always truthy, `.confidence` is undefined → fast-path never fires).
**Decision:** Auto-fix — add `await`.

## MEDIUM

**Null fallback `base` hardcodes `source: 'local'` incorrectly.**
When both parsers fail, the synthesized fallback says `source: 'local'` which misleads downstream formatters.
**Decision:** Auto-fix — use `source: 'haiku'` (last attempted) and add a comment.

**No test for `parseWithHaiku` throwing.**
`parseIntent` has no try/catch around `await parseWithHaiku(query)`. Contract unverified.
**Decision:** Auto-fix — add try/catch + test.

## LOW

**Missing boundary tests at exactly 0.74 and 0.75.**
**Decision:** Auto-fix — add two boundary tests.

**No test for empty query string.**
**Decision:** Auto-fix — add test.
