import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HookPayload } from '../types.js';

export type GuardResult =
  | { skip: false }
  | { skip: true; reason: string };

export function evaluateGuards(payload: HookPayload): GuardResult {
  // Layer 1: entrypoint must be human-driven
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? 'cli';
  const allowedEntrypoints = [
    'cli',
    'sdk-ts',
    'claude-desktop',
    'claude-vscode',
  ];
  if (!allowedEntrypoints.includes(entrypoint)) {
    return { skip: true, reason: `entrypoint=${entrypoint}` };
  }

  // Layer 2: minimal hook profile suppresses observation
  if ((process.env.DEVNEURAL_HOOK_PROFILE ?? 'standard') === 'minimal') {
    return { skip: true, reason: 'hook_profile=minimal' };
  }

  // Layer 3: cooperative skip
  if (process.env.DEVNEURAL_SKIP_OBSERVE === '1') {
    return { skip: true, reason: 'devneural_skip_observe' };
  }

  // Layer 4: subagent sessions
  if (payload.agent_id && String(payload.agent_id).length > 0) {
    return { skip: true, reason: `agent_id=${payload.agent_id}` };
  }

  // Layer 5: path exclusions
  const skipPathsRaw =
    process.env.DEVNEURAL_OBSERVE_SKIP_PATHS ?? 'daemon-sessions,.devneural-mem';
  const skipPaths = skipPathsRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (payload.cwd) {
    const normalized = String(payload.cwd).replace(/\\/g, '/');
    for (const pattern of skipPaths) {
      if (normalized.includes(pattern)) {
        return { skip: true, reason: `path_excluded=${pattern}` };
      }
    }
  }

  // Disable file at data root
  const disabledFile = path.posix.join(
    (process.env.DEVNEURAL_DATA_ROOT ?? 'C:/dev/data/skill-connections').replace(
      /\\/g,
      '/',
    ),
    'disabled',
  );
  if (fs.existsSync(disabledFile)) {
    return { skip: true, reason: 'data_root_disabled_file' };
  }

  // Project-level opt-out: .devneural-ignore at cwd root
  if (payload.cwd) {
    try {
      const ignoreFile = path.join(payload.cwd, '.devneural-ignore');
      if (fs.existsSync(ignoreFile)) {
        return { skip: true, reason: 'project_devneural_ignore' };
      }
    } catch {
      /* ignore */
    }
  }

  return { skip: false };
}
