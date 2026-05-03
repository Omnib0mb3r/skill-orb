import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectMeta, ProjectRegistry } from './types.js';

/** Strips // line and /* block comments from JSONC content before JSON.parse. */
function stripJsoncComments(src: string): string {
  return src.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_, str: string | undefined) => str ?? '');
}

/**
 * Scans `localReposRoot` one level deep for devneural.jsonc files.
 * Returns a registry Map keyed by the project node id derived from
 * the githubUrl field ('project:' + stripped URL scheme).
 *
 * Non-fatal errors (missing dir, malformed JSON, missing fields) are logged
 * as warnings and skipped. Never throws.
 */
export async function buildProjectRegistry(
  localReposRoot: string,
): Promise<ProjectRegistry> {
  const registry: ProjectRegistry = new Map();

  let entries: string[];
  try {
    const dirents = await fs.readdir(localReposRoot, { withFileTypes: true });
    entries = dirents.filter(d => d.isDirectory()).map(d => d.name);
  } catch (err) {
    console.warn('[DevNeural] registry: could not read localReposRoot:', err instanceof Error ? err.message : String(err));
    return registry;
  }

  for (const entry of entries) {
    const configPath = path.join(localReposRoot, entry, 'devneural.jsonc');
    let raw: string;
    try {
      raw = await fs.readFile(configPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn(`[DevNeural] registry: could not read devneural.jsonc in ${entry}:`, err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsoncComments(raw));
    } catch (err) {
      console.warn(`[DevNeural] registry: malformed devneural.jsonc in ${entry}:`, err instanceof Error ? err.message : String(err));
      continue;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    const githubUrl = typeof obj['githubUrl'] === 'string' ? obj['githubUrl'] : '';
    const localPath = typeof obj['localPath'] === 'string' ? obj['localPath'] : '';
    const stage = typeof obj['stage'] === 'string' ? obj['stage'] : '';
    const tags = Array.isArray(obj['tags'])
      ? (obj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : null;

    if (!githubUrl || !localPath || !stage || tags === null) {
      continue;
    }

    // Strip URL scheme: 'https://github.com/user/repo' → 'github.com/user/repo'
    const strippedUrl = githubUrl.replace(/^https?:\/\//, '');
    const nodeId = `project:${strippedUrl}`;

    const meta: ProjectMeta = { stage, tags, localPath };
    registry.set(nodeId, meta);
  }

  return registry;
}
