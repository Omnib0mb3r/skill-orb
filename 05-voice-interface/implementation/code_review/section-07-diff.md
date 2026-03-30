diff --git a/05-voice-interface/src/formatter/orb-events.ts b/05-voice-interface/src/formatter/orb-events.ts
new file mode 100644
index 0000000..052adfd
--- /dev/null
+++ b/05-voice-interface/src/formatter/orb-events.ts
@@ -0,0 +1,96 @@
+import type { IntentResult } from '../intent/types';
+
+const API_URL = `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}/voice/command`;
+
+interface GraphEdge {
+  source: string;
+  target: string;
+  weight: number;
+}
+
+interface GraphNode {
+  id: string;
+  type: string;
+  stage?: string;
+}
+
+interface GraphResponse {
+  nodes?: GraphNode[];
+  edges: GraphEdge[];
+}
+
+interface NodeResponse {
+  node: { id: string; type: string };
+  edges: GraphEdge[];
+}
+
+async function postEvent(type: string, payload: unknown): Promise<void> {
+  try {
+    await fetch(API_URL, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ type, payload }),
+    });
+  } catch {
+    // Swallow all errors — orb events are best-effort
+  }
+}
+
+export async function sendOrbEvents(
+  intent: IntentResult,
+  apiResult: unknown,
+): Promise<void> {
+  switch (intent.intent) {
+    case 'get_context': {
+      const subgraph = apiResult as GraphResponse;
+      const nodes = subgraph?.nodes ?? [];
+      const projectNode = nodes.find(n => n.type === 'project');
+      const projectId = projectNode?.id ?? '';
+
+      await postEvent('voice:focus', { nodeId: projectId });
+
+      const adjacentIds = [...new Set(
+        (subgraph?.edges ?? []).flatMap(e => [e.source, e.target]),
+      )].filter(id => id !== projectId);
+
+      await postEvent('voice:highlight', { nodeIds: adjacentIds });
+      break;
+    }
+
+    case 'get_top_skills': {
+      const edges = Array.isArray(apiResult) ? (apiResult as GraphEdge[]) : [];
+      const skillIds = [...new Set(
+        edges.filter(e => e.target?.startsWith('skill:')).map(e => e.target),
+      )].slice(0, 5);
+      await postEvent('voice:highlight', { nodeIds: skillIds });
+      break;
+    }
+
+    case 'get_connections':
+    case 'get_node': {
+      const result = apiResult as (NodeResponse & { node?: unknown }) | null;
+      if (result && 'node' in result && result.node) {
+        await postEvent('voice:focus', { nodeId: (result as NodeResponse).node.id });
+      } else {
+        await postEvent('voice:highlight', { nodeIds: [] });
+      }
+      break;
+    }
+
+    case 'get_stages': {
+      const graph = apiResult as GraphResponse;
+      const projectNodes = (graph?.nodes ?? []).filter(n => n.type === 'project');
+      const stageFilter = intent.entities.stageFilter;
+      const matchingIds = stageFilter
+        ? projectNodes.filter(n => n.stage === stageFilter).map(n => n.id)
+        : projectNodes.map(n => n.id);
+      await postEvent('voice:highlight', { nodeIds: matchingIds });
+      break;
+    }
+
+    case 'unknown':
+    default:
+      await postEvent('voice:clear', {});
+      break;
+  }
+}
diff --git a/05-voice-interface/src/formatter/response.ts b/05-voice-interface/src/formatter/response.ts
new file mode 100644
index 0000000..fb120e0
--- /dev/null
+++ b/05-voice-interface/src/formatter/response.ts
@@ -0,0 +1,197 @@
+import path from 'path';
+import type { IntentResult } from '../intent/types';
+
+const serverPath = path.resolve(__dirname, '../../../02-api-server/dist/server.js');
+
+interface GraphEdge {
+  source: string;
+  target: string;
+  weight: number;
+  connection_type?: string;
+}
+
+interface GraphNode {
+  id: string;
+  label?: string;
+  type: string;
+  stage?: string;
+}
+
+interface GraphResponse {
+  nodes?: GraphNode[];
+  edges: GraphEdge[];
+}
+
+interface NodeResponse {
+  node: { id: string; label?: string; type: string; stage?: string };
+  edges: GraphEdge[];
+}
+
+function extractLabel(nodeId: string): string {
+  const afterColon = nodeId.includes(':') ? nodeId.split(':').slice(1).join(':') : nodeId;
+  const segments = afterColon.split('/');
+  const last = segments[segments.length - 1];
+  return last.charAt(0).toUpperCase() + last.slice(1);
+}
+
+function joinList(names: string[]): string {
+  if (names.length === 1) return names[0];
+  const copy = [...names];
+  const last = copy.pop()!;
+  return `${copy.join(', ')}, and ${last}`;
+}
+
+function formatTopSkills(edges: GraphEdge[], limit: number): string {
+  const skillEdges = edges.filter(
+    e => e.target?.startsWith('skill:') || e.source?.startsWith('skill:'),
+  );
+  if (skillEdges.length === 0) {
+    return "I didn't find any skill connections in your graph.";
+  }
+
+  const weightMap = new Map<string, number>();
+  for (const e of skillEdges) {
+    const skillId = e.target?.startsWith('skill:') ? e.target : e.source;
+    weightMap.set(skillId, (weightMap.get(skillId) ?? 0) + e.weight);
+  }
+
+  const sorted = [...weightMap.entries()]
+    .sort((a, b) => b[1] - a[1])
+    .slice(0, limit);
+
+  const names = sorted.map(([id]) => extractLabel(id));
+  if (names.length === 1) return `Your top skill is ${names[0]}.`;
+  return `Your top skills are ${joinList(names)}.`;
+}
+
+function formatSubgraph(subgraph: GraphResponse): string {
+  const edges = subgraph.edges ?? [];
+  if (edges.length === 0) {
+    return "I didn't find any connections matching that query.";
+  }
+
+  const skillCount = edges.filter(
+    e => e.target?.startsWith('skill:') || e.source?.startsWith('skill:'),
+  ).length;
+  const toolCount = edges.filter(
+    e => e.target?.startsWith('tool:') || e.source?.startsWith('tool:'),
+  ).length;
+
+  const parts: string[] = [];
+  if (skillCount > 0) parts.push(`${skillCount} skill${skillCount === 1 ? '' : 's'}`);
+  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`);
+  if (parts.length === 0) parts.push(`${edges.length} connection${edges.length === 1 ? '' : 's'}`);
+
+  const nodes = subgraph.nodes ?? [];
+  const projectNode = nodes.find(n => n.type === 'project');
+  const label = projectNode
+    ? (projectNode.label ?? extractLabel(projectNode.id))
+    : 'This project';
+
+  return `${label} connects to ${parts.join(' and ')}.`;
+}
+
+function formatNode(nodeResult: NodeResponse): string {
+  const node = nodeResult.node;
+  const label = node.label ?? extractLabel(node.id);
+  const edges = nodeResult.edges ?? [];
+  if (edges.length === 0) return `${label} has no connections in your graph.`;
+  return `${label} is connected to ${edges.length} node${edges.length === 1 ? '' : 's'}.`;
+}
+
+function formatStages(graph: GraphResponse, stageFilter?: string): string {
+  const nodes = (graph.nodes ?? []).filter(n => n.type === 'project');
+
+  if (stageFilter) {
+    const matching = nodes.filter(n => n.stage === stageFilter);
+    if (matching.length === 0) {
+      return `I didn't find any ${stageFilter} projects in your graph.`;
+    }
+    const names = matching.map(n => n.label ?? extractLabel(n.id));
+    return `You have ${matching.length} ${stageFilter} project${matching.length === 1 ? '' : 's'}: ${joinList(names)}.`;
+  }
+
+  const groups = new Map<string, GraphNode[]>();
+  for (const n of nodes) {
+    const stage = n.stage ?? 'untracked';
+    if (!groups.has(stage)) groups.set(stage, []);
+    groups.get(stage)!.push(n);
+  }
+
+  if (groups.size === 0) return "I didn't find any projects in your graph.";
+
+  const sentences: string[] = [];
+  for (const [stage, stageNodes] of groups) {
+    if (sentences.length >= 5) break;
+    const names = stageNodes.map(n => n.label ?? extractLabel(n.id));
+    sentences.push(
+      `You have ${stageNodes.length} ${stage} project${stageNodes.length === 1 ? '' : 's'}: ${joinList(names)}.`,
+    );
+  }
+  return sentences.join(' ');
+}
+
+const HEDGING_LABELS: Partial<Record<string, string>> = {
+  get_context: 'your current context',
+  get_top_skills: 'your top skills',
+  get_connections: 'connections',
+  get_node: 'a specific node',
+  get_stages: 'project stages',
+};
+
+export function formatResponse(
+  intent: IntentResult,
+  apiResult: unknown,
+  hedging: boolean,
+): string {
+  if (apiResult === null) {
+    return `The DevNeural graph isn't running. Start it with: node ${serverPath}`;
+  }
+
+  let text: string;
+
+  switch (intent.intent) {
+    case 'get_top_skills': {
+      const edges = Array.isArray(apiResult) ? (apiResult as GraphEdge[]) : [];
+      text = formatTopSkills(edges, intent.entities.limit ?? 5);
+      break;
+    }
+
+    case 'get_context': {
+      text = formatSubgraph(apiResult as GraphResponse);
+      break;
+    }
+
+    case 'get_connections': {
+      const result = apiResult as (GraphResponse & { node?: unknown }) | NodeResponse;
+      if (result && 'node' in result && result.node) {
+        text = formatNode(result as NodeResponse);
+      } else {
+        text = formatSubgraph(result as GraphResponse);
+      }
+      break;
+    }
+
+    case 'get_node': {
+      text = formatNode(apiResult as NodeResponse);
+      break;
+    }
+
+    case 'get_stages': {
+      text = formatStages(apiResult as GraphResponse, intent.entities.stageFilter);
+      break;
+    }
+
+    case 'unknown':
+    default:
+      text = "I didn't understand that query. Could you rephrase it?";
+      break;
+  }
+
+  if (hedging && intent.intent !== 'unknown') {
+    const label = HEDGING_LABELS[intent.intent];
+    if (label) text = `I think you're asking about ${label}. ${text}`;
+  }
+
+  return text;
+}
diff --git a/05-voice-interface/tests/formatter/orb-events.test.ts b/05-voice-interface/tests/formatter/orb-events.test.ts
new file mode 100644
index 0000000..5fc48a3
--- /dev/null
+++ b/05-voice-interface/tests/formatter/orb-events.test.ts
@@ -0,0 +1,157 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import type { IntentResult } from '../../src/intent/types';
+import { sendOrbEvents } from '../../src/formatter/orb-events';
+
+const mockFetch = vi.fn();
+vi.stubGlobal('fetch', mockFetch);
+
+function makeIntent(overrides: Partial<IntentResult>): IntentResult {
+  return {
+    intent: 'get_context',
+    confidence: 0.90,
+    entities: {},
+    source: 'local',
+    ...overrides,
+  };
+}
+
+function okResponse() {
+  return Promise.resolve({
+    ok: true,
+    status: 200,
+    json: () => Promise.resolve({}),
+  } as Response);
+}
+
+function parseBody(callIndex: number): unknown {
+  return JSON.parse(mockFetch.mock.calls[callIndex][1].body as string);
+}
+
+beforeEach(() => {
+  mockFetch.mockReset();
+  mockFetch.mockReturnValue(okResponse());
+});
+
+const subgraph = {
+  nodes: [
+    { id: 'project:github.com/user/DevNeural', label: 'DevNeural', type: 'project' },
+    { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
+  ],
+  edges: [
+    { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
+  ],
+};
+
+const skillEdges = [
+  { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
+  { source: 'project:github.com/user/BridgeDB', target: 'skill:python', weight: 6.0 },
+];
+
+describe('sendOrbEvents - get_context', () => {
+  it('sends two POSTs', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
+    expect(mockFetch).toHaveBeenCalledTimes(2);
+  });
+
+  it('first POST has type=voice:focus', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
+    const body = parseBody(0) as { type: string };
+    expect(body.type).toBe('voice:focus');
+  });
+
+  it('second POST has type=voice:highlight', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
+    const body = parseBody(1) as { type: string };
+    expect(body.type).toBe('voice:highlight');
+  });
+
+  it('focus fires before highlight (call order)', async () => {
+    const callOrder: string[] = [];
+    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
+      const body = JSON.parse(opts.body as string) as { type: string };
+      callOrder.push(body.type);
+      return okResponse();
+    });
+    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
+    expect(callOrder[0]).toBe('voice:focus');
+    expect(callOrder[1]).toBe('voice:highlight');
+  });
+});
+
+describe('sendOrbEvents - get_top_skills', () => {
+  it('sends one POST with type=voice:highlight and nodeIds array of skill IDs', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), skillEdges);
+    expect(mockFetch).toHaveBeenCalledTimes(1);
+    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
+    expect(body.type).toBe('voice:highlight');
+    expect(body.payload.nodeIds).toContain('skill:typescript');
+  });
+});
+
+describe('sendOrbEvents - get_connections', () => {
+  it('sends voice:focus with the resolved node ID', async () => {
+    const nodeResult = {
+      node: { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
+      edges: [],
+    };
+    await sendOrbEvents(makeIntent({ intent: 'get_connections' }), nodeResult);
+    expect(mockFetch).toHaveBeenCalledTimes(1);
+    const body = parseBody(0) as { type: string; payload: { nodeId: string } };
+    expect(body.type).toBe('voice:focus');
+    expect(body.payload.nodeId).toBe('skill:typescript');
+  });
+});
+
+describe('sendOrbEvents - get_stages', () => {
+  it('sends voice:highlight with matching project node IDs', async () => {
+    const graph = {
+      nodes: [
+        { id: 'project:github.com/user/Alpha1', label: 'Alpha1', type: 'project', stage: 'alpha' },
+        { id: 'project:github.com/user/Deployed1', label: 'Deployed1', type: 'project', stage: 'deployed' },
+      ],
+      edges: [],
+    };
+    const intent = makeIntent({ intent: 'get_stages', entities: { stageFilter: 'alpha' } });
+    await sendOrbEvents(intent, graph);
+    expect(mockFetch).toHaveBeenCalledTimes(1);
+    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
+    expect(body.type).toBe('voice:highlight');
+    expect(body.payload.nodeIds).toContain('project:github.com/user/Alpha1');
+    expect(body.payload.nodeIds).not.toContain('project:github.com/user/Deployed1');
+  });
+});
+
+describe('sendOrbEvents - unknown intent', () => {
+  it('sends voice:clear with empty payload', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'unknown' }), null);
+    expect(mockFetch).toHaveBeenCalledTimes(1);
+    const body = parseBody(0) as { type: string };
+    expect(body.type).toBe('voice:clear');
+  });
+});
+
+describe('sendOrbEvents - empty result set', () => {
+  it('sends voice:highlight with nodeIds=[] and does NOT send voice:clear', async () => {
+    await sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), []);
+    expect(mockFetch).toHaveBeenCalledTimes(1);
+    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
+    expect(body.type).toBe('voice:highlight');
+    expect(body.payload.nodeIds).toEqual([]);
+  });
+});
+
+describe('sendOrbEvents - network failures', () => {
+  it('resolves without throwing when POST fails', async () => {
+    mockFetch.mockRejectedValue(new Error('Connection refused'));
+    await expect(
+      sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), skillEdges),
+    ).resolves.toBeUndefined();
+  });
+
+  it('no unhandled rejection on network error for unknown intent', async () => {
+    mockFetch.mockRejectedValue(new Error('Network error'));
+    await expect(
+      sendOrbEvents(makeIntent({ intent: 'unknown' }), null),
+    ).resolves.toBeUndefined();
+  });
+});
diff --git a/05-voice-interface/tests/formatter/response.test.ts b/05-voice-interface/tests/formatter/response.test.ts
new file mode 100644
index 0000000..c3f1250
--- /dev/null
+++ b/05-voice-interface/tests/formatter/response.test.ts
@@ -0,0 +1,139 @@
+import { describe, it, expect } from 'vitest';
+import { formatResponse } from '../../src/formatter/response';
+import type { IntentResult } from '../../src/intent/types';
+
+function makeIntent(overrides: Partial<IntentResult>): IntentResult {
+  return {
+    intent: 'get_top_skills',
+    confidence: 0.90,
+    entities: {},
+    source: 'local',
+    ...overrides,
+  };
+}
+
+const edges = [
+  { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2, connection_type: 'project->skill' },
+  { source: 'tool:vim', target: 'skill:typescript', weight: 3.1, connection_type: 'tool->skill' },
+  { source: 'project:github.com/user/BridgeDB', target: 'skill:python', weight: 6.0, connection_type: 'project->skill' },
+];
+
+const graph = {
+  nodes: [
+    { id: 'project:github.com/user/Alpha1', label: 'Alpha1', type: 'project', stage: 'alpha' },
+    { id: 'project:github.com/user/Deployed1', label: 'Deployed1', type: 'project', stage: 'deployed' },
+    { id: 'project:github.com/user/NoStage', label: 'NoStage', type: 'project' },
+  ],
+  edges: [],
+};
+
+const NO_MARKDOWN = /[*#`•\[\]]/;
+
+describe('formatResponse - get_top_skills', () => {
+  it('output contains no markdown characters', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
+    expect(result).not.toMatch(NO_MARKDOWN);
+  });
+
+  it('output contains skill names not raw node IDs', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
+    expect(result).not.toContain('skill:typescript');
+    expect(result.toLowerCase()).toMatch(/typescript/i);
+  });
+
+  it('tool->skill edges include the skill in results', () => {
+    const toolSkillEdges = [
+      { source: 'tool:vim', target: 'skill:typescript', weight: 3.1, connection_type: 'tool->skill' },
+    ];
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), toolSkillEdges, false);
+    expect(result.toLowerCase()).toMatch(/typescript/i);
+  });
+
+  it('returns empty message when no skill edges', () => {
+    const noSkillEdges = [
+      { source: 'project:foo', target: 'tool:bar', weight: 1.0 },
+    ];
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), noSkillEdges, false);
+    expect(result).toContain("didn't find any skill connections");
+  });
+});
+
+describe('formatResponse - get_stages', () => {
+  it('no stageFilter: groups projects by stage including untracked', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_stages' }), graph, false);
+    expect(result.toLowerCase()).toMatch(/alpha/);
+    expect(result.toLowerCase()).toMatch(/deployed/);
+    expect(result.toLowerCase()).toMatch(/untracked/);
+  });
+
+  it('with stageFilter=alpha: mentions only alpha projects', () => {
+    const intent = makeIntent({ intent: 'get_stages', entities: { stageFilter: 'alpha' } });
+    const result = formatResponse(intent, graph, false);
+    expect(result.toLowerCase()).toContain('alpha');
+    expect(result).toContain('Alpha1');
+    expect(result).not.toContain('Deployed1');
+  });
+});
+
+describe('formatResponse - null apiResult (API unavailable)', () => {
+  it("output contains \"isn't running\"", () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), null, false);
+    expect(result).toContain("isn't running");
+  });
+
+  it('output contains "node " followed by a path to server.js', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), null, false);
+    expect(result).toMatch(/node .+server\.js/);
+  });
+});
+
+describe('formatResponse - empty result set', () => {
+  it("returns message about no connections for empty get_connections result", () => {
+    const intent = makeIntent({ intent: 'get_connections' });
+    const result = formatResponse(intent, { nodes: [], edges: [] }, false);
+    expect(result).toContain("didn't find any connections");
+  });
+});
+
+describe('formatResponse - hedging', () => {
+  it("hedging=true: output starts with \"I think you're asking about\"", () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, true);
+    expect(result).toMatch(/^I think you're asking about/);
+  });
+
+  it('hedging=false: no hedging prefix', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
+    expect(result).not.toMatch(/^I think/);
+  });
+});
+
+describe('formatResponse - general constraints', () => {
+  it('no raw node IDs in output for get_top_skills', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
+    expect(result).not.toMatch(/skill:[a-z0-9./\-]+/);
+    expect(result).not.toMatch(/project:[a-z0-9./\-]+/);
+  });
+
+  it('sentence count ≤ 5 for get_stages', () => {
+    const result = formatResponse(makeIntent({ intent: 'get_stages' }), graph, false);
+    const sentences = result.split(/\.\s+|\.$/).filter(s => s.trim().length > 0);
+    expect(sentences.length).toBeLessThanOrEqual(5);
+  });
+});
+
+describe('formatResponse - get_context', () => {
+  it('output mentions connection counts and contains no markdown', () => {
+    const subgraph = {
+      nodes: [
+        { id: 'project:github.com/user/DevNeural', label: 'DevNeural', type: 'project' },
+        { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
+      ],
+      edges: [
+        { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
+      ],
+    };
+    const result = formatResponse(makeIntent({ intent: 'get_context' }), subgraph, false);
+    expect(result).toMatch(/\d/);
+    expect(result).not.toMatch(NO_MARKDOWN);
+  });
+});
