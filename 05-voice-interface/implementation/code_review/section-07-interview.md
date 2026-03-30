# Code Review Interview: section-07-formatter

## Auto-fixes Applied (no user input needed)

1. **CRITICAL — orb-events.ts skill filter asymmetry**: Added `|| e.source?.startsWith('skill:')` to `get_top_skills` filter in orb-events.ts, matching response.ts. Also map skill ID from source when appropriate.

2. **HIGH — joinList empty array crash**: Added `if (names.length === 0) return '';` guard at top of `joinList`.

3. **MEDIUM-1 — get_top_skills limit ignored in orb**: Changed `.slice(0, 5)` to `.slice(0, intent.entities.limit ?? 5)` in orb-events.ts.

4. **MEDIUM-3 — voice:focus with empty nodeId**: Wrapped `postEvent('voice:focus', ...)` in `if (projectId)` guard to skip the call when no project node found in subgraph.

5. **LOW-1 — HEDGING_LABELS type**: Changed `Partial<Record<string, string>>` to `Partial<Record<IntentName, string>>` for type safety.

6. **LOW-2 — Missing get_node test**: Added two tests covering `get_node` with non-empty edges (label + count) and empty edges (no connections message).

7. **LOW-4 — Missing hedging+unknown test**: Added test verifying `hedging=true` with `intent='unknown'` produces no hedging prefix.

## Let Go

- **MEDIUM-2 — Duplicate type definitions**: Acceptable for now; both files have different structural needs for their local interfaces. Canonical types from api-client.ts would require more invasive restructuring.
- **MEDIUM-4 — serverPath is machine-specific**: By design; `path.resolve(__dirname, ...)` is the correct dynamic approach per the spec. Snapshot portability is not a concern for this CLI tool.
- **LOW-3 — formatSubgraph double-counting**: Acceptable; edge-count narration is approximate and informative enough.
