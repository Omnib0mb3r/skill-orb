import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

import type { ProjectIdentity, ProjectSource } from '../types';

export type { ProjectIdentity };

/** Walk up the directory tree from `from`, looking for a directory entry named `name`.
 *  Returns the parent directory containing `name`, or null if not found. */
function findUp(name: string, from: string): string | null {
  if (!from || !from.trim()) return null;
  try {
    let current = from;
    while (true) {
      const target = path.join(current, name);
      if (fs.existsSync(target)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  } catch {
    return null;
  }
}

/** Normalize SSH or HTTPS git remote URLs to host/owner/repo format.
 *  Returns input unchanged for unrecognized formats. */
export function normalizeGitUrl(url: string): string {
  // SSH: git@github.com:user/repo.git → github.com/user/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS: https://github.com/user/repo.git → github.com/user/repo
  const httpsMatch = url.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // Unrecognized format — return unchanged
  return url;
}

/** Convert backslashes to forward slashes; lowercase the entire path for canonical keys. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Resolve the canonical project identity from a working directory path.
 *  Priority: git-remote > git-root > cwd. Never throws. */
export async function resolveProjectIdentity(cwd: string): Promise<ProjectIdentity> {
  try {
    if (!cwd) {
      return { id: '', source: 'cwd' };
    }

    const gitRoot = findUp('.git', cwd);

    if (gitRoot) {
      try {
        const output = cp.execFileSync('git', ['-C', gitRoot, 'remote', 'get-url', 'origin'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const remoteUrl = output.trim();
        const id = normalizeGitUrl(remoteUrl);
        return { id, source: 'git-remote' };
      } catch {
        return { id: normalizePath(gitRoot), source: 'git-root' };
      }
    }

    return { id: normalizePath(cwd), source: 'cwd' };
  } catch {
    return { id: normalizePath(cwd), source: 'cwd' };
  }
}
