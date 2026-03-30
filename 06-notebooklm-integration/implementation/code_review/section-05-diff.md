diff --git a/06-notebooklm-integration/src/summary/renderer.ts b/06-notebooklm-integration/src/summary/renderer.ts
new file mode 100644
index 0000000..d927cd1
--- /dev/null
+++ b/06-notebooklm-integration/src/summary/renderer.ts
@@ -0,0 +1,30 @@
+import type { SessionSummary } from '../types.js';
+
+/** Renders a SessionSummary as an Obsidian-ready markdown block. */
+export function renderSummary(summary: SessionSummary): string {
+  const parts: string[] = [];
+
+  parts.push(`## Session: ${summary.date}`);
+  parts.push('');
+  parts.push('### What I worked on');
+  parts.push(summary.what_i_worked_on);
+
+  if (summary.graph_insights.length > 0) {
+    parts.push('');
+    parts.push('### Graph insights');
+    for (const insight of summary.graph_insights) {
+      parts.push(`- ${insight}`);
+    }
+  }
+
+  parts.push('');
+  parts.push('### Lessons learned');
+  parts.push(summary.lessons_learned);
+  parts.push('');
+  parts.push('<!-- USER NOTES: Add your own reflections here -->');
+  parts.push('');
+  parts.push('---');
+  parts.push('');
+
+  return parts.join('\n');
+}
diff --git a/06-notebooklm-integration/tests/renderer.test.ts b/06-notebooklm-integration/tests/renderer.test.ts
new file mode 100644
index 0000000..49aa3b0
--- /dev/null
+++ b/06-notebooklm-integration/tests/renderer.test.ts
@@ -0,0 +1,67 @@
+import { describe, it, expect } from 'vitest';
+import { renderSummary } from '../src/summary/renderer.js';
+import type { SessionSummary } from '../src/types.js';
+
+const fullSummary: SessionSummary = {
+  date: '2025-10-15',
+  project: 'devneural',
+  what_i_worked_on: 'Built the renderer module for Obsidian sync.',
+  graph_insights: [
+    'New connection: project:devneural → skill:obsidian-integration',
+    'High weight edge: project:devneural → tool:Write (weight: 42)',
+  ],
+  lessons_learned: 'Pure functions are easy to test.',
+};
+
+const emptySummary: SessionSummary = {
+  ...fullSummary,
+  graph_insights: [],
+};
+
+describe('renderSummary', () => {
+  it('produces correct markdown with all sections present (snapshot)', () => {
+    const result = renderSummary(fullSummary);
+    expect(result).toMatchInlineSnapshot(`
+      "## Session: 2025-10-15
+
+      ### What I worked on
+      Built the renderer module for Obsidian sync.
+
+      ### Graph insights
+      - New connection: project:devneural → skill:obsidian-integration
+      - High weight edge: project:devneural → tool:Write (weight: 42)
+
+      ### Lessons learned
+      Pure functions are easy to test.
+
+      <!-- USER NOTES: Add your own reflections here -->
+
+      ---
+      "
+    `);
+  });
+
+  it('omits the Graph insights section when graph_insights is empty', () => {
+    const result = renderSummary(emptySummary);
+    expect(result).not.toContain('### Graph insights');
+    expect(result).toContain('### What I worked on');
+    expect(result).toContain('### Lessons learned');
+  });
+
+  it('always ends the rendered string with ---', () => {
+    expect(renderSummary(fullSummary).trimEnd()).toMatch(/---$/);
+    expect(renderSummary(emptySummary).trimEnd()).toMatch(/---$/);
+  });
+
+  it('does not include DEVNEURAL_SESSIONS_START marker', () => {
+    expect(renderSummary(fullSummary)).not.toContain('DEVNEURAL_SESSIONS_START');
+    expect(renderSummary(emptySummary)).not.toContain('DEVNEURAL_SESSIONS_START');
+  });
+
+  it('uses Session: YYYY-MM-DD heading from summary.date', () => {
+    const result = renderSummary(fullSummary);
+    expect(result).toContain('## Session: 2025-10-15');
+    const otherDate: SessionSummary = { ...fullSummary, date: '2026-03-30' };
+    expect(renderSummary(otherDate)).toContain('## Session: 2026-03-30');
+  });
+});
