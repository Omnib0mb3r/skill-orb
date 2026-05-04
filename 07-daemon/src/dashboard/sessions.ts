/**
 * Dashboard session endpoints.
 *
 * Lists active Claude sessions on the host (by reading
 * ~/.claude/projects/<slug>/<session-id>.jsonl), exposes per-session
 * details (current task, rolling summary, recent transcript chunks),
 * and accepts a queued prompt for the session bridge (Phase 3.3).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DATA_ROOT, ensureDir } from '../paths.js';
import { readSummary, readCurrentTask } from '../curation/index.js';
import { getPhase } from './session-phase.js';

const SESSIONS_ROOT = path
  .join(os.homedir(), '.claude', 'projects')
  .replace(/\\/g, '/');
const BRIDGE_DIR = path.posix.join(DATA_ROOT, 'session-bridge');
const ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // last 10min of activity = "active"

export interface SessionListItem {
  session_id: string;
  project_slug: string;
  jsonl_path: string;
  bytes: number;
  last_modified_ms: number;
  active: boolean;
  has_summary: boolean;
  has_task: boolean;
  /** Live state from hook events; used by Stream Deck tile coloring.
   * 'unknown' means no hook has fired yet for this session in this
   * daemon's lifetime (e.g. stale jsonl from before the daemon started). */
  phase: 'thinking' | 'tool' | 'permission' | 'idle' | 'unknown';
}

export function listSessions(): SessionListItem[] {
  if (!fs.existsSync(SESSIONS_ROOT)) return [];
  const out: SessionListItem[] = [];
  const slugs = fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true });
  const now = Date.now();
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const slugDir = path.posix.join(SESSIONS_ROOT, slug.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(slugDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const sessionId = e.name.replace('.jsonl', '');
      const file = path.posix.join(slugDir, e.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      out.push({
        session_id: sessionId,
        project_slug: slug.name,
        jsonl_path: file,
        bytes: stat.size,
        last_modified_ms: stat.mtimeMs,
        active: now - stat.mtimeMs < ACTIVE_THRESHOLD_MS,
        has_summary: Boolean(readSummary(sessionId)),
        has_task: Boolean(readCurrentTask(sessionId)),
        phase: getPhase(sessionId),
      });
    }
  }
  out.sort((a, b) => b.last_modified_ms - a.last_modified_ms);
  return out;
}

export interface SessionDetail extends SessionListItem {
  summary: string;
  task: string;
  recent_chunks: SessionChunk[];
}

export interface SessionChunk {
  role: string;
  text: string;
  timestamp?: string;
}

export function getSessionDetail(
  sessionId: string,
  options: { recentLimit?: number } = {},
): SessionDetail | null {
  const list = listSessions();
  const item = list.find((s) => s.session_id === sessionId);
  if (!item) return null;
  return {
    ...item,
    summary: readSummary(sessionId),
    task: readCurrentTask(sessionId),
    recent_chunks: readRecentChunks(item.jsonl_path, options.recentLimit ?? 30),
  };
}

function readRecentChunks(file: string, limit: number): SessionChunk[] {
  // Read the tail of the jsonl, parse turns, return last N. Bounded so
  // we never load huge transcripts into memory.
  const READ_BYTES = 256 * 1024;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const start = Math.max(0, stat.size - READ_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf-8');
    // Drop possibly partial first line
    const firstNl = start === 0 ? -1 : text.indexOf('\n');
    const usable = firstNl === -1 ? text : text.slice(firstNl + 1);
    const lines = usable.split('\n').filter((l) => l.trim().length > 0);
    const chunks: SessionChunk[] = [];
    for (const line of lines.slice(-limit * 2)) {
      try {
        const obj = JSON.parse(line) as {
          message?: { role?: string; content?: unknown };
          type?: string;
          timestamp?: string;
          role?: string;
        };
        const role = obj.message?.role ?? obj.role ?? obj.type ?? 'unknown';
        const text = extractText(obj);
        if (!text) continue;
        chunks.push({
          role,
          text: text.slice(0, 2000),
          ...(obj.timestamp ? { timestamp: obj.timestamp } : {}),
        });
      } catch {
        continue;
      }
    }
    return chunks.slice(-limit);
  } finally {
    fs.closeSync(fd);
  }
}

function extractText(obj: { message?: { content?: unknown } }): string {
  const c = obj.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (
          b &&
          typeof b === 'object' &&
          (b as { type?: string }).type === 'text'
        ) {
          return (b as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

/**
 * Queue a prompt for delivery to a running session. The 09-bridge VS
 * Code extension (Phase 3.3) watches this directory and pastes the
 * message into the matching terminal.
 */
export function queueSessionPrompt(
  sessionId: string,
  text: string,
): { ok: true; queued_at: string } {
  ensureDir(BRIDGE_DIR);
  const file = path.posix.join(BRIDGE_DIR, `${sessionId}.in`);
  const entry = JSON.stringify({
    queued_at: new Date().toISOString(),
    text,
  });
  fs.appendFileSync(file, entry + '\n', 'utf-8');
  return { ok: true, queued_at: new Date().toISOString() };
}

export function queueSessionFocus(sessionId: string): { ok: true } {
  ensureDir(BRIDGE_DIR);
  const file = path.posix.join(BRIDGE_DIR, `${sessionId}.in`);
  fs.appendFileSync(
    file,
    JSON.stringify({ queued_at: new Date().toISOString(), action: 'focus' }) +
      '\n',
    'utf-8',
  );
  return { ok: true };
}

export type NavKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'enter' | 'backspace'
  | '1' | '2' | '3' | '4' | '5'
  | 'mic';

const NAV_KEYS: ReadonlySet<NavKey> = new Set([
  'up', 'down', 'left', 'right',
  'enter', 'backspace',
  '1', '2', '3', '4', '5',
  'mic',
]);

export function isNavKey(value: unknown): value is NavKey {
  return typeof value === 'string' && NAV_KEYS.has(value as NavKey);
}

/* Queue a single Nav-mode key press for the bridge to inject into the
 * matching VS Code window. Mirrors the physical Stream Deck Nav layout:
 * arrows for permission picks, numbers for menu options, enter, backspace,
 * mic = Win+H. The bridge file is the same per-session inbox the focus
 * and prompt actions use. */
export function queueSessionKey(
  sessionId: string,
  key: NavKey,
): { ok: true; queued_at: string } {
  ensureDir(BRIDGE_DIR);
  const file = path.posix.join(BRIDGE_DIR, `${sessionId}.in`);
  const queued_at = new Date().toISOString();
  fs.appendFileSync(
    file,
    JSON.stringify({ queued_at, action: 'key', key }) + '\n',
    'utf-8',
  );
  return { ok: true, queued_at };
}
