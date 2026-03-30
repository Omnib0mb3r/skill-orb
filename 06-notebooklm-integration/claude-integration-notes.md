# Integration Notes: Opus Review Feedback

## Items Being Integrated

### 1. Model name inconsistency (item 1) — INTEGRATING
The config schema said `"claude-sonnet-4-6"` as default but Component 4 said `"claude-haiku-4-5-20251001"`. Aligning both to `"claude-haiku-4-5-20251001"` since Component 4 is the authoritative usage site and Haiku is the right choice (short summary generation, cost-sensitive).

### 2. Insufficient Claude context (item 4) — INTEGRATING
Reviewer correctly noted that passing only graph insight strings + project name + timestamps gives Claude almost nothing to generate a meaningful "what I worked on" paragraph. Adding to the prompt:
- Deduplicated list of `tool_name` values from LogEntry
- File paths from Write/Edit/Read operations (extracted from `tool_input.file_path` or `tool_input.content` header)
- Skill nodes observed (from connection_events where target_node starts with `skill:`)

This is the most important fix — without richer context, the AI output is useless.

### 3. ConnectionType `tool->skill` not handled (item 2) — INTEGRATING
Adding acknowledgment that `tool->skill` is a fourth connection type (per 02-api-server types.ts). The log-reader should include it in connection_events; graph-reader should not crash on it. Adding to the data contracts section.

### 5. Duplicate session detection (item 7) — INTEGRATING
Adding idempotency check: before writing, check if a `## Session: YYYY-MM-DD` heading already exists in the target file. If yes, skip and print a message (don't overwrite user edits). Document as design decision.

### 6. ANTHROPIC_API_KEY prerequisite (item 8) — INTEGRATING
Adding to the CLI section: document `ANTHROPIC_API_KEY` as a required environment variable with a clear error message if missing.

### 7. `@anthropic-ai/sdk` dependency classification (item 9) — NOT APPLICABLE
The plan already lists `@anthropic-ai/sdk` as a production dependency (not devDependency). The reviewer noted the discrepancy exists in 05-voice-interface's package.json — that's a separate bug, not something the plan needs to fix. No change needed.

### 8. Slug derivation edge cases (item 3) — INTEGRATING
Adding explicit specification: strip `project:` prefix first, then extract last path component, lowercase always (GitHub URLs and Windows paths alike), handle collisions by keeping full path if last component is non-unique (e.g., `tools` from two different paths → use penultimate + last).

### 9. Prepend insertion anchor (item 6) — INTEGRATING
Using `<!-- DEVNEURAL_SESSIONS_START -->` as the insertion anchor instead of the first `---` line. Avoids fragility when users add their own `---` rules. New file format gets the marker injected on creation.

### 10. Project ID prefix in weights.json (item 10) — INTEGRATING
Adding explicit note: weights.json `source_node`/`target_node` fields use `project:` prefix. When matching projectId from SessionData (which is bare, e.g., `github.com/...`), the graph-reader must compare against both `project:<id>` and the bare ID.

### 11. Weight milestone logic caveat (item 11) — INTEGRATING (with simplification)
Acknowledging in the plan that the milestone heuristic is an approximation — it can produce false positives (an edge touched today at a round count that was already there). Keeping the feature but documenting the limitation clearly. Not implementing historical diffing (too complex for the scope).

### 12. Config template (item 15) — INTEGRATING
Adding `config.example.json` to the build artifacts list and the list of files to create.

### 13. UTC date documentation (item 14) — INTEGRATING (light)
Adding a note in the CLI --date option docs that dates are UTC and recommending `--date $(date -u +%Y-%m-%d)` for local timezone use.

### 14. UTF-8 encoding (item 5) — INTEGRATING
Adding to writer component: explicitly specify `{ encoding: 'utf-8' }` on all `fs.readFileSync` / `fs.writeFileSync` calls.

## Items NOT Being Integrated

### Item 12 (rate limiting / cost) — SKIPPING
This is a personal CLI tool for one user. Rate limiting and cost documentation add noise without value at this scope. If it becomes a concern, it's a trivial flag addition.

### Item 13 (tool_input size warning) — SKIPPING
The plan already says "do not send raw log dumps." Adding a comment about WHY would be documentation, not a design change. The implementer will see the plan and make the right choice.

### Item 16 (stale research artifacts) — SKIPPING
Research files are planning artifacts, not code. They don't need to stay in sync with the final plan scope.

### Item 17 (large log files) — SKIPPING
This is a personal developer tool. Acknowledging the "loads all entries into memory" assumption would add noise for no practical benefit at this scale.

### Item 18 (writeSessionEntry return type) — PARTIALLY INTEGRATED
The error handling strategy table already says "Catch and rethrow" for Obsidian write failures. Rather than changing the return type to `Result<T>`, adding a note that the CLI entry point must wrap the write call in a try/catch and print a clear error before exiting 1.
