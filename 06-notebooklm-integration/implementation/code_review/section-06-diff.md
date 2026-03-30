diff --git a/06-notebooklm-integration/src/summary/generator.ts b/06-notebooklm-integration/src/summary/generator.ts
new file mode 100644
index 0000000..c74df0d
--- /dev/null
+++ b/06-notebooklm-integration/src/summary/generator.ts
@@ -0,0 +1,132 @@
+import Anthropic from '@anthropic-ai/sdk';
+import type { SessionData, GraphInsight, SessionSummary, ObsidianSyncConfig } from '../types.js';
+
+const PLACEHOLDER = '[Summary generation failed — check ANTHROPIC_API_KEY and model config]';
+
+function extractToolNames(sessionData: SessionData): string[] {
+  const names = new Set<string>();
+  for (const entry of sessionData.entries) {
+    if (entry.tool_name) names.add(entry.tool_name);
+  }
+  return [...names].sort();
+}
+
+function extractFilePaths(sessionData: SessionData): string[] {
+  const basenames = new Set<string>();
+  for (const entry of sessionData.entries) {
+    if (entry.tool_input && typeof entry.tool_input === 'object') {
+      const fp = entry.tool_input['file_path'];
+      const p = entry.tool_input['path'];
+      for (const val of [fp, p]) {
+        if (typeof val === 'string' && val.length > 0) {
+          // Split on both / and \ to handle Windows and Unix paths
+          const parts = val.split(/[/\\]/);
+          const base = parts[parts.length - 1];
+          if (base.length > 0) basenames.add(base);
+        }
+      }
+    }
+  }
+  return [...basenames].sort();
+}
+
+function extractSkillNodes(sessionData: SessionData): string[] {
+  const skills = new Set<string>();
+  for (const event of sessionData.connection_events) {
+    if (event.target_node.startsWith('skill:')) {
+      const name = event.target_node.slice('skill:'.length);
+      if (name.length > 0) skills.add(name);
+    }
+  }
+  return [...skills].sort();
+}
+
+function buildPrompt(
+  sessionData: SessionData,
+  insights: GraphInsight[],
+): { system: string; user: string } {
+  const tools = extractToolNames(sessionData);
+  const files = extractFilePaths(sessionData);
+  const skills = extractSkillNodes(sessionData);
+
+  const system = [
+    'You are a developer reflection assistant for DevNeural, a tool-use tracking system for Claude Code sessions.',
+    'The user is a software developer keeping a personal Obsidian second-brain for reflection and knowledge management.',
+    'Your job is to synthesize structured session data into a first-person, reflective narrative.',
+    'Always respond with a JSON object containing exactly two string fields: "what_i_worked_on" and "lessons_learned".',
+    'Each field should be 2-4 sentences in first person past tense.',
+    'Do not include any markdown code fences in your response.',
+  ].join('\n');
+
+  const insightLines = insights.map(i => `  - ${i.description}`).join('\n');
+
+  const user = [
+    `Project: ${sessionData.primary_project}`,
+    `Date: ${sessionData.date}`,
+    `Session window: ${sessionData.session_start} → ${sessionData.session_end}`,
+    `Log entries: ${sessionData.entries.length}`,
+    `Connection events: ${sessionData.connection_events.length}`,
+    '',
+    `Tools used: ${tools.join(', ') || 'none'}`,
+    `Files touched: ${files.join(', ') || 'none'}`,
+    `Skills activated: ${skills.join(', ') || 'none'}`,
+    '',
+    'Graph insights from today:',
+    insightLines || '  (none)',
+    '',
+    'Please write a first-person reflection summarizing what was accomplished and what was learned.',
+    'Respond with JSON: {"what_i_worked_on": "...", "lessons_learned": "..."}',
+  ].join('\n');
+
+  return { system, user };
+}
+
+function parseResponse(text: string): { what_i_worked_on: string; lessons_learned: string } {
+  // Strip optional markdown code fences
+  const stripped = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
+  const parsed = JSON.parse(stripped) as Record<string, unknown>;
+  const wit = typeof parsed['what_i_worked_on'] === 'string' ? parsed['what_i_worked_on'] : '';
+  const ll = typeof parsed['lessons_learned'] === 'string' ? parsed['lessons_learned'] : '';
+  if (!wit || !ll) throw new Error('Missing required fields in response');
+  return { what_i_worked_on: wit, lessons_learned: ll };
+}
+
+export async function generateSummary(
+  sessionData: SessionData,
+  insights: GraphInsight[],
+  config: ObsidianSyncConfig,
+): Promise<SessionSummary> {
+  const graphInsights = insights.map(i => i.description);
+
+  try {
+    const client = new Anthropic();
+    const { system, user } = buildPrompt(sessionData, insights);
+
+    const response = await client.messages.create({
+      model: config.claude_model,
+      max_tokens: 1024,
+      system,
+      messages: [{ role: 'user', content: user }],
+    });
+
+    const text = response.content[0].text;
+    const { what_i_worked_on, lessons_learned } = parseResponse(text);
+
+    return {
+      date: sessionData.date,
+      project: sessionData.primary_project,
+      what_i_worked_on,
+      graph_insights: graphInsights,
+      lessons_learned,
+    };
+  } catch (err) {
+    console.warn(`[generator] Claude API call failed: ${(err as Error).message}`);
+    return {
+      date: sessionData.date,
+      project: sessionData.primary_project,
+      what_i_worked_on: PLACEHOLDER,
+      graph_insights: graphInsights,
+      lessons_learned: PLACEHOLDER,
+    };
+  }
+}
diff --git a/06-notebooklm-integration/tests/generator.test.ts b/06-notebooklm-integration/tests/generator.test.ts
new file mode 100644
index 0000000..bbbec0e
--- /dev/null
+++ b/06-notebooklm-integration/tests/generator.test.ts
@@ -0,0 +1,189 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import { fileURLToPath } from 'node:url';
+import path from 'node:path';
+import { readFileSync } from 'node:fs';
+import type { SessionData, GraphInsight, ObsidianSyncConfig } from '../src/types.js';
+
+// Must be called before importing the module under test
+vi.mock('@anthropic-ai/sdk');
+
+// Import after mock is set up
+const { generateSummary } = await import('../src/summary/generator.js');
+const AnthropicModule = await import('@anthropic-ai/sdk');
+const MockAnthropic = vi.mocked(AnthropicModule.default);
+
+const __dirname = path.dirname(fileURLToPath(import.meta.url));
+const fixtureJSONL = path.join(__dirname, 'fixtures', 'sample-session.jsonl');
+
+// Build SessionData from fixture
+function buildSessionData(): SessionData {
+  const lines = readFileSync(fixtureJSONL, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
+  return {
+    date: '2026-03-30',
+    primary_project: 'github.com/Omnib0mb3r/DevNeural',
+    all_projects: ['github.com/Omnib0mb3r/DevNeural', 'github.com/Omnib0mb3r/skill-connections'],
+    entries: lines,
+    session_start: '2026-03-30T10:00:00Z',
+    session_end: '2026-03-30T10:45:00Z',
+    connection_events: lines.map((e: { source_node: string; target_node: string; connection_type: string; timestamp: string }) => ({
+      source_node: e.source_node,
+      target_node: e.target_node,
+      connection_type: e.connection_type,
+      timestamp: e.timestamp,
+    })),
+  };
+}
+
+const mockInsights: GraphInsight[] = [
+  {
+    type: 'new_connection',
+    source_node: 'project:github.com/Omnib0mb3r/DevNeural',
+    target_node: 'skill:deep-plan',
+    weight: 0.42,
+    raw_count: 10,
+    description: 'New connection: project:github.com/Omnib0mb3r/DevNeural → skill:deep-plan',
+  },
+  {
+    type: 'high_weight',
+    source_node: 'project:github.com/Omnib0mb3r/DevNeural',
+    target_node: 'tool:Read',
+    weight: 0.95,
+    raw_count: 50,
+    description: 'Strong connection (weight 0.95): project:github.com/Omnib0mb3r/DevNeural → tool:Read',
+  },
+];
+
+const mockConfig: ObsidianSyncConfig = {
+  vault_path: '/vault',
+  notes_subfolder: 'DevNeural/Projects',
+  data_root: '/data',
+  api_base_url: 'http://localhost:3747',
+  prepend_sessions: true,
+  claude_model: 'claude-test-model',
+};
+
+const goodApiResponse = {
+  content: [
+    {
+      text: JSON.stringify({
+        what_i_worked_on: 'Worked on the renderer module.',
+        lessons_learned: 'Pure functions make testing simple.',
+      }),
+    },
+  ],
+};
+
+function setupMockCreate(returnValue: unknown) {
+  const mockCreate = vi.fn().mockResolvedValue(returnValue);
+  MockAnthropic.mockImplementation(() => ({
+    messages: { create: mockCreate },
+  }) as never);
+  return mockCreate;
+}
+
+describe('generateSummary', () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it('calls Anthropic SDK with expected prompt structure (project, date, tools, files, skills, insights)', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    expect(mockCreate).toHaveBeenCalledOnce();
+    const call = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
+    const userMsg = call.messages[0].content;
+    expect(userMsg).toContain('github.com/Omnib0mb3r/DevNeural');
+    expect(userMsg).toContain('2026-03-30');
+    expect(userMsg).toContain('deep-plan'); // skill without prefix
+    expect(userMsg).toContain('New connection'); // insight description
+  });
+
+  it('sends deduplicated tool_name list from LogEntry objects', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    const call = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
+    const userMsg = call.messages[0].content;
+    // Fixture has: Read, Skill, Bash, Grep, Edit — should appear deduplicated
+    expect(userMsg).toContain('Read');
+    expect(userMsg).toContain('Bash');
+    // Each tool name appears only once in the tools list (count occurrences of "Read" in context)
+    const toolSection = userMsg.match(/Tools used:([^\n]*)/)?.[1] ?? '';
+    const readCount = (toolSection.match(/Read/g) ?? []).length;
+    expect(readCount).toBe(1);
+  });
+
+  it('extracts file paths from tool_input.file_path for Read/Write/Edit entries', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    const call = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
+    const userMsg = call.messages[0].content;
+    // Fixture entry 1 has file_path: "/src/types.ts" → basename: "types.ts"
+    expect(userMsg).toContain('types.ts');
+  });
+
+  it('extracts skill nodes from connection_events (target_node starting with skill:)', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    const call = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
+    const userMsg = call.messages[0].content;
+    // Fixture has skill:deep-plan and skill:superpowers → stripped: deep-plan, superpowers
+    expect(userMsg).toContain('deep-plan');
+    expect(userMsg).toContain('superpowers');
+  });
+
+  it('parses the Claude JSON response into SessionSummary shape', async () => {
+    setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    const result = await generateSummary(sessionData, mockInsights, mockConfig);
+
+    expect(result.date).toBe('2026-03-30');
+    expect(result.project).toBe('github.com/Omnib0mb3r/DevNeural');
+    expect(result.what_i_worked_on).toBe('Worked on the renderer module.');
+    expect(result.lessons_learned).toBe('Pure functions make testing simple.');
+    expect(result.graph_insights).toEqual(mockInsights.map(i => i.description));
+  });
+
+  it('returns placeholder text when Anthropic SDK throws (no crash)', async () => {
+    const mockCreate = vi.fn().mockRejectedValue(new Error('API error'));
+    MockAnthropic.mockImplementation(() => ({
+      messages: { create: mockCreate },
+    }) as never);
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+
+    const sessionData = buildSessionData();
+    const result = await generateSummary(sessionData, mockInsights, mockConfig);
+
+    expect(result.date).toBe('2026-03-30');
+    expect(result.project).toBe('github.com/Omnib0mb3r/DevNeural');
+    expect(result.what_i_worked_on).toContain('Summary generation failed');
+    expect(result.lessons_learned).toContain('Summary generation failed');
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+
+  it('uses model from config (not hardcoded)', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    const call = mockCreate.mock.calls[0][0] as { model: string };
+    expect(call.model).toBe('claude-test-model');
+  });
+
+  it('sends max_tokens: 1024 in the API call', async () => {
+    const mockCreate = setupMockCreate(goodApiResponse);
+    const sessionData = buildSessionData();
+    await generateSummary(sessionData, mockInsights, mockConfig);
+
+    const call = mockCreate.mock.calls[0][0] as { max_tokens: number };
+    expect(call.max_tokens).toBe(1024);
+  });
+});
