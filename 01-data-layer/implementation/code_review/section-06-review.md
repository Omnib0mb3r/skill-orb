# Section 06 Hook Runner — Code Review

## CRITICAL: `proper-lockfile` always fails on the first run — `weights.json` does not yet exist at lock time

**File:** `src/hook-runner.ts`, lines 181–184

`lockfile.lock(weightsPath)` requires the target file to exist. On a fresh install or after manual deletion, `weights.json` is absent, the lock throws `ENOENT`, the catch swallows it, and the first write is unguarded. In concurrent sessions this is also the write most likely to produce a lost-update race.

Fix: ensure `weights.json` exists before locking (touch/write empty JSON), or use `{ realpath: false }` which proper-lockfile supports for locking on non-existent paths.

---

## HIGH: Bash and Agent branches pass raw path to `resolveProjectIdentity` instead of `path.dirname`

**File:** `src/hook-runner.ts`, lines 72–79 (Bash), lines 90–95 (Agent)

Write/Edit correctly calls `resolveProjectIdentity(path.dirname(filePath))`. Bash and Agent pass the raw matched string. When the match is a file like `/home/user/other/src/foo.ts`, `findUp` looks for `/home/user/other/src/foo.ts/.git` — inside a file, not a directory. Both branches must apply `path.dirname(candidate)` first.

---

## HIGH: `URL_RE` captures trailing punctuation, producing corrupt connection keys

**File:** `src/hook-runner.ts`, line 23

`\S+` matches all non-whitespace. `"See https://github.com/user/repo."` produces `github.com/user/repo.` (with period). `normalizeGitUrl` does not strip punctuation. The key is silently stored corrupt and can never merge with the canonical form.

Replace `\S+` with `[^\s.,;:)\]'"<>]+` to stop at sentence boundaries.

---

## HIGH: Subprocess integration tests use `tsx` instead of `dist/hook-runner.js`

**File:** `tests/hook-runner.test.ts`, lines 251–267

Plan explicitly requires `dist/hook-runner.js`. Using `tsx` means: (a) compiled output is never validated, (b) each subprocess spawns ~350ms slower, (c) no build prerequisite is enforced. Should use `node dist/hook-runner.js` with a `beforeAll` build step.

---

## HIGH: "Multiple derived connections" subprocess test is a conditional non-assertion

**File:** `tests/hook-runner.test.ts`, lines 465–489

The assertion is inside `if (fs.existsSync(logFile))` and only checks `>= 1` line. If the log file is absent for any reason, the test passes unconditionally. Should assert `>= 2` lines and check for both connection types, matching the full-pipeline Edit test pattern.

---

## MEDIUM: `SKILL_TOKEN_RE` — no common-word filter

**File:** `src/hook-runner.ts`, lines 18–20

Spec requires skipping common English words. A description like `"well-known pattern for deep-plan"` returns `well-known` instead of `deep-plan`. Minimal stoplist needed for the most common hyphenated phrases.

---

## MEDIUM: `dataRoot` / `effectiveDataRoot` — redundant double-resolution

**File:** `src/hook-runner.ts`, lines 142, 156–157

`loadConfig` already reads `DEVNEURAL_DATA_ROOT` internally. When the env var is set, `effectiveDataRoot === dataRoot` always. When they differ (config.json `data_root` field overrides), all downstream I/O silently moves to a different directory — undocumented and untested.

---

## MEDIUM: `require.main === module` guard contradicts the plan but is correct

**File:** `src/hook-runner.ts`, lines 200–205

Without the guard, importing the module in tests would trigger `main()` and hang on stdin. The guard is necessary and correct. The plan spec should be updated; no code change needed.

---

## LOW: `ABS_PATH_RE` matches Unix sub-paths inside Windows drive paths

On Windows, `C:/dev/tools/project` also triggers the `/\S+` branch matching `/dev/tools/project`. Spurious but harmless `existsSync` call.

---

## LOW: Deduplication test only covers URL-to-URL duplicates

No test for the same project appearing as both a URL and an absolute path in the same payload, or spanning `prompt` + `description` fields.
