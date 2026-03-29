# Code Review Interview: section-01-schema

## Items asked of user

### Issue 4 — githubUrl validation strength
**Question:** Enforce `https://github.com/` prefix?
**User decision:** Yes — enforce the prefix. Fail fast with a clear error.

## Auto-fixes applied (no user input needed)

- **Issue 1:** Change `schema_version: number` → `schema_version: 1` literal type in `02-api-server/src/graph/types.ts`
- **Issue 2:** Improve legacy format test comment to clarify "recoverable" means no crash/wrong value
- **Issue 4:** Enforce `https://github.com/` prefix in `validateDevNeuralConfig` + add test
- **Issue 5:** Deduplicate tags before returning from `validateDevNeuralConfig`
- **Issue 6:** Use `.trim().length === 0` for name and description validation
- **Issue 9:** Add `[]` and `[{}]` array input test cases

## Items let go

- **Issue 3:** Test file location — keeping in `tests/` matches existing project convention
- **Issue 7:** bridger-tests has no git remote, correctly skipped per spec
- **Issue 8:** Barrel export — premature; sections 02/03 will import by path
