diff --git a/05-voice-interface/src/intent/parser.ts b/05-voice-interface/src/intent/parser.ts
new file mode 100644
index 0000000..b5ab846
--- /dev/null
+++ b/05-voice-interface/src/intent/parser.ts
@@ -0,0 +1,78 @@
+import { parseLocalIntent } from './local-parser';
+import { parseWithHaiku, UNREACHABLE_RESULT } from './haiku-parser';
+import type { IntentResult } from './types';
+
+export interface ParsedIntent extends IntentResult {
+  /** true when confidence is 0.60–0.84 — formatter prefixes with "I think you're asking about..." */
+  hedging: boolean;
+  /** true when confidence < 0.60 — intent overridden to 'unknown', no API call downstream */
+  clarification: boolean;
+  /** true when Haiku API call failed entirely (network/quota error) */
+  unreachable: boolean;
+}
+
+/**
+ * Unified intent parsing pipeline: local parser → Haiku fallback → confidence gating.
+ * Always returns a ParsedIntent — never throws.
+ */
+export async function parseIntent(query: string): Promise<ParsedIntent> {
+  let best: IntentResult | null = null;
+  let unreachable = false;
+
+  // Step 1: try local parser
+  const localResult = parseLocalIntent(query);
+
+  if (localResult !== null && localResult.confidence >= 0.75) {
+    // Fast-path: local parser is confident enough, skip Haiku
+    best = localResult;
+  } else {
+    // Step 2: local not confident enough — call Haiku
+    const haikuResult = await parseWithHaiku(query);
+
+    if (haikuResult === UNREACHABLE_RESULT) {
+      // Haiku API is down — fall back to whatever local produced (may be null)
+      unreachable = true;
+      best = localResult; // may be null if local also returned null
+    } else {
+      // Haiku responded — use as authoritative result
+      best = haikuResult;
+    }
+  }
+
+  // Step 3: build a base result (handles null best)
+  const base: IntentResult = best ?? {
+    intent: 'unknown',
+    confidence: 0,
+    entities: {},
+    source: 'local',
+  };
+
+  // Step 4: apply confidence gates
+  const confidence = base.confidence;
+
+  if (confidence < 0.60) {
+    return {
+      ...base,
+      intent: 'unknown',
+      hedging: false,
+      clarification: true,
+      unreachable,
+    };
+  }
+
+  if (confidence < 0.85) {
+    return {
+      ...base,
+      hedging: true,
+      clarification: false,
+      unreachable,
+    };
+  }
+
+  return {
+    ...base,
+    hedging: false,
+    clarification: false,
+    unreachable,
+  };
+}
diff --git a/05-voice-interface/tests/intent/parser.test.ts b/05-voice-interface/tests/intent/parser.test.ts
new file mode 100644
index 0000000..6506a4e
--- /dev/null
+++ b/05-voice-interface/tests/intent/parser.test.ts
@@ -0,0 +1,198 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import type { IntentResult } from '../../src/intent/types';
+
+const { MOCK_UNREACHABLE } = vi.hoisted(() => ({
+  MOCK_UNREACHABLE: Symbol('unreachable'),
+}));
+
+vi.mock('../../src/intent/local-parser', () => ({
+  parseLocalIntent: vi.fn(),
+}));
+
+vi.mock('../../src/intent/haiku-parser', () => ({
+  parseWithHaiku: vi.fn(),
+  UNREACHABLE_RESULT: MOCK_UNREACHABLE,
+}));
+
+import { parseIntent } from '../../src/intent/parser';
+import { parseLocalIntent } from '../../src/intent/local-parser';
+import { parseWithHaiku } from '../../src/intent/haiku-parser';
+
+const mockParseLocal = vi.mocked(parseLocalIntent);
+const mockParseHaiku = vi.mocked(parseWithHaiku);
+
+function localResult(overrides?: Partial<IntentResult>): IntentResult {
+  return {
+    intent: 'get_top_skills',
+    confidence: 0.95,
+    entities: {},
+    source: 'local',
+    ...overrides,
+  };
+}
+
+function haikuResult(overrides?: Partial<IntentResult>): IntentResult {
+  return {
+    intent: 'get_context',
+    confidence: 0.90,
+    entities: {},
+    source: 'haiku',
+    ...overrides,
+  };
+}
+
+beforeEach(() => {
+  vi.clearAllMocks();
+});
+
+describe('parseIntent - local parser fast-path', () => {
+  it('local confidence >= 0.75 → Haiku NOT called, local result returned', async () => {
+    mockParseLocal.mockReturnValue(localResult({ confidence: 0.95, intent: 'get_top_skills' }));
+
+    const result = await parseIntent('what are my top skills');
+
+    expect(mockParseHaiku).not.toHaveBeenCalled();
+    expect(result.intent).toBe('get_top_skills');
+    expect(result.hedging).toBe(false);
+    expect(result.clarification).toBe(false);
+    expect(result.unreachable).toBe(false);
+  });
+
+  it('local confidence < 0.75 → Haiku IS called with original query', async () => {
+    mockParseLocal.mockReturnValue(localResult({ confidence: 0.60 }));
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.85 }));
+
+    await parseIntent('what am I working on');
+
+    expect(mockParseHaiku).toHaveBeenCalledOnce();
+    expect(mockParseHaiku).toHaveBeenCalledWith('what am I working on');
+  });
+
+  it('local returns null → Haiku called', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.80 }));
+
+    await parseIntent('something vague');
+
+    expect(mockParseHaiku).toHaveBeenCalledOnce();
+  });
+});
+
+describe('parseIntent - confidence gates', () => {
+  it('final confidence < 0.60 → clarification=true, intent overridden to unknown', async () => {
+    mockParseLocal.mockReturnValue(localResult({ confidence: 0.40, intent: 'get_node' }));
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.50, intent: 'get_node' }));
+
+    const result = await parseIntent('huh');
+
+    expect(result.intent).toBe('unknown');
+    expect(result.clarification).toBe(true);
+    expect(result.hedging).toBe(false);
+    expect(result.unreachable).toBe(false);
+  });
+
+  it('final confidence 0.60–0.84 → hedging=true, clarification=false', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.72, intent: 'get_stages' }));
+
+    const result = await parseIntent('projects in testing');
+
+    expect(result.intent).toBe('get_stages');
+    expect(result.hedging).toBe(true);
+    expect(result.clarification).toBe(false);
+    expect(result.unreachable).toBe(false);
+  });
+
+  it('final confidence >= 0.85 → no hedging, no clarification', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.90, intent: 'get_context' }));
+
+    const result = await parseIntent('what am I working on');
+
+    expect(result.intent).toBe('get_context');
+    expect(result.hedging).toBe(false);
+    expect(result.clarification).toBe(false);
+    expect(result.unreachable).toBe(false);
+  });
+
+  it('boundary: confidence exactly 0.60 → hedging=true', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.60 }));
+
+    const result = await parseIntent('query');
+
+    expect(result.hedging).toBe(true);
+    expect(result.clarification).toBe(false);
+  });
+
+  it('boundary: confidence exactly 0.85 → no hedging', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.85 }));
+
+    const result = await parseIntent('query');
+
+    expect(result.hedging).toBe(false);
+    expect(result.clarification).toBe(false);
+  });
+});
+
+describe('parseIntent - Haiku unreachable', () => {
+  it('Haiku unreachable → unreachable=true, falls back to local result', async () => {
+    mockParseLocal.mockReturnValue(localResult({ confidence: 0.65, intent: 'get_connections', source: 'local' }));
+    // eslint-disable-next-line @typescript-eslint/no-explicit-any
+    mockParseHaiku.mockResolvedValue(MOCK_UNREACHABLE as any);
+
+    const result = await parseIntent('what connects to DevNeural');
+
+    expect(result.unreachable).toBe(true);
+    expect(result.intent).toBe('get_connections');
+    expect(result.source).toBe('local');
+  });
+
+  it('Haiku unreachable AND local too low → unknown + clarification + unreachable', async () => {
+    mockParseLocal.mockReturnValue(localResult({ confidence: 0.30, intent: 'get_node' }));
+    // eslint-disable-next-line @typescript-eslint/no-explicit-any
+    mockParseHaiku.mockResolvedValue(MOCK_UNREACHABLE as any);
+
+    const result = await parseIntent('something');
+
+    expect(result.unreachable).toBe(true);
+    expect(result.clarification).toBe(true);
+    expect(result.intent).toBe('unknown');
+  });
+
+  it('Haiku unreachable AND local null → unknown + clarification + unreachable', async () => {
+    mockParseLocal.mockReturnValue(null);
+    // eslint-disable-next-line @typescript-eslint/no-explicit-any
+    mockParseHaiku.mockResolvedValue(MOCK_UNREACHABLE as any);
+
+    const result = await parseIntent('something');
+
+    expect(result.unreachable).toBe(true);
+    expect(result.clarification).toBe(true);
+    expect(result.intent).toBe('unknown');
+  });
+});
+
+describe('parseIntent - entity passthrough', () => {
+  it('passes entities from local result through', async () => {
+    mockParseLocal.mockReturnValue(
+      localResult({ confidence: 0.90, intent: 'get_node', entities: { nodeName: 'DevNeural' } })
+    );
+
+    const result = await parseIntent('tell me about DevNeural');
+
+    expect(result.entities.nodeName).toBe('DevNeural');
+  });
+
+  it('passes entities from haiku result through', async () => {
+    mockParseLocal.mockReturnValue(null);
+    mockParseHaiku.mockResolvedValue(
+      haikuResult({ confidence: 0.88, entities: { stageFilter: 'deployed' } })
+    );
+
+    const result = await parseIntent('what is deployed');
+
+    expect(result.entities.stageFilter).toBe('deployed');
+  });
+});
