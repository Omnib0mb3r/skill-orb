# Code Review: section-02-data-layer

## ISSUE 1 — BARE CATCH SWALLOWS NON-ENOENT I/O ERRORS SILENTLY (HIGH)

`hook-runner.ts` outer `catch {}` is documented as "File not found — walk up." It catches every exception from `fs.promises.readFile`, including EPERM and EMFILE. If `devneural.json` exists but can't be read (permission denied), the function silently skips that directory and walks up — potentially returning metadata from a different ancestor project.

**Auto-fix:** Narrow catch to ENOENT; warn+return undefined for all other error codes.

## ISSUE 2 — IGNORES validateDevNeuralConfig VALIDATOR (HIGH)

The function does ad-hoc string extraction with no validation. A file with `"stage": "garbage"` writes "garbage" into JSONL permanently. `validateDevNeuralConfig` exists in the same package for this exact purpose.

**Decision needed:** The plan section explicitly says "does not validate the devneural.json schema (that is section-01-schema)." The intent is best-effort extraction — hook runner should not skip enrichment because someone has an invalid stage. Should we still enforce validation here?

## ISSUE 3 — stage/tags TYPED AS string/string[] NOT StageValue/TagValue (MEDIUM)

`StageValue` and `TagValue` narrow types exist in `devneural-config.ts`. Both `LogEntry.stage` and the return type of `readDevneuralJson` use plain `string`/`string[]`. This is a type-safety regression.

**Let go:** Since we're doing best-effort extraction without validation, the value could be any string from JSON. Using `string` is correct for this non-validating path.

## ISSUE 4 — WEIGHTS TEST HAS VACUOUS PASS (MEDIUM)

The `ConnectionRecord.has-no-stage/tags` test wraps all assertions in `if (fs.existsSync(weightsFile))` — if the subprocess doesn't produce a weights file, the test passes with zero assertions.

**Auto-fix:** Assert `existsSync` unconditionally before reading.

## ISSUE 5 — MISSING TEST: tags-present, stage-absent (MEDIUM)

`buildLogEntry` tests cover both-present, both-absent, stage-only. Missing: tags-only (stage undefined, tags provided).

**Auto-fix:** Add the missing symmetric test.

## ISSUE 6 — EMPTY OBJECT RETURN BLURS FILE-FOUND VS NOT-FOUND (LOW)

When a valid JSON object has neither stage nor tags, the function returns `{}` not `undefined`. Callers can't distinguish "no file found" from "file found with no relevant fields."

**Let go:** The plan spec doesn't require this distinction; callers use `meta?.stage` correctly regardless.

## ISSUE 7 — NO GUARD AGAINST EMPTY/RELATIVE startDir (LOW)

No validation of the input path. Empty string would resolve relative to process cwd.

**Let go:** `payload.cwd` from the Claude Code hook system is always absolute.
