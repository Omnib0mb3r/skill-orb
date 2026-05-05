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

/**
 * On Windows, spawning `node` directly from Claude Code's hook runner causes
 * a console window to flash on the active desktop for every hook firing
 * (multiple times per prompt). Wrapping the node call in a VBScript shim
 * launched via wscript.exe with WindowStyle 0 produces zero visible flash.
 * The shim is generated at install time and lives next to hook-runner.js.
 */
const SILENT_SHIM = path
  .resolve(__dirname, '..', '..', '..', 'dist', 'capture', 'hooks', 'silent-runner.vbs')
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
  // Notification fires when Claude is waiting on a permission/elicitation
  // answer from the user. We capture the prompt message + matcher so the
  // dashboard can surface the question with answer buttons; without this
  // entry the dashboard sees nothing when CC asks "1) yes 2) no" and the
  // user has to tab back to the VS Code window to reply.
  { event: 'Notification', phase: 'notification' },
  // SessionStart fires on every session boot. We care about source=clear
  // so the daemon can mark the previous session in this workspace as
  // superseded; without this, /clear leaves a phantom tile in the Stream
  // Deck rail until the old jsonl's mtime ages past ACTIVE_THRESHOLD_MS.
  { event: 'SessionStart', phase: 'session_start' },
];

function buildCommand(phase: string): string {
  // wscript runs VBScripts with no console window. Path uses backslashes
  // because wscript.exe's command-line parser is fussy about forward slashes
  // even though node accepts them.
  const shim = SILENT_SHIM.replace(/\//g, '\\');
  return `wscript.exe "${shim}" ${phase}`;
}

function ensureSilentShim(): void {
  const shimDir = path.dirname(SILENT_SHIM);
  fs.mkdirSync(shimDir, { recursive: true });
  // The shim takes the phase as argument and runs hook-runner.js with it.
  // WshShell.Run window-style 0 = hidden, third arg false = don't wait.
  // On error we fall back to running visibly so failures aren't completely silent.
  const runnerWin = HOOK_RUNNER_DIST.replace(/\//g, '\\');
  const vbs = [
    'Option Explicit',
    'Dim sh, phase, cmd',
    'Set sh = CreateObject("WScript.Shell")',
    'If WScript.Arguments.Count > 0 Then',
    '  phase = WScript.Arguments(0)',
    'Else',
    '  phase = ""',
    'End If',
    `cmd = "node """ & "${runnerWin.replace(/\\/g, '\\\\')}" & """ " & phase`,
    'sh.Run cmd, 0, False',
    'Set sh = Nothing',
    '',
  ].join('\r\n');
  fs.writeFileSync(SILENT_SHIM, vbs, 'utf-8');
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
    entry.command.includes('07-daemon\\dist\\capture\\hooks\\hook-runner.js') ||
    entry.command.includes('07-daemon/dist/capture/hooks/silent-runner.vbs') ||
    entry.command.includes('07-daemon\\dist\\capture\\hooks\\silent-runner.vbs')
  );
}

function isDevNeuralEntry(entry: HookCommandEntry): boolean {
  return isV1Entry(entry) || isV2Entry(entry);
}

function loadSettings(): SettingsFile {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    let raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    // Strip UTF-8 BOM. PowerShell 5.1's Set-Content -Encoding UTF8 prepends
    // one and breaks JSON.parse; tolerate it on read so we don't fight other
    // tools that may have written the file.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw) as SettingsFile;
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

  ensureSilentShim();

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
