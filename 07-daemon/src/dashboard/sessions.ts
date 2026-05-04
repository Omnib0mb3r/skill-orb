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

/* Derive current phase by reading the last few KB of the jsonl. The
 * chokidar transcript-watcher fires unreliably on Windows for files
 * that are being appended-to live, leaving phase stuck at 'unknown'
 * for active sessions. Tailing the file on every /sessions request is
 * cheap (~8KB read, only for active sessions) and reflects ground
 * truth: the last record tells us whether Claude is thinking, running
 * a tool, or idle. */
function derivePhaseFromTail(file: string): 'thinking' | 'tool' | 'idle' | 'unknown' {
  try {
    const stat = fs.statSync(file);
    if (stat.size === 0) return 'unknown';
    const tailLen = Math.min(stat.size, 16 * 1024);
    const start = stat.size - tailLen;
    const fd = fs.openSync(file, 'r');
    let text: string;
    try {
      const buf = Buffer.alloc(tailLen);
      fs.readSync(fd, buf, 0, tailLen, start);
      text = buf.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      try {
        const rec = JSON.parse(line) as {
          type?: string;
          role?: string;
          message?: { role?: string; content?: unknown };
        };
        const role = rec.type ?? rec.role ?? rec.message?.role;
        if (role === 'user') return 'thinking';
        if (role === 'assistant') {
          if (/"type"\s*:\s*"tool_use"/.test(line)) return 'tool';
          return 'idle';
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  return 'unknown';
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
      const isActive = now - stat.mtimeMs < ACTIVE_THRESHOLD_MS;
      // For active sessions, tail-derive phase so the dashboard reflects
      // current reality even when chokidar misses change events. Stale
      // sessions just take whatever the in-memory tracker last knew.
      let phase = getPhase(sessionId);
      if (isActive) {
        const derived = derivePhaseFromTail(file);
        if (derived !== 'unknown') phase = derived;
      }
      out.push({
        session_id: sessionId,
        project_slug: slug.name,
        jsonl_path: file,
        bytes: stat.size,
        last_modified_ms: stat.mtimeMs,
        active: isActive,
        has_summary: Boolean(readSummary(sessionId)),
        has_task: Boolean(readCurrentTask(sessionId)),
        phase,
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
  options: { recentLimit?: number; query?: string } = {},
): SessionDetail | null {
  const list = listSessions();
  const item = list.find((s) => s.session_id === sessionId);
  if (!item) return null;
  /* If a search query is present we scan the entire jsonl for chunks
   * that match (substring, case-insensitive) and return those plus a
   * little context. Otherwise default to the cheap tail read. The
   * "user opened this session from a search hit" path is exactly when
   * older transcript turns matter. */
  const recent = options.query
    ? readMatchingChunks(item.jsonl_path, options.query, options.recentLimit ?? 200)
    : readRecentChunks(item.jsonl_path, options.recentLimit ?? 30);
  return {
    ...item,
    summary: readSummary(sessionId),
    task: readCurrentTask(sessionId),
    recent_chunks: recent,
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

/* Whole-file scan for chunks whose text contains the query
 * (case-insensitive). Used when the user opens a session from a wiki
 * search hit; the matching turn could be anywhere in the transcript,
 * not just the tail. Bounded by MAX_BYTES so a multi-megabyte session
 * doesn't OOM the daemon, and by limit on returned chunks so we never
 * stream a huge payload to the dashboard. */
function readMatchingChunks(file: string, query: string, limit: number): SessionChunk[] {
  const MAX_BYTES = 8 * 1024 * 1024; // 8MB cap per session scan
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  // Read either the whole file or its tail if it exceeds the cap. For
  // most Claude sessions full file is well under 8MB.
  const start = Math.max(0, stat.size - MAX_BYTES);
  const fd = fs.openSync(file, 'r');
  let text: string;
  try {
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
  const firstNl = start === 0 ? -1 : text.indexOf('\n');
  const usable = firstNl === -1 ? text : text.slice(firstNl + 1);
  const needle = query.toLowerCase();
  const matches: SessionChunk[] = [];
  for (const line of usable.split('\n')) {
    if (matches.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        message?: { role?: string; content?: unknown };
        type?: string;
        timestamp?: string;
        role?: string;
      };
      const text = extractText(obj);
      if (!text) continue;
      if (!text.toLowerCase().includes(needle)) continue;
      const role = obj.message?.role ?? obj.role ?? obj.type ?? 'unknown';
      matches.push({
        role,
        text: text.slice(0, 4000),
        ...(obj.timestamp ? { timestamp: obj.timestamp } : {}),
      });
    } catch {
      continue;
    }
  }
  return matches;
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

/* Bridge liveness window. The bridge writes a heartbeat file every
 * tick (~750ms). If the heartbeat is missing or older than this, the
 * dashboard treats the bridge as offline and refuses to queue anything,
 * so messages don't accumulate for hours and then dump all at once
 * when a stale window finally reloads. */
const BRIDGE_HEARTBEAT_FILE = path.posix.join(BRIDGE_DIR, '.heartbeat');
const BRIDGE_HEARTBEAT_STALE_MS = 30_000;

export interface BridgeStatus {
  alive: boolean;
  last_seen_ms: number | null;
  age_ms: number | null;
}

export function bridgeStatus(): BridgeStatus {
  try {
    const stat = fs.statSync(BRIDGE_HEARTBEAT_FILE);
    const age = Date.now() - stat.mtimeMs;
    return {
      alive: age <= BRIDGE_HEARTBEAT_STALE_MS,
      last_seen_ms: stat.mtimeMs,
      age_ms: age,
    };
  } catch {
    return { alive: false, last_seen_ms: null, age_ms: null };
  }
}

/**
 * Queue a prompt for delivery to a running session. The 09-bridge VS
 * Code extension (Phase 3.3) watches this directory and pastes the
 * message into the matching terminal.
 *
 * Refuses to queue if no bridge has written a heartbeat within the
 * stale window. Without this, a closed VS Code window left users with
 * messages silently sitting in the inbox for hours, then all dumping
 * into the terminal when the bridge eventually came back online.
 */
export function queueSessionPrompt(
  sessionId: string,
  text: string,
):
  | { ok: true; queued_at: string }
  | { ok: false; error: string; bridge: BridgeStatus } {
  const status = bridgeStatus();
  if (!status.alive) {
    return {
      ok: false,
      error:
        status.last_seen_ms === null
          ? 'bridge offline: no heartbeat ever recorded'
          : `bridge offline: last heartbeat ${Math.round((status.age_ms ?? 0) / 1000)}s ago`,
      bridge: status,
    };
  }
  ensureDir(BRIDGE_DIR);
  const file = path.posix.join(BRIDGE_DIR, `${sessionId}.in`);
  const queued_at = new Date().toISOString();
  const entry = JSON.stringify({ queued_at, text });
  fs.appendFileSync(file, entry + '\n', 'utf-8');
  return { ok: true, queued_at };
}

export function queueSessionFocus(
  sessionId: string,
):
  | { ok: true }
  | { ok: false; error: string; bridge: BridgeStatus } {
  const status = bridgeStatus();
  if (!status.alive) {
    return { ok: false, error: 'bridge offline', bridge: status };
  }
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
):
  | { ok: true; queued_at: string }
  | { ok: false; error: string; bridge: BridgeStatus } {
  const status = bridgeStatus();
  if (!status.alive) {
    return {
      ok: false,
      error:
        status.last_seen_ms === null
          ? 'bridge offline: no heartbeat ever recorded'
          : `bridge offline: last heartbeat ${Math.round((status.age_ms ?? 0) / 1000)}s ago`,
      bridge: status,
    };
  }
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
