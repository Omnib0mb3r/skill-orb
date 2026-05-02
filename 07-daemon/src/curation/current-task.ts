/**
 * Current-task memory.
 *
 * Maintains a tiny per-session note describing what the user is
 * currently working on. Survives compaction (daemon owns it, not
 * Claude's context). Read at UserPromptSubmit by the curator and
 * passed to Claude as 50-100 tokens of grounding.
 *
 * Path: c:/dev/data/skill-connections/session-state/<session-id>.task.md
 */
import * as fs from 'node:fs';
import {
  sessionTaskFile,
  sessionStateDir,
  ensureDir,
} from '../paths.js';
import {
  pickProvider,
  callValidated,
  type LlmProvider,
} from '../llm/index.js';
import type { Validator } from '../llm/validator.js';

interface TaskShape {
  current_task: string;
  last_action: string;
  blocked_on?: string;
}

const validateTask: Validator<TaskShape> = (raw) => {
  if (!raw || typeof raw !== 'object')
    return { ok: false, errors: ['response not object'] };
  const obj = raw as Record<string, unknown>;
  const current = typeof obj.current_task === 'string' ? obj.current_task : '';
  const last = typeof obj.last_action === 'string' ? obj.last_action : '';
  if (!current) return { ok: false, errors: ['current_task missing'] };
  if (current.length > 280)
    return { ok: false, errors: ['current_task too long'] };
  return {
    ok: true,
    value: {
      current_task: current,
      last_action: last,
      ...(typeof obj.blocked_on === 'string' && obj.blocked_on
        ? { blocked_on: obj.blocked_on }
        : {}),
    },
    errors: [],
  };
};

export interface TaskUpdate {
  sessionId: string;
  recentChunks: { role: string; text: string }[];
}

export interface TaskResult {
  written: boolean;
  current_task?: string;
  reason?: string;
}

export function readCurrentTask(sessionId: string): string {
  const file = sessionTaskFile(sessionId);
  if (!fs.existsSync(file)) return '';
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

export async function updateCurrentTask(
  update: TaskUpdate,
  log: (msg: string) => void = () => undefined,
): Promise<TaskResult> {
  const provider = pickProvider();
  if (!provider || !provider.isConfigured()) {
    return { written: false, reason: 'LLM not configured' };
  }
  if (update.recentChunks.length < 2) {
    return { written: false, reason: 'not enough new content' };
  }

  const existing = readCurrentTask(update.sessionId);
  const transcript = update.recentChunks
    .slice(-10)
    .map((c) => `[${c.role}] ${c.text.slice(0, 600)}`)
    .join('\n\n');

  const result = await runTask(provider, existing, transcript, log);
  if (!result.value) {
    return {
      written: false,
      reason: `task call failed: ${result.errors.join('; ')}`,
    };
  }

  const formatted = formatTask(update.sessionId, result.value);
  ensureDir(sessionStateDir());
  fs.writeFileSync(sessionTaskFile(update.sessionId), formatted, 'utf-8');
  return { written: true, current_task: result.value.current_task };
}

async function runTask(
  provider: LlmProvider,
  existing: string,
  transcript: string,
  log: (msg: string) => void,
): Promise<{
  value: TaskShape | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: string[];
}> {
  const system = `You maintain a one-paragraph note about what a developer is currently doing in their Claude session.

Output strictly this JSON shape:
{
  "current_task": "single sentence, present tense, naming the concrete thing being worked on right now",
  "last_action": "single sentence about the most recent action taken or message exchanged",
  "blocked_on": "optional, only if there is a current blocker"
}

Hard rules:
- current_task must be a single, specific sentence (<= 240 chars).
- Be concrete. "Implementing the ollama adapter" beats "working on stuff".
- Update only when the focus has actually shifted. If the focus is unchanged from existing, return the same current_task.
- Do not include speaker tags, do not include code, do not narrate.`;

  const user = `Existing current_task (may be empty):
${existing || '(none)'}

Recent transcript chunks (newest at the bottom):
${transcript.slice(0, 4000)}

Respond with JSON only.`;

  return callValidated(
    provider,
    {
      role: 'self_query',
      systemBlocks: [{ text: system, cache: true }],
      user,
      maxTokens: 300,
    },
    validateTask,
    log,
  );
}

function formatTask(sessionId: string, t: TaskShape): string {
  const lines: string[] = [];
  lines.push(`# Current task`);
  lines.push('');
  lines.push(`- session: ${sessionId}`);
  lines.push(`- updated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(t.current_task);
  if (t.last_action) {
    lines.push('');
    lines.push(`Last action: ${t.last_action}`);
  }
  if (t.blocked_on) {
    lines.push('');
    lines.push(`Blocked on: ${t.blocked_on}`);
  }
  return lines.join('\n') + '\n';
}

export function readCurrentTaskBody(sessionId: string): string {
  const raw = readCurrentTask(sessionId);
  if (!raw) return '';
  // Skip the header (lines until blank line after "updated:")
  const idx = raw.indexOf('\n\n');
  if (idx === -1) return raw.trim();
  return raw.slice(idx + 2).trim();
}
