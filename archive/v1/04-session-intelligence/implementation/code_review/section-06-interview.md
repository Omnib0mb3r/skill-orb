# Code Review Interview — section-06-install-script

## Review Findings Triage

### Finding #1 (CRITICAL): __dirname undefined under tsx ESM
**Decision: Let go.** False alarm. `package.json` has no `"type": "module"` and tsx without ESM mode runs CJS. `__dirname` is defined.

### Finding #2 (CRITICAL): Atomic write — settings.json can corrupt on crash
**Decision: Auto-fix.** Write to `.tmp` file first, then `renameSync` to final path.

### Finding #4 (IMPORTANT): readSettings swallows all errors
**Decision: Auto-fix.** Catch only ENOENT (return `{}`); rethrow all other errors (EPERM, etc.) to avoid silently overwriting on permission errors.

### Finding #6 (IMPORTANT/MINOR): statusMessage test uses toBeDefined, not exact value
**Decision: Auto-fix.** Changed to `.toBe('Loading DevNeural context...')`.

### Finding #7 (MINOR): Idempotency test missing reference equality check
**Decision: Auto-fix.** Added `expect(result2).toBe(result1)` to assert same-reference early exit.

### Findings #3, #5, #8, #9, #10, #11
**Decision: Let go.** Spec-specified behavior (substring dedup), internal naming difference, handled at call site, matches spec, test casts, cosmetic.

---

## Auto-Fixes Applied

1. `src/install-hook.ts` — `readSettings`: catches only `ENOENT`, rethrows others
2. `src/install-hook.ts` — `writeSettings`: writes to `.tmp` then renames atomically
3. `tests/install-hook.test.ts` — idempotency test: added `expect(result2).toBe(result1)`
4. `tests/install-hook.test.ts` — statusMessage test: exact string assertion
