# Code Review Interview — section-04-formatter

## Review Findings

**MUST FIX (2)**
1. `resolveLabel` crashes if `edge.target` is undefined/null — `targetId.indexOf(':')` throws TypeError
2. `relativeTime` returns "NaN months ago" for invalid date strings — plan says must never throw or produce garbage

**SHOULD FIX (3)**
3. Future `last_seen` dates produce negative `diffDays` → "-1 months ago"
4. Weight exactly at `minWeight` (1.0) boundary is untested
5. Types not exported from formatter (section-05 coupling)

**NITPICK (2)**
6. Output ends with trailing `\n`
7. `nodeMap` constructed after early-return check

## Triage Decisions

| # | Decision | Rationale |
|---|---------|-----------|
| 1 | **Auto-fix** | Guard `!targetId` → return '(unknown)'; TypeScript types don't prevent runtime bad data |
| 2 | **Auto-fix** | Add `isNaN(lastSeen.getTime())` guard returning 'unknown' |
| 3 | **Auto-fix** | Clamp `diffDays = Math.max(0, diffDays)` |
| 4 | **Auto-fix** | Add test: `weight: 1.0` should appear in output |
| 5 | **Let go** | Plan-intentional; section-05 will pass api-client's GraphResponse through cast |
| 6 | **Let go** | No spec violation; no test checks end-of-string |
| 7 | **Let go** | Inconsequential for single-call usage |

## User Interview

No user input required — all actionable items are auto-fixes.

## Applied Auto-fixes

1. `resolveLabel`: added `if (!targetId) return '(unknown)'` guard
2. `relativeTime`: added `isNaN(lastSeen.getTime())` guard returning 'unknown'
3. `relativeTime`: changed `diffDays` to `Math.max(0, ...)`
4. Added test: skill edge with exactly `weight: 1.0` appears in output
