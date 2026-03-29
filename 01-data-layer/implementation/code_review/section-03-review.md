# Section 03 Identity — Code Review

## CRITICAL: Shell Injection in `execSync`

**File:** `src/identity/index.ts`, line 75

`gitRoot` is interpolated directly into a shell command string. On Unix, a path with `"` or backtick breaks argument boundaries; on Windows cmd.exe, `&`, `|`, `^` can escape the quoted argument.

**Fix:** replace `execSync` with `execFileSync` and pass args as an array — bypasses shell entirely.

---

## HIGH: `normalizePath` Spec Ambiguity

**Spec bullet:** "Lowercase the drive letter if present"
**Spec example:** `C:\dev\tools\DevNeural` → `c:/dev/tools/devneural` (full lowercase)

Implementation only lowercases drive letter. For a weight-edge keying system on Windows NTFS (case-insensitive), full lowercase would produce more canonical identifiers. Needs decision.

---

## MEDIUM: Missing-Git-Binary Test Contradicts Spec Bullet

Spec bullet says `source: 'cwd'` when git binary not on PATH. Test (correctly) asserts `source: 'git-root'` (since .git exists). Implementation is logically correct per the background prose — contradiction should be documented.

---

## LOW Items

- **Unnecessary cast:** `(output as string).trim()` — `encoding: 'utf8'` already types output as `string`
- **Missing import:** `ProjectSource` not imported (compiles fine transitively, but deviates from spec stub)

---

## Test Gaps

1. SSH URL without `.git` suffix untested
2. Unix path through `normalizePath` untested (should pass through unchanged)
3. No comment in `findUp` noting `existsSync` handles `.git` files (worktrees) correctly
