/**
 * Superseded session registry.
 *
 * When Claude Code's /clear command fires, it does not delete the old
 * session's jsonl. The file is left behind in ~/.claude/projects/<slug>/
 * with a fresh mtime, so listSessions() keeps treating it as active for
 * the next ACTIVE_THRESHOLD_MS window. The Stream Deck rail then shows
 * two tiles for what is, from the user's perspective, a single session.
 *
 * The SessionStart hook (source: clear) fires with the new session_id.
 * Daemon resolves the previous session in the same workspace and writes
 * its id here. listSessions() filters anything in this set.
 *
 * File-backed so daemon restarts don't resurrect stale tiles. Entries
 * older than RETENTION_MS are pruned on every read.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DATA_ROOT, ensureDir } from '../paths.js';

const FILE = path.posix.join(DATA_ROOT, 'superseded-sessions.json');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Entry {
  superseded_by: string;
  ts: number;
}

interface FileShape {
  entries: Record<string, Entry>;
}

function load(): FileShape {
  try {
    const raw = fs.readFileSync(FILE, 'utf-8');
    const parsed = JSON.parse(raw) as FileShape;
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return { entries: {} };
    }
    return parsed;
  } catch {
    return { entries: {} };
  }
}

function save(shape: FileShape): void {
  try {
    ensureDir(DATA_ROOT);
    fs.writeFileSync(FILE, JSON.stringify(shape, null, 2), 'utf-8');
  } catch {
    /* swallow; non-fatal */
  }
}

function prune(shape: FileShape): FileShape {
  const cutoff = Date.now() - RETENTION_MS;
  let mutated = false;
  for (const [id, entry] of Object.entries(shape.entries)) {
    if (entry.ts < cutoff) {
      delete shape.entries[id];
      mutated = true;
    }
  }
  if (mutated) save(shape);
  return shape;
}

export function markSuperseded(sessionId: string, by: string): void {
  if (!sessionId || sessionId === by) return;
  const shape = load();
  shape.entries[sessionId] = { superseded_by: by, ts: Date.now() };
  save(shape);
}

export function isSuperseded(sessionId: string): boolean {
  if (!sessionId) return false;
  const shape = prune(load());
  return Boolean(shape.entries[sessionId]);
}

export function listSuperseded(): Record<string, Entry> {
  return prune(load()).entries;
}
