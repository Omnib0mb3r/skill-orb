/**
 * Transcript watcher.
 *
 * Watches Claude Code's per-session JSONL transcript files under
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Reads incrementally from a persisted byte offset per file. Never
 * loads a full transcript into memory. Each new line is parsed as JSON,
 * scrubbed, and appended into transcripts.jsonl under the matching
 * project-id directory along with a chunk record suitable for later
 * embedding by the daemon brain.
 *
 * P1 scope: capture and persist incremental chunks. Embedding into
 * Chroma happens in P2 once the embedder is wired.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import { resolveProjectIdentity } from '../identity/project-id.js';
import { recordIdentity } from '../identity/registry.js';
import { scrubSecrets } from './secret-scrub.js';
import {
  ensureProjectDir,
  transcriptsFile,
  DATA_ROOT,
} from '../paths.js';
import type { Observation } from '../types.js';
import { appendObservation } from './observations.js';
import type { Store } from '../store/index.js';
import { embedOne } from '../embedder/index.js';
import {
  evaluateAssistantReply,
  evaluateCorrection,
} from '../reinforcement/index.js';

const HOME = os.homedir();
const DEFAULT_ROOT = path.join(HOME, '.claude', 'projects').replace(/\\/g, '/');
const OFFSETS_FILE = path.posix.join(DATA_ROOT, 'transcript-offsets.json');

interface OffsetMap {
  [filePath: string]: number;
}

let offsets: OffsetMap = {};
let offsetsLoaded = false;

function loadOffsets(): void {
  if (offsetsLoaded) return;
  offsetsLoaded = true;
  try {
    if (fs.existsSync(OFFSETS_FILE)) {
      offsets = JSON.parse(fs.readFileSync(OFFSETS_FILE, 'utf-8')) as OffsetMap;
    }
  } catch {
    offsets = {};
  }
}

function saveOffsets(): void {
  try {
    fs.writeFileSync(OFFSETS_FILE, JSON.stringify(offsets), 'utf-8');
  } catch {
    /* ignore */
  }
}

interface TranscriptLine {
  type?: string;
  role?: string;
  message?: { role?: string; content?: unknown };
  cwd?: string;
  sessionId?: string;
  session_id?: string;
  timestamp?: string;
  uuid?: string;
}

function extractCwd(line: TranscriptLine): string | undefined {
  if (typeof line.cwd === 'string') return line.cwd;
  return undefined;
}

function extractSessionId(line: TranscriptLine, fallback: string): string {
  return (
    (typeof line.sessionId === 'string' && line.sessionId) ||
    (typeof line.session_id === 'string' && line.session_id) ||
    fallback
  );
}

function extractText(line: TranscriptLine): string {
  const message = line.message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; content?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

function classifyRole(line: TranscriptLine): string {
  if (typeof line.role === 'string') return line.role;
  const messageRole = line.message?.role;
  if (typeof messageRole === 'string') return messageRole;
  return line.type ?? 'unknown';
}

async function readTail(file: string): Promise<{
  newBytes: Buffer;
  startOffset: number;
  endOffset: number;
} | null> {
  loadOffsets();
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return null;
  }
  const start = offsets[file] ?? 0;
  if (stat.size <= start) return null;

  const handle = await fsp.open(file, 'r');
  try {
    const length = stat.size - start;
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, start);
    return { newBytes: buffer, startOffset: start, endOffset: stat.size };
  } finally {
    await handle.close();
  }
}

interface ProcessResult {
  chunks: number;
  bytes: number;
}

function chunkId(file: string, uuid: string | undefined, offset: number): string {
  const base = `${file}|${uuid ?? ''}|${offset}`;
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}

