import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getLogFilePath, buildLogEntry, appendLogEntry } from '../src/logger';
import type { HookPayload, ProjectIdentity } from '../src/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makePayload = (overrides: Partial<HookPayload> = {}): HookPayload => ({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-001',
  cwd: '/some/cwd',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
  tool_response: null,
  tool_use_id: 'tu-001',
  transcript_path: '/tmp/transcript.json',
  permission_mode: 'default',
  ...overrides,
});

const makeIdentity = (overrides: Partial<ProjectIdentity> = {}): ProjectIdentity => ({
  id: 'github.com/user/repo',
  source: 'git-remote',
  ...overrides,
});

// ── getLogFilePath ────────────────────────────────────────────────────────────

describe('getLogFilePath', () => {
  it('produces correct filename for a given UTC date', () => {
    const dataRoot = '/tmp/data';
    const date = new Date('2026-03-28T15:30:00Z');
    const result = getLogFilePath(dataRoot, date);
    expect(result).toBe(path.join(dataRoot, 'logs', '2026-03-28.jsonl'));
  });

  it('uses current date when no date argument is provided', () => {
    const dataRoot = '/tmp/data';
    const before = new Date();
    const result = getLogFilePath(dataRoot);
    const after = new Date();
    const year = before.getUTCFullYear();
    const month = String(before.getUTCMonth() + 1).padStart(2, '0');
    const day = String(before.getUTCDate()).padStart(2, '0');
    // Result should be today's file (same UTC day as before/after)
    expect(result).toContain(path.join('logs', `${year}-${month}-${day}.jsonl`));
    void after; // suppress unused warning
  });
});

// ── buildLogEntry ─────────────────────────────────────────────────────────────

