# Integration Notes: Opus Review Feedback

## What I'm Integrating

### Critical #1 — `ProjectIdentity` field names corrected
**Integrating.** The plan incorrectly named the field `projectId` and included a non-existent `rawValue` field. The actual `ProjectIdentity` interface has `{ id: string, source: ProjectSource }`. Every reference in Section 2 and Section 5 updated accordingly.

### Critical #2 — Cross-package import path
**Integrating with adjustment.** The plan's proposed import (`../01-data-layer/src/types.js`) won't compile with `rootDir: ./src`. Fix: drop `rootDir` from `tsconfig.json` (outDir still works without it) and import from `../01-data-layer/dist/identity/index.js`. Plan updated to explicitly note that `01-data-layer` must be built before `04-session-intelligence`.

### Critical #3 — Use `fetch` instead of `node:http`
**Integrating.** The reviewer correctly identified that `AbortController` doesn't integrate cleanly with `node:http.request`. Since Claude Code requires Node 18+, `fetch` is available and the cleaner choice. Updated Section 3 to use `fetch` with `AbortSignal.timeout(5000)` and removed the `node:http` rationale.

### Critical #4 — Install script deduplication across missing-matcher entries
**Integrating.** Existing SessionStart entries in settings.json don't have `matcher` fields. The deduplication logic must scan command strings across ALL entries (not just within the target matcher) to avoid duplicate registrations. Updated Section 6 to specify this.

### Moderate #5 — Outgoing-only edge filter documented as intentional
**Integrating.** Added explicit documentation that the formatter intentionally filters to outgoing edges only (source === project), with rationale: for context injection we care about what this project actively uses, not what uses it.

### Moderate #6 — `project->tool` edges explicitly excluded
**Integrating.** Added a note in Section 4 that `project->tool` edges are excluded from the formatter output per design (tools are too transient to be useful session context — confirmed in interview Q2).

### Moderate #7 — Include `raw_count` in formatter output
**Integrating.** The spec example shows "92 uses" next to entries. The plan's formatter output structure omitted this. Updated Section 4 to include `raw_count` in the output string as "(N uses)" alongside the weight.

### Moderate #8 — Multiple matchers → redundant injection
**Acknowledging, not adding complexity.** The reviewer's concern is valid but the solution (tracking injections via CLAUDE_ENV_FILE) adds meaningful complexity for minimal gain. A local API call is ~1ms. Updated Section 6 with a note that this is acceptable by design.

### Moderate #9 — Stale path note for install script
**Integrating.** Added a note in Section 6: after install, moving or renaming the DevNeural repo breaks the hook silently. The install output should tell the user the hook is tied to that path.

### Moderate #10 — Slow test needs explicit timeout
**Integrating.** The API timeout test (mock server delays 6s) will fail with Vitest's default 5s test timeout. Added `{ timeout: 15000 }` to that test case, and added `vitest.config.ts` note.

### Minor #11 — `api-client.test.ts` missing from module structure
**Integrating.** Added to the directory listing in Section 0.

### Minor #12 — Mock server: Fastify → `node:http.createServer`
**Integrating.** Fastify is not a dependency of this module. Using `node:http.createServer` for test fixtures is simpler and adds no dev dependency.

### Minor #13 — `DEVNEURAL_API_URL` precedence clarified
**Integrating.** Added explicit rule: `DEVNEURAL_API_URL` wins if set, otherwise construct from `DEVNEURAL_PORT`. No ambiguity when both are set.

### Architectural #18 — `api-client.test.ts` 404 test replaced
**Integrating.** The `/graph/subgraph` endpoint never returns 404 (only empty `{ nodes: [], edges: [] }`). Replaced the 404 test case with an empty-response test.

---

## What I'm NOT Integrating

### Architectural #19 — Log `source` field to stderr for debugging
The hook already logs nothing to stderr in normal operation. Adding debug logging for the `source` field is out of scope for this implementation — it can be added later if debugging the hook proves difficult.

### Moderate #8 (partial) — Active deduplication via CLAUDE_ENV_FILE
Multiple hook firings per session (from clear/compact/resume) is acknowledged and acceptable. Adding a check mechanism would require writing to CLAUDE_ENV_FILE, which adds complexity and a new system boundary this module doesn't otherwise have.
