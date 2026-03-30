import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentResult } from '../../src/intent/types';
import type { ApiClientConfig, GraphNode } from '../../src/routing/api-client';
import { executeIntentRequest, resolveLabel } from '../../src/routing/intent-map';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const config: ApiClientConfig = { apiUrl: 'http://localhost:3747', timeoutMs: 5000 };
const PROJECT_ID = 'project:github.com/user/devneural';

function makeIntent(overrides: Partial<IntentResult>): IntentResult {
  return {
    intent: 'get_context',
    confidence: 0.90,
    entities: {},
    source: 'local',
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

const SAMPLE_NODES: GraphNode[] = [
  { id: 'project:github.com/user/devneural', label: 'DevNeural', type: 'project' },
  { id: 'skill:typescript', label: 'TypeScript', type: 'skill' },
];

const FULL_GRAPH = { nodes: SAMPLE_NODES, edges: [], updated_at: '2024-01-01' };

beforeEach(() => {
  mockFetch.mockReset();
});

describe('executeIntentRequest - get_context', () => {
  it('requests /graph/subgraph?project={resolvedProjectId}', async () => {
    mockFetch.mockReturnValue(okResponse({ nodes: [], edges: [] }));
    await executeIntentRequest(makeIntent({ intent: 'get_context' }), PROJECT_ID, config);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toContain('/graph/subgraph?project=');
    expect(mockFetch.mock.calls[0][0]).toContain(encodeURIComponent(PROJECT_ID));
  });
});

describe('executeIntentRequest - get_top_skills', () => {
  it('always requests /graph/top?limit=100 regardless of entities.limit', async () => {
    mockFetch.mockReturnValue(okResponse([]));
    await executeIntentRequest(makeIntent({ intent: 'get_top_skills' }), PROJECT_ID, config);
    expect(mockFetch.mock.calls[0][0]).toContain('limit=100');
  });

  it('uses limit=100 even when entities.limit=5', async () => {
    mockFetch.mockReturnValue(okResponse([]));
    await executeIntentRequest(makeIntent({ intent: 'get_top_skills', entities: { limit: 5 } }), PROJECT_ID, config);
    expect(mockFetch.mock.calls[0][0]).toContain('limit=100');
  });
});

describe('executeIntentRequest - get_connections', () => {
  it('with nodeName: makes two fetches (GET /graph then GET /graph/node/{id})', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse(FULL_GRAPH))
      .mockReturnValueOnce(okResponse({ node: 'data' }));
    const result = await executeIntentRequest(
      makeIntent({ intent: 'get_connections', entities: { nodeName: 'DevNeural' } }),
      PROJECT_ID,
      config,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('/graph');
    expect(mockFetch.mock.calls[1][0]).toContain('/graph/node/');
    expect(result?.resolvedNodeId).toBe('project:github.com/user/devneural');
  });

  it('without nodeName: requests /graph/subgraph?project={projectId}', async () => {
    mockFetch.mockReturnValue(okResponse({ nodes: [], edges: [] }));
    await executeIntentRequest(makeIntent({ intent: 'get_connections' }), PROJECT_ID, config);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toContain('/graph/subgraph');
  });
});

describe('executeIntentRequest - get_node', () => {
  it('makes two fetches: GET /graph then GET /graph/node/{id}', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse(FULL_GRAPH))
      .mockReturnValueOnce(okResponse({ id: 'skill:typescript' }));
    const result = await executeIntentRequest(
      makeIntent({ intent: 'get_node', entities: { nodeName: 'TypeScript' } }),
      PROJECT_ID,
      config,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result?.resolvedNodeId).toBe('skill:typescript');
  });

  it('returns null when nodeName is absent', async () => {
    const result = await executeIntentRequest(makeIntent({ intent: 'get_node' }), PROJECT_ID, config);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('executeIntentRequest - get_stages', () => {
  it('requests /graph (full graph)', async () => {
    mockFetch.mockReturnValue(okResponse(FULL_GRAPH));
    await executeIntentRequest(makeIntent({ intent: 'get_stages' }), PROJECT_ID, config);
    expect(mockFetch).toHaveBeenCalledOnce();
    const url: string = mockFetch.mock.calls[0][0];
    expect(url.endsWith('/graph')).toBe(true);
  });
});

describe('executeIntentRequest - unknown', () => {
  it('returns null with no API call', async () => {
    const result = await executeIntentRequest(makeIntent({ intent: 'unknown' }), PROJECT_ID, config);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('resolveLabel', () => {
  it('returns node id on case-insensitive exact match', () => {
    const nodes: GraphNode[] = [
      { id: 'project:github.com/user/repo', label: 'MyProject', type: 'project' },
    ];
    expect(resolveLabel('myproject', nodes)).toBe('project:github.com/user/repo');
  });

  it('returns null when no match', () => {
    expect(resolveLabel('nonexistent', SAMPLE_NODES)).toBeNull();
  });

  it('exact match wins over partial match', () => {
    const nodes: GraphNode[] = [
      { id: 'id:partial', label: 'Dev', type: 'project' },
      { id: 'id:exact', label: 'DevNeural', type: 'project' },
    ];
    expect(resolveLabel('devneural', nodes)).toBe('id:exact');
    expect(resolveLabel('dev', nodes)).toBe('id:partial');
  });

  it('handles nodes without label gracefully', () => {
    const nodes: GraphNode[] = [
      { id: 'id:nolabel', type: 'project' },
    ];
    expect(resolveLabel('anything', nodes)).toBeNull();
  });
});

describe('fetchWithTimeout', () => {
  it('returns null on network failure', async () => {
    const { fetchWithTimeout } = await import('../../src/routing/api-client');
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await fetchWithTimeout('http://localhost:3747/test');
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    const { fetchWithTimeout } = await import('../../src/routing/api-client');
    mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 404 } as Response));
    const result = await fetchWithTimeout('http://localhost:3747/test');
    expect(result).toBeNull();
  });

  it('returns parsed JSON body on 200 response', async () => {
    const { fetchWithTimeout } = await import('../../src/routing/api-client');
    mockFetch.mockReturnValue(okResponse({ hello: 'world' }));
    const result = await fetchWithTimeout('http://localhost:3747/test');
    expect(result).toEqual({ hello: 'world' });
  });

  it('URL-encodes node ID with reserved characters in the path', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse({ nodes: [{ id: 'project:org/repo+name', label: 'Repo+Name', type: 'project' }], edges: [] }))
      .mockReturnValueOnce(okResponse({ data: true }));
    await executeIntentRequest(
      makeIntent({ intent: 'get_node', entities: { nodeName: 'Repo+Name' } }),
      PROJECT_ID,
      config,
    );
    const nodeUrl: string = mockFetch.mock.calls[1][0];
    expect(nodeUrl).toContain(encodeURIComponent('project:org/repo+name'));
  });
});
