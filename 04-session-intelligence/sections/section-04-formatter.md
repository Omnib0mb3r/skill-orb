# Section 04: Formatter

## Overview

This section implements `src/formatter.ts`, a pure function that transforms a `GraphResponse` (returned by the API client) into a human-readable plain text string suitable for injection into Claude's context. Because it has no I/O or side effects, it is fully unit-testable in isolation.

**Depends on:** section-01-setup (build tooling must be in place)
**Blocks:** section-05-entry-point (the main entry point calls `formatSubgraph`)

---

## Files to Create

- `src/formatter.ts` — the formatter module
- `tests/formatter.test.ts` — unit tests (write these first)

---

## Tests First

Write all tests in `tests/formatter.test.ts` before implementing. All tests should initially fail (or not compile), then pass after implementation.

Use Vitest. Import `formatSubgraph` directly — no binary spawning needed, this is a pure function.

### Test list

1. **Both sections** — a `GraphResponse` with both `project->skill` and `project->project` outgoing edges above threshold → output contains both `"Skills (top connections):"` and `"Related Projects:"` headers.

2. **Skills only** — a response with only skill edges → output contains the `"Skills"` section header but does NOT contain `"Related Projects:"`.

3. **Projects only** — a response with only project-to-project edges → output contains `"Related Projects"` but does NOT contain the `"Skills"` header.

4. **No connections** — all edges are below `minWeight` (e.g., `weight: 0.5`) or there are no edges at all → output contains `"No significant connections found"`.

5. **raw_count in output** — output includes the use count formatted as `"(N uses)"` next to each entry.

6. **Relative time: today** — an edge with `last_seen` set to today's ISO date → relative time string is `"today"`.

7. **Relative time: 2 days ago** — `last_seen` set to 2 days ago → string is `"2 days ago"`.

8. **Relative time: 8 days ago** — `last_seen` set to 8 days ago → string is `"1 week ago"`.

9. **Label fallback** — an edge whose `target` ID has no matching entry in `response.nodes` → the output label strips the type prefix from the ID (e.g., node `"skill:my-skill"` with no matching node entry → label displayed as `"my-skill"`).

10. **Top-10 limit** — a response with 15 skill edges, all above threshold → output contains exactly 10 skill entries (one bullet per line; count the bullets).

11. **Weight filter** — a skill edge with `weight: 0.5` (below default `minWeight: 1.0`) → that skill does NOT appear in the output.

12. **Outgoing-only filter** — an edge where the current project is the `target` rather than the `source` → that edge is excluded from output.

13. **Tool edge exclusion** — an edge of `connection_type: "project->tool"` → excluded from output even if weight is high.

---

## Implementation

**File:** `C:\dev\tools\DevNeural\04-session-intelligence\src\formatter.ts`

### Types

Define these interfaces locally (do not import from the API client — the formatter is a standalone module; the caller passes the data in):

```typescript
interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

export interface FormatterConfig {
  maxResultsPerType: number; // default 10
  minWeight: number;         // default 1.0
}
```

### Function signature

```typescript
export function formatSubgraph(
  projectId: string,
  response: GraphResponse,
  config: FormatterConfig,
): string
```

### Formatting logic (step by step)

1. **Filter edges** — keep only edges where ALL of the following are true:
   - `edge.source === "project:" + projectId` (outgoing from this project only; intentional — we care about what this project uses, not what uses it)
   - `edge.connection_type === "project->skill"` OR `edge.connection_type === "project->project"` (edges of type `"project->tool"` are excluded by design — tools are too transient to be useful session context)
   - `edge.weight >= config.minWeight`

2. **Split** the filtered edges into two arrays: skill edges (`connection_type === "project->skill"`) and project edges (`connection_type === "project->project"`).

3. **Sort each array** by `weight` descending.

4. **Limit each array** to the top `config.maxResultsPerType` entries.

5. **Build a node lookup map** from `response.nodes`: `Map<string, GraphNode>` keyed by `node.id`.

6. **Resolve label for each edge target:**
   - Look up `edge.target` in the node map.
   - If found, use `node.label`.
   - If not found, strip the type prefix: take everything after the first `":"` in the target ID string.

7. **Format relative time** for `edge.last_seen` (ISO 8601 string):
   - Parse to a `Date`, compute `diffDays = Math.floor((now - lastSeen) / (1000 * 60 * 60 * 24))`
   - `diffDays === 0` → `"today"`
   - `diffDays === 1` → `"1 day ago"`
   - `diffDays < 7` → `"N days ago"`
   - `diffDays < 14` → `"1 week ago"`
   - `diffDays < 30` → `"N weeks ago"` (weeks = `Math.floor(diffDays / 7)`)
   - `diffDays < 60` → `"1 month ago"`
   - Otherwise → `"N months ago"` (months = `Math.floor(diffDays / 30)`)
   - No external date libraries.

8. **Assemble the output string.** If both skill and project arrays are empty after filtering, return the no-connections message. Otherwise build the string as:

```
DevNeural Context for <projectId>:

  Skills (top connections):
    • <label> (<weight>/10, <raw_count> uses) — <relativeTime>
    ...

  Related Projects:
    • <label> (<weight>/10, <raw_count> uses) — last connected <relativeTime>
    ...
```

   - Omit the `"Skills (top connections):"` block entirely if the skill array is empty.
   - Omit the `"Related Projects:"` block entirely if the project array is empty.
   - `weight` should be formatted to one decimal place (e.g., `"7.3/10"`).
   - Skill entries use `— <relativeTime>` (no "last connected" prefix).
   - Project entries use `— last connected <relativeTime>`.

### No-connections message

```
No significant connections found for this project yet.
```

---

## Edge Cases

- If `response.nodes` is empty but `response.edges` has entries, the label fallback (strip type prefix) must handle all entries gracefully without throwing.
- `projectId` passed into `formatSubgraph` is the bare ID (e.g., `github.com/user/repo`), not prefixed with `"project:"`. The filter must construct `"project:" + projectId` when comparing against `edge.source`.
- `weight` values from the API are in range `[0.0, 10.0]` — format them with one decimal place using `weight.toFixed(1)`.
- The function must never throw regardless of malformed input shapes. Wrap per-edge processing in a guard if needed.

---

## Dependencies

This section has no runtime dependencies beyond Node.js built-ins. Do not import from `api-client.ts` or `identity.ts` — define the needed types locally. The types used here (`GraphResponse`, `GraphNode`, `GraphEdge`) are structurally identical to those in the API client but are intentionally kept separate to preserve the formatter as a pure, isolated module.