describe('buildLogEntry', () => {
  it('sets schema_version: 1', () => {
    const entry = buildLogEntry(makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash');
    expect(entry.schema_version).toBe(1);
  });

  it('project->tool sets correct connection type and nodes', () => {
    const entry = buildLogEntry(
      makePayload(),
      makeIdentity(),
      'project->tool',
      'project:github.com/user/repo',
      'tool:Bash'
    );
    expect(entry.connection_type).toBe('project->tool');
    expect(entry.source_node).toBe('project:github.com/user/repo');
    expect(entry.target_node).toBe('tool:Bash');
  });

  it('project->skill sets correct connection type and nodes', () => {
    const entry = buildLogEntry(
      makePayload(),
      makeIdentity(),
      'project->skill',
      'project:github.com/user/repo',
      'skill:gsd:execute-phase'
    );
    expect(entry.connection_type).toBe('project->skill');
    expect(entry.target_node).toBe('skill:gsd:execute-phase');
  });

  it('project->project sets correct connection type', () => {
    const entry = buildLogEntry(
      makePayload(),
      makeIdentity(),
      'project->project',
      'project:github.com/user/a',
      'project:github.com/user/b'
    );
    expect(entry.connection_type).toBe('project->project');
  });

  it('copies session_id, tool_use_id, tool_name, and tool_input from payload', () => {
    const payload = makePayload({
      session_id: 'sess-xyz',
      tool_use_id: 'tu-xyz',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/foo.txt', content: 'hello' },
    });
    const entry = buildLogEntry(payload, makeIdentity(), 'project->tool', 'project:x', 'tool:Write');
    expect(entry.session_id).toBe('sess-xyz');
    expect(entry.tool_use_id).toBe('tu-xyz');
    expect(entry.tool_name).toBe('Write');
    expect(entry.tool_input).toEqual({ file_path: '/tmp/foo.txt', content: 'hello' });
  });

  it('sets timestamp as ISO 8601 UTC string ending with Z', () => {
    const entry = buildLogEntry(makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash');
    expect(entry.timestamp.endsWith('Z')).toBe(true);
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('includes stage and tags in the entry when provided', () => {
    const entry = buildLogEntry(
      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
      'deployed', ['sandbox'],
    );
    expect(entry.stage).toBe('deployed');
    expect(entry.tags).toEqual(['sandbox']);
  });

  it('omits stage key entirely when stage is undefined', () => {
    const entry = buildLogEntry(
      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
      undefined, undefined,
    );
    expect(entry).not.toHaveProperty('stage');
    expect(entry).not.toHaveProperty('tags');
  });

  it('includes tags but omits stage when only tags are provided', () => {
    const entry = buildLogEntry(
      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
      undefined, ['sandbox'],
    );
    expect(entry).not.toHaveProperty('stage');
    expect(entry.tags).toEqual(['sandbox']);
  });

  it('includes stage but omits tags when only stage is provided', () => {
    const entry = buildLogEntry(
      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
      'alpha', undefined,
    );
    expect(entry.stage).toBe('alpha');
    expect(entry).not.toHaveProperty('tags');
  });

  it('serialized JSON entry includes stage and tags only when defined', async () => {
    const entry = buildLogEntry(
      makePayload(), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash',
      'beta', ['revision-needed'],
    );
    const parsed = JSON.parse(JSON.stringify(entry));
    expect(parsed.stage).toBe('beta');
    expect(parsed.tags).toEqual(['revision-needed']);
  });
});

// ── appendLogEntry ────────────────────────────────────────────────────────────

describe('appendLogEntry', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  });

  afterEach(() => {
    if (dataRoot && fs.existsSync(dataRoot)) {
      fs.rmSync(dataRoot, { recursive: true });
    }
  });

  const makeEntry = () =>
    buildLogEntry(makePayload(), makeIdentity(), 'project->tool', 'project:github.com/user/repo', 'tool:Bash');

  it('creates logs/ directory if it does not exist', async () => {
    const entry = makeEntry();
    await appendLogEntry(entry, dataRoot);
    expect(fs.existsSync(path.join(dataRoot, 'logs'))).toBe(true);
  });

  it('writes a valid JSON line terminated with \\n', async () => {
    const entry = makeEntry();
    const date = new Date();
    await appendLogEntry(entry, dataRoot);

    const logFile = getLogFilePath(dataRoot, date);
    const content = fs.readFileSync(logFile, 'utf8');
    expect(content.endsWith('\n')).toBe(true);

    const line = content.trim();
    const parsed = JSON.parse(line);
    expect(parsed.schema_version).toBe(1);
  });

  it('appends to existing file without overwriting', async () => {
    const entry1 = buildLogEntry(makePayload({ tool_name: 'Bash' }), makeIdentity(), 'project->tool', 'project:x', 'tool:Bash');
    const entry2 = buildLogEntry(makePayload({ tool_name: 'Write' }), makeIdentity(), 'project->tool', 'project:x', 'tool:Write');

    const date = new Date();
    await appendLogEntry(entry1, dataRoot);
    await appendLogEntry(entry2, dataRoot);

    const logFile = getLogFilePath(dataRoot, date);
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    expect(parsed1.tool_name).toBe('Bash');
    expect(parsed2.tool_name).toBe('Write');
  });

  it('written JSON deserializes to a valid LogEntry shape', async () => {
    const entry = makeEntry();
    const date = new Date();
    await appendLogEntry(entry, dataRoot);

    const logFile = getLogFilePath(dataRoot, date);
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());

    const requiredFields = [
      'schema_version', 'timestamp', 'session_id', 'tool_use_id',
      'project', 'project_source', 'tool_name', 'tool_input',
      'connection_type', 'source_node', 'target_node',
    ];
    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
  });

  it('does not throw and logs to stderr when write fails', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Use a file as dataRoot so mkdir(dataRoot/logs) fails
    const fileAsRoot = path.join(dataRoot, 'not-a-dir.txt');
    fs.writeFileSync(fileAsRoot, 'blocker');

    const entry = makeEntry();
    await expect(appendLogEntry(entry, fileAsRoot)).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DevNeural]'),
      expect.anything()
    );

    stderrSpy.mockRestore();
  });
});
