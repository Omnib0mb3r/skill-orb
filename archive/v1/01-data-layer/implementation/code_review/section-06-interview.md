# Section 06 Hook Runner — Code Review Interview

## Issue 1 (CRITICAL): `proper-lockfile` always fails on the first run — `weights.json` does not yet exist
**Decision:** Option A — create `weights.json` first if absent, then lock.
**Applied:** Added `if (!fs.existsSync(weightsPath))` block before `lockfile.lock` that writes an empty `weights.json` using `flag: 'wx'` (exclusive create — race-safe). A concurrent process that wins the race causes `wx` to throw, which is caught silently; the file exists and locking proceeds normally.

## Issue 4 (HIGH): Subprocess integration tests use `tsx` instead of `dist/hook-runner.js`
**Decision:** Option B — keep `tsx` and note the deviation.
**Applied:** No code change. Deviation noted in section doc. `tsx` is faster (~350ms vs build overhead), validates end-to-end logic, and avoids a build prerequisite. The compiled output is validated by the TypeScript compiler at build time.

## Issue 7 (Medium): `effectiveDataRoot` / `dataRoot` redundant double-resolution
**Decision:** Option A — remove `effectiveDataRoot`, use `dataRoot` everywhere.
**Applied:** Removed `effectiveDataRoot` variable. All 4 downstream uses (`appendLogEntry`, `weightsPath`, `loadWeights`, `saveWeights`) now reference `dataRoot` directly. Reduces indirection and eliminates the undocumented config override behavior.

## Auto-fixes applied

### HIGH: Bash and Agent branches missing `path.dirname`
`src/hook-runner.ts` — Bash branch: `resolveProjectIdentity(path.dirname(candidate))`. Agent branch: `resolveProjectIdentity(path.dirname(candidate))`. Matches the Write/Edit branch behavior.

### HIGH: `URL_RE` captured trailing punctuation, producing corrupt connection keys
`src/hook-runner.ts` — Changed from `[^\s.,;:)\]'"<>]+` (which incorrectly excluded dots, breaking `github.com` URLs) to `[^\s]+` with a negative lookbehind `(?<![.,;:)\]'"<>])`. The lookbehind causes the regex engine to backtrack and strip trailing sentence punctuation while allowing dots within URLs.

### MEDIUM: `SKILL_STOP` set added, `extractSkillName` updated
`src/hook-runner.ts` — Added `SKILL_STOP` with 20 common hyphenated English phrases. `extractSkillName` now skips any token matching `SKILL_STOP` before falling back to `subagent_type` or `'unknown-skill'`.

### MEDIUM: `require.main === module` guard — plan spec note
`src/hook-runner.ts` — Guard is present and correct. Without it, importing the module in tests would hang on stdin. Plan spec noted as needing update (no code change required).

### HIGH: "Multiple derived connections" subprocess test was a conditional non-assertion
`tests/hook-runner.test.ts` — Removed the `if (fs.existsSync(logFile))` guard. Now unconditionally asserts `fs.existsSync(logFile) === true`, `lines.length >= 2`, and checks for both `project->tool` and `project->project` entries. Matches the full-pipeline Edit test pattern.
