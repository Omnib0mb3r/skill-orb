import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { buildGraph } from '../../src/graph/builder.js';
import { registerGraphRoutes } from '../../src/routes/graph.js';
import type { WeightsFile, InMemoryGraph } from '../../src/graph/types.js';

const fixtureWeights: WeightsFile = {
  connections: {
    'project:github.com/user/repo||tool:Bash': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Bash',
      connection_type: 'project->tool',
      raw_count: 5,
      weight: 0.8,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
    'project:github.com/user/repo||tool:Edit': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Edit',
      connection_type: 'project->tool',
      raw_count: 10,
      weight: 0.9,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
    'project:github.com/user/other||tool:Read': {
      source_node: 'project:github.com/user/other',
      target_node: 'tool:Read',
      connection_type: 'project->tool',
      raw_count: 3,
      weight: 0.5,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
    'project:github.com/user/repo||skill:gsd': {
      source_node: 'project:github.com/user/repo',
      target_node: 'skill:gsd',
      connection_type: 'project->skill',
      raw_count: 7,
      weight: 0.7,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
    'project:github.com/user/other||skill:tdd': {
      source_node: 'project:github.com/user/other',
      target_node: 'skill:tdd',
      connection_type: 'project->skill',
      raw_count: 2,
      weight: 0.3,
      first_seen: '2025-01-01T00:00:00.000Z',
      last_seen: '2025-03-01T00:00:00.000Z',
    },
  },
  schema_version: 1,
  updated_at: '2025-03-01T00:00:00.000Z',
};

const emptyWeights: WeightsFile = {
  connections: {},
  schema_version: 1,
  updated_at: '2025-01-01T00:00:00.000Z',
};

let app: FastifyInstance;
let graph: InMemoryGraph;

beforeEach(async () => {
  graph = buildGraph(fixtureWeights);
  app = Fastify();
  await app.register(cors, { origin: '*' });
  registerGraphRoutes(app, () => graph);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with { status: "ok", uptime: <number> }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});

describe('GET /graph', () => {
  it('returns 200 with empty GraphResponse when graph is empty', async () => {
    graph = buildGraph(emptyWeights);
    const res = await app.inject({ method: 'GET', url: '/graph' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(typeof body.updated_at).toBe('string');
  });

  it('returns 200 with populated GraphResponse when fixture graph is loaded', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.nodes.length).toBe(graph.nodeIndex.size);
    expect(body.edges.length).toBe(graph.edgeList.length);
    expect(typeof body.updated_at).toBe('string');
  });

  it('includes CORS header Access-Control-Allow-Origin: *', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('GET /graph/node/:id', () => {
  it('returns 200 with { node, edges } for a known node id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/graph/node/project:github.com%2Fuser%2Frepo',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.node.id).toBe('project:github.com/user/repo');
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('returns 404 with { error: "Node not found" } for an unknown node id', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/node/project:nonexistent' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Node not found');
  });

  it('URL-decodes the :id parameter', async () => {
    // project:c%3A/dev → project:c:/dev
    const pathWeights: WeightsFile = {
      connections: {
        'project:c:/dev||tool:Edit': {
          source_node: 'project:c:/dev',
          target_node: 'tool:Edit',
          connection_type: 'project->tool',
          raw_count: 1,
          weight: 1.0,
          first_seen: '2025-01-01T00:00:00.000Z',
          last_seen: '2025-01-01T00:00:00.000Z',
        },
      },
      schema_version: 1,
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    graph = buildGraph(pathWeights);
    const res = await app.inject({
      method: 'GET',
      url: '/graph/node/project%3Ac%3A%2Fdev',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.node.id).toBe('project:c:/dev');
  });
});

describe('GET /graph/subgraph', () => {
  it('returns 400 when ?project= param is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/subgraph' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Missing required query parameter: project');
  });

  it('returns 400 when ?project= param is an empty string', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/subgraph?project=' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Missing required query parameter: project');
  });

  it('returns 200 with matching nodes/edges for a known project id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/graph/subgraph?project=github.com/user/repo',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges.length).toBeGreaterThan(0);
    for (const edge of body.edges) {
      expect(
        edge.source === 'project:github.com/user/repo' ||
        edge.target === 'project:github.com/user/repo'
      ).toBe(true);
    }
  });

  it('returns 200 with empty GraphResponse for a project id that has no edges', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/graph/subgraph?project=nonexistent',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges).toEqual([]);
    expect(body.nodes).toEqual([]);
  });
});

describe('GET /graph/top', () => {
  it('returns 200 with default limit of 10 edges when no limit param given', async () => {
    // Our fixture has 5 edges — default 10 returns all
    const res = await app.inject({ method: 'GET', url: '/graph/top' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges.length).toBe(5);
  });

  it('?limit=3 returns at most 3 edges', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=3' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges.length).toBe(3);
  });

  it('?limit=200 is clamped to max 100', async () => {
    // Build a graph with 101 edges to distinguish clamped (100) from unclamped (101)
    const connections: WeightsFile['connections'] = {};
    for (let i = 0; i < 101; i++) {
      const key = `project:repo-${i}||tool:Edit`;
      connections[key] = {
        source_node: `project:repo-${i}`,
        target_node: 'tool:Edit',
        connection_type: 'project->tool',
        raw_count: 1,
        weight: i / 100,
        first_seen: '2025-01-01T00:00:00.000Z',
        last_seen: '2025-01-01T00:00:00.000Z',
      };
    }
    graph = buildGraph({ connections, schema_version: 1, updated_at: '2025-01-01T00:00:00.000Z' });
    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=200' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges.length).toBe(100);
  });

  it('invalid ?limit= value falls back to default of 10', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=abc' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // fixture has 5 edges, default 10 returns all 5
    expect(body.edges.length).toBe(5);
  });

  it('?limit=0 falls back to default of 10', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/top?limit=0' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges.length).toBe(5);
  });

  it('returns 200 with empty GraphResponse when graph is empty', async () => {
    graph = buildGraph(emptyWeights);
    const res = await app.inject({ method: 'GET', url: '/graph/top' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges).toEqual([]);
    expect(body.nodes).toEqual([]);
  });
});
