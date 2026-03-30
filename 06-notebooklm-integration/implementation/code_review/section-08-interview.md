# Code Review Interview — section-08-cli-integration

## Triage

### Auto-fix: BLOCKER 1 — `_config` on exported public interface
- Move `_config` to an internal `InternalPipelineOptions` type so the public API is clean.
- No test changes needed (TypeScript structural typing handles it).

### Auto-fix: BLOCKER 2 — API key checked before config loaded
- Spec ordering: (1) resolve configPath, (2) check API key, (3) call loadConfig.
- Reorder so configPath is resolved first, then API key check, then loadConfig.

### Auto-fix: Issue 3 — `resolveNotePath` has extra `existingSlugs` parameter
- Remove the third parameter to match the spec signature exactly.
- Call site in generate-summary.ts already passes only two args; no functional change.

### Auto-fix: Issue 4 — `parseArgs` doesn't guard against missing values for value flags
- Add bounds check after pre-increment for `--date`, `--project`, `--config`.

### Let go: Issue 5 — fixture conflates new_connection and weight_milestone onto same edge
- Tests pass; both insight types are emitted for that edge. Low risk, no test impact.
