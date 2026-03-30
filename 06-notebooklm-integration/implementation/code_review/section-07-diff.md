diff --git a/06-notebooklm-integration/src/obsidian/writer.ts b/06-notebooklm-integration/src/obsidian/writer.ts
new file mode 100644
index 0000000..820e648
--- /dev/null
+++ b/06-notebooklm-integration/src/obsidian/writer.ts
@@ -0,0 +1,104 @@
+import * as fs from 'node:fs';
+import * as path from 'node:path';
+import type { SessionSummary, ObsidianSyncConfig } from '../types.js';
+
+const SESSIONS_MARKER = '<!-- DEVNEURAL_SESSIONS_START -->';
+
+/**
+ * Derives a filesystem-safe slug from a project ID.
+ * Strips 'project:' prefix, splits on / and \, takes last component lowercase.
+ * Uses <penultimate>-<last> form on slug collision.
+ */
+export function deriveSlug(projectId: string, existingSlugs?: Map<string, string>): string {
+  // Strip project: prefix
+  const bare = projectId.startsWith('project:') ? projectId.slice('project:'.length) : projectId;
+
+  // Split on both / and \ to handle URLs and Windows paths
+  const parts = bare.split(/[/\\]/).filter(p => p.length > 0);
+
+  const last = (parts[parts.length - 1] ?? '').toLowerCase();
+
+  if (!existingSlugs) return last;
+
+  // Check for collision
+  const collision = [...existingSlugs.values()].includes(last);
+  if (!collision) return last;
+
+  // Use penultimate-last form
+  const penultimate = (parts[parts.length - 2] ?? '').toLowerCase();
+  return penultimate ? `${penultimate}-${last}` : last;
+}
+
+function removeSessionBlock(lines: string[], date: string): string[] {
+  const startMarker = `## Session: ${date}`;
+  const startIdx = lines.findIndex(l => l.trim() === startMarker);
+  if (startIdx === -1) return lines;
+
+  let endIdx = startIdx + 1;
+  while (endIdx < lines.length && lines[endIdx].trim() !== '---') {
+    endIdx++;
+  }
+  // Include the '---' line and any trailing blank line
+  if (endIdx < lines.length) endIdx++;
+  if (endIdx < lines.length && lines[endIdx].trim() === '') endIdx++;
+
+  return [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
+}
+
+/**
+ * Writes a rendered session summary to the appropriate Obsidian vault file.
+ */
+export function writeSessionEntry(
+  summary: SessionSummary,
+  rendered: string,
+  config: ObsidianSyncConfig,
+  options?: { force?: boolean; existingSlugs?: Map<string, string> },
+): void {
+  const slug = deriveSlug(summary.project, options?.existingSlugs);
+  const filePath = path.join(config.vault_path, config.notes_subfolder, `${slug}.md`);
+
+  // Ensure parent directories exist
+  fs.mkdirSync(path.dirname(filePath), { recursive: true });
+
+  // New file path
+  if (!fs.existsSync(filePath)) {
+    const newContent = `# ${slug}\n${SESSIONS_MARKER}\n${rendered}`;
+    fs.writeFileSync(filePath, newContent, { encoding: 'utf-8' });
+    return;
+  }
+
+  // File exists — read current content
+  let content = fs.readFileSync(filePath, { encoding: 'utf-8' });
+  const sessionHeading = `## Session: ${summary.date}`;
+
+  if (content.includes(sessionHeading)) {
+    if (!options?.force) {
+      console.log(`Session for ${summary.date} already exists in ${filePath}. Use --force to overwrite.`);
+      return;
+    }
+    // Force: remove existing session block
+    const lines = removeSessionBlock(content.split('\n'), summary.date);
+    content = lines.join('\n');
+  }
+
+  if (config.prepend_sessions) {
+    const markerIdx = content.indexOf(SESSIONS_MARKER);
+    if (markerIdx !== -1) {
+      // Insert after marker line
+      const insertPos = markerIdx + SESSIONS_MARKER.length;
+      content = content.slice(0, insertPos) + '\n' + rendered + content.slice(insertPos);
+    } else {
+      // Fallback: insert after first heading line
+      const lines = content.split('\n');
+      const headingIdx = lines.findIndex(l => l.startsWith('#'));
+      const insertAt = headingIdx !== -1 ? headingIdx + 1 : 0;
+      lines.splice(insertAt, 0, rendered);
+      content = lines.join('\n');
+    }
+  } else {
+    // Append mode
+    content = content + rendered;
+  }
+
+  fs.writeFileSync(filePath, content, { encoding: 'utf-8' });
+}
diff --git a/06-notebooklm-integration/tests/writer.test.ts b/06-notebooklm-integration/tests/writer.test.ts
new file mode 100644
index 0000000..cce1f5c
--- /dev/null
+++ b/06-notebooklm-integration/tests/writer.test.ts
@@ -0,0 +1,175 @@
+import * as fs from 'node:fs';
+import * as os from 'node:os';
+import * as path from 'node:path';
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { deriveSlug, writeSessionEntry } from '../src/obsidian/writer.js';
+import type { ObsidianSyncConfig, SessionSummary } from '../src/types.js';
+
+let tmpDir: string;
+
+beforeEach(() => {
+  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-test-'));
+});
+
+afterEach(() => {
+  fs.rmSync(tmpDir, { recursive: true, force: true });
+});
+
+function makeConfig(overrides: Partial<ObsidianSyncConfig> = {}): ObsidianSyncConfig {
+  return {
+    vault_path: tmpDir,
+    notes_subfolder: 'Projects',
+    data_root: '/data',
+    api_base_url: 'http://localhost:3747',
+    prepend_sessions: true,
+    claude_model: 'claude-haiku-4-5-20251001',
+    ...overrides,
+  };
+}
+
+function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
+  return {
+    date: '2026-03-30',
+    project: 'github.com/Omnib0mb3r/DevNeural',
+    what_i_worked_on: 'Worked on the writer module.',
+    graph_insights: [],
+    lessons_learned: 'File I/O requires careful testing.',
+    ...overrides,
+  };
+}
+
+const RENDERED = '## Session: 2026-03-30\n\n### What I worked on\nWorked on the writer module.\n\n---\n';
+
+describe('deriveSlug', () => {
+  it("strips 'project:' prefix before processing", () => {
+    expect(deriveSlug('project:github.com/user/DevNeural')).toBe(
+      deriveSlug('github.com/user/DevNeural'),
+    );
+  });
+
+  it('extracts last path component and lowercases (URL path)', () => {
+    expect(deriveSlug('github.com/Omnib0mb3r/DevNeural')).toBe('devneural');
+  });
+
+  it('extracts last path component and lowercases (Windows path with backslashes)', () => {
+    expect(deriveSlug('c:\\dev\\tools\\DevNeural')).toBe('devneural');
+  });
+
+  it("uses '<penultimate>-<last>' form when two projects would produce the same slug", () => {
+    const slugs = new Map<string, string>();
+    const slug1 = deriveSlug('github.com/user/devneural', slugs);
+    slugs.set('github.com/user/devneural', slug1);
+    const slug2 = deriveSlug('c:/dev/devneural', slugs);
+    expect(slug1).toBe('devneural');
+    expect(slug2).toBe('dev-devneural');
+  });
+});
+
+describe('writeSessionEntry', () => {
+  it('creates new file with heading and DEVNEURAL_SESSIONS_START marker when file does not exist', () => {
+    const config = makeConfig();
+    const summary = makeSummary();
+    writeSessionEntry(summary, RENDERED, config);
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    expect(fs.existsSync(filePath)).toBe(true);
+    const content = fs.readFileSync(filePath, 'utf-8');
+    expect(content).toContain('# devneural');
+    expect(content).toContain('<!-- DEVNEURAL_SESSIONS_START -->');
+    expect(content).toContain('## Session: 2026-03-30');
+  });
+
+  it('returns early (no write) and logs message when Session: YYYY-MM-DD heading already exists and --force not set', () => {
+    const config = makeConfig();
+    const summary = makeSummary();
+    writeSessionEntry(summary, RENDERED, config);
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    const contentBefore = fs.readFileSync(filePath, 'utf-8');
+    // Write a second time without force
+    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
+    writeSessionEntry(summary, RENDERED, config);
+    const contentAfter = fs.readFileSync(filePath, 'utf-8');
+    expect(contentAfter).toBe(contentBefore);
+    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
+    consoleSpy.mockRestore();
+  });
+
+  it('overwrites existing session block when --force is set', () => {
+    const config = makeConfig();
+    const summary = makeSummary();
+    writeSessionEntry(summary, RENDERED, config);
+    const updatedRendered = RENDERED.replace('Worked on the writer module.', 'Updated content.');
+    writeSessionEntry(summary, updatedRendered, config, { force: true });
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    const content = fs.readFileSync(filePath, 'utf-8');
+    expect(content).toContain('Updated content.');
+    expect(content).not.toContain('Worked on the writer module.');
+  });
+
+  it('inserts session after DEVNEURAL_SESSIONS_START marker when prepend_sessions = true', () => {
+    const config = makeConfig({ prepend_sessions: true });
+    const summary1 = makeSummary({ date: '2026-03-29' });
+    const rendered1 = RENDERED.replace('2026-03-30', '2026-03-29');
+    writeSessionEntry(summary1, rendered1, config);
+    // Now write a second session for 2026-03-30
+    writeSessionEntry(makeSummary(), RENDERED, config);
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    const content = fs.readFileSync(filePath, 'utf-8');
+    // 2026-03-30 should come BEFORE 2026-03-29 (prepended)
+    const pos30 = content.indexOf('Session: 2026-03-30');
+    const pos29 = content.indexOf('Session: 2026-03-29');
+    expect(pos30).toBeLessThan(pos29);
+  });
+
+  it('appends to end when prepend_sessions = false', () => {
+    const config = makeConfig({ prepend_sessions: false });
+    const summary1 = makeSummary({ date: '2026-03-29' });
+    const rendered1 = RENDERED.replace('2026-03-30', '2026-03-29');
+    writeSessionEntry(summary1, rendered1, config);
+    writeSessionEntry(makeSummary(), RENDERED, config);
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    const content = fs.readFileSync(filePath, 'utf-8');
+    const pos30 = content.indexOf('Session: 2026-03-30');
+    const pos29 = content.indexOf('Session: 2026-03-29');
+    // 2026-03-30 should come AFTER 2026-03-29 (appended)
+    expect(pos30).toBeGreaterThan(pos29);
+  });
+
+  it('inserts after first heading when DEVNEURAL_SESSIONS_START marker is absent (fallback)', () => {
+    const config = makeConfig();
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    fs.mkdirSync(path.join(tmpDir, 'Projects'), { recursive: true });
+    // Pre-existing file without the marker
+    fs.writeFileSync(filePath, '# devneural\n\nSome existing content.\n', 'utf-8');
+    writeSessionEntry(makeSummary(), RENDERED, config);
+    const content = fs.readFileSync(filePath, 'utf-8');
+    expect(content).toContain('## Session: 2026-03-30');
+    // Session should be inserted early (after heading, before existing content)
+    const posHeading = content.indexOf('# devneural');
+    const posSession = content.indexOf('## Session: 2026-03-30');
+    const posExisting = content.indexOf('Some existing content.');
+    expect(posSession).toBeGreaterThan(posHeading);
+    expect(posSession).toBeLessThan(posExisting);
+  });
+
+  it('creates parent directories when they do not exist (mkdirSync recursive)', () => {
+    const config = makeConfig({ notes_subfolder: 'Deep/Nested/Projects' });
+    const summary = makeSummary();
+    writeSessionEntry(summary, RENDERED, config);
+    const filePath = path.join(tmpDir, 'Deep', 'Nested', 'Projects', 'devneural.md');
+    expect(fs.existsSync(filePath)).toBe(true);
+  });
+
+  it('reads and writes files with { encoding: utf-8 } (verify no BOM)', () => {
+    const config = makeConfig();
+    const summary = makeSummary();
+    writeSessionEntry(summary, RENDERED, config);
+    const filePath = path.join(tmpDir, 'Projects', 'devneural.md');
+    const buf = fs.readFileSync(filePath);
+    // UTF-8 BOM is 0xEF, 0xBB, 0xBF
+    expect(buf[0]).not.toBe(0xef);
+    expect(buf[1]).not.toBe(0xbb);
+    expect(buf[2]).not.toBe(0xbf);
+    // Content should be valid UTF-8 string
+    expect(buf.toString('utf-8')).toContain('## Session: 2026-03-30');
+  });
+});
