import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import chokidar from 'chokidar';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { type ServerConfig, loadConfig } from './config.js';
import { buildGraph } from './graph/builder.js';
import { buildProjectRegistry } from './graph/registry.js';
import type { InMemoryGraph, WeightsFile, ProjectRegistry } from './graph/types.js';
import { getFullGraph } from './graph/queries.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { setWss, broadcast } from './ws/broadcaster.js';
import { startWatchers, stopWatchers, getEventBuffer } from './watcher/index.js';

export type { ServerConfig };

const emptyWeights: WeightsFile = { schema_version: 1, updated_at: '', connections: {} };

export async function createServer(config: ServerConfig): Promise<{
  fastify: FastifyInstance;
  port: number;
  stop: () => Promise<void>;
}> {
  const fastify = Fastify({ logger: true });

  // Build initial project registry from localReposRoot (empty if not configured)
  let registry: ProjectRegistry = new Map();
  if (config.localReposRoot) {
    registry = await buildProjectRegistry(config.localReposRoot);
  }

  // Track latest weights so registry re-scans can re-enrich without re-reading disk
  let latestWeights: WeightsFile = emptyWeights;
  let graph: InMemoryGraph = buildGraph(emptyWeights, registry);

  // Register plugins (CORS first so headers apply to all routes including errors)
  await fastify.register(fastifyCors, { origin: '*' });
  await fastify.register(fastifyWebsocket);

  // Register REST routes (closures over graph reference for live reads)
  registerGraphRoutes(fastify, () => graph);
  registerEventsRoutes(fastify, getEventBuffer);
  registerVoiceRoutes(fastify, broadcast);

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
    (_unusedGraph, weights) => {
      latestWeights = weights;
      graph = buildGraph(weights, registry);
      broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) });
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
    latestWeights = JSON.parse(raw) as WeightsFile;
    graph = buildGraph(latestWeights, registry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load initial weights.json:', err);
    }
  }

  // Watch localReposRoot for devneural.json changes and rebuild registry on any change
  let registryWatcher: ReturnType<typeof chokidar.watch> | null = null;
  if (config.localReposRoot) {
    const handleRegistryChange = async () => {
      registry = await buildProjectRegistry(config.localReposRoot);
      graph = buildGraph(latestWeights, registry);
      broadcast({ type: 'graph:snapshot', payload: getFullGraph(graph, new Date().toISOString()) });
    };
    registryWatcher = chokidar.watch(
      `${config.localReposRoot.replace(/\\/g, '/')}/**/devneural.json`,
      { ignoreInitial: true, depth: 1 }
    );
    registryWatcher.on('add', handleRegistryChange).on('change', handleRegistryChange);
  }

  try {
    await fastify.listen({ port: config.port, host: '127.0.0.1' });
  } catch (err) {
    // Clean up watchers if bind fails (e.g. port already in use)
    await Promise.all([stopWatchers(), registryWatcher?.close()]);
    throw err;
  }

  const resolvedPort = (fastify.server.address() as AddressInfo).port;

  // websocketServer is only available after listen() completes
  setWss((fastify as any).websocketServer);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await Promise.all([stopWatchers(), registryWatcher?.close()]);
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
