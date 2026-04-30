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
  });

  watcher.on('add', (f: string) => recordChange('add', f));
  watcher.on('change', (f: string) => recordChange('change', f));
  watcher.on('unlink', (f: string) => recordChange('unlink', f));
  watcher.on('error', (err: unknown) => {
    log(`[fs-watcher] error: ${(err as Error)?.message ?? err}`);
  });

  log(`[fs-watcher] watching ${root}`);
  return {
    stop: async () => {
      await watcher.close();
    },
  };
}
