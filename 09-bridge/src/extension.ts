/**
 * DevNeural Session Bridge.
 *
 * Watches c:/dev/data/skill-connections/session-bridge/<session-id>.in
 * for messages from the daemon. Each message is a JSON line with
 * either a prompt to send to a Claude Code terminal, or a focus
 * directive to bring this VS Code window forward.
 *
 * The bridge picks a target terminal by:
 *   1. The most recently active terminal whose name matches the
 *      configured pattern (default "claude", case-insensitive)
 *   2. Falling back to the active terminal if no match
 *   3. Failing silently and logging if no terminal is open
 *
 * Multi-window VS Code: every window runs its own bridge. To avoid
 * duplicate processing, an extension instance only handles a message
 * if the message's session_id maps to a session whose cwd matches
 * this window's workspace folder. If no mapping is found, all
 * windows attempt to handle (last writer wins on file truncation).
 */
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

const channel = vscode.window.createOutputChannel('DevNeural Bridge');

/* Bridge messages from the daemon. Three shapes:
 *   text          - paste a prompt into the matching Claude terminal
 *   action=focus  - bring this VS Code window to OS foreground
 *   action=key    - inject a single virtual-key press (or chord for mic).
 *                   Mirrors the physical Stream Deck Nav mode: arrows for
 *                   permission picks, numbers for menu options, enter,
 *                   backspace, and Win+H for the OS dictation overlay. */
type NavKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'enter' | 'backspace'
  | '1' | '2' | '3' | '4' | '5'
  | 'mic';

interface BridgeMessage {
  queued_at: string;
  text?: string;
  action?: 'focus' | 'key';
  key?: NavKey;
}

interface SessionMapping {
  session_id: string;
  cwd?: string;
  project_root?: string;
}

let watchTimer: NodeJS.Timeout | undefined;
let lastOffsets = new Map<string, number>();
let enabled = true;

function getDataRoot(): string {
  const cfg = vscode.workspace.getConfiguration('devneural.bridge');
  const raw = (cfg.get<string>('dataRoot') ?? 'C:/dev/data/skill-connections')
    .replace(/\\/g, '/')
    .replace(/^~/, os.homedir().replace(/\\/g, '/'));
  return raw;
}

function getBridgeDir(): string {
  return path.posix.join(getDataRoot(), 'session-bridge');
}

function getTerminalPattern(): string {
  return (
    vscode.workspace
      .getConfiguration('devneural.bridge')
      .get<string>('terminalNamePattern') ?? 'claude'
  ).toLowerCase();
}

function isEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration('devneural.bridge').get<boolean>('enabled') ??
    true
  );
}

function findTargetTerminal(): vscode.Terminal | undefined {
  const pattern = getTerminalPattern();
  const terminals = vscode.window.terminals;
  if (terminals.length === 0) return undefined;
  // Prefer the active terminal if it matches the pattern
  const active = vscode.window.activeTerminal;
  if (active && active.name.toLowerCase().includes(pattern)) {
    return active;
  }
  // Otherwise, the most-recently created terminal whose name matches
  for (let i = terminals.length - 1; i >= 0; i--) {
    const t = terminals[i];
    if (t && t.name.toLowerCase().includes(pattern)) {
      return t;
    }
  }
  // Fallback: active terminal
  return active ?? terminals[terminals.length - 1];
}

