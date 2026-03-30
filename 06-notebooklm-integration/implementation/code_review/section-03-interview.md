# Code Review Interview — section-03-log-reader

## Blockers (Auto-fixed)

**Sync I/O in async function**
- Switched from `existsSync`/`readFileSync` to `access`/`readFile` from `node:fs/promises`
- Now properly async throughout

**Lexicographic timestamp sort**
- Changed `.sort()` to `.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())`
- Handles timezone offsets and non-UTC strings safely

## Not a Bug (per spec)

**connection_events maps ALL entries** — spec explicitly says "include ALL entries, not just those with recognized connection_type values". No change.

## Let Go

**Temp dir cleanup** — test-only accumulation, not a correctness issue
**Exact entry count assertion** — >= 7 is fine given fixture may grow
