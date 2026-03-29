import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { type ServerConfig, loadConfig } from './config.js';
import { buildGraph } from './graph/builder.js';
import type { InMemoryGraph, WeightsFile } from './graph/types.js';
import { getFullGraph } from './graph/queries.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerEventsRoutes } from './routes/events.js';
import { setWss, broadcast } from './ws/broadcaster.js';
import { startWatchers, stopWatchers, getEventBuffer } from './watcher/index.js';

export type { ServerConfig };

const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '1.0' };

export async function createServer(config: ServerConfig): Promise<{
  fastify: FastifyInstance;
  port: number;
  stop: () => Promise<void>;
}> {
  const fastify = Fastify({ logger: true });
  let graph: InMemoryGraph = buildGraph(emptyWeights);

  // Register plugins (CORS first so headers apply to all routes including errors)
  await fastify.register(fastifyCors, { origin: '*' });
  await fastify.register(fastifyWebsocket);

  // Register REST routes (closures over graph reference for live reads)
  registerGraphRoutes(fastify, () => graph);
  registerEventsRoutes(fastify, getEventBuffer);

  // Register WebSocket route — send snapshot directly to the connecting client only
  fastify.get('/ws', { websocket: true }, (socket) => {
    const snapshot = getFullGraph(graph, new Date().toISOString());
    socket.send(JSON.stringify({ type: 'graph:snapshot', payload: snapshot }));
  });

  // Start file watchers with reduced stabilityThreshold when running tests (port 0)
  const stabilityThreshold = config.port === 0 ? 50 : 300;
  startWatchers(
    path.join(config.dataRoot, 'weights.json'),
    path.join(config.dataRoot, 'logs'),
    (newGraph) => {
      graph = newGraph;
      broadcast({ type: 'graph:snapshot', payload: getFullGraph(newGraph, new Date().toISOString()) });
    },
    (entry, isStartup) => {
      if (!isStartup) {
        const { tool_use_id, connection_type, source_node, target_node, timestamp } = entry;
        broadcast({ type: 'connection:new', payload: { tool_use_id, connection_type, source_node, target_node, timestamp } });
      }
    },
    { stabilityThreshold }
  );

  // Pre-load graph from weights.json if it exists so first request gets real data
  try {
    const raw = await fs.readFile(path.join(config.dataRoot, 'weights.json'), 'utf-8');
    graph = buildGraph(JSON.parse(raw) as WeightsFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load initial weights.json:', err);
    }
  }

  try {
    await fastify.listen({ port: config.port, host: '127.0.0.1' });
  } catch (err) {
    // Clean up watchers if bind fails (e.g. port already in use)
    await stopWatchers();
    throw err;
  }

  const resolvedPort = (fastify.server.address() as AddressInfo).port;

  // websocketServer is only available after listen() completes
  setWss((fastify as any).websocketServer);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopWatchers();
    try {
      await fastify.close();
    } catch {
      // ignore errors from already-closed instance
    }
  };

  return { fastify, port: resolvedPort, stop };
}

// ESM entry-point guard — only runs when the file is executed directly, not when imported by tests
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  (async () => {
    const config = loadConfig();
    const { stop } = await createServer(config);
    process.on('SIGINT', async () => {
      await stop();
      process.exit(0);
    });
  })();
}
