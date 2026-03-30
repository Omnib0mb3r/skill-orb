# Code Review: section-07-formatter

## CRITICAL

**orb-events.ts: get_top_skills skill filter is asymmetric with response.ts**
`orb-events.ts` filters only `e.target?.startsWith('skill:')`, while `response.ts` correctly checks both `target` and `source`. A skill appearing as an edge source gets narrated in text but never highlighted in the orb.
Fix: add `|| e.source?.startsWith('skill:')` to the filter.

## HIGH

**response.ts joinList: crashes on empty names array**
`copy.pop()!` on an empty array produces `undefined` at runtime; the non-null assertion silences TypeScript and the template literal emits the string `'undefined'`.
Fix: add `if (names.length === 0) return '';` guard at top.

## MEDIUM

1. **get_top_skills orb event ignores `intent.entities.limit`** — hardcodes 5 while `response.ts` uses `intent.entities.limit ?? 5`. User asking for top 10 gets 10 spoken but only 5 highlighted.
   Fix: `.slice(0, intent.entities.limit ?? 5)`

2. **Duplicate type definitions have already diverged** — `GraphEdge`, `GraphNode`, `GraphResponse`, `NodeResponse` re-declared in both files; canonical versions exist in `api-client.ts`. Drift already visible: orb-events.ts `GraphEdge` omits `connection_type`. Consider importing from `api-client.ts`.

3. **get_context fires `voice:focus` with `{ nodeId: '' }` when no project node** — When `apiResult` has no project-typed node, `projectId` falls back to `''` and `postEvent` is still called with invalid value. Fix: skip focus call when `projectId === ''`.

4. **`serverPath` embeds machine-specific absolute path** — computed at module load, embeds caller's filesystem path in output. Acceptable for now; noted for future portability.

## LOW

1. `HEDGING_LABELS` uses `Partial<Record<string, string>>` instead of `Partial<Record<IntentName, string>>` — loses type safety for misspelled intent names.

2. No dedicated test for `get_node` intent in `response.test.ts`.

3. `formatSubgraph` double-counts edges where both endpoints carry different type prefixes (edge `tool:A -> skill:B` counted in both skillCount and toolCount).

4. No test verifying `hedging=true` with `intent='unknown'` produces no hedging prefix.

## Decisions

- **Auto-fix**: CRITICAL, HIGH, MEDIUM-1, MEDIUM-3, LOW-1, LOW-2, LOW-4
- **Let go**: MEDIUM-2 (acceptable divergence for this section), MEDIUM-4 (by design), LOW-3 (acceptable edge case)
