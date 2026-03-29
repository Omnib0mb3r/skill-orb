# section-03-api-server

## Overview

This section updates the existing `02-api-server` component to enrich `GraphNode` objects with project metadata sourced directly from `devneural.json` files on disk. The API server scans `localReposRoot` for these files, builds a project registry, and uses it to populate `stage`, `tags`, and `localPath` on project nodes at graph build time.

**Depends on**: `section-01-schema` (defines the `devneural.json` format, reconciles the `WeightsFile` field name mismatch). May be worked in parallel with `section-02-data-layer` once section-01 is complete.

**Blocks**: `section-05-extension-host` (the extension host relies on `localPath` in `GraphNode` for active-project detection and node click handling).

---

## Background

The current `GraphNode` type carries only `id`, `type`, and `label`. The extension's camera system needs to know which VS Code project folder maps to which graph node. Rather than having the extension guess path resolution, the API server enriches `GraphNode` directly from `devneural.json` files it finds on disk. Stage tags and local paths describe nodes, so they must come from a node-level source.

Key files to touch:

| File | Change |
|------|--------|
| `C:/dev/tools/DevNeural/02-api-server/src/graph/types.ts` | Add optional fields to `GraphNode` |
| `C:/dev/tools/DevNeural/02-api-server/src/graph/registry.ts` | New file: project registry scanner |
| `C:/dev/tools/DevNeural/02-api-server/src/graph/builder.ts` | Accept and apply `ProjectRegistry` |
| `C:/dev/tools/DevNeural/02-api-server/src/config.ts` | Add `localReposRoot` to `ServerConfig` |
| `C:/dev/tools/DevNeural/02-api-server/src/server.ts` | Wire registry scan, watcher, pass into graph builds |
| `C:/dev/tools/DevNeural/02-api-server/src/ws/types.ts` | Extend `GraphNodeSchema` with optional fields |
| `C:/dev/tools/DevNeural/02-api-server/tests/graph/builder.test.ts` | New test file |
| `C:/dev/tools/DevNeural/02-api-server/tests/graph/registry.test.ts` | New test file |

---

## Tests First

Test files live under `C:\dev\tools\DevNeural\02-api-server\tests\` matching the vitest include glob `tests/**/*.test.ts`.

### `tests/graph/registry.test.ts`

```typescript
describe('buildProjectRegistry', () => {
  it('scans localReposRoot and returns a Map keyed by project node id');
  // Key format: 'project:' + stripped githubUrl (e.g. 'project:github.com/user/repo')
  // Value: { stage, tags, localPath } from each devneural.json found

  it('returns an empty Map when localReposRoot does not exist');
  // Must not throw; logs a warning

  it('skips directories that have no devneural.json');

  it('skips directories where devneural.json is malformed JSON');
  // Must not throw; logs a warning and continues scanning

  it('skips directories where devneural.json is missing required fields');

  it('includes all valid projects even when some subdirectories are invalid');

  it('constructs the correct node id from the githubUrl field');
  // 'https://github.com/user/repo' → node id is 'project:github.com/user/repo'
  // (strip the https:// scheme; keep the rest)
});
```

### `tests/graph/builder.test.ts`

```typescript
describe('buildGraph with ProjectRegistry', () => {
  it('GraphNode for a project with a registry entry gets stage, tags, and localPath populated');
  it('GraphNode for a project WITHOUT a registry entry has no stage, tags, or localPath keys');
  // The fields must be absent (undefined), not null or empty string.
  // Serialize to JSON and confirm the keys do not appear.

  it('GraphNode for tool and skill nodes never carries stage/tags/localPath regardless of registry');

  it('graph:snapshot payload includes stage/tags/localPath on enriched project nodes');
  // Serialize the output of getFullGraph() to JSON and parse it back;
  // assert the enriched node fields round-trip correctly.

  it('graph:snapshot with unenriched nodes deserializes without error');
  // Ensure the Zod schema in ws/types.ts accepts payloads where stage/tags/localPath are absent.
});
```

---

## Implementation Details

### Step 1: Extend `GraphNode` type

In `C:\dev\tools\DevNeural\02-api-server\src\graph\types.ts`:

```typescript
export interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;          // From devneural.json: alpha | beta | deployed | archived
  tags?: string[];         // From devneural.json: e.g. ['sandbox', 'revision-needed']
  localPath?: string;      // Absolute path to the local project clone
}

export interface ProjectMeta {
  stage: string;
  tags: string[];
  localPath: string;
}

/** Keyed by project node id: 'project:github.com/user/repo' */
export type ProjectRegistry = Map<string, ProjectMeta>;
```

### Step 2: Create `src/graph/registry.ts`

```typescript
/**
 * Scans `localReposRoot` one level deep for devneural.json files.
 * Returns a registry Map keyed by the project node id derived from
 * the githubUrl field ('project:' + stripped URL).
 *
 * Non-fatal errors (missing dir, malformed JSON, missing fields) are logged
 * as warnings and skipped. Never throws.
 */
export async function buildProjectRegistry(
  localReposRoot: string
): Promise<ProjectRegistry>
```

Node ID derivation: strip the scheme (`https://` or `http://`) from `githubUrl`, then prepend `project:`. Example: `https://github.com/user/repo` → `project:github.com/user/repo`.

The scan is **one level deep only** — read the immediate subdirectories of `localReposRoot` and look for `devneural.json` at `<localReposRoot>/<subdir>/devneural.json`.

### Step 3: Update `src/graph/builder.ts`

Update `buildGraph` to accept an optional `ProjectRegistry` and enrich project nodes:

```typescript
export function buildGraph(
  weights: WeightsFile,
  registry?: ProjectRegistry
): InMemoryGraph
```

When building a `GraphNode`, if `type === 'project'` and the registry has an entry for the node's id, spread the `ProjectMeta` fields onto the node. Otherwise, the node is returned with no extra fields.

Do not add stage/tags/localPath to tool or skill nodes.

### Step 4: Update `src/config.ts`

Add `localReposRoot` to `ServerConfig`:

```typescript
export interface ServerConfig {
  port: number;
  dataRoot: string;
  localReposRoot: string;  // Read from DEVNEURAL_LOCAL_REPOS_ROOT; default ''
}
```

An empty string means the registry scan is skipped — the server does not error when the variable is missing.

### Step 5: Update `src/server.ts`

1. After loading config, if `localReposRoot` is non-empty, call `buildProjectRegistry(localReposRoot)` to get the initial registry.
2. Pass the registry to `buildGraph` when building the initial graph and on every `onGraphChange` callback.
3. Start a separate chokidar watcher on `localReposRoot` watching for `devneural.json` files. On `add` or `change`, call `buildProjectRegistry` again and trigger a full broadcast of the re-enriched graph.
4. Tear down the registry watcher in the `stop()` function.

### Step 6: Update `src/ws/types.ts`

Extend `GraphNodeSchema`:

```typescript
const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['project', 'tool', 'skill']),
  label: z.string(),
  stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  localPath: z.string().optional(),
});
```

---

## Behavior Contract

- **Registry scan is non-blocking**: If `localReposRoot` is empty or inaccessible, the server starts normally with an empty registry. Nodes render without enrichment.
- **Fields are absent, not null**: Unenriched nodes must not have `null` values for `stage`/`tags`/`localPath` — use `undefined` (omitted in JSON serialization).
- **Backward compatible**: `buildGraph` accepts `registry` as an optional second argument; all existing call sites remain valid.
- **Existing tests continue to pass**: Run `npm test` in `02-api-server` after changes.
