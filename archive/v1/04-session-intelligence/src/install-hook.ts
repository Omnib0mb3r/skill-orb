import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── Public helpers (exported for unit testing) ───────────────────────────────

export function getSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function readSettings(settingsPath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export function buildHookEntry(
  command: string,
  matcher: string,
  includeStatusMessage: boolean,
): object {
  const hookObj: Record<string, unknown> = {
    type: 'command',
    command,
    timeout: 10,
  };
  if (includeStatusMessage) {
    hookObj.statusMessage = 'Loading DevNeural context...';
  }
  return { matcher, hooks: [hookObj] };
}

export function mergeHooks(
  existing: Record<string, unknown>,
  hookCommand: string,
): Record<string, unknown> {
  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
  const existingSessionStart = (existingHooks.SessionStart as unknown[]) ?? [];

  // Scan all nested command strings across ALL entries (with or without matcher)
  const existingCommands = existingSessionStart
    .flatMap((entry: unknown) => ((entry as Record<string, unknown>).hooks as unknown[]) ?? [])
    .map((h: unknown) => ((h as Record<string, unknown>).command as string) ?? '');

  if (existingCommands.some((cmd) => cmd.includes('session-start.js'))) {
    return existing; // already installed — return same reference for identity check
  }

  const matchers = ['startup', 'resume', 'clear', 'compact'];
  const newEntries = matchers.map((m) => buildHookEntry(hookCommand, m, m === 'startup'));

  return {
    ...existing,
    hooks: {
      ...existingHooks,
      SessionStart: [...existingSessionStart, ...newEntries],
    },
  };
}

export function writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmpPath, settingsPath);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const scriptPath = path.resolve(__dirname, '..', 'dist', 'session-start.js')
    .split(path.sep).join('/');
  const hookCommand = `node "${scriptPath}"`;

  const settingsPath = getSettingsPath();
  const existing = readSettings(settingsPath);
  const merged = mergeHooks(existing, hookCommand);

  if (merged === existing) {
    process.stdout.write('DevNeural hook already registered in settings.json — no changes made.\n');
    return;
  }

  writeSettings(settingsPath, merged);

  process.stdout.write(
    `DevNeural SessionStart hook installed.\n` +
    `Script: ${scriptPath}\n` +
    `Registered in: ${settingsPath}\n\n` +
    `Matchers: startup, resume, clear, compact\n\n` +
    `Note: Run 'npm run build' first to compile the hook script.\n` +
    `      The hook is bound to the path above — moving the DevNeural repo will break it.\n` +
    `Open a new Claude Code session to verify the hook fires.\n`,
  );
}

main().catch((err: Error) => {
  process.stderr.write(`install-hook error: ${err.message}\n`);
  process.exit(1);
});
