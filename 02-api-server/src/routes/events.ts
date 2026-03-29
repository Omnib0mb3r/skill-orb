import type { FastifyInstance } from 'fastify';

export interface LogEntry {
  tool_use_id: string;
  connection_type: string;
  source_node: string;
  target_node: string;
  timestamp: string;
}

export function registerEventsRoutes(
  app: FastifyInstance,
  getEvents: () => LogEntry[]
): void {
  app.get<{ Querystring: { limit?: string } }>('/events', async (request) => {
    const parsed = parseInt(request.query.limit ?? '', 10);
    const limit = isNaN(parsed) || parsed <= 0 ? 50 : Math.min(parsed, 500);
    const buffer = getEvents();
    return {
      events: buffer.slice(0, limit),
      total: buffer.length,
    };
  });
}
