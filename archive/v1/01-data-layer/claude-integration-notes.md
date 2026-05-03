# Integration Notes: Opus Review Feedback

**Source:** `reviews/iteration-1-opus.md`
**Date:** 2026-03-28

---

## What I'm Integrating

### 1. Remove `skill->tool` from `ConnectionType` (CRITICAL)
The union includes `'skill->tool'` but the hook runner never produces it. This is a type lie.
**Action:** Remove from the union, add a comment that this is deferred to a future SubagentStop hook.

### 2. Add `proper-lockfile` for weights.json (CRITICAL)
The race condition is real and happens during any fast tool sequence (rapid file edits, agent loops). The current plan defers this but the fix is ~3 lines. The fallback-on-lock-failure pattern preserves the "never block Claude" invariant.
**Action:** Add `proper-lockfile` to dependencies. Wrap read-modify-write in `lockfile.lock()` / `lockfile.unlock()` with 5-second stale timeout. Fall back to unlocked write on lock failure.

### 3. Document `project->project` as conscious deferral (IMPORTANT)
The type is missing entirely with no explanation. Should be acknowledged.
**Action:** Add a note in Edge Cases documenting this as a future connection type.

### 4. Document `package.json` fallback omission (IMPORTANT)
The cascade skips `package.json` name after git-remote without acknowledgment.
**Action:** Add a note in the Identity module that this was deliberately omitted for simplicity.

### 5. Make `loadConfig` log parse errors to stderr (IMPORTANT)
`loadWeights` logs to stderr on corrupt file; `loadConfig` swallows silently. Inconsistent.
**Action:** Update Config module spec to log to stderr on JSON parse failure.

### 6. Clarify `updateWeight` is in-place mutation, not pure (IMPORTANT)
The plan calls it "pure function (no I/O)" but also "mutates the connection record." Contradiction.
**Action:** Replace "pure function (no I/O)" with "in-place mutation — modifies `weights.connections` directly, returns the same reference."

### 7. Parallelize log append + weight update in hook runner (IMPORTANT)
These two operations are independent. Running them in `Promise.all` is a free latency win.
**Action:** Update hook runner flow to run step 6 and step 7 concurrently.

### 8. Replace `simple-git` with `child_process.execSync` (MEDIUM)
One shell command doesn't justify a full library. Consistent with the "inline what's simple" philosophy already applied to `findUp`.
**Action:** Replace `simple-git` in Identity module spec with direct `child_process.execSync`.

### 9. Add `deriveConnection` function (MEDIUM)
Encapsulates the `tool_name == "Agent"` branching logic and makes the hook runner a clean pipeline. Improves TDD — the branching can be unit-tested independently.
**Action:** Add `deriveConnection(payload: HookPayload, identity: ProjectIdentity): { connectionType, sourceNode, targetNode }` to hook runner spec.

### 10. Add missing test cases (IMPORTANT)
Multiple gaps in the test plan: concurrent write test, `normalizeGitUrl` edge cases, allowlist positive case, `appendLogEntry` on permission-denied, empty `cwd` in payload, `deriveConnection` unit tests.
**Action:** Add all to the Testing Strategy section.

### 11. Add `tool_use_id` to `LogEntry` (LOW — high value)
It's in the payload and creates a unique key per event. Useful for deduplication and future correlation. Low cost, high forward-compatibility value.
**Action:** Add `tool_use_id: string` to `LogEntry` interface.

### 12. Note `DEFAULT_DATA_ROOT` is intentionally Windows-specific (MEDIUM)
This is a single-machine MVP. The env var override covers other users. Worth documenting explicitly.
**Action:** Add a comment in Config module explaining the Windows-specific default is intentional for the author's machine; `DEVNEURAL_DATA_ROOT` is the portability escape hatch.

### 13. Note weight formula rounding is for forward compatibility (MINOR)
4 decimal places are effectively unused at integer `raw_count` values, but they exist for when the formula is replaced with EMA or similar.
**Action:** Add a clarifying comment in the weight calculation spec.

---

## What I'm Not Integrating

### `--dry-run` flag
Good debugging ergonomic, but it's scope creep for this planning document. Can be added during implementation.

### Schema version migration detail
The plan doesn't need a full migration spec for v1. The review asks for a one-liner note about where migration code lives; I'll add this.
**Action:** Actually integrating this — it's trivial to add.

---

## Summary

Most changes are clarifications and small additions to existing sections. No structural rework needed. The biggest functional change is adding `proper-lockfile` support and the `deriveConnection` refactor.
