/**
 * Off-site wiki push.
 *
 * The wiki repo at DATA_ROOT/wiki is committed locally on every lint /
 * ingest pass via wiki/scaffolding.ts. This module pushes those commits
 * to the remote (typically a private GitHub repo) on an interval so a
 * disk failure does not lose every page between daily backups.
 *
 * Idempotent and quiet: if no remote is configured the push call no-ops
 * with a single log line on first attempt and stays silent after. Any
 * push error is logged but never thrown — wiki integrity is the priority,
 * not the off-site mirror.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { wikiRoot } from '../paths.js';

let intervalHandle: NodeJS.Timeout | null = null;
let warnedNoRemote = false;

function hasRemote(): boolean {
  try {
    const out = execSync('git remote', {
      cwd: wikiRoot(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function pushOnce(log: (msg: string) => void): void {
  const root = wikiRoot();
  if (!fs.existsSync(root)) return;
  if (!hasRemote()) {
    if (!warnedNoRemote) {
      log('[wiki-push] no git remote configured; off-site push skipped');
      warnedNoRemote = true;
    }
    return;
  }
  try {
    execSync('git push --quiet', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 60_000,
    });
    // Successful pushes stay silent so the log doesn't fill with no-ops
    // when nothing has changed since the last fire.
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('Everything up-to-date') || msg.includes('up to date')) return;
    log(`[wiki-push] push failed: ${msg.slice(0, 200)}`);
  }
}

export function startWikiPushInterval(
  log: (msg: string) => void,
  intervalMs: number,
): void {
  if (intervalHandle) return;
  log(`[wiki-push] interval started, every ${Math.round(intervalMs / 1000)}s`);
  intervalHandle = setInterval(() => pushOnce(log), intervalMs);
  // Fire one push at startup so a daemon restart doesn't sit on
  // unpushed commits for a full interval.
  setTimeout(() => pushOnce(log), 5_000);
}

export function stopWikiPushInterval(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
