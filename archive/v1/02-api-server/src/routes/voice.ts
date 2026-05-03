import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ServerMessageSchema, type ServerMessage } from '../ws/types.js';

const VoiceCommandSchema = z.object({
  type: z.enum(['voice:focus', 'voice:highlight', 'voice:clear']),
  payload: z.unknown(),
});

export function registerVoiceRoutes(
  app: FastifyInstance,
  broadcastFn: (msg: ServerMessage) => void
): void {
  app.post('/voice/command', async (request, reply) => {
    // Step 1: validate type against allowlist
    const typeResult = VoiceCommandSchema.safeParse(request.body);
    if (!typeResult.success) {
      return reply.status(400).send({ error: typeResult.error.issues.map(i => i.message).join('; ') });
    }

    // Step 2: validate full body (type + payload shape) against ServerMessageSchema
    const fullResult = ServerMessageSchema.safeParse(request.body);
    if (!fullResult.success) {
      return reply.status(400).send({ error: fullResult.error.issues.map(i => i.message).join('; ') });
    }

    broadcastFn(fullResult.data);
    return reply.status(200).send({ ok: true });
  });
}