function focusWindow(): void {
  // VS Code's extension API has no "bring my window to OS foreground" call.
  // workbench.action.focusActiveEditorGroup moves focus inside VS Code but
  // does NOT pull the window above other apps on Windows. To match the
  // physical Stream Deck's tap-to-focus behavior we shell out to a hidden
  // PowerShell that calls Win32 SetForegroundWindow against the matching
  // Code.exe process. Match by workspace folder name in MainWindowTitle so
  // the right window comes forward when the user has multiple VS Codes
  // open.
  void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  vscode.window.setStatusBarMessage('DevNeural Bridge: focus requested', 1500);
  channel.appendLine(`[focus] requested at ${new Date().toISOString()}`);

  if (process.platform !== 'win32') return;

  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderName = folders[0]?.name ?? '';
  // PowerShell escapes: keep folder name simple. If empty, fall back to any
  // VS Code window (better than nothing).
  const titleFilter = folderName
    ? `$_.MainWindowTitle -like '*${folderName.replace(/'/g, "''")}*'`
    : '$_.MainWindowHandle -ne 0';
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$sig = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
'@
Add-Type -MemberDefinition $sig -Name W -Namespace DN -ErrorAction SilentlyContinue
$proc = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and (${titleFilter}) } | Select-Object -First 1
if (-not $proc) { $proc = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if ($proc) {
  [DN.W]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [DN.W]::BringWindowToTop($proc.MainWindowHandle) | Out-Null
  [DN.W]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
}
`.trim();
  try {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    channel.appendLine(`[focus] dispatched SetForegroundWindow for "${folderName || '(any)'}"`);
  } catch (err) {
    channel.appendLine(`[focus] powershell failed: ${(err as Error).message}`);
  }
}

/* Inject one Nav key into the OS foreground via Win32 SendInput. We shell
 * out to a hidden PowerShell that builds the INPUT struct and calls the
 * native SendInput, mirroring the C# StreamDeck.Platform.InputInjector.
 * Mic = Win+H (Windows 11 dictation overlay). Numbers send VK_1..VK_5,
 * arrows + enter + backspace map to their VKs. */
function injectKey(key: NavKey): void {
  if (process.platform !== 'win32') {
    channel.appendLine(`[key] non-windows; skipped ${key}`);
    return;
  }
  const VKs: Record<NavKey, number | null> = {
    up: 0x26, down: 0x28, left: 0x25, right: 0x27,
    enter: 0x0d, backspace: 0x08,
    '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34, '5': 0x35,
    mic: null, // chord; handled separately below
  };
  const VK_LWIN = 0x5b;
  const VK_H = 0x48;
  const single = VKs[key];

  const ps = key === 'mic'
    ? buildChordPs(VK_LWIN, VK_H)
    : single != null
      ? buildSinglePs(single)
      : null;
  if (!ps) {
    channel.appendLine(`[key] unknown key: ${key}`);
    return;
  }
  try {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    channel.appendLine(`[key] dispatched ${key}`);
  } catch (err) {
    channel.appendLine(`[key] powershell failed: ${(err as Error).message}`);
  }
}

function buildSinglePs(vk: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$sig = @'
[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct INPUT_UNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public ulong pad1; [FieldOffset(8)] public ulong pad2; [FieldOffset(16)] public ulong pad3; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUT_UNION u; }
[DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int cbSize);
'@
Add-Type -MemberDefinition $sig -Name K -Namespace DN -ErrorAction SilentlyContinue
$inputs = New-Object DN.K+INPUT[] 2
$inputs[0].type = 1; $inputs[0].u.ki.wVk = ${vk}
$inputs[1].type = 1; $inputs[1].u.ki.wVk = ${vk}; $inputs[1].u.ki.dwFlags = 2
[DN.K]::SendInput(2, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][DN.K+INPUT])) | Out-Null
`.trim();
}

