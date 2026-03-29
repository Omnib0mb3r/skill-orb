import { z } from 'zod';

const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['project', 'tool', 'skill']),
  label: z.string(),
  stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  localPath: z.string().optional(),
});

const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  connection_type: z.enum(['project->tool', 'project->project', 'project->skill', 'tool->skill']),
  raw_count: z.number(),
  weight: z.number(),
  first_seen: z.string(),
  last_seen: z.string(),
});

const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  updated_at: z.string(),
});

const LogEntrySchema = z.object({
  tool_use_id: z.string(),
  connection_type: z.string(),
  source_node: z.string(),
  target_node: z.string(),
  timestamp: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('graph:snapshot'), payload: GraphResponseSchema }),
  z.object({ type: z.literal('connection:new'), payload: LogEntrySchema }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
