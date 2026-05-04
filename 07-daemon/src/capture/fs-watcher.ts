/**
 * Filesystem watcher.
 *
 * Watches the user's project root tree for change events. Records each
 * change as a lightweight observation so the daemon brain (later phase)
 * can fold filesystem activity into ingest context.
 *
 * P1: capture and persist. No embedding, no analysis.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { resolveProjectIdentity } from '../identity/project-id.js';
import { recordIdentity } from '../identity/registry.js';
import { appendObservation } from './observations.js';
import type { Observation } from '../types.js';

const DEFAULT_ROOT = (
  process.env.DEVNEURAL_FS_ROOT ?? 'C:/dev/Projects'
).replace(/\\/g, '/');

const IGNORE_PATTERNS = [
  /[\\/]node_modules[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]\.git[\\/]/,
  /[\\/]\.next[\\/]/,
  /[\\/]\.turbo[\\/]/,
  /[\\/]\.cache[\\/]/,
  /[\\/]coverage[\\/]/,
  /[\\/]\.devneural-mem[\\/]/,
];

function shouldIgnore(file: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(file));
}

export interface FsWatcher {
  stop: () => Promise<void>;
}

export interface FsWatcherOptions {
  rootDir?: string;
  log?: (msg: string) => void;
}

function recordChange(
  kind: 'add' | 'change' | 'unlink',
  filePath: string,
): void {
  if (shouldIgnore(filePath)) return;
  const dir = path.dirname(filePath);
  let identity;
  try {
    identity = resolveProjectIdentity(dir);
  } catch {
    return;
  }
  if (identity.id === 'global') return;

  try {
    recordIdentity(identity);
  } catch {
    /* ignore */
  }

  const obs: Observation = {
    timestamp: new Date().toISOString(),
    event: 'tool_complete',
    session: 'fs-watcher',
    project_id: identity.id,
    project_name: identity.name,
    tool: `fs:${kind}`,
    output: filePath.replace(/\\/g, '/'),
    cwd: identity.root,
  };
  try {
    appendObservation(identity.id, obs);
  } catch {
    /* ignore */
  }
}

export function startFsWatcher(options: FsWatcherOptions = {}): FsWatcher {
  const root = (options.rootDir ?? DEFAULT_ROOT).replace(/\\/g, '/');
  const log = options.log ?? (() => undefined);
  if (!fs.existsSync(root)) {
    log(`[fs-watcher] root not present: ${root}`);
    return { stop: async () => undefined };
  }

  const watcher: FSWatcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    ignored: (file: string) => shouldIgnore(file),
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    depth: 8,
    /* ignorePermissionErrors lets chokidar skip dirs the daemon process
     * can't read (system folders, OneDrive locked dirs, etc) instead of
     * emitting EPERM events. Was flooding daemon.log with one error per
     * unreadable subdirectory at startup. */
    ignorePermissionErrors: true,
  });

  watcher.on('add', (f: string) => recordChange('add', f));
  watcher.on('change', (f: string) => recordChange('change', f));
  watcher.on('unlink', (f: string) => recordChange('unlink', f));

  /* Throttle error logging. With ignorePermissionErrors:true the EPERM
   * flood goes away, but other transient errors (file truncated mid-watch,
   * antivirus locks) can still arrive in bursts. Coalesce identical
   * messages within a 30s window into a single log line with a count. */
  const errCounts = new Map<string, number>();
  let errFlushTimer: NodeJS.Timeout | null = null;
  const flushErrors = () => {
    for (const [msg, count] of errCounts.entries()) {
      log(`[fs-watcher] error: ${msg}${count > 1 ? ` (x${count})` : ''}`);
    }
    errCounts.clear();
    errFlushTimer = null;
  };
  watcher.on('error', (err: unknown) => {
    const msg = (err as Error)?.message ?? String(err);
    errCounts.set(msg, (errCounts.get(msg) ?? 0) + 1);
    if (!errFlushTimer) {
      errFlushTimer = setTimeout(flushErrors, 30_000);
    }
  });

  log(`[fs-watcher] watching ${root}`);
  return {
    stop: async () => {
      await watcher.close();
    },
  };
}
