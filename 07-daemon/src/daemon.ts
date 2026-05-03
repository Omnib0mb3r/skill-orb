#!/usr/bin/env node
/**
 * DevNeural daemon entrypoint.
 *
 * P1 scope: capture only. Owns the transcript watcher, fs watcher, and
 * git watcher; receives SIGUSR1 throttle pings from hooks (no-op for
 * now, will trigger ingest in P3); exposes /health on Fastify.
 *
 * Exits cleanly on SIGTERM/SIGINT, releases PID file.
 */
import * as fs from 'node:fs';
import Fastify from 'fastify';
import { ensureDataRoot, daemonLogFile, daemonPidFile } from './paths.js';
import { writePid, readPid, removeStalePid, isAlive } from './lifecycle/pid.js';
import { SignalCoalescer } from './lifecycle/signals.js';
import { startTranscriptWatcher } from './capture/transcript-watcher.js';
import { startFsWatcher } from './capture/fs-watcher.js';
import { startGitWatcher } from './capture/git-watcher.js';
import { Store } from './store/index.js';
import { embedOne, warmUp, getEmbedDim, getModelId } from './embedder/index.js';
import { ensureWiki } from './wiki/scaffolding.js';
import { runSeed, hasSeeded } from './corpus/seed.js';
import { runIngest } from './wiki/ingest.js';
import { pickProvider, providerStatus } from './llm/index.js';
import { curate, updateSummary, updateGlossary, updateCurrentTask } from './curation/index.js';
import { decayInactivePages } from './reinforcement/index.js';
import { runLint } from './wiki/lint.js';
import { generateWhatsNew } from './wiki/whats-new.js';
import { registerDashboardRoutes } from './dashboard/routes.js';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEVNEURAL_PORT ?? 3747);

function logger(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(daemonLogFile(), line, 'utf-8');
  } catch {
    /* fall back to stderr */
  }
  process.stderr.write(line);
}

