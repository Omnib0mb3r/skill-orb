# Code Review: section-01-schema

## ISSUE 1 — SCHEMA_VERSION TYPE ASYMMETRY (HIGH)

`01-data-layer/src/types.ts` declares `schema_version: 1` as a numeric literal type. `02-api-server/src/graph/types.ts` was updated to use `schema_version: number` — widened. The plan adopted data-layer field names but not the literal type constraint. Should use `schema_version: 1` in api-server too.

**Auto-fix:** Change `number` → `1` in api-server types.ts

## ISSUE 2 — LEGACY FORMAT TEST CONTRADICTS PLAN WORDING (HIGH)

`02-api-server/tests/graph/weights-alignment.test.ts` asserts old-field-name files silently succeed. The plan section says: "Reading a weights.json with the old divergent field names produces a recoverable error or explicit fallback, not a silent wrong value."

However: `buildGraph` only reads `connections`, never `version`/`last_updated`. So old files produce correct graphs — this IS the recoverable behavior (no crash, no wrong value). The plan wording is ambiguous but the runtime behavior is acceptable. The test comment should be updated to clarify this.

**Auto-fix:** Improve comment to clarify "recoverable" means no crash/wrong value, not a warning.

## ISSUE 3 — TEST FILE LOCATION (MEDIUM)

Plan specified `src/__tests__/devneural-schema.test.ts`. Implementation placed it in `tests/` (integration test directory). This codebase's convention is `tests/` for all tests — the plan's `src/__tests__/` was the wrong convention for this project.

**Let go:** Keeping in `tests/` aligns with existing project conventions.

## ISSUE 4 — GITHUBURL VALIDATION TOO WEAK (MEDIUM)

`validateDevNeuralConfig` accepts any non-empty string for `githubUrl`. The API server derives `GraphNode.id` as `project:github.com/user/repo` from this field. A GitLab URL or non-URL string would produce an ID that never matches data-layer nodes.

**Decision needed from user:** Enforce `https://github.com/` prefix?

## ISSUE 5 — DUPLICATE TAGS ALLOWED (MEDIUM)

`['sandbox', 'sandbox']` passes validation and propagates downstream. Tags are semantically a set.

**Auto-fix:** Deduplicate tags before returning.

## ISSUE 6 — WHITESPACE-ONLY STRINGS PASS FOR NAME/DESCRIPTION (LOW)

`name: '   '` passes and renders as blank node label. Use `.trim().length === 0`.

**Auto-fix:** Apply trim check for name and description.

## ISSUE 7 — BRIDGER-TESTS NOT ADDRESSED IN DOCS (MEDIUM)

Plan required checking `c:/dev/bridger-tests` for a GitHub remote. Checked: no remote found. Per spec: "These nodes cannot have devneural.json files created for them." Correctly skipped.

**Let go:** Confirmed no remote exists, skip is correct per spec.

## ISSUE 8 — NO BARREL EXPORT (LOW)

`src/schema/devneural-config.ts` not re-exported from a barrel. Sections 02/03 will import by path directly.

**Let go:** Premature. Sections 02 and 03 will import directly; barrel can be added later if needed.

## ISSUE 9 — ARRAY INPUT MISSING FROM NON-OBJECT GUARD TESTS (LOW)

`Array.isArray(raw)` guard has no test coverage with `[]` or `[{}]` inputs.

**Auto-fix:** Add array input test case.
