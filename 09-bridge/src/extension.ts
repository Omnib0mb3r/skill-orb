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
import { spawn, execFile } from 'node:child_process';

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

/* Per-window offset persistence so VS Code reloads don't replay the
 * entire bridge inbox backlog (which can fire stale mic toggles or
 * key presses queued hours ago). The offsets file is keyed by
 * workspace folder so multiple VS Code windows don't trample each
 * other's cursors. */
function getOffsetsFile(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folderKey = folders[0]?.uri.fsPath?.replace(/[\\/:*?"<>|]/g, '_') ?? 'no-workspace';
  const dir = path.posix.join(getDataRoot(), 'session-bridge', '.offsets');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return path.posix.join(dir, `${folderKey}.json`);
}

function loadOffsets(): void {
  const file = getOffsetsFile();
  if (!fs.existsSync(file)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, number>;
    lastOffsets = new Map(Object.entries(raw));
  } catch {
    /* ignore */
  }
}

let offsetsSaveTimer: NodeJS.Timeout | undefined;
function saveOffsetsDebounced(): void {
  if (offsetsSaveTimer) return;
  offsetsSaveTimer = setTimeout(() => {
    offsetsSaveTimer = undefined;
    try {
      const obj: Record<string, number> = {};
      for (const [k, v] of lastOffsets) obj[k] = v;
      fs.writeFileSync(getOffsetsFile(), JSON.stringify(obj), 'utf-8');
    } catch {
      /* ignore */
    }
  }, 500);
}

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

/* Cache of terminal id -> "is this running claude" so we don't shell
 * out to wmic on every tick. Cleared when terminals open or close. */
const claudeTerminalCache = new Map<vscode.Terminal, boolean>();
function clearClaudeTerminalCache(): void {
  claudeTerminalCache.clear();
}

interface ProcRow {
  pid: number;
  ppid: number;
  cmd: string;
}

/* Walk the Windows process tree from a root pid; return any descendant
 * whose ExecutablePath or CommandLine contains "claude". One wmic call
 * for the whole snapshot, then BFS in memory.
 *
 * wmic is deprecated in Windows 11 but still ships. If it's missing
 * we fall back to PowerShell Get-CimInstance which is the modern
 * equivalent. Both produce the same shape. */
async function findClaudeDescendant(rootPid: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const rows = await snapshotProcesses();
  if (rows.length === 0) return false;
  const byParent = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid) ?? [];
    list.push(r);
    byParent.set(r.ppid, list);
  }
  const stack: number[] = [rootPid];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const children = byParent.get(cur) ?? [];
    for (const c of children) {
      if (/claude/i.test(c.cmd)) return true;
      stack.push(c.pid);
    }
  }
  return false;
}

let cachedSnapshot: { rows: ProcRow[]; ts: number } | null = null;
async function snapshotProcesses(): Promise<ProcRow[]> {
  // 4-second cache: bridge tick is 750ms, identifying many terminals
  // in a row would otherwise spawn a wmic per terminal per tick.
  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshot.ts < 4_000) {
    return cachedSnapshot.rows;
  }
  const rows = await runProcessSnapshot();
  cachedSnapshot = { rows, ts: now };
  return rows;
}

function runProcessSnapshot(): Promise<ProcRow[]> {
  return new Promise((resolve) => {
    // PowerShell Get-CimInstance is the modern replacement for wmic
    // and ships on every Windows 10+. Single -Command invocation,
    // CSV output, parse line-by-line.
    const psCmd =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation";
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        const rows: ProcRow[] = [];
        const lines = stdout.split(/\r?\n/);
        // Skip header
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          // Naive CSV split: fields are quoted, commas inside quotes
          // are valid. Use a regex that respects quoted segments.
          const m = line.match(/^"(\d+)","(\d+)","(.*)"$/);
          if (!m) continue;
          rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            cmd: m[3] ?? '',
          });
        }
        resolve(rows);
      },
    );
  });
}

async function isClaudeTerminal(t: vscode.Terminal): Promise<boolean> {
  const cached = claudeTerminalCache.get(t);
  if (cached !== undefined) return cached;
  let pid: number | undefined;
  try {
    pid = await t.processId;
  } catch {
    pid = undefined;
  }
  if (!pid) {
    claudeTerminalCache.set(t, false);
    return false;
  }
  const found = await findClaudeDescendant(pid);
  claudeTerminalCache.set(t, found);
  return found;
}

/* Async terminal resolution. The tick loop awaits this so we don't
 * deliver a message before we know which terminal is the Claude one.
 * Resolution order:
 *
 *   1. Configured terminalNamePattern matches a terminal name.
 *      Fastest, also covers the user's explicit Pick Terminal flow.
 *   2. Process-tree auto-detect: walk children of each terminal's
 *      shell pid; any descendant whose CommandLine contains "claude"
 *      claims the terminal. This is what catches Claude Code's
 *      actual node-based shell when the terminal name is "PowerShell"
 *      or "1: pwsh".
 *
 * If neither resolves, we return undefined. The user-facing notice
 * gives them the explicit Pick Terminal escape hatch. */
