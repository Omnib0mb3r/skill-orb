import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentResult } from '../../src/intent/types';
import { sendOrbEvents } from '../../src/formatter/orb-events';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeIntent(overrides: Partial<IntentResult>): IntentResult {
  return {
    intent: 'get_context',
    confidence: 0.90,
    entities: {},
    source: 'local',
    ...overrides,
  };
}

function okResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  } as Response);
}

function parseBody(callIndex: number): unknown {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body as string);
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockReturnValue(okResponse());
});

const subgraph = {
  nodes: [
    { id: 'project:github.com/user/DevNeural', label: 'DevNeural', type: 'project' },
    { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
  ],
  edges: [
    { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
  ],
};

const skillEdges = [
  { source: 'project:github.com/user/DevNeural', target: 'skill:typescript', weight: 8.2 },
  { source: 'project:github.com/user/BridgeDB', target: 'skill:python', weight: 6.0 },
];

describe('sendOrbEvents - get_context', () => {
  it('sends two POSTs', async () => {
    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('first POST has type=voice:focus', async () => {
    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
    const body = parseBody(0) as { type: string };
    expect(body.type).toBe('voice:focus');
  });

  it('second POST has type=voice:highlight', async () => {
    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
    const body = parseBody(1) as { type: string };
    expect(body.type).toBe('voice:highlight');
  });

  it('focus fires before highlight (call order)', async () => {
    const callOrder: string[] = [];
    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { type: string };
      callOrder.push(body.type);
      return okResponse();
    });
    await sendOrbEvents(makeIntent({ intent: 'get_context' }), subgraph);
    expect(callOrder[0]).toBe('voice:focus');
    expect(callOrder[1]).toBe('voice:highlight');
  });
});

describe('sendOrbEvents - get_top_skills', () => {
  it('sends one POST with type=voice:highlight and nodeIds array of skill IDs', async () => {
    await sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), skillEdges);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
    expect(body.type).toBe('voice:highlight');
    expect(body.payload.nodeIds).toContain('skill:typescript');
  });
});

describe('sendOrbEvents - get_connections', () => {
  it('sends voice:focus with the resolved node ID', async () => {
    const nodeResult = {
      node: { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
      edges: [],
    };
    await sendOrbEvents(makeIntent({ intent: 'get_connections' }), nodeResult);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(0) as { type: string; payload: { nodeId: string } };
    expect(body.type).toBe('voice:focus');
    expect(body.payload.nodeId).toBe('skill:typescript');
  });
});

describe('sendOrbEvents - get_stages', () => {
  it('sends voice:highlight with matching project node IDs', async () => {
    const graph = {
      nodes: [
        { id: 'project:github.com/user/Alpha1', label: 'Alpha1', type: 'project', stage: 'alpha' },
        { id: 'project:github.com/user/Deployed1', label: 'Deployed1', type: 'project', stage: 'deployed' },
      ],
      edges: [],
    };
    const intent = makeIntent({ intent: 'get_stages', entities: { stageFilter: 'alpha' } });
    await sendOrbEvents(intent, graph);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
    expect(body.type).toBe('voice:highlight');
    expect(body.payload.nodeIds).toContain('project:github.com/user/Alpha1');
    expect(body.payload.nodeIds).not.toContain('project:github.com/user/Deployed1');
  });
});

describe('sendOrbEvents - unknown intent', () => {
  it('sends voice:clear with empty payload', async () => {
    await sendOrbEvents(makeIntent({ intent: 'unknown' }), null);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(0) as { type: string };
    expect(body.type).toBe('voice:clear');
  });
});

describe('sendOrbEvents - empty result set', () => {
  it('sends voice:highlight with nodeIds=[] and does NOT send voice:clear', async () => {
    await sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), []);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(0) as { type: string; payload: { nodeIds: string[] } };
    expect(body.type).toBe('voice:highlight');
    expect(body.payload.nodeIds).toEqual([]);
  });
});

describe('sendOrbEvents - network failures', () => {
  it('resolves without throwing when POST fails', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    await expect(
      sendOrbEvents(makeIntent({ intent: 'get_top_skills' }), skillEdges),
    ).resolves.toBeUndefined();
  });

  it('no unhandled rejection on network error for unknown intent', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    await expect(
      sendOrbEvents(makeIntent({ intent: 'unknown' }), null),
    ).resolves.toBeUndefined();
  });
});
