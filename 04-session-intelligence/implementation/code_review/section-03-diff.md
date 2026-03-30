## section-03-api-client diff

```diff
diff --git a/04-session-intelligence/src/api-client.ts b/04-session-intelligence/src/api-client.ts
new file mode 100644
index 0000000..ea3d88f
--- /dev/null
+++ b/04-session-intelligence/src/api-client.ts
@@ -0,0 +1,57 @@
+export interface GraphNode {
+  id: string;
+  type: 'project' | 'tool' | 'skill';
+  label: string;
+  stage?: string;
+  tags?: string[];
+  localPath?: string;
+}
+
+export interface GraphEdge {
+  id: string;
+  source: string;
+  target: string;
+  connection_type: string;
+  raw_count: number;
+  weight: number;
+  first_seen: string;
+  last_seen: string;
+}
+
+export interface GraphResponse {
+  nodes: GraphNode[];
+  edges: GraphEdge[];
+  updated_at: string;
+}
+
+export interface ApiClientConfig {
+  apiUrl: string;
+  timeoutMs: number;
+}
+
+export function buildApiConfig(): ApiClientConfig {
+  if (process.env.DEVNEURAL_API_URL) {
+    return { apiUrl: process.env.DEVNEURAL_API_URL, timeoutMs: 5000 };
+  }
+  return {
+    apiUrl: `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}`,
+    timeoutMs: 5000,
+  };
+}
+
+export async function fetchSubgraph(
+  projectId: string,
+  config: ApiClientConfig,
+): Promise<GraphResponse | null> {
+  try {
+    const url = `${config.apiUrl}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
+    const response = await fetch(url, {
+      signal: AbortSignal.timeout(config.timeoutMs),
+    });
+    if (!response.ok) return null;
+    const data = await response.json() as GraphResponse;
+    return data;
+  } catch {
+    return null;
+  }
+}
diff --git a/04-session-intelligence/tests/api-client.test.ts b/04-session-intelligence/tests/api-client.test.ts
new file mode 100644
index 0000000..1dbf6ee
--- /dev/null
+++ b/04-session-intelligence/tests/api-client.test.ts
@@ -0,0 +1,126 @@
+import { describe, it, expect, afterEach } from 'vitest';
+import * as http from 'node:http';
+import { fetchSubgraph, buildApiConfig } from '../src/api-client';
...
```
