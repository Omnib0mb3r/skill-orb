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

  const app = Fastify({ logger: false });
  app.get('/health', async () => ({
    ok: true,
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    phase: 'P1-capture',
  }));

  app.get('/projects', async () => {
    const { listProjects } = await import('./identity/registry.js');
    return { projects: listProjects() };
  });

  // Placeholder for future ingest trigger
  app.post('/sync', async () => ({ ok: true, note: 'P1 placeholder; ingest comes in P3' }));

  try {
    await app.listen({ port: PORT, host: '127.0.0.1' });
    logger(`listening on http://127.0.0.1:${PORT}`);
  } catch (err) {
    logger(`http listen failed: ${(err as Error).message}`);
  }

  const coalescer = new SignalCoalescer(
    async () => {
      logger('signal pass: ingest will run here in P3 (no-op in P1)');
    },
    logger,
  );

  const transcripts = startTranscriptWatcher({ log: logger });
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
