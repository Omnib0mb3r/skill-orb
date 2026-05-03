// src/routes/sync.ts
import type { FastifyInstance } from 'fastify';

export type SyncFn = () => Promise<{
  created: string[];
  moved: string[];
  errors: { project: string; error: string }[];
}>;

export function registerSyncRoute(app: FastifyInstance, syncFn: SyncFn): void {
  app.post('/sync', async (_request, reply) => {
    try {
      const result = await syncFn();
      return reply.status(200).send(result);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