async function findTargetTerminalAsync(): Promise<vscode.Terminal | undefined> {
  const pattern = getTerminalPattern();
  const terminals = vscode.window.terminals;
  if (terminals.length === 0) return undefined;

  // 1. Name pattern (cheap path).
  const active = vscode.window.activeTerminal;
  if (active && active.name.toLowerCase().includes(pattern)) {
    return active;
  }
  for (let i = terminals.length - 1; i >= 0; i--) {
    const t = terminals[i];
    if (t && t.name.toLowerCase().includes(pattern)) {
      return t;
    }
  }

  // 2. Process-tree auto-detect.
  // Prefer the active terminal so multi-terminal windows stay
  // predictable; only fall through to others if active isn't Claude.
  if (active && (await isClaudeTerminal(active))) {
    return active;
  }
  for (let i = terminals.length - 1; i >= 0; i--) {
    const t = terminals[i];
    if (!t) continue;
    if (await isClaudeTerminal(t)) return t;
  }
  return undefined;
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

/* Throttle the "no terminal" notice. Without this the user sees a
 * popup every time the daemon writes another prompt to the bridge
 * inbox, even though the warning content never changes. The first
 * occurrence shows an actionable info message (with "Pick Terminal"
 * button) so the user can fix the mapping. Subsequent occurrences
 * within 5 minutes go to the status bar only (auto-hide). */
let lastNoTerminalNoticeMs = 0;
let firstNoticeShown = false;
function noticeNoTerminal(): void {
  const now = Date.now();
  if (now - lastNoTerminalNoticeMs < 5 * 60_000) return;
  lastNoTerminalNoticeMs = now;
  if (!firstNoticeShown) {
    firstNoticeShown = true;
    void vscode.window
      .showInformationMessage(
        'DevNeural Bridge: no Claude terminal mapped in this window. Map one to receive prompts here.',
        'Pick Terminal',
        'Dismiss',
      )
      .then((choice) => {
        if (choice === 'Pick Terminal') {
          void vscode.commands.executeCommand(
            'devneural.bridge.openClaudeTerminal',
          );
        }
      });
    return;
  }
  vscode.window.setStatusBarMessage(
    'DevNeural Bridge: no terminal mapped; prompt skipped.',
    3000,
  );
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

  const terminal = await findTargetTerminalAsync();
  if (!terminal) {
    channel.appendLine(
      '[skip] no terminal in this window; another bridge instance is expected to handle it',
    );
    noticeNoTerminal();
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

/* Cache: session_id -> resolved cwd (or '' if unresolvable). Keyed by
 * the path of the source we read it from so cache invalidates when
 * the user moves session-state. */
const cwdCache = new Map<string, string>();

function resolveSessionCwd(sessionId: string): string {
  const cached = cwdCache.get(sessionId);
  if (cached !== undefined) return cached;

  const dataRoot = getDataRoot();
  const metaFile = path.posix.join(
    dataRoot,
    'session-state',
    `${sessionId}.meta.json`,
  );
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as SessionMapping;
      const cwd = (meta.cwd ?? meta.project_root ?? '').replace(/\\/g, '/');
      cwdCache.set(sessionId, cwd);
      return cwd;
    } catch {
      /* fall through to jsonl scan */
    }
  }

  // Fallback: scan ~/.claude/projects/<slug>/<sessionId>.jsonl for the
  // first record carrying a cwd. The summarizer might not have run yet
  // for this session, so the meta file is missing; the actual
  // transcript on disk is the canonical source either way.
  const claudeRoot = path.posix.join(
    os.homedir().replace(/\\/g, '/'),
    '.claude',
    'projects',
  );
  if (fs.existsSync(claudeRoot)) {
    try {
      const slugs = fs.readdirSync(claudeRoot, { withFileTypes: true });
      for (const slug of slugs) {
        if (!slug.isDirectory()) continue;
        const file = path.posix.join(claudeRoot, slug.name, `${sessionId}.jsonl`);
        if (!fs.existsSync(file)) continue;
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(8 * 1024);
          const n = fs.readSync(fd, buf, 0, buf.length, 0);
          const text = buf.toString('utf-8', 0, n);
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const rec = JSON.parse(trimmed) as { cwd?: string };
              if (typeof rec.cwd === 'string' && rec.cwd) {
                const cwd = rec.cwd.replace(/\\/g, '/');
                cwdCache.set(sessionId, cwd);
                return cwd;
              }
            } catch {
              /* skip */
            }
          }
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {
      /* ignore */
    }
  }

  cwdCache.set(sessionId, '');
  return '';
}

function shouldHandleSession(sessionId: string): boolean {
  /* Decide whether THIS VS Code window should process the bridge
   * message for this session. A session belongs to whichever window
   * has the matching workspace folder open; multiple windows with
   * independent bridges otherwise all try and clobber each other.
   *
   * Resolution chain:
   *   1. session-state meta file (written by summarizer)
   *   2. ~/.claude/projects/<slug>/<sessionId>.jsonl first cwd record
   * If both fail, we bail to "true" so SOME window handles it; the
   * strict terminal match in handleMessage protects against
   * delivering to an unrelated shell. */
  const sessionCwd = resolveSessionCwd(sessionId);
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!sessionCwd || folders.length === 0) return true;
  // Windows paths are case-insensitive on disk but the casing recorded
  // in the Claude Code transcript ("C:\dev\...") often differs from the
  // casing VS Code uses for its workspace fsPath ("c:\dev\..."), which
  // turned a case mismatch into a silent "skip every prompt".
  const sessionCwdLower = sessionCwd.toLowerCase();
  return folders.some((f) => {
    const folder = f.uri.fsPath.replace(/\\/g, '/').toLowerCase();
    return sessionCwdLower === folder || sessionCwdLower.startsWith(`${folder}/`);
  });
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
      const isLast = i === lines.length - 1;
      const isLastIncomplete = isLast && !text.endsWith('\n');
      if (isLastIncomplete) break;
      // split('\n') of "a\nb\n" yields ["a","b",""]; the trailing empty
      // token after a final newline is not a real line and must not
      // contribute to `consumed`, otherwise the offset overshoots EOF
      // by 1 byte and the next tick treats the unchanged file as
      // truncated, replaying every message every 750ms.
      if (isLast && line === '' && text.endsWith('\n')) break;
      consumed += Buffer.byteLength(line, 'utf-8') + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed) as BridgeMessage;
        // Drop stale messages so a queue that piled up while the bridge
        // was down does not flood the terminal hours later. Threshold
        // matches the daemon's bridge-offline window plus a buffer for
        // tick latency; anything older was almost certainly queued
        // against a dead bridge.
        const queuedMs = Date.parse(message.queued_at);
        if (Number.isFinite(queuedMs) && Date.now() - queuedMs > 90_000) {
          channel.appendLine(
            `[skip-stale] queued_at=${message.queued_at} age=${Math.round((Date.now() - queuedMs) / 1000)}s text=${(message.text ?? message.action ?? '').toString().slice(0, 60)}`,
          );
          continue;
        }
        void handleMessage(message);
      } catch (err) {
        channel.appendLine(
          `[parse-error] ${(err as Error).message}: ${trimmed.slice(0, 200)}`,
        );
      }
    }
    const nextOffset = Math.min(lastOffset + consumed, stat.size);
    lastOffsets.set(file, nextOffset);
    saveOffsetsDebounced();
  } finally {
    fs.closeSync(fd);
  }
}

