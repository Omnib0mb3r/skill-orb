diff --git a/06-notebooklm-integration/src/session/graph-reader.ts b/06-notebooklm-integration/src/session/graph-reader.ts
new file mode 100644
index 0000000..31292f8
--- /dev/null
+++ b/06-notebooklm-integration/src/session/graph-reader.ts
@@ -0,0 +1,127 @@
+import { readFileSync } from 'node:fs';
+import { join } from 'node:path';
+import type { ObsidianSyncConfig, GraphInsight } from '../types.js';
+
+interface Edge {
+  source_node: string;
+  target_node: string;
+  weight: number;
+  raw_count: number;
+  first_seen: string;
+  last_seen: string;
+}
+
+interface GraphResponse {
+  nodes: Array<{ id: string; [key: string]: unknown }>;
+  edges: Edge[];
+}
+
+// weights.json uses a connections object keyed by "source||target"
+interface WeightsFile {
+  schema_version?: number;
+  connections: Record<string, Edge>;
+}
+
+const MILESTONE_COUNTS = new Set([10, 25, 50, 100]);
+
+async function fetchEdgesFromApi(projectId: string, config: ObsidianSyncConfig): Promise<Edge[] | null> {
+  try {
+    const url = `${config.api_base_url}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
+    const response = await fetch(url);
+    if (!response.ok) {
+      console.warn(`[graph-reader] API returned ${response.status}, falling back to file`);
+      return null;
+    }
+    const data = (await response.json()) as GraphResponse;
+    return data.edges ?? [];
+  } catch (err) {
+    console.warn(`[graph-reader] API fetch failed: ${(err as Error).message}, falling back to file`);
+    return null;
+  }
+}
+
+function loadEdgesFromFile(projectId: string, config: ObsidianSyncConfig): Edge[] | null {
+  try {
+    const weightsPath = join(config.data_root, 'weights.json');
+    const raw = readFileSync(weightsPath, { encoding: 'utf-8' });
+    const data = JSON.parse(raw) as WeightsFile;
+    const prefixed = `project:${projectId}`;
+    return Object.values(data.connections).filter(
+      e =>
+        e.source_node === projectId ||
+        e.source_node === prefixed ||
+        e.target_node === projectId ||
+        e.target_node === prefixed,
+    );
+  } catch (err) {
+    console.warn(`[graph-reader] Failed to read weights.json: ${(err as Error).message}`);
+    return null;
+  }
+}
+
+function classifyEdges(edges: Edge[], date: string): GraphInsight[] {
+  const insights: GraphInsight[] = [];
+
+  // new_connection: first_seen date portion equals date
+  for (const edge of edges) {
+    if (edge.first_seen.startsWith(date)) {
+      insights.push({
+        type: 'new_connection',
+        source_node: edge.source_node,
+        target_node: edge.target_node,
+        weight: edge.weight,
+        raw_count: edge.raw_count,
+        description: `New connection: ${edge.source_node} → ${edge.target_node}`,
+      });
+    }
+  }
+
+  // high_weight: top 3 edges by weight descending
+  // Note: may overlap with new_connection — acceptable per spec
+  const sorted = [...edges].sort((a, b) => b.weight - a.weight);
+  for (const edge of sorted.slice(0, 3)) {
+    insights.push({
+      type: 'high_weight',
+      source_node: edge.source_node,
+      target_node: edge.target_node,
+      weight: edge.weight,
+      raw_count: edge.raw_count,
+      description: `Strong connection (weight ${edge.weight.toFixed(2)}): ${edge.source_node} → ${edge.target_node}`,
+    });
+  }
+
+  // weight_milestone: last_seen date matches AND raw_count is a milestone value
+  // Note: approximate — an edge at a milestone count touched again today may be a false positive
+  for (const edge of edges) {
+    if (edge.last_seen.startsWith(date) && MILESTONE_COUNTS.has(edge.raw_count)) {
+      insights.push({
+        type: 'weight_milestone',
+        source_node: edge.source_node,
+        target_node: edge.target_node,
+        weight: edge.weight,
+        raw_count: edge.raw_count,
+        description: `Milestone: ${edge.source_node} → ${edge.target_node} reached ${edge.raw_count} uses`,
+      });
+    }
+  }
+
+  return insights;
+}
+
+export async function extractGraphInsights(
+  projectId: string,
+  date: string,
+  config: ObsidianSyncConfig,
+): Promise<GraphInsight[]> {
+  let edges = await fetchEdgesFromApi(projectId, config);
+
+  if (edges === null) {
+    edges = loadEdgesFromFile(projectId, config);
+  }
+
+  if (edges === null) {
+    return [];
+  }
+
+  return classifyEdges(edges, date);
+}
diff --git a/06-notebooklm-integration/tests/fixtures/sample-weights.json b/06-notebooklm-integration/tests/fixtures/sample-weights.json
index d9e5d4c..9334fb7 100644
--- a/06-notebooklm-integration/tests/fixtures/sample-weights.json
+++ b/06-notebooklm-integration/tests/fixtures/sample-weights.json
@@ -1,60 +1,69 @@
 {
-  "edges": [
-    {
+  "schema_version": 1,
+  "updated_at": "2026-03-30T10:45:00.000Z",
+  "connections": {
+    "project:github.com/Omnib0mb3r/DevNeural||tool:Read": {
       "source_node": "project:github.com/Omnib0mb3r/DevNeural",
       "target_node": "tool:Read",
-      "weight": 0.95,
+      "connection_type": "project->tool",
       "raw_count": 50,
-      "first_seen": "2026-03-01",
-      "last_seen": "2026-03-30"
+      "weight": 0.95,
+      "first_seen": "2026-03-01T00:00:00.000Z",
+      "last_seen": "2026-03-30T10:00:00.000Z"
     },
-    {
+    "project:github.com/Omnib0mb3r/DevNeural||tool:Edit": {
       "source_node": "project:github.com/Omnib0mb3r/DevNeural",
       "target_node": "tool:Edit",
-      "weight": 0.88,
+      "connection_type": "project->tool",
       "raw_count": 38,
-      "first_seen": "2026-03-05",
-      "last_seen": "2026-03-29"
+      "weight": 0.88,
+      "first_seen": "2026-03-05T00:00:00.000Z",
+      "last_seen": "2026-03-29T00:00:00.000Z"
     },
-    {
+    "project:github.com/Omnib0mb3r/DevNeural||tool:Bash": {
       "source_node": "project:github.com/Omnib0mb3r/DevNeural",
       "target_node": "tool:Bash",
-      "weight": 0.75,
+      "connection_type": "project->tool",
       "raw_count": 25,
-      "first_seen": "2026-03-10",
-      "last_seen": "2026-03-30"
+      "weight": 0.75,
+      "first_seen": "2026-03-10T00:00:00.000Z",
+      "last_seen": "2026-03-30T09:00:00.000Z"
     },
-    {
+    "project:github.com/Omnib0mb3r/DevNeural||skill:deep-plan": {
       "source_node": "project:github.com/Omnib0mb3r/DevNeural",
       "target_node": "skill:deep-plan",
-      "weight": 0.42,
+      "connection_type": "project->skill",
       "raw_count": 10,
-      "first_seen": "2026-03-30",
-      "last_seen": "2026-03-30"
+      "weight": 0.42,
+      "first_seen": "2026-03-30T00:00:00.000Z",
+      "last_seen": "2026-03-30T10:00:00.000Z"
     },
-    {
+    "project:github.com/Omnib0mb3r/DevNeural||project:github.com/Omnib0mb3r/skill-connections": {
       "source_node": "project:github.com/Omnib0mb3r/DevNeural",
       "target_node": "project:github.com/Omnib0mb3r/skill-connections",
-      "weight": 0.35,
+      "connection_type": "project->project",
       "raw_count": 7,
-      "first_seen": "2026-03-20",
-      "last_seen": "2026-03-28"
+      "weight": 0.35,
+      "first_seen": "2026-03-20T00:00:00.000Z",
+      "last_seen": "2026-03-28T00:00:00.000Z"
     },
-    {
+    "tool:Bash||skill:gsd-execute": {
       "source_node": "tool:Bash",
       "target_node": "skill:gsd-execute",
-      "weight": 0.55,
+      "connection_type": "tool->skill",
       "raw_count": 12,
-      "first_seen": "2026-03-15",
-      "last_seen": "2026-03-30"
+      "weight": 0.55,
+      "first_seen": "2026-03-15T00:00:00.000Z",
+      "last_seen": "2026-03-30T08:00:00.000Z"
     },
-    {
+    "project:github.com/Omnib0mb3r/skill-connections||tool:Grep": {
       "source_node": "project:github.com/Omnib0mb3r/skill-connections",
       "target_node": "tool:Grep",
-      "weight": 0.30,
+      "connection_type": "project->tool",
       "raw_count": 8,
-      "first_seen": "2026-03-15",
-      "last_seen": "2026-03-28"
+      "weight": 0.30,
+      "first_seen": "2026-03-15T00:00:00.000Z",
+      "last_seen": "2026-03-28T00:00:00.000Z"
     }
-  ]
+  }
 }
diff --git a/06-notebooklm-integration/tests/graph-reader.test.ts b/06-notebooklm-integration/tests/graph-reader.test.ts
new file mode 100644
index 0000000..c403144
--- /dev/null
+++ b/06-notebooklm-integration/tests/graph-reader.test.ts
@@ -0,0 +1,132 @@
+import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
+import { fileURLToPath } from 'node:url';
+import path from 'node:path';
+import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+import type { ObsidianSyncConfig } from '../src/types.js';
+import { extractGraphInsights } from '../src/session/graph-reader.js';
+
+const __dirname = path.dirname(fileURLToPath(import.meta.url));
+const fixtureWeightsPath = path.join(__dirname, 'fixtures', 'sample-weights.json');
+
+// Set up a temp data_root with weights.json (the file the graph-reader expects)
+const tempDataRoot = join(tmpdir(), `devneural-graph-test-${Date.now()}`);
+beforeAll(() => {
+  mkdirSync(tempDataRoot, { recursive: true });
+  writeFileSync(join(tempDataRoot, 'weights.json'), readFileSync(fixtureWeightsPath, 'utf-8'), 'utf-8');
+});
+
+const mockConfig: ObsidianSyncConfig = {
+  vault_path: '/vault',
+  notes_subfolder: 'DevNeural/Projects',
+  data_root: tempDataRoot,
+  api_base_url: 'http://localhost:3747',
+  prepend_sessions: true,
+  claude_model: 'claude-haiku-4-5-20251001',
+};
+
+const PROJECT_ID = 'github.com/Omnib0mb3r/DevNeural';
+const TEST_DATE = '2026-03-30';
+
+// Build a mock API response from the fixture edges for the given project
+function buildApiResponse() {
+  const weights = JSON.parse(readFileSync(fixtureWeightsPath, 'utf-8')) as {
+    connections: Record<string, { source_node: string; target_node: string; weight: number; raw_count: number; first_seen: string; last_seen: string }>;
+  };
+  const edges = Object.values(weights.connections).filter(
+    e => e.source_node === `project:${PROJECT_ID}` || e.source_node === PROJECT_ID,
+  );
+  return { nodes: [], edges };
+}
+
+describe('extractGraphInsights', () => {
+  afterEach(() => {
+    vi.restoreAllMocks();
+  });
+
+  it('calls API endpoint with project ID and returns parsed insights', async () => {
+    const apiResponse = buildApiResponse();
+    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
+      ok: true,
+      json: async () => apiResponse,
+    } as Response);
+
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    expect(insights.length).toBeGreaterThan(0);
+    expect(insights.every(i => i.type && i.source_node && i.description)).toBe(true);
+  });
+
+  it('falls back to reading weights.json when API returns non-200 or fetch throws', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    expect(insights.length).toBeGreaterThan(0);
+  });
+
+  it('matches project edges using both bare ID and project: prefixed ID from weights.json', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    // All source_nodes in results should reference our project
+    const projectSources = insights.filter(
+      i => i.source_node === PROJECT_ID || i.source_node === `project:${PROJECT_ID}`,
+    );
+    expect(projectSources.length).toBeGreaterThan(0);
+  });
+
+  it('identifies new_connection insights where first_seen date matches target date', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    const newConns = insights.filter(i => i.type === 'new_connection');
+    // Fixture has 2 edges with first_seen starting 2026-03-30: tool:Read's first_seen is 2026-03-01, so only skill:deep-plan
+    expect(newConns.length).toBeGreaterThanOrEqual(1);
+    expect(newConns[0].description).toContain('New connection');
+  });
+
+  it('identifies high_weight insights for top 3 edges by weight', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    const highWeight = insights.filter(i => i.type === 'high_weight');
+    expect(highWeight.length).toBeLessThanOrEqual(3);
+    expect(highWeight.length).toBeGreaterThanOrEqual(1);
+    // Sorted by weight descending
+    for (let i = 1; i < highWeight.length; i++) {
+      expect(highWeight[i - 1].weight).toBeGreaterThanOrEqual(highWeight[i].weight);
+    }
+  });
+
+  it('identifies weight_milestone insights where last_seen = today AND raw_count in [10,25,50,100]', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    const milestones = insights.filter(i => i.type === 'weight_milestone');
+    // Fixture: tool:Read has raw_count=50, last_seen=2026-03-30; tool:Bash has raw_count=25, last_seen=2026-03-30; skill:deep-plan has raw_count=10, last_seen=2026-03-30
+    expect(milestones.length).toBeGreaterThanOrEqual(1);
+    milestones.forEach(m => {
+      expect([10, 25, 50, 100]).toContain(m.raw_count);
+      expect(m.description).toContain('Milestone');
+    });
+  });
+
+  it('returns empty array when both API and file read fail (no throw)', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const badConfig: ObsidianSyncConfig = { ...mockConfig, data_root: '/nonexistent/path/99999' };
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, badConfig);
+    expect(insights).toEqual([]);
+    expect(warnSpy).toHaveBeenCalled();
+  });
+
+  it('produces plain-English description strings for each insight type', async () => {
+    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
+    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
+    for (const insight of insights) {
+      expect(typeof insight.description).toBe('string');
+      expect(insight.description.length).toBeGreaterThan(5);
+    }
+    const newConn = insights.find(i => i.type === 'new_connection');
+    const highW = insights.find(i => i.type === 'high_weight');
+    const milestone = insights.find(i => i.type === 'weight_milestone');
+    if (newConn) expect(newConn.description).toMatch(/New connection/i);
+    if (highW) expect(highW.description).toMatch(/Strong connection|weight/i);
+    if (milestone) expect(milestone.description).toMatch(/Milestone/i);
+  });
+});