function buildChordPs(modifier: number, key: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$sig = @'
[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct INPUT_UNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public ulong pad1; [FieldOffset(8)] public ulong pad2; [FieldOffset(16)] public ulong pad3; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUT_UNION u; }
[DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int cbSize);
'@
Add-Type -MemberDefinition $sig -Name K -Namespace DN -ErrorAction SilentlyContinue
$inputs = New-Object DN.K+INPUT[] 4
$inputs[0].type = 1; $inputs[0].u.ki.wVk = ${modifier}
$inputs[1].type = 1; $inputs[1].u.ki.wVk = ${key}
$inputs[2].type = 1; $inputs[2].u.ki.wVk = ${key};      $inputs[2].u.ki.dwFlags = 2
$inputs[3].type = 1; $inputs[3].u.ki.wVk = ${modifier}; $inputs[3].u.ki.dwFlags = 2
[DN.K]::SendInput(4, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][DN.K+INPUT])) | Out-Null
`.trim();
}

async function handleMessage(message: BridgeMessage): Promise<void> {
  if (message.action === 'focus') {
    focusWindow();
    return;
  }
  if (message.action === 'key' && message.key) {
    injectKey(message.key);
    return;
  }
  if (!message.text) {
    channel.appendLine('[skip] message has no text and no action');
    return;
  }

  const terminal = findTargetTerminal();
  if (!terminal) {
    channel.appendLine(
      `[skip] no terminal in this window. Open Claude Code first.`,
    );
    vscode.window.showWarningMessage(
      'DevNeural Bridge has a queued prompt but no Claude terminal is open in this window.',
    );
    return;
  }
  channel.appendLine(
    `[send] -> "${terminal.name}": ${message.text.slice(0, 80)}${
      message.text.length > 80 ? '...' : ''
    }`,
  );
  terminal.show(true);
  terminal.sendText(message.text, true);
}

function shouldHandleSession(sessionId: string): boolean {
  // Map the session-id to its cwd via the daemon's session-state metadata.
  // If the cwd starts with this window's workspace folder, we own it.
  const dataRoot = getDataRoot();
  const metaFile = path.posix.join(
    dataRoot,
    'session-state',
    `${sessionId}.meta.json`,
  );
  if (!fs.existsSync(metaFile)) {
    return true; // No mapping; let everyone try (last-writer-wins on file truncation)
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as SessionMapping;
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return true;
    const sessionPath = (meta.cwd ?? meta.project_root ?? '').replace(
      /\\/g,
      '/',
    );
    if (!sessionPath) return true;
    return folders.some((f) => {
      const folder = f.uri.fsPath.replace(/\\/g, '/');
      return sessionPath === folder || sessionPath.startsWith(`${folder}/`);
    });
  } catch {
    return true;
  }
}

function processFile(file: string): void {
  if (!isEnabled()) return;
  const sessionId = path.basename(file, '.in');
  if (!shouldHandleSession(sessionId)) {
    return;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return;
  }
  const lastOffset = lastOffsets.get(file) ?? 0;
  if (stat.size === lastOffset) return;
  if (stat.size < lastOffset) {
    // File was truncated; restart from beginning
    lastOffsets.set(file, 0);
    return processFile(file);
  }

  const fd = fs.openSync(file, 'r');
  try {
    const length = stat.size - lastOffset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, lastOffset);
    const text = buf.toString('utf-8');
    const lines = text.split('\n');
    let consumed = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const isLastIncomplete =
        i === lines.length - 1 && !text.endsWith('\n');
      if (isLastIncomplete) break;
      consumed += Buffer.byteLength(line, 'utf-8') + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed) as BridgeMessage;
        void handleMessage(message);
      } catch (err) {
        channel.appendLine(
          `[parse-error] ${(err as Error).message}: ${trimmed.slice(0, 200)}`,
        );
      }
    }
    lastOffsets.set(file, lastOffset + consumed);
  } finally {
    fs.closeSync(fd);
  }
}

function tick(): void {
  if (!enabled || !isEnabled()) return;
  const dir = getBridgeDir();
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.in')) {
      processFile(path.posix.join(dir, e.name));
    }
  }
}

function startWatching(): void {
  if (watchTimer) return;
  channel.appendLine(`[start] bridge dir: ${getBridgeDir()}`);
  channel.appendLine(`[start] terminal pattern: ${getTerminalPattern()}`);
  watchTimer = setInterval(tick, 750);
}

function stopWatching(): void {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  channel.appendLine(`[activate] DevNeural Bridge ${getDataRoot()}`);
  if (isEnabled()) {
    startWatching();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('devneural.bridge.status', () => {
      const status = {
        enabled,
        configEnabled: isEnabled(),
        dataRoot: getDataRoot(),
        bridgeDir: getBridgeDir(),
        terminalPattern: getTerminalPattern(),
        terminals: vscode.window.terminals.map((t) => t.name),
        workspaces: (vscode.workspace.workspaceFolders ?? []).map((f) =>
          f.uri.fsPath,
        ),
        watching: Boolean(watchTimer),
        offsetsTracked: lastOffsets.size,
      };
      channel.show(true);
      channel.appendLine(`[status] ${JSON.stringify(status, null, 2)}`);
      void vscode.window.showInformationMessage(
        `DevNeural Bridge: ${enabled ? 'on' : 'off'}, watching ${getBridgeDir()}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devneural.bridge.toggle', () => {
      enabled = !enabled;
      if (enabled) {
        startWatching();
        void vscode.window.showInformationMessage('DevNeural Bridge: enabled');
      } else {
        stopWatching();
        void vscode.window.showInformationMessage('DevNeural Bridge: paused');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'devneural.bridge.openClaudeTerminal',
      async () => {
        const t = await vscode.window.showQuickPick(
          vscode.window.terminals.map((term) => term.name),
          { placeHolder: 'Pick the terminal that hosts Claude Code' },
        );
        if (!t) return;
        const cfg = vscode.workspace.getConfiguration('devneural.bridge');
        await cfg.update(
          'terminalNamePattern',
          t.toLowerCase(),
          vscode.ConfigurationTarget.Workspace,
        );
        void vscode.window.showInformationMessage(
          `Bridge will route prompts to "${t}".`,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devneural.bridge')) {
        // Reset offset tracking on dataRoot change
        if (e.affectsConfiguration('devneural.bridge.dataRoot')) {
          lastOffsets = new Map();
        }
        if (!isEnabled()) stopWatching();
        else startWatching();
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => stopWatching(),
  });
}

export function deactivate(): void {
  stopWatching();
  channel.appendLine('[deactivate]');
}
