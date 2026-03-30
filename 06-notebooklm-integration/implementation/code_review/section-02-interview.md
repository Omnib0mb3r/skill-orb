# Code Review Interview — section-02-types-config

## No blockers. Auto-fixes applied:

**Portable /tmp path in file-not-found test**
- Changed hardcoded `/tmp/devneural-nonexistent-config-99999.json` to `join(tmpdir(), ...)`
- Rationale: portable across Windows/Linux/Mac CI

**Better process.exit spy assertion**
- Replaced throw-based spy with `vi.fn()` mock + `expect(exitSpy).toHaveBeenCalledWith(1)`
- Rationale: tests actual exit code rather than spy implementation detail

## Let Go

**`as ObsidianSyncConfig` cast** — minor, types are identical; removing adds no value now
**`!process.env.ANTHROPIC_API_KEY` comment** — behavior is correct and obvious enough
