diff --git a/05-voice-interface/src/intent/haiku-parser.ts b/05-voice-interface/src/intent/haiku-parser.ts
new file mode 100644
index 0000000..bcf7a5c
--- /dev/null
+++ b/05-voice-interface/src/intent/haiku-parser.ts
@@ -0,0 +1,93 @@
+import Anthropic from '@anthropic-ai/sdk';
+import { z } from 'zod';
+import { IntentResult } from './types';
+
+const client = new Anthropic();
+
+// Zod schema for the structured JSON response from Haiku.
+// Does NOT include 'source' — that is added by this parser after parsing.
+const IntentResultSchema = z.object({
+  intent: z.enum([
+    'get_context',
+    'get_top_skills',
+    'get_connections',
+    'get_node',
+    'get_stages',
+    'unknown',
+  ]),
+  confidence: z.number().min(0).max(1),
+  entities: z.object({
+    nodeName: z.string().optional(),
+    stageFilter: z.string().optional(),
+    limit: z.number().optional(),
+  }),
+});
+
+const SYSTEM_PROMPT = `You are an intent classifier for a developer knowledge graph tool.
+
+Classify the user's query into one of these intents and extract relevant entities:
+
+Intents:
+- get_context: user asks about their current project or what they are working on
+- get_top_skills: user asks for top or most-used skills
+- get_connections: user asks what a named thing (project/skill) is connected to
+- get_node: user asks for details about a specific named node
+- get_stages: user asks about project stages (alpha, beta, deployed, archived)
+- unknown: query does not fit any of the above
+
+Entity fields to extract (leave empty object if none apply):
+- nodeName: a project or skill name mentioned in the query
+- stageFilter: one of "alpha", "beta", "deployed", "archived" if mentioned
+- limit: a numeric limit for top-N queries
+
+Respond ONLY with a JSON object in this exact format:
+{"intent": "<intent_name>", "confidence": <0.0-1.0>, "entities": {}}
+
+If the query does not fit any intent, set intent to "unknown" and confidence to 0.0.`;
+
+/**
+ * Sentinel returned when the API call fails (network error, HTTP error, etc.).
+ * Section-05 checks `result === UNREACHABLE_RESULT` to detect API failure vs
+ * a successful model response of intent: 'unknown'.
+ */
+export const UNREACHABLE_RESULT: IntentResult = Object.freeze({
+  intent: 'unknown' as const,
+  confidence: 0,
+  entities: {},
+  source: 'haiku' as const,
+});
+
+/**
+ * Parse a voice query using claude-haiku-4-5.
+ * Returns an IntentResult with source: 'haiku'.
+ * On any API failure, returns UNREACHABLE_RESULT.
+ */
+export async function parseWithHaiku(query: string): Promise<IntentResult> {
+  try {
+    const response = await client.messages.create({
+      model: 'claude-haiku-4-5',
+      max_tokens: 256,
+      system: SYSTEM_PROMPT,
+      messages: [{ role: 'user', content: query }],
+    });
+
+    // Extract text content from the response
+    const textContent = response.content.find((c) => c.type === 'text');
+    if (!textContent || textContent.type !== 'text') {
+      return UNREACHABLE_RESULT;
+    }
+
+    // Parse and validate with Zod
+    const parsed = JSON.parse(textContent.text);
+    const validated = IntentResultSchema.parse(parsed);
+
+    return {
+      ...validated,
+      source: 'haiku',
+    };
+  } catch (err) {
+    // Log to stderr so it doesn't pollute stdout (which carries the user-facing response)
+    console.error('[haiku-parser] API error:', err instanceof Error ? err.message : err);
+    return UNREACHABLE_RESULT;
+  }
+}
diff --git a/05-voice-interface/tests/intent/haiku-parser.test.ts b/05-voice-interface/tests/intent/haiku-parser.test.ts
new file mode 100644
index 0000000..37b7b73
--- /dev/null
+++ b/05-voice-interface/tests/intent/haiku-parser.test.ts
@@ -0,0 +1,137 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import type { IntentResult } from '../../src/intent/types';
+
+// Use vi.hoisted so mockCreate is available inside the vi.mock factory
+const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
+
+vi.mock('@anthropic-ai/sdk', () => {
+  return {
+    default: vi.fn().mockImplementation(() => ({
+      messages: {
+        create: mockCreate,
+      },
+    })),
+  };
+});
+
+// Import AFTER mock is set up
+import { parseWithHaiku, UNREACHABLE_RESULT } from '../../src/intent/haiku-parser';
+
+function makeResponse(json: object) {
+  return {
+    content: [{ type: 'text', text: JSON.stringify(json) }],
+    model: 'claude-haiku-4-5-20251001',
+    stop_reason: 'end_turn',
+  };
+}
+
+beforeEach(() => {
+  mockCreate.mockReset();
+});
+
+describe('parseWithHaiku - SDK call parameters', () => {
+  it('calls Anthropic SDK with correct model and max_tokens', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'get_top_skills', confidence: 0.92, entities: {} })
+    );
+    await parseWithHaiku('what are my top skills');
+    const callArgs = mockCreate.mock.calls[0][0];
+    expect(callArgs.model).toBe('claude-haiku-4-5');
+    expect(callArgs.max_tokens).toBe(256);
+  });
+
+  it('passes the query as user message content', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'get_context', confidence: 0.85, entities: {} })
+    );
+    await parseWithHaiku('what am I working on');
+    const callArgs = mockCreate.mock.calls[0][0];
+    expect(callArgs.messages).toEqual([
+      { role: 'user', content: 'what am I working on' },
+    ]);
+  });
+});
+
+describe('parseWithHaiku - successful responses', () => {
+  it('returns IntentResult with source: haiku for get_top_skills', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'get_top_skills', confidence: 0.92, entities: {} })
+    );
+    const result = await parseWithHaiku('what are my top skills');
+    expect(result.intent).toBe('get_top_skills');
+    expect(result.confidence).toBe(0.92);
+    expect(result.source).toBe('haiku');
+    expect(result.entities).toEqual({});
+  });
+
+  it('includes entity fields when Haiku returns them', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({
+        intent: 'get_node',
+        confidence: 0.88,
+        entities: { nodeName: 'DevNeural' },
+      })
+    );
+    const result = await parseWithHaiku('tell me about DevNeural');
+    expect(result.intent).toBe('get_node');
+    expect(result.entities.nodeName).toBe('DevNeural');
+    expect(result.source).toBe('haiku');
+  });
+
+  it('passes through unknown intent with low confidence (model-decided unknown)', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'unknown', confidence: 0, entities: {} })
+    );
+    const result = await parseWithHaiku("what's the weather");
+    expect(result.intent).toBe('unknown');
+    expect(result.confidence).toBe(0);
+    expect(result.source).toBe('haiku');
+    // This is NOT the UNREACHABLE_RESULT — model responded successfully
+    expect(result).not.toBe(UNREACHABLE_RESULT);
+  });
+});
+
+describe('parseWithHaiku - error paths', () => {
+  it('returns UNREACHABLE_RESULT on network failure', async () => {
+    mockCreate.mockRejectedValue(new Error('fetch failed'));
+    const result = await parseWithHaiku('what are my top skills');
+    expect(result).toBe(UNREACHABLE_RESULT);
+    expect(result.intent).toBe('unknown');
+    expect(result.confidence).toBe(0);
+    expect(result.source).toBe('haiku');
+  });
+
+  it('returns UNREACHABLE_RESULT on HTTP 429 quota error', async () => {
+    const err = new Error('rate_limit_error');
+    (err as NodeJS.ErrnoException & { status?: number }).status = 429;
+    mockCreate.mockRejectedValue(err);
+    const result = await parseWithHaiku('what are my top skills');
+    expect(result).toBe(UNREACHABLE_RESULT);
+  });
+
+  it('returns UNREACHABLE_RESULT on invalid JSON response', async () => {
+    mockCreate.mockResolvedValue({
+      content: [{ type: 'text', text: 'not valid json {{' }],
+    });
+    const result = await parseWithHaiku('what are my top skills');
+    expect(result).toBe(UNREACHABLE_RESULT);
+  });
+});
+
+describe('parseWithHaiku - Zod schema enforcement', () => {
+  it('returns UNREACHABLE_RESULT if confidence is outside 0–1 range', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'get_top_skills', confidence: 1.5, entities: {} })
+    );
+    const result = await parseWithHaiku('what are my top skills');
+    expect(result).toBe(UNREACHABLE_RESULT);
+  });
+
+  it('returns UNREACHABLE_RESULT if intent is not a valid IntentName', async () => {
+    mockCreate.mockResolvedValue(
+      makeResponse({ intent: 'invalid_intent', confidence: 0.8, entities: {} })
+    );
+    const result = await parseWithHaiku('something');
+    expect(result).toBe(UNREACHABLE_RESULT);
+  });
+});
