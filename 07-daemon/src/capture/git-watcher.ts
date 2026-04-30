/**
 * Git watcher.
 *
 * Polls every registered project for HEAD/branch/commit changes. On
 * detected change, records a lightweight observation. P1 scope: capture
 * only. The daemon brain consumes these later as context for ingest.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { listProjects } from '../identity/registry.js';
import { appendObservation } from './observations.js';
import type { Observation } from '../types.js';

const POLL_INTERVAL_MS = Number(process.env.DEVNEURAL_GIT_POLL_MS ?? 30_000);

interface GitState {
  head: string | null;
  branch: string | null;
}

const lastState = new Map<string, GitState>();

function safeExec(cwd: string, cmd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readGitState(root: string): GitState {
  const head = safeExec(root, 'git rev-parse HEAD');
  const branch = safeExec(root, 'git rev-parse --abbrev-ref HEAD');
  return { head, branch };
}

function diffSummary(prev: GitState, next: GitState): string {
  const parts: string[] = [];
  if (prev.branch !== next.branch) {
    parts.push(`branch ${prev.branch ?? '?'} -> ${next.branch ?? '?'}`);
  }
  if (prev.head !== next.head) {
    parts.push(
      `head ${(prev.head ?? '?').slice(0, 8)} -> ${(next.head ?? '?').slice(0, 8)}`,
    );
  }
  return parts.join('; ');
}

function tick(log: (msg: string) => void): void {
  const projects = listProjects();
  for (const project of projects) {
    if (!project.root) continue;
    if (!fs.existsSync(project.root)) continue;
    const next = readGitState(project.root);
    const prev = lastState.get(project.id);
    if (!prev) {
      lastState.set(project.id, next);
      continue;
    }
    if (prev.head === next.head && prev.branch === next.branch) continue;

    const summary = diffSummary(prev, next);
    lastState.set(project.id, next);

    const obs: Observation = {
      timestamp: new Date().toISOString(),
      event: 'tool_complete',
      session: 'git-watcher',
      project_id: project.id,
      project_name: project.name,
      tool: 'git:state-change',
      output: summary,
      cwd: project.root,
    };
    try {
      appendObservation(project.id, obs);
    } catch {
      /* ignore */
    }
    log(`[git-watcher] ${project.name}: ${summary}`);
  }
}

export interface GitWatcher {
  stop: () => void;
}

export interface GitWatcherOptions {
  intervalMs?: number;
  log?: (msg: string) => void;
}

export function startGitWatcher(options: GitWatcherOptions = {}): GitWatcher {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const log = options.log ?? (() => undefined);
  log(`[git-watcher] polling every ${interval}ms`);
  const handle = setInterval(() => {
    try {
      tick(log);
    } catch (err) {
      log(`[git-watcher] tick error: ${(err as Error)?.message ?? err}`);
    }
  }, interval);
  return {
    stop: () => clearInterval(handle),
  };
}
