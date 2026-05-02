/**
 * Rolling session summarizer.
 *
 * Maintains a per-session markdown digest at
 *   c:/dev/data/skill-connections/session-state/<session-id>.summary.md
 *
 * Updated periodically (every N new turns or T minutes). Replaces
 * the bloat-prone "auto-load full transcript on resume" path. When
 * Claude resumes a session, we point at the summary file.
 *
 * The summary is structured:
 *   - 1-2 sentence overall theme of the session
 *   - bullet list of decisions made
 *   - bullet list of open threads
 *   - last touched timestamp
 *
 * Hard caps: ~300 tokens for the summary itself, hand-readable.
 */
import * as fs from 'node:fs';
import {
  sessionSummaryFile,
  sessionMetaFile,
  sessionStateDir,
  ensureDir,
} from '../paths.js';
import {
  pickProvider,
  callValidated,
  type LlmProvider,
} from '../llm/index.js';
import type { Validator } from '../llm/validator.js';

const SUMMARY_INTERVAL_TURNS = Number(
  process.env.DEVNEURAL_SUMMARY_TURNS ?? 8,
);
const SUMMARY_INTERVAL_MS = Number(
  process.env.DEVNEURAL_SUMMARY_MIN_MS ?? 5 * 60 * 1000,
);

interface SessionMeta {
  session_id: string;
  project_id: string;
  project_name: string;
  last_summarized_turns: number;
  last_summarized_ms: number;
  total_turns: number;
  last_touched_ms: number;
}

interface SummaryShape {
  theme: string;
  decisions: string[];
  open_threads: string[];
  recent_focus: string;
}

const validateSummary: Validator<SummaryShape> = (raw) => {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object')
    return { ok: false, errors: ['response not object'] };
  const obj = raw as Record<string, unknown>;
  const theme = typeof obj.theme === 'string' ? obj.theme : '';
  const recent = typeof obj.recent_focus === 'string' ? obj.recent_focus : '';
  const decisions = Array.isArray(obj.decisions)
    ? (obj.decisions as unknown[]).filter((x) => typeof x === 'string')
    : [];
  const threads = Array.isArray(obj.open_threads)
    ? (obj.open_threads as unknown[]).filter((x) => typeof x === 'string')
    : [];
  if (!theme) errors.push('theme missing');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      theme,
      decisions: decisions as string[],
      open_threads: threads as string[],
      recent_focus: recent,
    },
    errors: [],
  };
};

export interface SummaryUpdate {
  sessionId: string;
  projectId: string;
  projectName: string;
  newTurns: number;
  recentChunks: { role: string; text: string; timestamp_ms: number }[];
}

export interface SummaryResult {
  written: boolean;
  reason?: string;
  cost?: { input_tokens: number; output_tokens: number };
}

export function loadMeta(sessionId: string): SessionMeta | null {
  ensureDir(sessionStateDir());
  const file = sessionMetaFile(sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionMeta;
  } catch {
    return null;
  }
}

function saveMeta(meta: SessionMeta): void {
  ensureDir(sessionStateDir());
  fs.writeFileSync(
    sessionMetaFile(meta.session_id),
    JSON.stringify(meta, null, 2),
    'utf-8',
  );
}

function loadExistingSummary(sessionId: string): string {
  const file = sessionSummaryFile(sessionId);
  if (!fs.existsSync(file)) return '';
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

export function shouldSummarize(
  meta: SessionMeta | null,
  totalTurns: number,
): boolean {
  if (!meta) return totalTurns >= 4;
  const turnsDelta = totalTurns - meta.last_summarized_turns;
  if (turnsDelta >= SUMMARY_INTERVAL_TURNS) return true;
  const msDelta = Date.now() - meta.last_summarized_ms;
  if (msDelta >= SUMMARY_INTERVAL_MS && turnsDelta >= 2) return true;
  return false;
}

export async function updateSummary(
  update: SummaryUpdate,
  log: (msg: string) => void = () => undefined,
): Promise<SummaryResult> {
  const provider = pickProvider();
  if (!provider || !provider.isConfigured()) {
    return { written: false, reason: 'LLM not configured' };
  }

  if (update.recentChunks.length < 2) {
    return { written: false, reason: 'not enough new content' };
  }

  const existing = loadExistingSummary(update.sessionId);
  const transcript = update.recentChunks
    .slice(-30)
    .map((c) => `[${c.role}] ${c.text.slice(0, 800)}`)
    .join('\n\n');

  const result = await runSummary(provider, existing, transcript, log);
  if (!result.value) {
    return {
      written: false,
      reason: `summary call failed: ${result.errors.join('; ')}`,
    };
  }

  const summary = formatSummary(
    update.sessionId,
    update.projectName,
    result.value,
  );
  ensureDir(sessionStateDir());
  fs.writeFileSync(sessionSummaryFile(update.sessionId), summary, 'utf-8');

  const meta: SessionMeta = {
    session_id: update.sessionId,
    project_id: update.projectId,
    project_name: update.projectName,
    last_summarized_turns: (loadMeta(update.sessionId)?.total_turns ?? 0) +
      update.newTurns,
    last_summarized_ms: Date.now(),
    total_turns: (loadMeta(update.sessionId)?.total_turns ?? 0) + update.newTurns,
    last_touched_ms: Date.now(),
  };
  saveMeta(meta);

  return {
    written: true,
    cost: {
      input_tokens: result.totalInputTokens,
      output_tokens: result.totalOutputTokens,
    },
  };
}

async function runSummary(
  provider: LlmProvider,
  existingSummary: string,
  transcript: string,
  log: (msg: string) => void,
): Promise<{
  value: SummaryShape | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: string[];
}> {
  const system = `You produce session summaries for a developer's tooling.

Output strictly this JSON shape:
{
  "theme": "one sentence describing what this session is about",
  "decisions": ["short bullet", "short bullet"],
  "open_threads": ["short bullet"],
  "recent_focus": "one sentence about what is happening right now"
}

Hard rules:
- "theme" <= 200 chars.
- bullets are <= 140 chars each.
- 0-6 decisions, 0-4 open threads.
- Do not include code blocks. Do not include speaker tags.
- Be terse and informative. No filler.`;

  const user = `Existing summary (may be empty):
${existingSummary || '(none)'}

Update the summary using these recent transcript chunks (newest at the bottom):

${transcript.slice(0, 6000)}

Respond with the JSON object only.`;

  return callValidated(
    provider,
    {
      role: 'self_query',
      systemBlocks: [{ text: system, cache: true }],
      user,
      maxTokens: 700,
    },
    validateSummary,
    log,
  );
}

function formatSummary(
  sessionId: string,
  projectName: string,
  s: SummaryShape,
): string {
  const lines: string[] = [];
  lines.push(`# Session summary`);
  lines.push('');
  lines.push(`- session: ${sessionId}`);
  lines.push(`- project: ${projectName}`);
  lines.push(`- updated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Theme`);
  lines.push(s.theme);
  lines.push('');
  lines.push(`## Recent focus`);
  lines.push(s.recent_focus || '(continuing prior thread)');
  lines.push('');
  if (s.decisions.length > 0) {
    lines.push(`## Decisions`);
    for (const d of s.decisions) lines.push(`- ${d}`);
    lines.push('');
  }
  if (s.open_threads.length > 0) {
    lines.push(`## Open threads`);
    for (const t of s.open_threads) lines.push(`- ${t}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function readSummary(sessionId: string): string {
  const file = sessionSummaryFile(sessionId);
  if (!fs.existsSync(file)) return '';
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}
