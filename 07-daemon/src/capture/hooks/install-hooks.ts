#!/usr/bin/env node
/**
 * install-hooks.
 *
 * Idempotently registers the four DevNeural hook entries in
 * ~/.claude/settings.json. Safe to re-run.
 *
 * Each registration is keyed by a stable marker (`devneural:hook-runner:<phase>`)
 * embedded in a leading comment-style command string fragment. We detect
 * existing DevNeural entries by command path and replace them.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json').replace(/\\/g, '/');

const HOOK_RUNNER_DIST = path
  .resolve(__dirname, '..', '..', '..', 'dist', 'capture', 'hooks', 'hook-runner.js')
  .replace(/\\/g, '/');

interface HookCommandEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommandEntry[];
}

interface SettingsFile {
  hooks?: Record<string, HookGroup[] | undefined> | HookGroup[] | undefined;
  // settings.json may have other keys; preserve them.
  [key: string]: unknown;
}

const HOOK_PHASES: Array<{ event: string; phase: string; matcher?: string }> = [
  { event: 'PreToolUse', phase: 'pre' },
  { event: 'PostToolUse', phase: 'post' },
  { event: 'UserPromptSubmit', phase: 'prompt' },
  { event: 'Stop', phase: 'stop' },
];

function buildCommand(phase: string): string {
  return `node "${HOOK_RUNNER_DIST}" ${phase}`;
}

const V1_PATHS = [
  '01-data-layer/dist/hook-runner.js',
  '01-data-layer\\dist\\hook-runner.js',
  '04-session-intelligence/dist/session-start.js',
  '04-session-intelligence\\dist\\session-start.js',
];

function isV1Entry(entry: HookCommandEntry): boolean {
  if (!entry || entry.type !== 'command') return false;
  if (typeof entry.command !== 'string') return false;
  for (const p of V1_PATHS) if (entry.command.includes(p)) return true;
  return false;
}

function isV2Entry(entry: HookCommandEntry): boolean {
  if (!entry || entry.type !== 'command') return false;
  if (typeof entry.command !== 'string') return false;
  return (
    entry.command.includes('07-daemon/dist/capture/hooks/hook-runner.js') ||
    entry.command.includes('07-daemon\\dist\\capture\\hooks\\hook-runner.js')
  );
}

function isDevNeuralEntry(entry: HookCommandEntry): boolean {
  return isV1Entry(entry) || isV2Entry(entry);
}

function loadSettings(): SettingsFile {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as SettingsFile;
  } catch (err) {
    throw new Error(
      `failed to parse ${SETTINGS_PATH}: ${(err as Error).message}`,
    );
  }
}

function saveSettings(settings: SettingsFile): void {
  const backup = SETTINGS_PATH + '.devneural.bak';
  if (fs.existsSync(SETTINGS_PATH)) {
    fs.copyFileSync(SETTINGS_PATH, backup);
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function ensureHooksObject(settings: SettingsFile): Record<string, HookGroup[]> {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  return settings.hooks as Record<string, HookGroup[]>;
}

function addHook(
  hooks: Record<string, HookGroup[]>,
  event: string,
  command: string,
  matcher?: string,
): void {
  const groups = hooks[event] ?? [];

  // Strip any existing devneural entries from this event.
  const cleaned: HookGroup[] = [];
  for (const group of groups) {
    const remaining = (group.hooks ?? []).filter((h) => !isDevNeuralEntry(h));
    if (remaining.length > 0) {
      cleaned.push({ ...group, hooks: remaining });
    } else if (group.matcher && group.matcher !== matcher) {
      // empty group with a different matcher: keep so user's other config isn't dropped
      cleaned.push({ ...group, hooks: [] });
    }
  }

  cleaned.push({
    ...(matcher !== undefined ? { matcher } : {}),
    hooks: [{ type: 'command', command }],
  });

  hooks[event] = cleaned;
}

/**
 * Walk every hook event in the settings and strip any v1 DevNeural entries.
 * The four HOOK_PHASES events get explicit re-installation by addHook; this
 * pass cleans up v1 entries that landed under events we no longer claim
 * (e.g. v1 SessionStart entries that v2 doesn't replace because v2 absorbs
 * startup-context loading into the daemon's polling).
 */
function purgeOrphanedV1Entries(hooks: Record<string, HookGroup[]>): number {
  let purged = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const cleaned: HookGroup[] = [];
    for (const group of groups) {
      const before = (group.hooks ?? []).length;
      const remaining = (group.hooks ?? []).filter((h) => !isV1Entry(h));
      purged += before - remaining.length;
      if (remaining.length > 0) {
        cleaned.push({ ...group, hooks: remaining });
      } else if (group.matcher) {
        // preserve empty matcher-bearing group so other tools' future entries land cleanly
        cleaned.push({ ...group, hooks: [] });
      }
    }
    hooks[event] = cleaned;
  }
  return purged;
}

function main(): void {
  if (!fs.existsSync(HOOK_RUNNER_DIST)) {
    console.error(
      `[install-hooks] hook runner not built. Run \`npm run build\` first.\n  expected: ${HOOK_RUNNER_DIST}`,
    );
    process.exit(1);
  }

  const settings = loadSettings();
  const hooks = ensureHooksObject(settings);

  const purged = purgeOrphanedV1Entries(hooks);
  if (purged > 0) {
    console.log(`[install-hooks] purged ${purged} orphaned v1 entr${purged === 1 ? 'y' : 'ies'}`);
  }

  for (const { event, phase, matcher } of HOOK_PHASES) {
    const command = buildCommand(phase);
    addHook(hooks, event, command, matcher ?? (event.endsWith('ToolUse') ? '*' : undefined));
  }

  saveSettings(settings);
  console.log(`[install-hooks] wrote ${SETTINGS_PATH}`);
  console.log(`[install-hooks] hook runner: ${HOOK_RUNNER_DIST}`);
}

main();
