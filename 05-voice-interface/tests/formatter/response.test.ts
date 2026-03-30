import { describe, it, expect } from 'vitest';
import { formatResponse } from '../../src/formatter/response';
import type { IntentResult } from '../../src/intent/types';

function makeIntent(overrides: Partial<IntentResult>): IntentResult {
  return {
    intent: 'get_top_skills',
    confidence: 0.90,
    entities: {},
    source: 'local',
    ...overrides,
  };
}

const edges = [
  { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2, connection_type: 'project->skill' },
  { source: 'tool:vim', target: 'skill:typescript', weight: 3.1, connection_type: 'tool->skill' },
  { source: 'project:github.com/user/BridgeDB', target: 'skill:python', weight: 6.0, connection_type: 'project->skill' },
];

const graph = {
  nodes: [
    { id: 'project:github.com/user/Alpha1', label: 'Alpha1', type: 'project', stage: 'alpha' },
    { id: 'project:github.com/user/Deployed1', label: 'Deployed1', type: 'project', stage: 'deployed' },
    { id: 'project:github.com/user/NoStage', label: 'NoStage', type: 'project' },
  ],
  edges: [],
};

const NO_MARKDOWN = /[*#`•\[\]]/;

describe('formatResponse - get_top_skills', () => {
  it('output contains no markdown characters', () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
    expect(result).not.toMatch(NO_MARKDOWN);
  });

  it('output contains skill names not raw node IDs', () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
    expect(result).not.toContain('skill:typescript');
    expect(result.toLowerCase()).toMatch(/typescript/i);
  });

  it('tool->skill edges include the skill in results', () => {
    const toolSkillEdges = [
      { source: 'tool:vim', target: 'skill:typescript', weight: 3.1, connection_type: 'tool->skill' },
    ];
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), toolSkillEdges, false);
    expect(result.toLowerCase()).toMatch(/typescript/i);
  });

  it('returns empty message when no skill edges', () => {
    const noSkillEdges = [
      { source: 'project:foo', target: 'tool:bar', weight: 1.0 },
    ];
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), noSkillEdges, false);
    expect(result).toContain("didn't find any skill connections");
  });
});

describe('formatResponse - get_stages', () => {
  it('no stageFilter: groups projects by stage including untracked', () => {
    const result = formatResponse(makeIntent({ intent: 'get_stages' }), graph, false);
    expect(result.toLowerCase()).toMatch(/alpha/);
    expect(result.toLowerCase()).toMatch(/deployed/);
    expect(result.toLowerCase()).toMatch(/untracked/);
  });

  it('with stageFilter=alpha: mentions only alpha projects', () => {
    const intent = makeIntent({ intent: 'get_stages', entities: { stageFilter: 'alpha' } });
    const result = formatResponse(intent, graph, false);
    expect(result.toLowerCase()).toContain('alpha');
    expect(result).toContain('Alpha1');
    expect(result).not.toContain('Deployed1');
  });
});

describe('formatResponse - null apiResult (API unavailable)', () => {
  it("output contains \"isn't running\"", () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), null, false);
    expect(result).toContain("isn't running");
  });

  it('output contains "node " followed by a path to server.js', () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), null, false);
    expect(result).toMatch(/node .+server\.js/);
  });
});

describe('formatResponse - empty result set', () => {
  it("returns message about no connections for empty get_connections result", () => {
    const intent = makeIntent({ intent: 'get_connections' });
    const result = formatResponse(intent, { nodes: [], edges: [] }, false);
    expect(result).toContain("didn't find any connections");
  });
});

describe('formatResponse - hedging', () => {
  it("hedging=true: output starts with \"I think you're asking about\"", () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, true);
    expect(result).toMatch(/^I think you're asking about/);
  });

  it('hedging=false: no hedging prefix', () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
    expect(result).not.toMatch(/^I think/);
  });
});

describe('formatResponse - get_node', () => {
  it('output mentions node label and connection count', () => {
    const nodeResult = {
      node: { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
      edges: [
        { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
        { source: 'project:github.com/user/BridgeDB', target: 'skill:typescript', weight: 6.0 },
      ],
    };
    const result = formatResponse(makeIntent({ intent: 'get_node' }), nodeResult, false);
    expect(result).toContain('TypeScript');
    expect(result).toMatch(/\d/);
  });

  it('reports no connections when edges are empty', () => {
    const nodeResult = {
      node: { id: 'skill:rust', label: 'Rust', type: 'skill' },
      edges: [],
    };
    const result = formatResponse(makeIntent({ intent: 'get_node' }), nodeResult, false);
    expect(result).toContain('Rust');
    expect(result).toContain('no connections');
  });
});

describe('formatResponse - general constraints', () => {
  it('no raw node IDs in output for get_top_skills', () => {
    const result = formatResponse(makeIntent({ intent: 'get_top_skills' }), edges, false);
    expect(result).not.toMatch(/skill:[a-z0-9./\-]+/);
    expect(result).not.toMatch(/project:[a-z0-9./\-]+/);
  });

  it('sentence count ≤ 5 for get_stages', () => {
    const result = formatResponse(makeIntent({ intent: 'get_stages' }), graph, false);
    const sentences = result.split(/\.\s+|\.$/).filter(s => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(5);
  });
});

describe('formatResponse - hedging with unknown intent', () => {
  it('hedging=true with intent=unknown does not add hedging prefix', () => {
    const result = formatResponse(makeIntent({ intent: 'unknown' }), {}, true);
    expect(result).not.toMatch(/^I think/);
  });
});

describe('formatResponse - get_context', () => {
  it('output mentions connection counts and contains no markdown', () => {
    const subgraph = {
      nodes: [
        { id: 'project:github.com/user/DevNeural', label: 'DevNeural', type: 'project' },
        { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
      ],
      edges: [
        { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
      ],
    };
    const result = formatResponse(makeIntent({ intent: 'get_context' }), subgraph, false);
    expect(result).toMatch(/\d/);
    expect(result).not.toMatch(NO_MARKDOWN);
  });
});
