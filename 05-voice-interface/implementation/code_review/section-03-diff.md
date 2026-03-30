diff --git a/05-voice-interface/src/intent/local-parser.ts b/05-voice-interface/src/intent/local-parser.ts
new file mode 100644
index 0000000..9b1a172
--- /dev/null
+++ b/05-voice-interface/src/intent/local-parser.ts
@@ -0,0 +1,267 @@
+import * as natural from 'natural';
+import { IntentName, IntentResult } from './types';
+
+// ---------------------------------------------------------------------------
+// Keyword phrase table
+// A query matches a phrase group when ALL phrases in the group appear in the
+// lowercased query. Each intent can have multiple groups (OR logic between groups).
+// ---------------------------------------------------------------------------
+const KEYWORD_TABLE: Record<IntentName, string[][]> = {
+  get_top_skills: [
+    ['skills', 'most'],
+    ['top', 'skills'],
+    ['skills', 'use'],
+    ['skills', 'used'],
+    ['most', 'used', 'skills'],
+    ['frequently', 'skills'],
+  ],
+  get_context: [
+    ['current context'],
+    ['working on'],
+    ['current project'],
+    ['my context'],
+    ['what am i doing'],
+  ],
+  get_stages: [
+    ['alpha'],
+    ['beta'],
+    ['deployed'],
+    ['archived'],
+    ['stage'],
+    ['stages'],
+  ],
+  get_connections: [
+    ['connected to'],
+    ['connections for'],
+    ['connects to'],
+    ['what connects'],
+    ['linked to'],
+    ['dependencies of'],
+  ],
+  get_node: [
+    ['tell me about'],
+    ['what is'],
+    ['describe'],
+    ['about'],
+    ['info on'],
+    ['information about'],
+  ],
+  unknown: [],
+};
+
+// Fixed fast-path confidence values per intent
+const FAST_PATH_CONFIDENCE: Partial<Record<IntentName, number>> = {
+  get_top_skills: 0.95,
+  get_context: 0.95,
+  get_stages: 0.95,
+  get_connections: 0.90,
+  get_node: 0.90,
+};
+
+// ---------------------------------------------------------------------------
+// Training examples for BayesClassifier (~20 per intent)
+// ---------------------------------------------------------------------------
+interface TrainingExample {
+  text: string;
+  intent: IntentName;
+}
+
+const TRAINING_EXAMPLES: TrainingExample[] = [
+  // get_context
+  { text: 'what am I currently working on', intent: 'get_context' },
+  { text: 'show my current context', intent: 'get_context' },
+  { text: 'what project am I on', intent: 'get_context' },
+  { text: 'give me my context', intent: 'get_context' },
+  { text: 'what session context do I have', intent: 'get_context' },
+  { text: 'summarize what I am doing', intent: 'get_context' },
+  { text: 'current work summary', intent: 'get_context' },
+  { text: 'what have I been working on', intent: 'get_context' },
+  { text: 'my active project', intent: 'get_context' },
+  { text: 'what is my focus', intent: 'get_context' },
+  { text: 'recent activity context', intent: 'get_context' },
+  { text: 'show context', intent: 'get_context' },
+  { text: 'current focus area', intent: 'get_context' },
+  { text: 'what files am I editing', intent: 'get_context' },
+  { text: 'session summary', intent: 'get_context' },
+  { text: 'tell me what I am doing', intent: 'get_context' },
+  { text: 'project status', intent: 'get_context' },
+  { text: 'what task am I on', intent: 'get_context' },
+  { text: 'overview of my work', intent: 'get_context' },
+  { text: 'active task summary', intent: 'get_context' },
+
+  // get_top_skills
+  { text: 'list top skills', intent: 'get_top_skills' },
+  { text: 'show my most used skills', intent: 'get_top_skills' },
+  { text: 'what skills do I use most', intent: 'get_top_skills' },
+  { text: 'top skills ranking', intent: 'get_top_skills' },
+  { text: 'which skills am I best at', intent: 'get_top_skills' },
+  { text: 'most frequently used skills', intent: 'get_top_skills' },
+  { text: 'skill usage statistics', intent: 'get_top_skills' },
+  { text: 'what are my strongest skills', intent: 'get_top_skills' },
+  { text: 'show skill breakdown', intent: 'get_top_skills' },
+  { text: 'skill leaderboard', intent: 'get_top_skills' },
+  { text: 'which technologies do I use most', intent: 'get_top_skills' },
+  { text: 'my primary skills', intent: 'get_top_skills' },
+  { text: 'top five skills', intent: 'get_top_skills' },
+  { text: 'best skills summary', intent: 'get_top_skills' },
+  { text: 'skill frequency report', intent: 'get_top_skills' },
+  { text: 'what languages do I code in most', intent: 'get_top_skills' },
+  { text: 'top used technologies', intent: 'get_top_skills' },
+  { text: 'main competencies', intent: 'get_top_skills' },
+  { text: 'skills I have most experience with', intent: 'get_top_skills' },
+  { text: 'skill proficiency summary', intent: 'get_top_skills' },
+
+  // get_connections
+  { text: 'what is connected to DevNeural', intent: 'get_connections' },
+  { text: 'show connections for this project', intent: 'get_connections' },
+  { text: 'what connects to voice interface', intent: 'get_connections' },
+  { text: 'list dependencies of api server', intent: 'get_connections' },
+  { text: 'what links to my project', intent: 'get_connections' },
+  { text: 'find all connections', intent: 'get_connections' },
+  { text: 'related nodes for DevNeural', intent: 'get_connections' },
+  { text: 'what projects use this skill', intent: 'get_connections' },
+  { text: 'dependency graph for', intent: 'get_connections' },
+  { text: 'show graph connections', intent: 'get_connections' },
+  { text: 'what is this linked to', intent: 'get_connections' },
+  { text: 'outgoing edges from', intent: 'get_connections' },
+  { text: 'incoming connections to', intent: 'get_connections' },
+  { text: 'network of this project', intent: 'get_connections' },
+  { text: 'what depends on typescript', intent: 'get_connections' },
+  { text: 'show neighbors of react', intent: 'get_connections' },
+  { text: 'connected projects', intent: 'get_connections' },
+  { text: 'what uses this library', intent: 'get_connections' },
+  { text: 'project interconnections', intent: 'get_connections' },
+  { text: 'adjacent nodes', intent: 'get_connections' },
+
+  // get_node
+  { text: 'tell me about DevNeural', intent: 'get_node' },
+  { text: 'what is voice interface', intent: 'get_node' },
+  { text: 'describe the api server', intent: 'get_node' },
+  { text: 'give me info on typescript', intent: 'get_node' },
+  { text: 'information about react', intent: 'get_node' },
+  { text: 'details for session intelligence', intent: 'get_node' },
+  { text: 'what does DevNeural do', intent: 'get_node' },
+  { text: 'explain the web app', intent: 'get_node' },
+  { text: 'lookup node devneural', intent: 'get_node' },
+  { text: 'show me the node details', intent: 'get_node' },
+  { text: 'project description', intent: 'get_node' },
+  { text: 'what is this project about', intent: 'get_node' },
+  { text: 'node info for api', intent: 'get_node' },
+  { text: 'get details of skill', intent: 'get_node' },
+  { text: 'show node profile', intent: 'get_node' },
+  { text: 'full info on project x', intent: 'get_node' },
+  { text: 'describe skill typescript', intent: 'get_node' },
+  { text: 'what kind of node is this', intent: 'get_node' },
+  { text: 'profile of session intelligence', intent: 'get_node' },
+  { text: 'node summary for devneural', intent: 'get_node' },
+
+  // get_stages
+  { text: 'show alpha projects', intent: 'get_stages' },
+  { text: 'list projects in beta', intent: 'get_stages' },
+  { text: 'what is deployed', intent: 'get_stages' },
+  { text: 'show archived projects', intent: 'get_stages' },
+  { text: 'projects by stage', intent: 'get_stages' },
+  { text: 'filter by alpha stage', intent: 'get_stages' },
+  { text: 'what projects are live', intent: 'get_stages' },
+  { text: 'in development projects', intent: 'get_stages' },
+  { text: 'show me beta items', intent: 'get_stages' },
+  { text: 'which projects are deployed', intent: 'get_stages' },
+  { text: 'all alpha work', intent: 'get_stages' },
+  { text: 'projects currently archived', intent: 'get_stages' },
+  { text: 'list by lifecycle stage', intent: 'get_stages' },
+  { text: 'show production projects', intent: 'get_stages' },
+  { text: 'what is in beta testing', intent: 'get_stages' },
+  { text: 'inactive projects', intent: 'get_stages' },
+  { text: 'everything in alpha', intent: 'get_stages' },
+  { text: 'deployed services', intent: 'get_stages' },
+  { text: 'stage filter deployed', intent: 'get_stages' },
+  { text: 'completed and archived work', intent: 'get_stages' },
+];
+
+// ---------------------------------------------------------------------------
+// Build and train classifier at module load time
+// ---------------------------------------------------------------------------
+const classifier = new natural.BayesClassifier();
+for (const example of TRAINING_EXAMPLES) {
+  classifier.addDocument(example.text, example.intent);
+}
+classifier.train();
+
+// ---------------------------------------------------------------------------
+// normalizeConfidence
+// Applies softmax over top-2 log-probabilities returned by getClassifications().
+// Exported for unit testing.
+// ---------------------------------------------------------------------------
+export function normalizeConfidence(
+  logProbs: Array<{ label: string; value: number }>
+): number {
+  if (logProbs.length === 0) return 0;
+
+  // Sort descending (least-negative first = highest probability)
+  const sorted = [...logProbs].sort((a, b) => b.value - a.value);
+  const top1 = sorted[0].value;
+  const top2 = sorted[1]?.value ?? (top1 - 10);
+
+  const confidence =
+    Math.exp(top1) / (Math.exp(top1) + Math.exp(top2));
+
+  // Clamp to [0, 1]
+  return Math.min(1, Math.max(0, confidence));
+}
+
+// ---------------------------------------------------------------------------
+// parseLocalIntent
+// Returns null when confidence is below 0.75 (defer to Haiku).
+// ---------------------------------------------------------------------------
+export function parseLocalIntent(query: string): IntentResult | null {
+  const normalized = query.toLowerCase().trim();
+
+  // --- Keyword fast-path ---
+  const matchedIntents = new Set<IntentName>();
+
+  for (const [intentName, phraseGroups] of Object.entries(KEYWORD_TABLE) as [
+    IntentName,
+    string[][]
+  ][]) {
+    if (intentName === 'unknown') continue;
+    for (const group of phraseGroups) {
+      if (group.every((phrase) => normalized.includes(phrase))) {
+        matchedIntents.add(intentName);
+        break; // one matching group is enough for this intent
+      }
+    }
+  }
+
+  if (matchedIntents.size === 1) {
+    const intent = [...matchedIntents][0];
+    const confidence = FAST_PATH_CONFIDENCE[intent] ?? 0.90;
+    return {
+      intent,
+      confidence,
+      entities: {},
+      source: 'local',
+    };
+  }
+
+  // If 0 or 2+ intents matched, fall through to classifier
+
+  // --- BayesClassifier fallback ---
+  const classifications = classifier.getClassifications(
+    normalized
+  ) as Array<{ label: string; value: number }>;
+
+  if (!classifications || classifications.length === 0) return null;
+
+  const confidence = normalizeConfidence(classifications);
+  if (confidence < 0.75) return null;
+
+  const topLabel = classifications.sort((a, b) => b.value - a.value)[0]
+    .label as IntentName;
+
+  return {
+    intent: topLabel,
+    confidence,
+    entities: {},
+    source: 'local',
+  };
+}
diff --git a/05-voice-interface/tests/intent/local-parser.test.ts b/05-voice-interface/tests/intent/local-parser.test.ts
new file mode 100644
index 0000000..e90122b
--- /dev/null
+++ b/05-voice-interface/tests/intent/local-parser.test.ts
@@ -0,0 +1,110 @@
+import { describe, it, expect } from 'vitest';
+import { parseLocalIntent, normalizeConfidence } from '../../src/intent/local-parser';
+
+describe('normalizeConfidence', () => {
+  it('returns a value in the 0.0–1.0 range', () => {
+    const logProbs = [
+      { label: 'get_top_skills', value: -0.5 },
+      { label: 'get_context', value: -2.0 },
+      { label: 'get_connections', value: -3.0 },
+    ];
+    const result = normalizeConfidence(logProbs);
+    expect(result).toBeGreaterThanOrEqual(0.0);
+    expect(result).toBeLessThanOrEqual(1.0);
+  });
+
+  it('returns ~0.5 when top-2 log-probs are close together', () => {
+    const logProbs = [
+      { label: 'get_top_skills', value: -1.0 },
+      { label: 'get_context', value: -1.1 },
+    ];
+    const result = normalizeConfidence(logProbs);
+    expect(result).toBeGreaterThan(0.4);
+    expect(result).toBeLessThan(0.6);
+  });
+
+  it('returns near 1.0 when top-1 is much larger than top-2', () => {
+    const logProbs = [
+      { label: 'get_top_skills', value: -0.1 },
+      { label: 'get_context', value: -5.0 },
+    ];
+    const result = normalizeConfidence(logProbs);
+    expect(result).toBeGreaterThan(0.9);
+  });
+
+  it('handles single entry by using default for top2', () => {
+    const logProbs = [{ label: 'get_context', value: -0.5 }];
+    const result = normalizeConfidence(logProbs);
+    expect(result).toBeGreaterThanOrEqual(0.0);
+    expect(result).toBeLessThanOrEqual(1.0);
+  });
+});
+
+describe('parseLocalIntent - keyword fast-path', () => {
+  it('"what skills am I using most" → get_top_skills, confidence 0.95, source local', () => {
+    const result = parseLocalIntent('what skills am I using most');
+    expect(result).not.toBeNull();
+    expect(result!.intent).toBe('get_top_skills');
+    expect(result!.confidence).toBe(0.95);
+    expect(result!.source).toBe('local');
+  });
+
+  it('"what\'s my current context" → get_context, confidence ≥ 0.90, source local', () => {
+    const result = parseLocalIntent("what's my current context");
+    expect(result).not.toBeNull();
+    expect(result!.intent).toBe('get_context');
+    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
+    expect(result!.source).toBe('local');
+  });
+
+  it('"show me alpha projects" → get_stages, confidence ≥ 0.90, source local', () => {
+    const result = parseLocalIntent('show me alpha projects');
+    expect(result).not.toBeNull();
+    expect(result!.intent).toBe('get_stages');
+    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
+    expect(result!.source).toBe('local');
+  });
+
+  it('ambiguous query matching both get_connections and get_context does NOT return fast-path result', () => {
+    // "what's connected to my current project" has keywords from both get_connections and get_context
+    const result = parseLocalIntent("what's connected to my current project");
+    // Either returns null (low confidence after classifier) or a classifier result — but NOT a 0.95 fast-path hit
+    // The fast-path must not fire when two intents match
+    if (result !== null) {
+      // If classifier fires, it should not have the 0.95 fixed confidence
+      expect(result.confidence).not.toBe(0.95);
+    }
+    // No assertion on null since classifier may still resolve it
+  });
+});
+
+describe('parseLocalIntent - BayesClassifier fallback', () => {
+  it('"list top skills" → get_top_skills, confidence ≥ 0.75', () => {
+    const result = parseLocalIntent('list top skills');
+    expect(result).not.toBeNull();
+    expect(result!.intent).toBe('get_top_skills');
+    expect(result!.confidence).toBeGreaterThanOrEqual(0.75);
+  });
+
+  it('"what tools does DevNeural use" → get_connections or get_node', () => {
+    const result = parseLocalIntent('what tools does DevNeural use');
+    // May return null if confidence is low, or resolve to connections/node
+    if (result !== null) {
+      expect(['get_connections', 'get_node']).toContain(result.intent);
+    }
+  });
+
+  it('"what\'s the weather" → returns null (confidence < 0.75, defers to Haiku)', () => {
+    const result = parseLocalIntent("what's the weather");
+    expect(result).toBeNull();
+  });
+});
+
+describe('parseLocalIntent - entity extraction', () => {
+  it('returns empty entities object (entity extraction is deferred to pipeline)', () => {
+    const result = parseLocalIntent('what are my top skills');
+    if (result !== null) {
+      expect(result.entities).toEqual({});
+    }
+  });
+});
