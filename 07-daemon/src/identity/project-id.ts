import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ProjectIdentity } from '../types.js';

export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .toLowerCase()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

export function hashId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function tryGitRemote(cwd: string): string | null {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

function tryGitToplevel(cwd: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
      .trim()
      .replace(/\\/g, '/');
  } catch {
    return null;
  }
}

export function resolveProjectIdentity(cwd: string): ProjectIdentity {
  if (!cwd || !fs.existsSync(cwd)) {
    return { id: 'global', name: 'global', root: cwd ?? '', remote: null, scope: 'global' };
  }

  const remote = tryGitRemote(cwd);
  if (remote) {
    const normalized = normalizeRemote(remote);
    const id = hashId(normalized);
    const toplevel = tryGitToplevel(cwd) ?? cwd;
    const name = path.basename(toplevel);
    return { id, name, root: toplevel, remote: normalized, scope: 'remote' };
  }

  const toplevel = tryGitToplevel(cwd);
  if (toplevel) {
    const id = hashId(toplevel.toLowerCase());
    const name = path.basename(toplevel);
    return { id, name, root: toplevel, remote: null, scope: 'path' };
  }

  return { id: 'global', name: 'global', root: cwd, remote: null, scope: 'global' };
}
