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
  app.get('/health', async () => ({
    ok: true,
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    phase: 'P3.6-curation',
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

  app.post('/sync', async () => ({ ok: true, note: 'sync hook for devneural-projects' }));

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

  try {
    await app.listen({ port: PORT, host: '127.0.0.1' });
    logger(`listening on http://127.0.0.1:${PORT}`);
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