/* Liveness heartbeat. The daemon refuses to queue prompts unless this
 * file's mtime is recent (default <30s), so we touch it on every tick.
 * Without this, a closed VS Code window left messages buffering in the
 * bridge inbox for hours and dumped them all at once on next reload. */
function writeHeartbeat(): void {
  const dir = getBridgeDir();
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
  }
  const file = path.posix.join(dir, '.heartbeat');
  try {
    const now = Date.now();
    fs.writeFileSync(file, String(now), 'utf-8');
  } catch {
    /* ignore */
  }
}

function tick(): void {
  if (!enabled || !isEnabled()) return;
  writeHeartbeat();
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
  loadOffsets();
  channel.appendLine(`[start] bridge dir: ${getBridgeDir()}`);
  channel.appendLine(`[start] terminal pattern: ${getTerminalPattern()}`);
  channel.appendLine(`[start] offsets restored: ${lastOffsets.size} files`);

  /* On first start in a new workspace (no offsets file yet), advance
   * the cursor to current end-of-file for every existing inbox file
   * so we don't replay backlog from before the bridge was installed
   * or before the user mapped their terminal. */
  if (lastOffsets.size === 0) {
    const dir = getBridgeDir();
    if (fs.existsSync(dir)) {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isFile() || !e.name.endsWith('.in')) continue;
          const full = path.posix.join(dir, e.name);
          try {
            const stat = fs.statSync(full);
            lastOffsets.set(full, stat.size);
          } catch {
            /* ignore */
          }
        }
        channel.appendLine(
          `[start] first run: skipped ${lastOffsets.size} backlog files`,
        );
        saveOffsetsDebounced();
      } catch {
        /* ignore */
      }
    }
  }
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

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => clearClaudeTerminalCache()),
    vscode.window.onDidCloseTerminal(() => clearClaudeTerminalCache()),
  );

  context.subscriptions.push({
    dispose: () => stopWatching(),
  });
}

export function deactivate(): void {
  stopWatching();
  channel.appendLine('[deactivate]');
}
