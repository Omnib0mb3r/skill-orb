#!/usr/bin/env node
/**
 * DevNeural hook runner.
 *
 * Invoked by every Claude Code hook entry that DevNeural cares about
 * (PreToolUse, PostToolUse, UserPromptSubmit, Stop). The hook is called
 * with a single CLI arg (the phase name) and the hook payload on stdin.
 *
 * Hot path. Stays cheap:
 *   1. read stdin
 *   2. evaluate self-loop guards
 *   3. resolve project identity
 *   4. scrub secrets
 *   5. append one observation line
 *   6. throttle-signal the daemon (every N events)
 *   7. lazy-spawn daemon if not running
 *
 * Always exit 0. Hooks must never block Claude.
 */
import { resolveProjectIdentity } from '../../identity/project-id.js';
import { recordIdentity } from '../../identity/registry.js';
import {
  appendObservation,
  bumpSignalCounter,
  purgeOldArchivesOncePerDay,
} from '../observations.js';
import { evaluateGuards } from '../../lifecycle/guards.js';
import { scrubSecrets, scrubObject } from '../secret-scrub.js';
import { ensureDaemonRunning } from '../../lifecycle/spawn.js';
import { readPid, isAlive } from '../../lifecycle/pid.js';
import type { HookPayload, HookPhase, Observation } from '../../types.js';

const CURATE_TIMEOUT_MS = Number(
  process.env.DEVNEURAL_CURATE_TIMEOUT_MS ?? 1500,
);
const DAEMON_PORT = Number(process.env.DEVNEURAL_PORT ?? 3747);

async function curateAndPrint(
  prompt: string,
  sessionId: string,
  projectId: string,
): Promise<void> {
  if (!prompt || prompt.trim().length < 4) return;
  const url = `http://127.0.0.1:${DAEMON_PORT}/curate`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CURATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        session_id: sessionId,
        project_id: projectId,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return;
    const body = (await res.json()) as {
      ok?: boolean;
      injection?: string;
      components?: { skipped_reason?: string };
    };
    if (body.ok && body.injection && body.injection.trim().length > 0) {
      // Claude Code reads hook stdout and treats it as additional context.
      process.stdout.write(body.injection + '\n');
    }
  } catch {
    /* daemon down or timeout; injection silently skipped */
  } finally {
    clearTimeout(t);
  }
}

const MAX_FIELD_BYTES = 5000;

function trim(value: string): string {
  if (value.length <= MAX_FIELD_BYTES) return value;
  return value.slice(0, MAX_FIELD_BYTES) + '...[truncated]';
}

function parsePhase(arg: string | undefined): HookPhase {
  switch ((arg ?? '').toLowerCase()) {
    case 'pre':
    case 'pretool':
    case 'pre_tool':
    case 'pretooluse':
      return 'pre_tool';
    case 'post':
    case 'posttool':
    case 'post_tool':
    case 'posttooluse':
      return 'post_tool';
    case 'prompt':
    case 'user_prompt':
    case 'userpromptsubmit':
      return 'user_prompt';
    case 'stop':
    case 'session_stop':
      return 'session_stop';
    default:
      return 'post_tool';
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf-8');
  let buf = '';
  for await (const chunk of process.stdin) {
    buf += chunk;
    if (buf.length > 256 * 1024) break;
  }
  return buf;
}

function parsePayload(raw: string): HookPayload | null {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
}

function buildObservation(
  phase: HookPhase,
  payload: HookPayload,
  projectId: string,
  projectName: string,
): Observation {
  const timestamp = new Date().toISOString();
  const session = String(payload.session_id ?? 'unknown');
  const cwd = payload.cwd ? String(payload.cwd) : undefined;

  if (phase === 'user_prompt') {
    const promptText = payload.prompt ?? payload.user_prompt ?? '';
    return {
      timestamp,
      event: 'user_prompt',
      session,
      project_id: projectId,
      project_name: projectName,
      prompt: scrubSecrets(trim(String(promptText))),
      cwd,
    };
  }

  if (phase === 'session_stop') {
    return {
      timestamp,
      event: 'session_stop',
      session,
      project_id: projectId,
      project_name: projectName,
      cwd,
    };
  }

  const tool = String(payload.tool_name ?? payload.tool ?? 'unknown');

  if (phase === 'pre_tool') {
    const inputRaw = payload.tool_input ?? payload.input ?? '';
    return {
      timestamp,
      event: 'tool_start',
      session,
      project_id: projectId,
      project_name: projectName,
      tool,
      input: trim(scrubObject(inputRaw)),
      cwd,
    };
  }

  // post_tool
  const outputRaw =
    payload.tool_response ?? payload.tool_output ?? payload.output ?? '';
  return {
    timestamp,
    event: 'tool_complete',
    session,
    project_id: projectId,
    project_name: projectName,
    tool,
    output: trim(scrubObject(outputRaw)),
    cwd,
  };
}

async function main(): Promise<void> {
  const phase = parsePhase(process.argv[2]);
  const raw = await readStdin();
  const payload = parsePayload(raw);

  if (payload === null) {
    // Parse error: log a minimal observation under global so we know it happened
    const obs: Observation = {
      timestamp: new Date().toISOString(),
      event: 'parse_error',
      session: 'unknown',
      project_id: 'global',
      project_name: 'global',
      raw: trim(scrubSecrets(raw)),
    };
    try {
      appendObservation('global', obs);
    } catch {
      /* ignore */
    }
    return;
  }

  const guard = evaluateGuards(payload);
  if (guard.skip) return;

  const cwd = payload.cwd ? String(payload.cwd) : process.cwd();
  const identity = resolveProjectIdentity(cwd);

  try {
    recordIdentity(identity);
  } catch {
    /* registry write failures must not block the hook */
  }

  const obs = buildObservation(phase, payload, identity.id, identity.name);
  try {
    appendObservation(identity.id, obs);
  } catch {
    return;
  }

  try {
    purgeOldArchivesOncePerDay(identity.id);
  } catch {
    /* ignore */
  }

  // P4: on UserPromptSubmit, fetch curated injection from daemon and print
  // to stdout so Claude Code includes it as additional context. Bounded
  // timeout; daemon-down silently skips.
  if (phase === 'user_prompt' && obs.prompt) {
    await curateAndPrint(obs.prompt, obs.session, identity.id);
  }

  const decision = bumpSignalCounter(identity.id);

  if (decision.shouldSignal) {
    const pid = readPid();
    if (pid !== null && isAlive(pid)) {
      try {
        process.kill(pid, 'SIGUSR1');
      } catch {
        /* daemon may have just died; ignore */
      }
    } else {
      try {
        ensureDaemonRunning();
      } catch {
        /* spawn failure must not block hook */
      }
    }
  } else {
    // First-time spawn even when not signaling, so daemon is alive.
    const pid = readPid();
    if (pid === null || !isAlive(pid)) {
      try {
        ensureDaemonRunning();
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch(() => {
  /* hooks must never throw */
});

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
