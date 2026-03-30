# TDD Plan: 06-obsidian-sync

Companion to `claude-plan.md`. Lists test stubs to write **before** implementing each component. Testing framework: **Vitest** (consistent with existing DevNeural modules).

Test files live in `tests/`. Run with `vitest run`.

---

## Component 1: Configuration (`config.ts`)

**Test file:** `tests/config.test.ts`

```
# Test: loadConfig returns valid config when all required fields present
# Test: loadConfig throws with descriptive message when vault_path is missing
# Test: loadConfig throws with descriptive message when data_root is missing
# Test: loadConfig applies defaults for optional fields (notes_subfolder, api_base_url, prepend_sessions, claude_model)
# Test: loadConfig throws when config file does not exist
# Test: loadConfig reads path from DEVNEURAL_OBSIDIAN_CONFIG env var when no arg provided
# Test: loadConfig throws when config JSON is malformed
# Test: config check throws with clear message when ANTHROPIC_API_KEY env var is missing
```

---

## Component 2: Session Log Reader (`session/log-reader.ts`)

**Test file:** `tests/log-reader.test.ts`

```
# Test: readSessionLog returns null when JSONL file does not exist for the given date
# Test: readSessionLog parses all log entries from a multi-line JSONL fixture
# Test: readSessionLog identifies primary_project as the most-frequently-appearing project ID
# Test: readSessionLog calculates session_start and session_end from first/last timestamps
# Test: readSessionLog includes all four connection_type values (project->tool, project->skill, project->project, tool->skill) in connection_events
# Test: readSessionLog returns all_projects as deduplicated list of all project IDs seen
# Test: readSessionLog handles a single-line JSONL (one log entry)
# Test: readSessionLog handles an empty JSONL file (returns SessionData with empty arrays)
```

---

## Component 3: Graph Reader (`session/graph-reader.ts`)

**Test file:** `tests/graph-reader.test.ts`

```
# Test: extractGraphInsights calls API endpoint with project ID and returns parsed insights
# Test: extractGraphInsights falls back to reading weights.json when API returns non-200 or fetch throws
# Test: extractGraphInsights matches project edges using both bare ID and 'project:' prefixed ID from weights.json
# Test: extractGraphInsights identifies new_connection insights where first_seen date matches target date
# Test: extractGraphInsights identifies high_weight insights for top 3 edges by weight
# Test: extractGraphInsights identifies weight_milestone insights where last_seen = today AND raw_count in [10, 25, 50, 100]
# Test: extractGraphInsights returns empty array when both API and file read fail (no throw)
# Test: extractGraphInsights produces plain-English description strings for each insight type
```

---

## Component 4: Summary Generator (`summary/generator.ts`)

**Test file:** `tests/generator.test.ts`

```
# Test: generateSummary calls Anthropic SDK with expected prompt structure (project, date, tools, files, skills, insights)
# Test: generateSummary sends deduplicated tool_name list from LogEntry objects
# Test: generateSummary extracts file paths from tool_input.file_path for Read/Write/Edit entries
# Test: generateSummary extracts skill nodes from connection_events (target_node starting with 'skill:')
# Test: generateSummary parses the Claude JSON response into SessionSummary shape
# Test: generateSummary returns placeholder text when Anthropic SDK throws (no crash)
# Test: generateSummary uses model from config (not hardcoded)
# Test: generateSummary sends max_tokens: 1024 in the API call
```

---

## Component 5: Renderer (`summary/renderer.ts`)

**Test file:** `tests/renderer.test.ts`

```
# Test: renderSummary produces correct markdown with all sections present (snapshot)
# Test: renderSummary omits the "Graph insights" section when graph_insights array is empty
# Test: renderSummary always ends the rendered string with '---' separator
# Test: renderSummary includes '<!-- DEVNEURAL_SESSIONS_START -->' is NOT included (renderer only produces the session block, not the file preamble)
# Test: renderSummary uses 'Session: YYYY-MM-DD' as the heading from summary.date
```

---

## Component 6: Obsidian Writer (`obsidian/writer.ts`)

**Test file:** `tests/writer.test.ts`
(Uses a temp directory fixture for all file I/O)

```
# Test: deriveSlug strips 'project:' prefix before processing
# Test: deriveSlug extracts last path component and lowercases (URL path)
# Test: deriveSlug extracts last path component and lowercases (Windows path with backslashes)
# Test: deriveSlug uses '<penultimate>-<last>' form when two projects would produce the same slug

# Test: writeSessionEntry creates new file with heading and DEVNEURAL_SESSIONS_START marker when file does not exist
# Test: writeSessionEntry returns early (no write) and logs message when Session: YYYY-MM-DD heading already exists and --force not set
# Test: writeSessionEntry overwrites existing session block when --force is set
# Test: writeSessionEntry inserts session after DEVNEURAL_SESSIONS_START marker when prepend_sessions = true
# Test: writeSessionEntry appends to end when prepend_sessions = false
# Test: writeSessionEntry inserts after first heading when DEVNEURAL_SESSIONS_START marker is absent (fallback)
# Test: writeSessionEntry creates parent directories when they do not exist (mkdirSync recursive)
# Test: writeSessionEntry reads and writes files with { encoding: 'utf-8' } (verify no BOM)
```

---

## CLI Entry Point (`generate-summary.ts`)

**Test file:** `tests/generate-summary.integration.test.ts`

```
# Integration test: full pipeline with real JSONL fixture + weights.json fixture in temp dir; Anthropic SDK mocked; verifies Obsidian file created with correct format
# Integration test: exits 0 with message when no log file found for date
# Integration test: exits 1 with clear message when ANTHROPIC_API_KEY missing
# Integration test: --dry-run prints markdown to stdout without writing file
# Integration test: second run for same date skips write and exits 0 (idempotency)
# Integration test: --force flag on second run overwrites existing session
```

---

## Build Order (Test-First)

For each component in build order, write the test file first (with failing stubs), then implement until tests pass:

1. `types.ts` — no tests (pure interfaces)
2. `config.ts` + `config.test.ts`
3. `session/log-reader.ts` + `log-reader.test.ts`
4. `session/graph-reader.ts` + `graph-reader.test.ts`
5. `summary/renderer.ts` + `renderer.test.ts`
6. `summary/generator.ts` + `generator.test.ts`
7. `obsidian/writer.ts` + `writer.test.ts`
8. `generate-summary.ts` + `generate-summary.integration.test.ts`