async function main(): Promise<void> {
  ensureDataRoot();

  const existing = readPid();
  if (existing !== null && existing !== process.pid && isAlive(existing)) {
    logger(`already running as pid ${existing}; exiting.`);
    process.exit(0);
  }

  removeStalePid();
  writePid(process.pid);
  logger(`daemon starting; pid=${process.pid}`);

  logger('opening store...');
  const store = await Store.open();
  logger(
    `store open: raw_chunks=${store.rawChunks.size()} wiki_pages=${store.wikiPages.size()} embedder=${getModelId()} dim=${getEmbedDim()}`,
  );

  const scaffold = ensureWiki();
  logger(
    `wiki scaffold: created=${scaffold.created.length} updated=${scaffold.updated.length} present=${scaffold.alreadyPresent.length}`,
  );

  const llmStatus = providerStatus();
  if (llmStatus) {
    logger(
      `LLM provider=${llmStatus.name} configured=${llmStatus.configured} models: ingest=${llmStatus.models.ingest} lint=${llmStatus.models.lint}`,
    );
    if (!llmStatus.configured) {
      logger(`LLM hint: ${llmStatus.hint}`);
    }
  } else {
    logger(
      'LLM disabled (DEVNEURAL_LLM_PROVIDER=none). Capture continues; ingest/lint/reconcile skipped.',
    );
  }

  // Pre-warm the chosen provider so the first ingest is not blocked.
  const provider = pickProvider();
  if (provider && provider.isConfigured()) {
    void provider.warmUp?.().catch(() => undefined);
  }

  // Trigger initial corpus ingest in background if never run.
  if (!hasSeeded() && provider && provider.isConfigured()) {
    logger('initial corpus ingest scheduled (background)');
    void runSeed(store, { log: logger }).catch((err) => {
      logger(`corpus seed failed: ${(err as Error).message}`);
    });
  }

  // Pre-warm the embedder so the first transcript chunk is not blocked by model load.
  warmUp()
    .then(() => logger('embedder warmed'))
    .catch((err) => logger(`embedder warm failed: ${(err as Error).message}`));

  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: Number(process.env.DEVNEURAL_UPLOAD_MAX_BYTES ?? 100 * 1024 * 1024),
      files: 1,
    },
  });
  await registerDashboardRoutes(app, store, logger);
  app.get('/health', async () => ({
    ok: true,
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    phase: 'P3.2-reference-corpus',
    raw_chunks: store.rawChunks.size(),
    wiki_pages: store.wikiPages.size(),
    llm: providerStatus(),
  }));

  app.get('/projects', async () => {
    const { listProjects } = await import('./identity/registry.js');
    return { projects: listProjects() };
  });

  app.post('/search', async (req) => {
    const body = (req.body ?? {}) as {
      q?: string;
      project_id?: string;
      kind?: string;
      top_k?: number;
      collection?: 'raw_chunks' | 'wiki_pages';
    };
    if (!body.q || typeof body.q !== 'string') {
      return { ok: false, error: 'q required' };
    }
    const topK = Math.min(Math.max(body.top_k ?? 10, 1), 50);
    const collection = body.collection ?? 'raw_chunks';
    const vec = await embedOne(body.q.slice(0, 4000));
    const target =
      collection === 'wiki_pages' ? store.wikiPages : store.rawChunks;
    const filterFn = (m: unknown): boolean => {
      const meta = m as Record<string, unknown>;
      if (body.project_id && meta.project_id !== body.project_id) return false;
      if (body.kind && meta.kind !== body.kind) return false;
      return true;
    };
    // VectorStore.search filter signature is generic on the stored metadata type;
    // we cast through unknown so a single predicate works for either collection.
    const results = (
      target as unknown as {
        search: (
          q: Float32Array,
          o: { topK: number; filter: (m: unknown) => boolean },
        ) => Array<{ id: string; score: number; metadata: unknown }>;
      }
    ).search(vec, { topK, filter: filterFn });
    return { ok: true, collection, count: results.length, results };
  });

  // /sync was the legacy monday.com sync endpoint used by devneural-projects.
  // Monday integration is dead. Returning 410 Gone so any caller still hitting
  // it gets a clear deprecation signal instead of silently succeeding.
  app.post('/sync', async (_req, reply) => {
    reply.code(410);
    return {
      ok: false,
      error: 'gone',
      note: 'monday integration deprecated; project status board coming in Phase 3 dashboard',
    };
  });

  app.post('/reseed', async () => {
    const r = await runSeed(store, { log: logger });
    return { ok: true, ...r };
  });

  app.post('/curate', async (req) => {
    const body = req.body as {
      prompt?: string;
      session_id?: string;
      project_id?: string;
    };
    if (!body.prompt || typeof body.prompt !== 'string') {
      return { ok: false, error: 'prompt required' };
    }
    const out = await curate(
      store,
      {
        prompt: body.prompt,
        sessionId: body.session_id ?? 'unknown',
        projectId: body.project_id ?? 'global',
      },
      logger,
    );
    return { ok: true, ...out };
  });

  app.post('/summarize', async (req) => {
    const body = req.body as {
      session_id?: string;
      project_id?: string;
      project_name?: string;
      chunks?: { role: string; text: string; timestamp_ms: number }[];
    };
    if (!body.session_id || !body.chunks) {
      return { ok: false, error: 'session_id and chunks required' };
    }
    const r = await updateSummary(
      {
        sessionId: body.session_id,
        projectId: body.project_id ?? 'global',
        projectName: body.project_name ?? 'global',
        newTurns: body.chunks.length,
        recentChunks: body.chunks,
      },
      logger,
    );
    return { ok: true, ...r };
  });

  app.post('/glossary', async (req) => {
    const body = req.body as {
      project_id?: string;
      project_name?: string;
      recent_text?: string;
    };
    if (!body.project_id || !body.recent_text) {
      return { ok: false, error: 'project_id and recent_text required' };
    }
    const r = await updateGlossary(
      {
        projectId: body.project_id,
        projectName: body.project_name ?? body.project_id,
        recentText: body.recent_text,
      },
      logger,
    );
    return { ok: true, ...r };
  });

  app.post('/decay', async () => {
    const r = await decayInactivePages(store, logger);
    return { ok: true, ...r };
  });

  app.post('/lint', async (req) => {
    const body = (req.body ?? {}) as { apply?: boolean };
    const r = await runLint({ apply: body.apply });
    return { ok: true, ...r };
  });

  app.post('/whats-new', async (req) => {
    const body = (req.body ?? {}) as { days?: number };
    const r = generateWhatsNew(body.days ?? 7);
    return { ok: true, ...r };
  });

  app.get('/graph', async () => {
    const nodes: Array<{
      id: string;
      title: string;
      status: string;
      weight: number;
      hits: number;
      corrections: number;
    }> = [];
    const edges: Array<{ from: string; to: string; weight: number }> = [];
    const fsLib = await import('node:fs');
    const pathLib = await import('node:path');
    const { wikiPagesDir, wikiPendingDir } = await import('./paths.js');
    const { parsePage } = await import('./wiki/schema.js');

    for (const dir of [wikiPagesDir(), wikiPendingDir()]) {
      if (!fsLib.existsSync(dir)) continue;
      for (const file of fsLib.readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        try {
          const parsed = parsePage(
            fsLib.readFileSync(pathLib.posix.join(dir, file), 'utf-8'),
          );
          const fm = parsed.frontmatter;
          nodes.push({
            id: fm.id,
            title: fm.title,
            status: fm.status,
            weight: fm.weight,
            hits: fm.hits ?? 0,
            corrections: fm.corrections ?? 0,
          });
          for (const target of parsed.sections.crossRefs) {
            edges.push({ from: fm.id, to: target, weight: fm.weight });
          }
        } catch {
          /* skip malformed */
        }
      }
    }
    return { ok: true, nodes, edges, generated_at: new Date().toISOString() };
  });

  app.get('/page/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const fsLib = await import('node:fs');
    const pathLib = await import('node:path');
    const { wikiPagesDir, wikiPendingDir, wikiArchiveDir } = await import('./paths.js');
    const { parsePage } = await import('./wiki/schema.js');
    for (const dir of [wikiPagesDir(), wikiPendingDir(), wikiArchiveDir()]) {
      const file = pathLib.posix.join(dir, `${id}.md`);
      if (fsLib.existsSync(file)) {
        const raw = fsLib.readFileSync(file, 'utf-8');
        try {
          const parsed = parsePage(raw);
          return { ok: true, raw, frontmatter: parsed.frontmatter };
        } catch {
          return { ok: false, error: 'parse failed', raw };
        }
      }
    }
    return { ok: false, error: 'page not found' };
  });

  app.get('/glossary/:projectId', async (req) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const { readGlossary } = await import('./curation/index.js');
    return { ok: true, project_id: projectId, entries: readGlossary(projectId) };
  });

  app.get('/session/:sessionId/summary', async (req) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const { readSummary } = await import('./curation/index.js');
    return { ok: true, session_id: sessionId, summary: readSummary(sessionId) };
  });

  app.get('/session/:sessionId/task', async (req) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const { readCurrentTask } = await import('./curation/index.js');
    return { ok: true, session_id: sessionId, task: readCurrentTask(sessionId) };
  });

  app.post('/task', async (req) => {
    const body = req.body as {
      session_id?: string;
      chunks?: { role: string; text: string }[];
    };
    if (!body.session_id || !body.chunks) {
      return { ok: false, error: 'session_id and chunks required' };
    }
    const r = await updateCurrentTask(
      { sessionId: body.session_id, recentChunks: body.chunks },
      logger,
    );
    return { ok: true, ...r };
  });

  app.post('/ingest', async (req) => {
    const body = req.body as {
      source?: string;
      project_id?: string;
      project_name?: string;
      content?: string;
    };
    if (!body.content || typeof body.content !== 'string') {
      return { ok: false, error: 'content required' };
    }
    const r = await runIngest(
      store,
      {
        source: body.source ?? 'manual',
        projectId: body.project_id ?? 'global',
        projectName: body.project_name ?? 'global',
        newContent: body.content,
        evidenceHints: [],
      },
      logger,
    );
    return { ok: true, ...r };
  });

  // Serve the dashboard static export when present. The export lives at
  // 08-dashboard/out/ produced by `npm run build` in that workspace. Path
  // resolution uses fileURLToPath so it works on Windows whether started
  // from dist/ or src/ via tsx. Layout: <repo>/07-daemon/dist/daemon.js
  // and <repo>/08-dashboard/out, so we go up two levels from this file's
  // directory then over to 08-dashboard/out.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dashboardOut = path.resolve(here, '..', '..', '08-dashboard', 'out');
    if (fs.existsSync(dashboardOut)) {
      await app.register(fastifyStatic, {
        root: dashboardOut,
        prefix: '/',
        index: ['index.html'],
      });
      // SPA fallback for client-side routes that have no matching .html on disk.
      // Static export emits one .html per route (out/orb.html, out/sessions.html,
      // etc.), so most paths resolve directly. The fallback only handles a small
      // residual set: query-string variations of /sessions/detail, refreshes
      // mid-route, etc.
      app.setNotFoundHandler((req, reply) => {
        if (req.method !== 'GET') {
          reply.code(404).send({ ok: false, error: 'not found' });
          return;
        }
        const url = (req.url ?? '/').split('?')[0] ?? '/';
        if (!url.includes('.')) {
          reply.type('text/html').sendFile('index.html');
          return;
        }
        reply.code(404).send({ ok: false, error: 'not found' });
      });
      logger(`dashboard static serve enabled from ${dashboardOut}`);
    } else {
      logger(`dashboard static export not found at ${dashboardOut}; API only`);
    }
  } catch (err) {
    logger(`dashboard static serve setup failed: ${(err as Error).message}`);
  }

  try {
    // Bind 0.0.0.0 so Tailscale can route to the dashboard from your
    // other devices on the tailnet. Localhost-only callers (hooks)
    // continue to hit 127.0.0.1 transparently. Override with
    // DEVNEURAL_BIND if you want to lock back down to 127.0.0.1.
    const host = process.env.DEVNEURAL_BIND ?? '0.0.0.0';
    await app.listen({ port: PORT, host });
    logger(`listening on http://${host}:${PORT}`);
  } catch (err) {
    logger(`http listen failed: ${(err as Error).message}`);
  }

  const coalescer = new SignalCoalescer(
    async () => {
      await store.flush();
      logger('signal pass: store flushed; ingest comes in P3');
    },
    logger,
  );

  const transcripts = startTranscriptWatcher({ log: logger, store });
  const fsWatcher = startFsWatcher({ log: logger });
  const gitWatcher = startGitWatcher({ log: logger });

  process.on('SIGUSR1', () => {
    coalescer.trigger('SIGUSR1');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger(`received ${signal}; shutting down`);
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    try {
      await transcripts.stop();
    } catch {
      /* ignore */
    }
    try {
      await fsWatcher.stop();
    } catch {
      /* ignore */
    }
    try {
      gitWatcher.stop();
    } catch {
      /* ignore */
    }
    try {
      await store.close();
    } catch {
      /* ignore */
    }
    try {
      const pid = readPid();
      if (pid === process.pid) {
        fs.unlinkSync(daemonPidFile());
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger(`uncaught: ${err?.stack ?? err?.message ?? err}`);
  });
  process.on('unhandledRejection', (err) => {
    logger(`unhandled rejection: ${(err as Error)?.message ?? err}`);
  });
}

main().catch((err) => {
  logger(`fatal: ${(err as Error)?.stack ?? (err as Error)?.message ?? err}`);
  process.exit(1);
});
