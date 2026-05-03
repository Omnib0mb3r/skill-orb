import type { FastifyInstance } from 'fastify';
import type { InMemoryGraph } from '../graph/types.js';
import { getFullGraph, getNodeById, getSubgraph, getTopEdges } from '../graph/queries.js';

export function registerGraphRoutes(
  app: FastifyInstance,
  getGraph: () => InMemoryGraph
): void {
  app.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime() };
  });

  app.get('/graph', async () => {
    return getFullGraph(getGraph(), new Date().toISOString());
  });

  app.get<{ Params: { id: string } }>('/graph/node/:id', async (request, reply) => {
    const nodeId = decodeURIComponent(request.params.id);
    const result = getNodeById(getGraph(), nodeId);
    if (!result) {
      return reply.status(404).send({ error: 'Node not found' });
    }
    return result;
  });

  app.get<{ Querystring: { project?: string } }>('/graph/subgraph', async (request, reply) => {
    const project = request.query.project;
    if (!project) {
      return reply.status(400).send({ error: 'Missing required query parameter: project' });
    }
    return getSubgraph(getGraph(), project);
  });

  app.get<{ Querystring: { limit?: string } }>('/graph/top', async (request) => {
    const parsed = parseInt(request.query.limit ?? '', 10);
    const limit = isNaN(parsed) || parsed <= 0 ? 10 : Math.min(parsed, 100);
    return getTopEdges(getGraph(), limit);
  });
}