async function processFile(
  file: string,
  store?: Store,
  log?: (msg: string) => void,
): Promise<ProcessResult> {
  const tail = await readTail(file);
  if (!tail) return { chunks: 0, bytes: 0 };

  const text = tail.newBytes.toString('utf-8');
  const lines = text.split('\n');
  // Last element may be a partial line; advance offset only past complete lines.
  let consumed = 0;
  let chunkCount = 0;

  let fallbackSession = path.basename(file, '.jsonl');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (i === lines.length - 1 && !text.endsWith('\n')) break;
    consumed += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(trimmed) as TranscriptLine;
    } catch {
      continue;
    }

    const cwd = extractCwd(parsed) ?? process.cwd();
    const session = extractSessionId(parsed, fallbackSession);
    const role = classifyRole(parsed);
    const rawText = extractText(parsed);
    if (!rawText) continue;
    const scrubbed = scrubSecrets(rawText);
    const identity = resolveProjectIdentity(cwd);
    try {
      recordIdentity(identity);
    } catch {
      /* ignore */
    }
    ensureProjectDir(identity.id);

    const transcriptsPath = transcriptsFile(identity.id);
    const record = {
      timestamp: parsed.timestamp ?? new Date().toISOString(),
      session,
      project_id: identity.id,
      role,
      kind: detectKind(scrubbed, role),
      length: scrubbed.length,
      text: scrubbed,
      source_file: file.replace(/\\/g, '/'),
      uuid: parsed.uuid,
    };
    try {
      fs.appendFileSync(
        transcriptsPath,
        JSON.stringify(record) + '\n',
        'utf-8',
      );
    } catch {
      continue;
    }

    // Mirror a lightweight observation so the daemon can react via signals.
    const obs: Observation = {
      timestamp: record.timestamp,
      event: 'tool_complete',
      session,
      project_id: identity.id,
      project_name: identity.name,
      tool: `transcript:${role}`,
      output: scrubbed.slice(0, 500),
      cwd,
    };
    try {
      appendObservation(identity.id, obs);
    } catch {
      /* ignore */
    }

    // P5: reinforcement signals based on role and pending injection
    if (store) {
      if (role === 'assistant' || record.role === 'assistant') {
        void evaluateAssistantReply(store, session, scrubbed).catch(() => undefined);
      } else if (role === 'user' || record.role === 'user') {
        evaluateCorrection(store, session, scrubbed);
      }
    }

    // P2: embed and store
    if (store) {
      const id = chunkId(file, parsed.uuid, tail.startOffset + consumed);
      const tsMs = Date.parse(record.timestamp);
      try {
        const vec = await embedOne(scrubbed.slice(0, 4000));
        await store.rawChunks.add({
          id,
          vector: vec,
          metadata: {
            project_id: identity.id,
            session_id: session,
            timestamp_ms: Number.isFinite(tsMs) ? tsMs : Date.now(),
            kind: record.kind,
            role,
            byte_length: scrubbed.length,
            text_preview: scrubbed.slice(0, 200),
          },
        });
        store.db.upsertRawChunk({
          id,
          project_id: identity.id,
          session_id: session,
          timestamp_ms: Number.isFinite(tsMs) ? tsMs : Date.now(),
          kind: record.kind,
          role,
          byte_length: scrubbed.length,
        });
      } catch (err) {
        log?.(
          `[transcript-watcher] embed/store failed: ${(err as Error)?.message ?? err}`,
        );
      }
    }
    chunkCount++;
  }

  offsets[file] = tail.startOffset + consumed;
  saveOffsets();
  return { chunks: chunkCount, bytes: consumed };
}

function detectKind(text: string, role: string): string {
  if (text.includes('```') && text.split('\n').length > 6) return 'code-mixed';
  if (role === 'user') return 'user-prose';
  if (role === 'assistant') return 'assistant-prose';
  return 'meta';
}

export interface TranscriptWatcher {
  stop: () => Promise<void>;
}

export interface WatcherOptions {
  rootDir?: string;
  log?: (msg: string) => void;
  store?: Store;
}

export function startTranscriptWatcher(
  options: WatcherOptions = {},
): TranscriptWatcher {
  const root = (options.rootDir ?? DEFAULT_ROOT).replace(/\\/g, '/');
  const log = options.log ?? (() => undefined);
  if (!fs.existsSync(root)) {
    log(`[transcript-watcher] root not present: ${root}`);
    return { stop: async () => undefined };
  }

  const watcher: FSWatcher = chokidar.watch(`${root}/**/*.jsonl`, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });

  const onChange = (file: string): void => {
    void processFile(file.replace(/\\/g, '/'), options.store, log).then(
      (result) => {
        if (result.chunks > 0) {
          log(
            `[transcript-watcher] ${path.basename(file)} +${result.chunks} chunks (${result.bytes}B)`,
          );
        }
      },
    );
  };

  watcher.on('add', onChange);
  watcher.on('change', onChange);
  watcher.on('error', (err: unknown) => {
    log(`[transcript-watcher] error: ${(err as Error)?.message ?? err}`);
  });

  log(`[transcript-watcher] watching ${root}`);
  return {
    stop: async () => {
      await watcher.close();
    },
  };
}
