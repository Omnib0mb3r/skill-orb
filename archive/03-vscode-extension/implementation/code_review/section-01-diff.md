diff --git a/01-data-layer/src/schema/devneural-config.ts b/01-data-layer/src/schema/devneural-config.ts
new file mode 100644
index 0000000..1919880
--- /dev/null
+++ b/01-data-layer/src/schema/devneural-config.ts
@@ -0,0 +1,82 @@
+export type StageValue = 'alpha' | 'beta' | 'deployed' | 'archived';
+export type TagValue = 'revision-needed' | 'sandbox';
+
+export interface DevNeuralConfig {
+  name: string;
+  localPath: string;
+  githubUrl: string;
+  stage: StageValue;
+  tags: TagValue[];
+  description: string;
+}
+
+const VALID_STAGES: ReadonlySet<string> = new Set(['alpha', 'beta', 'deployed', 'archived']);
+const VALID_TAGS: ReadonlySet<string> = new Set(['revision-needed', 'sandbox']);
+
+/**
+ * Validates and returns a typed DevNeuralConfig from an unknown parsed JSON value.
+ * Throws a descriptive Error on any missing or invalid field.
+ * Tolerates unknown extra fields.
+ */
+export function validateDevNeuralConfig(raw: unknown): DevNeuralConfig {
+  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
+    throw new Error('devneural.json must be a JSON object');
+  }
+
+  const obj = raw as Record<string, unknown>;
+
+  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
+    throw new Error('devneural.json: "name" is required and must be a non-empty string');
+  }
+
+  if (typeof obj['localPath'] !== 'string' || obj['localPath'].length === 0) {
+    throw new Error('devneural.json: "localPath" is required and must be a non-empty string');
+  }
+  // Must be absolute: starts with / (Unix) or a drive letter X:/ or X:\ (Windows)
+  const isAbsolute =
+    obj['localPath'].startsWith('/') || /^[a-zA-Z]:[/\\]/.test(obj['localPath']);
+  if (!isAbsolute) {
+    throw new Error(
+      `devneural.json: "localPath" must be an absolute path (got "${obj['localPath']}")`,
+    );
+  }
+
+  if (typeof obj['githubUrl'] !== 'string' || obj['githubUrl'].length === 0) {
+    throw new Error('devneural.json: "githubUrl" is required and must be a non-empty string');
+  }
+
+  if (typeof obj['stage'] !== 'string') {
+    throw new Error(
+      `devneural.json: "stage" is required and must be one of: ${[...VALID_STAGES].join(', ')}`,
+    );
+  }
+  if (!VALID_STAGES.has(obj['stage'])) {
+    throw new Error(
+      `devneural.json: "stage" must be one of: ${[...VALID_STAGES].join(', ')} (got "${obj['stage']}")`,
+    );
+  }
+
+  if (!Array.isArray(obj['tags'])) {
+    throw new Error('devneural.json: "tags" is required and must be an array');
+  }
+  for (const tag of obj['tags']) {
+    if (typeof tag !== 'string' || !VALID_TAGS.has(tag)) {
+      throw new Error(
+        `devneural.json: invalid tag "${tag}". Valid tags: ${[...VALID_TAGS].join(', ')}`,
+      );
+    }
+  }
+
+  if (typeof obj['description'] !== 'string' || obj['description'].length === 0) {
+    throw new Error('devneural.json: "description" is required and must be a non-empty string');
+  }
+
+  return {
+    name: obj['name'] as string,
+    localPath: obj['localPath'] as string,
+    githubUrl: obj['githubUrl'] as string,
+    stage: obj['stage'] as StageValue,
+    tags: obj['tags'] as TagValue[],
+    description: obj['description'] as string,
+  };
+}
diff --git a/01-data-layer/tests/devneural-schema.test.ts b/01-data-layer/tests/devneural-schema.test.ts
new file mode 100644
index 0000000..8510baa
--- /dev/null
+++ b/01-data-layer/tests/devneural-schema.test.ts
@@ -0,0 +1,121 @@
+import { describe, it, expect } from 'vitest';
+import { validateDevNeuralConfig } from '../src/schema/devneural-config';
+
+const validConfig = {
+  name: 'DevNeural',
+  localPath: 'c:/dev/tools/DevNeural',
+  githubUrl: 'https://github.com/mcollins-f6i/DevNeural',
+  stage: 'alpha',
+  tags: [],
+  description: 'Living neural network of project interconnections',
+};
+
+describe('validateDevNeuralConfig', () => {
+  it('accepts a valid config with all required fields', () => {
+    const result = validateDevNeuralConfig(validConfig);
+    expect(result.name).toBe('DevNeural');
+    expect(result.stage).toBe('alpha');
+    expect(result.tags).toEqual([]);
+    expect(result.localPath).toBe('c:/dev/tools/DevNeural');
+  });
+
+  it('accepts all valid stage values', () => {
+    for (const stage of ['alpha', 'beta', 'deployed', 'archived']) {
+      expect(() => validateDevNeuralConfig({ ...validConfig, stage })).not.toThrow();
+    }
+  });
+
+  it('accepts valid tag values', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, tags: ['revision-needed', 'sandbox'] }),
+    ).not.toThrow();
+  });
+
+  it('accepts an empty tags array', () => {
+    expect(() => validateDevNeuralConfig({ ...validConfig, tags: [] })).not.toThrow();
+  });
+
+  it('tolerates extra unknown fields without throwing', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, unknownField: 'ignored', anotherField: 42 }),
+    ).not.toThrow();
+  });
+
+  it('throws when stage is missing', () => {
+    const { stage: _s, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/stage/i);
+  });
+
+  it('throws when name is missing', () => {
+    const { name: _n, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/name/i);
+  });
+
+  it('throws when localPath is missing', () => {
+    const { localPath: _l, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/localPath/i);
+  });
+
+  it('throws when githubUrl is missing', () => {
+    const { githubUrl: _g, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/githubUrl/i);
+  });
+
+  it('throws when description is missing', () => {
+    const { description: _d, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/description/i);
+  });
+
+  it('throws when tags is missing', () => {
+    const { tags: _t, ...without } = validConfig;
+    expect(() => validateDevNeuralConfig(without)).toThrow(/tags/i);
+  });
+
+  it('throws on invalid stage value with a message naming the field', () => {
+    expect(() => validateDevNeuralConfig({ ...validConfig, stage: 'production' })).toThrow(
+      /stage/i,
+    );
+  });
+
+  it('throws on another invalid stage value', () => {
+    expect(() => validateDevNeuralConfig({ ...validConfig, stage: 'released' })).toThrow(
+      /stage/i,
+    );
+  });
+
+  it('throws when tags contains an unrecognized value', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, tags: ['unknown-tag'] }),
+    ).toThrow(/tag/i);
+  });
+
+  it('throws when localPath is a relative path (no drive letter or leading slash)', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, localPath: 'relative/path' }),
+    ).toThrow(/localPath/i);
+  });
+
+  it('throws when localPath starts with ./', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, localPath: './some/path' }),
+    ).toThrow(/localPath/i);
+  });
+
+  it('accepts Unix absolute localPath starting with /', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, localPath: '/home/user/project' }),
+    ).not.toThrow();
+  });
+
+  it('accepts Windows absolute localPath with drive letter', () => {
+    expect(() =>
+      validateDevNeuralConfig({ ...validConfig, localPath: 'C:/Users/user/project' }),
+    ).not.toThrow();
+  });
+
+  it('throws when raw is not an object', () => {
+    expect(() => validateDevNeuralConfig('not an object')).toThrow();
+    expect(() => validateDevNeuralConfig(null)).toThrow();
+    expect(() => validateDevNeuralConfig(42)).toThrow();
+  });
+});
diff --git a/02-api-server/src/graph/types.ts b/02-api-server/src/graph/types.ts
index 21703c6..caceff4 100644
--- a/02-api-server/src/graph/types.ts
+++ b/02-api-server/src/graph/types.ts
@@ -15,9 +15,9 @@ export interface WeightsFileEntry {
 }
 
 export interface WeightsFile {
+  schema_version: number;
+  updated_at: string;
   connections: Record<string, WeightsFileEntry>;
-  last_updated: string;
-  version: string;
 }
 
 export interface GraphNode {
diff --git a/02-api-server/src/watcher/index.ts b/02-api-server/src/watcher/index.ts
index c6402e0..3f82fe5 100644
--- a/02-api-server/src/watcher/index.ts
+++ b/02-api-server/src/watcher/index.ts
@@ -48,7 +48,7 @@ export function startWatchers(
     .on('add', handleWeightsRead)
     .on('change', handleWeightsRead)
     .on('unlink', () => {
-      const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '' };
+      const emptyWeights: WeightsFile = { schema_version: 1, updated_at: '', connections: {} };
       onGraphChange(buildGraph(emptyWeights));
     });
 
diff --git a/02-api-server/tests/graph/builder.test.ts b/02-api-server/tests/graph/builder.test.ts
index 39ef978..63e2231 100644
--- a/02-api-server/tests/graph/builder.test.ts
+++ b/02-api-server/tests/graph/builder.test.ts
@@ -3,9 +3,9 @@ import { buildGraph } from '../../src/graph/builder.js';
 import type { WeightsFile } from '../../src/graph/types.js';
 
 const emptyWeights: WeightsFile = {
+  schema_version: 1,
+  updated_at: '2025-01-01T00:00:00.000Z',
   connections: {},
-  last_updated: '2025-01-01T00:00:00.000Z',
-  version: '1.0',
 };
 
 describe('buildGraph', () => {
@@ -30,8 +30,8 @@ describe('buildGraph', () => {
           last_seen: '2025-06-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-06-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-06-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     expect(graph.nodeIndex.size).toBe(2);
@@ -64,8 +64,8 @@ describe('buildGraph', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     expect(graph.nodeIndex.get('project:my-repo')?.type).toBe('project');
@@ -107,8 +107,8 @@ describe('buildGraph', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     expect(graph.edgeList.map((e) => e.weight)).toEqual([3.0, 2.0, 1.0]);
@@ -146,8 +146,8 @@ describe('buildGraph', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     // project:a: source in 2 + target in 1 = 3 total
@@ -182,8 +182,8 @@ describe('buildGraph', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     expect(graph.edgeList.length).toBe(2);
@@ -206,8 +206,8 @@ describe('buildGraph', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     const graph = buildGraph(weights);
     const node = graph.nodeIndex.get('project:github.com/user/repo');
diff --git a/02-api-server/tests/graph/weights-alignment.test.ts b/02-api-server/tests/graph/weights-alignment.test.ts
new file mode 100644
index 0000000..3787306
--- /dev/null
+++ b/02-api-server/tests/graph/weights-alignment.test.ts
@@ -0,0 +1,67 @@
+/**
+ * WeightsFile field-name alignment tests.
+ *
+ * Verifies that the api-server's WeightsFile type uses the same field names
+ * that the data layer writes to disk (schema_version, updated_at).
+ */
+import { describe, it, expect } from 'vitest';
+import { buildGraph } from '../../src/graph/builder.js';
+import type { WeightsFile } from '../../src/graph/types.js';
+
+describe('WeightsFile field-name alignment with data-layer', () => {
+  it('accepts a weights.json using schema_version and updated_at (canonical data-layer format)', () => {
+    const weights: WeightsFile = {
+      schema_version: 1,
+      updated_at: '2026-01-01T00:00:00.000Z',
+      connections: {},
+    };
+    expect(() => buildGraph(weights)).not.toThrow();
+    const graph = buildGraph(weights);
+    expect(graph.nodeIndex.size).toBe(0);
+  });
+
+  it('builds a graph from a canonical weights.json with schema_version and updated_at', () => {
+    const weights: WeightsFile = {
+      schema_version: 1,
+      updated_at: '2026-01-01T00:00:00.000Z',
+      connections: {
+        'project:github.com/user/repo||tool:Edit': {
+          source_node: 'project:github.com/user/repo',
+          target_node: 'tool:Edit',
+          connection_type: 'project->tool',
+          raw_count: 5,
+          weight: 0.5,
+          first_seen: '2026-01-01T00:00:00.000Z',
+          last_seen: '2026-01-02T00:00:00.000Z',
+        },
+      },
+    };
+    const graph = buildGraph(weights);
+    expect(graph.nodeIndex.size).toBe(2);
+    expect(graph.edgeList.length).toBe(1);
+  });
+
+  it('a file with old divergent field names (version, last_updated) still yields a valid graph (connections-only parsing)', () => {
+    // buildGraph only reads .connections — legacy metadata fields are silently ignored
+    // rather than causing a crash. This is the "recoverable" behavior for old files.
+    const legacyFormat = {
+      version: '1.0',
+      last_updated: '2024-01-01T00:00:00.000Z',
+      connections: {
+        'project:a||tool:Bash': {
+          source_node: 'project:a',
+          target_node: 'tool:Bash',
+          connection_type: 'project->tool',
+          raw_count: 3,
+          weight: 0.3,
+          first_seen: '2024-01-01T00:00:00.000Z',
+          last_seen: '2024-01-02T00:00:00.000Z',
+        },
+      },
+    };
+    // Cast bypasses TS to simulate runtime reading of legacy file
+    const graph = buildGraph(legacyFormat as unknown as WeightsFile);
+    expect(graph.nodeIndex.size).toBe(2);
+    expect(graph.edgeList.length).toBe(1);
+  });
+});
diff --git a/02-api-server/tests/watcher/watcher.test.ts b/02-api-server/tests/watcher/watcher.test.ts
index 1427d5f..a62babc 100644
--- a/02-api-server/tests/watcher/watcher.test.ts
+++ b/02-api-server/tests/watcher/watcher.test.ts
@@ -20,6 +20,8 @@ async function pollUntil(
 }
 
 const fixtureWeights: WeightsFile = {
+  schema_version: 1,
+  updated_at: '2024-01-02T00:00:00.000Z',
   connections: {
     'project:github.com/user/repo||tool:Read': {
       source_node: 'project:github.com/user/repo',
@@ -40,8 +42,6 @@ const fixtureWeights: WeightsFile = {
       last_seen: '2024-01-02T00:00:00.000Z',
     },
   },
-  last_updated: '2024-01-02T00:00:00.000Z',
-  version: '1.0',
 };
 
 const fixtureJsonlLines = [
diff --git a/devneural.json b/devneural.json
new file mode 100644
index 0000000..0472581
--- /dev/null
+++ b/devneural.json
@@ -0,0 +1,8 @@
+{
+  "name": "DevNeural",
+  "localPath": "c:/dev/tools/DevNeural",
+  "githubUrl": "https://github.com/mcollins-f6i/DevNeural",
+  "stage": "alpha",
+  "tags": [],
+  "description": "Living neural network of project interconnections — data layer, API server, and VS Code extension"
+}
diff --git a/devneural.md b/devneural.md
new file mode 100644
index 0000000..9da30df
--- /dev/null
+++ b/devneural.md
@@ -0,0 +1,102 @@
+# devneural.json — Project Configuration Standard
+
+Every project tracked by DevNeural must have a `devneural.json` at its root. This file is the canonical source of node-level metadata for the DevNeural orb visualization.
+
+---
+
+## What devneural.json Is
+
+`devneural.json` is a small JSON file placed at the root of each tracked project. It tells the DevNeural API server how to identify, label, and stage the project in the connection graph. The API server scans `localReposRoot` for these files at startup and re-scans when they change.
+
+---
+
+## Fields
+
+| Field | Type | Required | Description |
+|---|---|---|---|
+| `name` | string | yes | Human-readable display name shown as the node label in the orb |
+| `localPath` | string (absolute) | yes | Absolute local filesystem path to the project root. Must begin with `/` (Unix) or a drive letter `X:/` or `X:\` (Windows). Relative paths are invalid. |
+| `githubUrl` | string | yes | Canonical GitHub URL, e.g. `https://github.com/user/DevNeural` |
+| `stage` | enum string | yes | One of: `alpha`, `beta`, `deployed`, `archived` |
+| `tags` | string[] | yes | Array of zero or more tag values (see below). An empty array `[]` is valid. |
+| `description` | string | yes | Short human-readable description of the project |
+
+All six fields are required. Unknown extra fields are tolerated — the validator allows forward-compatible extension.
+
+---
+
+## Stage Values
+
+| Value | Meaning |
+|---|---|
+| `alpha` | Early development, actively changing, incomplete |
+| `beta` | Feature-complete but not production-hardened |
+| `deployed` | Running in production or actively used |
+| `archived` | No longer developed; historical record only |
+
+The orb displays stage as a badge on the project node (TorusGeometry rendered by the rendering layer).
+
+---
+
+## Tag Values
+
+| Value | Meaning |
+|---|---|
+| `revision-needed` | Known areas requiring rework; signals caution in the orb view |
+| `sandbox` | Experimental or throwaway work; lower trust signal |
+
+Tags can be combined: `["revision-needed", "sandbox"]` is valid. An empty array `[]` means no special status.
+
+---
+
+## Downstream Effects of Changes
+
+When a `devneural.json` file is created, modified, or deleted:
+
+1. The API server's file watcher detects the change and triggers a full `localReposRoot` re-scan.
+2. The project registry is rebuilt: `GraphNode` objects are updated with new `stage`, `tags`, and `localPath` values.
+3. The updated graph is broadcast via WebSocket to all connected extension clients.
+4. The orb redraws the affected node with updated stage badge colors.
+
+---
+
+## How localPath Is Used
+
+`localPath` enables the orb to open a project's local folder directly when a project node is clicked. The extension host receives the click event, reads `GraphNode.localPath`, and opens the folder using VS Code's `vscode.openFolder` command.
+
+If `localPath` is absent from the `GraphNode` (e.g., the project was discovered by git remote only, not by a `devneural.json` scan), the extension falls back to opening the `githubUrl` in the browser.
+
+---
+
+## How githubUrl Is Used
+
+`githubUrl` serves two purposes:
+
+1. **Primary identifier**: The API server derives the canonical `GraphNode.id` (`project:github.com/user/repo`) from the GitHub URL. This links `devneural.json` metadata to the node that the data layer creates via git-remote discovery.
+2. **Fallback navigation**: When `localPath` does not exist on disk or is absent, the orb opens this URL in the browser on node click.
+
+---
+
+## Validation
+
+Validation is enforced at read time by `validateDevNeuralConfig` in `01-data-layer/src/schema/devneural-config.ts`. Malformed files are skipped with a warning logged to stderr — they are not silently ignored, and they do not crash the scan. A file is considered malformed if:
+
+- Any required field is missing
+- `stage` is not one of the four allowed values
+- Any entry in `tags` is not a known tag value
+- `localPath` is a relative path
+
+---
+
+## Example devneural.json
+
+```json
+{
+  "name": "DevNeural",
+  "localPath": "c:/dev/tools/DevNeural",
+  "githubUrl": "https://github.com/mcollins-f6i/DevNeural",
+  "stage": "alpha",
+  "tags": [],
+  "description": "Living neural network of project interconnections — data layer, API server, and VS Code extension"
+}
+```
