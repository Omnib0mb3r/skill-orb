diff --git a/02-api-server/src/config.ts b/02-api-server/src/config.ts
index 5f86e7e..d92439b 100644
--- a/02-api-server/src/config.ts
+++ b/02-api-server/src/config.ts
@@ -1,6 +1,7 @@
 export interface ServerConfig {
   port: number;
   dataRoot: string;
+  localReposRoot: string;  // Read from DEVNEURAL_LOCAL_REPOS_ROOT; empty string means skip registry scan
 }
 
 export function loadConfig(): ServerConfig {
@@ -28,5 +29,7 @@ export function loadConfig(): ServerConfig {
     process.exit(1);
   }
 
-  return { port: portNum, dataRoot };
+  const localReposRoot = process.env.DEVNEURAL_LOCAL_REPOS_ROOT ?? '';
+
+  return { port: portNum, dataRoot, localReposRoot };
 }
diff --git a/02-api-server/src/graph/builder.ts b/02-api-server/src/graph/builder.ts
index b314948..9204d4e 100644
--- a/02-api-server/src/graph/builder.ts
+++ b/02-api-server/src/graph/builder.ts
@@ -1,16 +1,25 @@
-import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge } from './types.js';
+import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge, ProjectRegistry } from './types.js';
 
-function parseNode(id: string): GraphNode {
+function parseNode(id: string, registry?: ProjectRegistry): GraphNode {
   const colonIdx = id.indexOf(':');
   const prefix = id.slice(0, colonIdx);
   const label = id.slice(colonIdx + 1);
   const type = (prefix === 'project' || prefix === 'tool' || prefix === 'skill')
     ? prefix
     : 'skill';
-  return { id, type, label };
+  const node: GraphNode = { id, type, label };
+  if (type === 'project' && registry) {
+    const meta = registry.get(id);
+    if (meta) {
+      node.stage = meta.stage;
+      node.tags = meta.tags;
+      node.localPath = meta.localPath;
+    }
+  }
+  return node;
 }
 
-export function buildGraph(weights: WeightsFile): InMemoryGraph {
+export function buildGraph(weights: WeightsFile, registry?: ProjectRegistry): InMemoryGraph {
   const nodeIndex = new Map<string, GraphNode>();
   const edgeList: GraphEdge[] = [];
   const edgeIndex = new Map<string, GraphEdge>();
@@ -33,7 +42,7 @@ export function buildGraph(weights: WeightsFile): InMemoryGraph {
 
     for (const nodeId of [entry.source_node, entry.target_node]) {
       if (!nodeIndex.has(nodeId)) {
-        nodeIndex.set(nodeId, parseNode(nodeId));
+        nodeIndex.set(nodeId, parseNode(nodeId, registry));
       }
       const adj = adjacency.get(nodeId);
       if (adj) {
diff --git a/02-api-server/src/graph/registry.ts b/02-api-server/src/graph/registry.ts
new file mode 100644
index 0000000..80220ad
--- /dev/null
+++ b/02-api-server/src/graph/registry.ts
@@ -0,0 +1,70 @@
+import { promises as fs } from 'node:fs';
+import path from 'node:path';
+import type { ProjectMeta, ProjectRegistry } from './types.js';
+
+/**
+ * Scans `localReposRoot` one level deep for devneural.json files.
+ * Returns a registry Map keyed by the project node id derived from
+ * the githubUrl field ('project:' + stripped URL scheme).
+ *
+ * Non-fatal errors (missing dir, malformed JSON, missing fields) are logged
+ * as warnings and skipped. Never throws.
+ */
+export async function buildProjectRegistry(
+  localReposRoot: string,
+): Promise<ProjectRegistry> {
+  const registry: ProjectRegistry = new Map();
+
+  let entries: string[];
+  try {
+    const dirents = await fs.readdir(localReposRoot, { withFileTypes: true });
+    entries = dirents.filter(d => d.isDirectory()).map(d => d.name);
+  } catch (err) {
+    console.warn('[DevNeural] registry: could not read localReposRoot:', err instanceof Error ? err.message : String(err));
+    return registry;
+  }
+
+  for (const entry of entries) {
+    const configPath = path.join(localReposRoot, entry, 'devneural.json');
+    let raw: string;
+    try {
+      raw = await fs.readFile(configPath, 'utf-8');
+    } catch {
+      // File not found or unreadable — skip silently
+      continue;
+    }
+
+    let parsed: unknown;
+    try {
+      parsed = JSON.parse(raw);
+    } catch (err) {
+      console.warn(`[DevNeural] registry: malformed devneural.json in ${entry}:`, err instanceof Error ? err.message : String(err));
+      continue;
+    }
+
+    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
+      continue;
+    }
+
+    const obj = parsed as Record<string, unknown>;
+    const githubUrl = typeof obj['githubUrl'] === 'string' ? obj['githubUrl'] : '';
+    const localPath = typeof obj['localPath'] === 'string' ? obj['localPath'] : '';
+    const stage = typeof obj['stage'] === 'string' ? obj['stage'] : '';
+    const tags = Array.isArray(obj['tags'])
+      ? (obj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
+      : null;
+
+    if (!githubUrl || !localPath || !stage || tags === null) {
+      continue;
+    }
+
+    // Strip URL scheme: 'https://github.com/user/repo' → 'github.com/user/repo'
+    const strippedUrl = githubUrl.replace(/^https?:\/\//, '');
+    const nodeId = `project:${strippedUrl}`;
+
+    const meta: ProjectMeta = { stage, tags, localPath };
+    registry.set(nodeId, meta);
+  }
+
+  return registry;
+}
diff --git a/02-api-server/src/graph/types.ts b/02-api-server/src/graph/types.ts
index 338625f..f5ea94d 100644
--- a/02-api-server/src/graph/types.ts
+++ b/02-api-server/src/graph/types.ts
@@ -24,8 +24,20 @@ export interface GraphNode {
   id: string;
   type: 'project' | 'tool' | 'skill';
   label: string;
+  stage?: string;      // From devneural.json: alpha | beta | deployed | archived
+  tags?: string[];     // From devneural.json: e.g. ['sandbox', 'revision-needed']
+  localPath?: string;  // Absolute path to the local project clone
 }
 
+export interface ProjectMeta {
+  stage: string;
+  tags: string[];
+  localPath: string;
+}
+
+/** Keyed by project node id: 'project:github.com/user/repo' */
+export type ProjectRegistry = Map<string, ProjectMeta>;
+
 export interface GraphEdge {
   id: string;
   source: string;
diff --git a/02-api-server/src/server.ts b/02-api-server/src/server.ts
index 0560ea9..cb36e16 100644
--- a/02-api-server/src/server.ts
+++ b/02-api-server/src/server.ts
@@ -1,13 +1,15 @@
 import Fastify, { type FastifyInstance } from 'fastify';
 import fastifyCors from '@fastify/cors';
 import fastifyWebsocket from '@fastify/websocket';
+import chokidar from 'chokidar';
 import { promises as fs } from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
 import type { AddressInfo } from 'node:net';
 import { type ServerConfig, loadConfig } from './config.js';
 import { buildGraph } from './graph/builder.js';
-import type { InMemoryGraph, WeightsFile } from './graph/types.js';
+import { buildProjectRegistry } from './graph/registry.js';
+import type { InMemoryGraph, WeightsFile, ProjectRegistry } from './graph/types.js';
 import { getFullGraph } from './graph/queries.js';
 import { registerGraphRoutes } from './routes/graph.js';
 import { registerEventsRoutes } from './routes/events.js';
@@ -16,7 +18,7 @@ import { startWatchers, stopWatchers, getEventBuffer } from './watcher/index.js'
 
 export type { ServerConfig };
 
-const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '1.0' };
+const emptyWeights: WeightsFile = { schema_version: 1, updated_at: '', connections: {} };
 
 export async function createServer(config: ServerConfig): Promise<{
   fastify: FastifyInstance;
@@ -24,7 +26,16 @@ export async function createServer(config: ServerConfig): Promise<{
   stop: () => Promise<void>;
 }> {
   const fastify = Fastify({ logger: true });
-  let graph: InMemoryGraph = buildGraph(emptyWeights);
+
+  // Build initial project registry from localReposRoot (empty if not configured)
+  let registry: ProjectRegistry = new Map();
+  if (config.localReposRoot) {
+    registry = await buildProjectRegistry(config.localReposRoot);
+  }
+
+  // Track latest weights so registry re-scans can re-enrich without re-reading disk
+  let latestWeights: WeightsFile = emptyWeights;
+  let graph: InMemoryGraph = buildGraph(emptyWeights, registry);
 
   // Register plugins (CORS first so headers apply to all routes including errors)
   await fastify.register(fastifyCors, { origin: '*' });
@@ -45,9 +56,10 @@ export async function createServer(config: ServerConfig): Promise<{
   startWatchers(
     path.join(config.dataRoot, 'weights.json'),
     path.join(config.dataRoot, 'logs'),
-    (newGraph) => {
-      graph = newGraph;
-      broadcast({ type: 'graph:snapshot', payload: getFullGraph(newGraph, new Date().toISOString()) });
+    (_unusedGraph, weights) => {
+      latestWeights = weights;
+      graph = buildGraph(weights, registry);
+      broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) });
     },
     (entry, isStartup) => {
       if (!isStartup) {
@@ -61,18 +73,34 @@ export async function createServer(config: ServerConfig): Promise<{
   // Pre-load graph from weights.json if it exists so first request gets real data
   try {
     const raw = await fs.readFile(path.join(config.dataRoot, 'weights.json'), 'utf-8');
-    graph = buildGraph(JSON.parse(raw) as WeightsFile);
+    latestWeights = JSON.parse(raw) as WeightsFile;
+    graph = buildGraph(latestWeights, registry);
   } catch (err) {
     if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
       console.error('Failed to load initial weights.json:', err);
     }
   }
 
+  // Watch localReposRoot for devneural.json changes and rebuild registry on any change
+  let registryWatcher: ReturnType<typeof chokidar.watch> | null = null;
+  if (config.localReposRoot) {
+    const handleRegistryChange = async () => {
+      registry = await buildProjectRegistry(config.localReposRoot);
+      graph = buildGraph(latestWeights, registry);
+      broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) });
+    };
+    registryWatcher = chokidar.watch(
+      path.join(config.localReposRoot, '*', 'devneural.json'),
+      { ignoreInitial: true }
+    );
+    registryWatcher.on('add', handleRegistryChange).on('change', handleRegistryChange);
+  }
+
   try {
     await fastify.listen({ port: config.port, host: '127.0.0.1' });
   } catch (err) {
     // Clean up watchers if bind fails (e.g. port already in use)
-    await stopWatchers();
+    await Promise.all([stopWatchers(), registryWatcher?.close()]);
     throw err;
   }
 
@@ -85,7 +113,7 @@ export async function createServer(config: ServerConfig): Promise<{
   const stop = async () => {
     if (stopped) return;
     stopped = true;
-    await stopWatchers();
+    await Promise.all([stopWatchers(), registryWatcher?.close()]);
     try {
       await fastify.close();
     } catch {
diff --git a/02-api-server/src/watcher/index.ts b/02-api-server/src/watcher/index.ts
index 3f82fe5..ce60378 100644
--- a/02-api-server/src/watcher/index.ts
+++ b/02-api-server/src/watcher/index.ts
@@ -20,7 +20,7 @@ let eventBuffer: LogEntry[] = [];
 export function startWatchers(
   weightsPath: string,
   logsDir: string,
-  onGraphChange: (graph: InMemoryGraph) => void,
+  onGraphChange: (graph: InMemoryGraph, weights: WeightsFile) => void,
   onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void,
   opts?: WatcherOptions
 ): void {
@@ -30,7 +30,7 @@ export function startWatchers(
     try {
       const content = await fs.promises.readFile(weightsPath, 'utf-8');
       const parsed = JSON.parse(content) as WeightsFile;
-      onGraphChange(buildGraph(parsed));
+      onGraphChange(buildGraph(parsed), parsed);
     } catch (err) {
       console.error('Failed to read/parse weights.json:', err);
     }
@@ -44,12 +44,12 @@ export function startWatchers(
     ignoreInitial: true,
   });
 
+  const emptyWeights: WeightsFile = { schema_version: 1, updated_at: '', connections: {} };
   weightsWatcher
     .on('add', handleWeightsRead)
     .on('change', handleWeightsRead)
     .on('unlink', () => {
-      const emptyWeights: WeightsFile = { schema_version: 1, updated_at: '', connections: {} };
-      onGraphChange(buildGraph(emptyWeights));
+      onGraphChange(buildGraph(emptyWeights), emptyWeights);
     });
 
   let isStartupScan = true;
diff --git a/02-api-server/src/ws/types.ts b/02-api-server/src/ws/types.ts
index ff329d4..81af8f8 100644
--- a/02-api-server/src/ws/types.ts
+++ b/02-api-server/src/ws/types.ts
@@ -4,6 +4,9 @@ const GraphNodeSchema = z.object({
   id: z.string(),
   type: z.enum(['project', 'tool', 'skill']),
   label: z.string(),
+  stage: z.string().optional(),
+  tags: z.array(z.string()).optional(),
+  localPath: z.string().optional(),
 });
 
 const GraphEdgeSchema = z.object({
diff --git a/02-api-server/tests/graph/builder.test.ts b/02-api-server/tests/graph/builder.test.ts
index 63e2231..ddd914c 100644
--- a/02-api-server/tests/graph/builder.test.ts
+++ b/02-api-server/tests/graph/builder.test.ts
@@ -1,6 +1,8 @@
 import { describe, it, expect } from 'vitest';
 import { buildGraph } from '../../src/graph/builder.js';
-import type { WeightsFile } from '../../src/graph/types.js';
+import { getFullGraph } from '../../src/graph/queries.js';
+import { ServerMessageSchema } from '../../src/ws/types.js';
+import type { WeightsFile, ProjectRegistry, ProjectMeta } from '../../src/graph/types.js';
 
 const emptyWeights: WeightsFile = {
   schema_version: 1,
@@ -215,3 +217,96 @@ describe('buildGraph', () => {
     expect(node?.label).toBe('github.com/user/repo');
   });
 });
+
+// ── ProjectRegistry enrichment ────────────────────────────────────────────────
+
+const projectWeights: WeightsFile = {
+  connections: {
+    'project:github.com/user/repo||tool:Edit': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'tool:Edit',
+      connection_type: 'project->tool',
+      raw_count: 5,
+      weight: 0.8,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-06-01T00:00:00.000Z',
+    },
+    'project:github.com/user/repo||skill:gsd:execute-phase': {
+      source_node: 'project:github.com/user/repo',
+      target_node: 'skill:gsd:execute-phase',
+      connection_type: 'project->skill',
+      raw_count: 2,
+      weight: 0.5,
+      first_seen: '2025-01-01T00:00:00.000Z',
+      last_seen: '2025-06-01T00:00:00.000Z',
+    },
+  },
+  schema_version: 1,
+  updated_at: '2025-06-01T00:00:00.000Z',
+};
+
+const repoMeta: ProjectMeta = {
+  stage: 'alpha',
+  tags: ['sandbox'],
+  localPath: 'c:/dev/user/repo',
+};
+
+describe('buildGraph with ProjectRegistry', () => {
+  it('GraphNode for a project with a registry entry gets stage, tags, and localPath populated', () => {
+    const registry: ProjectRegistry = new Map([
+      ['project:github.com/user/repo', repoMeta],
+    ]);
+    const graph = buildGraph(projectWeights, registry);
+    const node = graph.nodeIndex.get('project:github.com/user/repo');
+    expect(node?.stage).toBe('alpha');
+    expect(node?.tags).toEqual(['sandbox']);
+    expect(node?.localPath).toBe('c:/dev/user/repo');
+  });
+
+  it('GraphNode for a project WITHOUT a registry entry has no stage, tags, or localPath keys', () => {
+    const graph = buildGraph(projectWeights);
+    const node = graph.nodeIndex.get('project:github.com/user/repo');
+    // Fields must be absent (not null, not empty string)
+    const serialized = JSON.parse(JSON.stringify(node));
+    expect(serialized).not.toHaveProperty('stage');
+    expect(serialized).not.toHaveProperty('tags');
+    expect(serialized).not.toHaveProperty('localPath');
+  });
+
+  it('GraphNode for tool and skill nodes never carries stage/tags/localPath regardless of registry', () => {
+    // Even if registry has tool: or skill: entries (hypothetically), builder must not enrich them
+    const registry: ProjectRegistry = new Map([
+      ['project:github.com/user/repo', repoMeta],
+    ]);
+    const graph = buildGraph(projectWeights, registry);
+    const toolNode = graph.nodeIndex.get('tool:Edit');
+    const skillNode = graph.nodeIndex.get('skill:gsd:execute-phase');
+    for (const node of [toolNode, skillNode]) {
+      const serialized = JSON.parse(JSON.stringify(node));
+      expect(serialized).not.toHaveProperty('stage');
+      expect(serialized).not.toHaveProperty('tags');
+      expect(serialized).not.toHaveProperty('localPath');
+    }
+  });
+
+  it('graph:snapshot payload includes stage/tags/localPath on enriched project nodes', () => {
+    const registry: ProjectRegistry = new Map([
+      ['project:github.com/user/repo', repoMeta],
+    ]);
+    const graph = buildGraph(projectWeights, registry);
+    const snapshot = getFullGraph(graph, new Date().toISOString());
+    const parsed = JSON.parse(JSON.stringify(snapshot));
+    const projectNode = parsed.nodes.find((n: { id: string }) => n.id === 'project:github.com/user/repo');
+    expect(projectNode?.stage).toBe('alpha');
+    expect(projectNode?.tags).toEqual(['sandbox']);
+    expect(projectNode?.localPath).toBe('c:/dev/user/repo');
+  });
+
+  it('graph:snapshot with unenriched nodes deserializes without error via Zod schema', () => {
+    const graph = buildGraph(projectWeights);
+    const snapshot = getFullGraph(graph, new Date().toISOString());
+    const message = { type: 'graph:snapshot' as const, payload: snapshot };
+    const result = ServerMessageSchema.safeParse(message);
+    expect(result.success).toBe(true);
+  });
+});
diff --git a/02-api-server/tests/graph/queries.test.ts b/02-api-server/tests/graph/queries.test.ts
index 3f1a89d..dcdb346 100644
--- a/02-api-server/tests/graph/queries.test.ts
+++ b/02-api-server/tests/graph/queries.test.ts
@@ -28,13 +28,13 @@ function makeWeights(
       last_seen: '2025-01-01T00:00:00.000Z',
     };
   }
-  return { connections, last_updated: '2025-01-01T00:00:00.000Z', version: '1.0' };
+  return { connections, schema_version: 1, updated_at: '2025-01-01T00:00:00.000Z' };
 }
 
 const emptyWeights: WeightsFile = {
   connections: {},
-  last_updated: '2025-01-01T00:00:00.000Z',
-  version: '1.0',
+  schema_version: 1,
+  updated_at: '2025-01-01T00:00:00.000Z',
 };
 
 describe('getFullGraph', () => {
diff --git a/02-api-server/tests/graph/registry.test.ts b/02-api-server/tests/graph/registry.test.ts
new file mode 100644
index 0000000..e21161a
--- /dev/null
+++ b/02-api-server/tests/graph/registry.test.ts
@@ -0,0 +1,140 @@
+import { describe, it, expect, vi } from 'vitest';
+import * as os from 'os';
+import * as path from 'path';
+import * as fs from 'fs';
+import { buildProjectRegistry } from '../../src/graph/registry.js';
+
+// ── Helpers ───────────────────────────────────────────────────────────────────
+
+function makeTempDir(): string {
+  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
+}
+
+function cleanup(dir: string): void {
+  if (fs.existsSync(dir)) {
+    fs.rmSync(dir, { recursive: true });
+  }
+}
+
+function writeDevNeuralJson(dir: string, content: object): void {
+  fs.mkdirSync(dir, { recursive: true });
+  fs.writeFileSync(path.join(dir, 'devneural.json'), JSON.stringify(content));
+}
+
+const validConfig = {
+  name: 'My Repo',
+  localPath: 'c:/dev/my-repo',
+  githubUrl: 'https://github.com/user/my-repo',
+  stage: 'alpha',
+  tags: ['sandbox'],
+  description: 'A test repo',
+};
+
+// ── Tests ─────────────────────────────────────────────────────────────────────
+
+describe('buildProjectRegistry', () => {
+  it('scans localReposRoot and returns a Map keyed by project node id', async () => {
+    const root = makeTempDir();
+    try {
+      writeDevNeuralJson(path.join(root, 'my-repo'), validConfig);
+      const registry = await buildProjectRegistry(root);
+      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
+      const meta = registry.get('project:github.com/user/my-repo');
+      expect(meta?.stage).toBe('alpha');
+      expect(meta?.tags).toEqual(['sandbox']);
+      expect(meta?.localPath).toBe('c:/dev/my-repo');
+    } finally {
+      cleanup(root);
+    }
+  });
+
+  it('returns an empty Map when localReposRoot does not exist', async () => {
+    const stderrSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    try {
+      const registry = await buildProjectRegistry('/no/such/directory/xyz123');
+      expect(registry.size).toBe(0);
+    } finally {
+      stderrSpy.mockRestore();
+    }
+  });
+
+  it('skips directories that have no devneural.json', async () => {
+    const root = makeTempDir();
+    try {
+      // Directory without devneural.json
+      fs.mkdirSync(path.join(root, 'no-config-repo'));
+      // Directory with devneural.json
+      writeDevNeuralJson(path.join(root, 'has-config'), validConfig);
+      const registry = await buildProjectRegistry(root);
+      expect(registry.size).toBe(1);
+      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
+    } finally {
+      cleanup(root);
+    }
+  });
+
+  it('skips directories where devneural.json is malformed JSON', async () => {
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    const root = makeTempDir();
+    try {
+      const badDir = path.join(root, 'bad-json-repo');
+      fs.mkdirSync(badDir);
+      fs.writeFileSync(path.join(badDir, 'devneural.json'), '{ not valid json !!!');
+      const registry = await buildProjectRegistry(root);
+      expect(registry.size).toBe(0);
+    } finally {
+      cleanup(root);
+      warnSpy.mockRestore();
+    }
+  });
+
+  it('skips directories where devneural.json is missing required fields', async () => {
+    const root = makeTempDir();
+    try {
+      const incompleteConfig = { name: 'Incomplete', stage: 'alpha' }; // missing githubUrl, localPath, etc.
+      writeDevNeuralJson(path.join(root, 'incomplete-repo'), incompleteConfig);
+      const registry = await buildProjectRegistry(root);
+      expect(registry.size).toBe(0);
+    } finally {
+      cleanup(root);
+    }
+  });
+
+  it('includes all valid projects even when some subdirectories are invalid', async () => {
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    const root = makeTempDir();
+    try {
+      // Valid repo
+      writeDevNeuralJson(path.join(root, 'good-repo'), validConfig);
+      // Malformed JSON
+      const badDir = path.join(root, 'bad-json-repo');
+      fs.mkdirSync(badDir);
+      fs.writeFileSync(path.join(badDir, 'devneural.json'), 'not-json');
+      // Missing fields
+      writeDevNeuralJson(path.join(root, 'missing-fields-repo'), { name: 'Only Name' });
+      // No devneural.json at all
+      fs.mkdirSync(path.join(root, 'no-config-repo'));
+
+      const registry = await buildProjectRegistry(root);
+      expect(registry.size).toBe(1);
+      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
+    } finally {
+      cleanup(root);
+      warnSpy.mockRestore();
+    }
+  });
+
+  it('constructs the correct node id from the githubUrl field', async () => {
+    const root = makeTempDir();
+    try {
+      const config = { ...validConfig, githubUrl: 'https://github.com/org/some-project' };
+      writeDevNeuralJson(path.join(root, 'some-project'), config);
+      const registry = await buildProjectRegistry(root);
+      // 'https://github.com/org/some-project' → 'project:github.com/org/some-project'
+      expect(registry.has('project:github.com/org/some-project')).toBe(true);
+      expect(registry.has('project:https://github.com/org/some-project')).toBe(false);
+    } finally {
+      cleanup(root);
+    }
+  });
+});
diff --git a/02-api-server/tests/routes/graph.test.ts b/02-api-server/tests/routes/graph.test.ts
index 4bdb3a8..d7a6823 100644
--- a/02-api-server/tests/routes/graph.test.ts
+++ b/02-api-server/tests/routes/graph.test.ts
@@ -53,14 +53,14 @@ const fixtureWeights: WeightsFile = {
       last_seen: '2025-03-01T00:00:00.000Z',
     },
   },
-  last_updated: '2025-03-01T00:00:00.000Z',
-  version: '1.0',
+  schema_version: 1,
+  updated_at: '2025-03-01T00:00:00.000Z',
 };
 
 const emptyWeights: WeightsFile = {
   connections: {},
-  last_updated: '2025-01-01T00:00:00.000Z',
-  version: '1.0',
+  schema_version: 1,
+  updated_at: '2025-01-01T00:00:00.000Z',
 };
 
 let app: FastifyInstance;
@@ -148,8 +148,8 @@ describe('GET /graph/node/:id', () => {
           last_seen: '2025-01-01T00:00:00.000Z',
         },
       },
-      last_updated: '2025-01-01T00:00:00.000Z',
-      version: '1.0',
+      schema_version: 1,
+      updated_at: '2025-01-01T00:00:00.000Z',
     };
     graph = buildGraph(pathWeights);
     const res = await app.inject({
@@ -236,7 +236,7 @@ describe('GET /graph/top', () => {
         last_seen: '2025-01-01T00:00:00.000Z',
       };
     }
-    graph = buildGraph({ connections, last_updated: '2025-01-01T00:00:00.000Z', version: '1.0' });
+    graph = buildGraph({ connections, schema_version: 1, updated_at: '2025-01-01T00:00:00.000Z' });
     const res = await app.inject({ method: 'GET', url: '/graph/top?limit=200' });
     expect(res.statusCode).toBe(200);
     const body = JSON.parse(res.body);
