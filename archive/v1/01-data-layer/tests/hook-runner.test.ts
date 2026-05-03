import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { extractSkillName, extractProjectRefs, deriveConnections, readDevneuralJson } from '../src/hook-runner';
import { resolveProjectIdentity } from '../src/identity';
import type { HookPayload, ProjectIdentity, LogEntry } from '../src/types';
import { createTempDir, removeTempDir } from './helpers/tempDir';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makePayload = (overrides: Partial<HookPayload> = {}): HookPayload => ({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-001',
  cwd: 'C:/dev/tools/DevNeural',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
  tool_response: null,
  tool_use_id: 'tu-001',
  transcript_path: '/tmp/transcript.json',
  permission_mode: 'default',
  ...overrides,
});

const makeIdentity = (overrides: Partial<ProjectIdentity> = {}): ProjectIdentity => ({
  id: 'github.com/user/devneural',
  source: 'git-remote',
  ...overrides,
});

// ── Integration subprocess helper ─────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

const spawnHook = (stdin: string, extraEnv: Record<string, string> = {}) =>
  spawnSync(tsxBin, ['src/hook-runner.ts'], {
    input: stdin,
    encoding: 'utf8',
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
    timeout: 15000,
  });

// ── extractSkillName ──────────────────────────────────────────────────────────

describe('extractSkillName', () => {
  it('extracts kebab-case skill name from description', () => {
    expect(extractSkillName({ description: 'Use deep-plan to plan the feature' })).toBe('deep-plan');
  });

  it('extracts namespace:kebab skill name from description', () => {
    expect(extractSkillName({ description: 'gsd:execute-phase agent for execution' })).toBe('gsd:execute-phase');
  });

  it('falls back to subagent_type when description has no skill token', () => {
    expect(extractSkillName({ description: 'Exploring the codebase', subagent_type: 'Explore' })).toBe('Explore');
  });

  it('returns unknown-skill when no recognizable skill token in description', () => {
    expect(extractSkillName({ description: 'Exploring the codebase for patterns' })).toBe('unknown-skill');
  });

  it('returns unknown-skill when no description field', () => {
    expect(extractSkillName({})).toBe('unknown-skill');
  });
});

// ── extractProjectRefs ────────────────────────────────────────────────────────

describe('extractProjectRefs', () => {
  let tempDir: string;
  const identity = makeIdentity({ id: 'current-project' });

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { removeTempDir(tempDir); });

  it('detects cross-project file_path in Edit tool_input', async () => {
    const filePath = path.join(tempDir, 'some-file.ts');
    const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
    const refs = await extractProjectRefs(payload, identity);
    expect(refs).toHaveLength(1);
    expect(refs[0].connectionType).toBe('project->project');
    expect(refs[0].sourceNode).toBe('project:current-project');
    expect(refs[0].targetNode).toMatch(/^project:/);
  });

  it('returns no connections when file_path is within the current project', async () => {
    const resolvedIdentity = await resolveProjectIdentity(tempDir);
    const filePath = path.join(tempDir, 'some-file.ts');
    const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
    const refs = await extractProjectRefs(payload, resolvedIdentity);
    expect(refs).toHaveLength(0);
  });

  it('detects cross-project repo URL in Agent tool_input.prompt', async () => {
    const payload = makePayload({
      tool_name: 'Agent',
      tool_input: { prompt: 'See https://github.com/user/other-repo for reference' },
    });
    const refs = await extractProjectRefs(payload, identity);
    expect(refs).toHaveLength(1);
    expect(refs[0].connectionType).toBe('project->project');
    expect(refs[0].targetNode).toBe('project:github.com/user/other-repo');
  });

  it('deduplicates multiple references to the same target project', async () => {
    const payload = makePayload({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'See https://github.com/user/repo and also https://github.com/user/repo',
      },
    });
    const refs = await extractProjectRefs(payload, identity);
    expect(refs).toHaveLength(1);
  });

  it('silently skips unresolvable or nonexistent paths — does not throw', async () => {
    const payload = makePayload({
      tool_name: 'Bash',
      tool_input: { command: 'ls /nonexistent-path-xyz/that/does/not/exist' },
    });
    await expect(extractProjectRefs(payload, identity)).resolves.toEqual([]);
  });
});

// ── deriveConnections ─────────────────────────────────────────────────────────

describe('deriveConnections', () => {
  const identity = makeIdentity();

  it('returns project->tool connection for a Bash payload', async () => {
    const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    const conns = await deriveConnections(payload, identity);
    expect(conns).toHaveLength(1);
    expect(conns[0].connectionType).toBe('project->tool');
    expect(conns[0].sourceNode).toBe('project:github.com/user/devneural');
    expect(conns[0].targetNode).toBe('tool:Bash');
  });

  it('returns project->skill connection for Agent payload with recognizable skill in description', async () => {
    const payload = makePayload({
      tool_name: 'Agent',
      tool_input: { description: 'deep-plan skill for implementation planning' },
    });
    const conns = await deriveConnections(payload, identity);
    expect(conns).toHaveLength(1);
    expect(conns[0].connectionType).toBe('project->skill');
    expect(conns[0].targetNode).toBe('skill:deep-plan');
  });

  it('returns skill:unknown-skill when Agent description contains no recognizable skill name', async () => {
    const payload = makePayload({
      tool_name: 'Agent',
      tool_input: { description: 'Exploring the codebase for patterns' },
    });
    const conns = await deriveConnections(payload, identity);
    expect(conns[0].connectionType).toBe('project->skill');
    expect(conns[0].targetNode).toBe('skill:unknown-skill');
  });

  it('returns skill:unknown-skill when Agent payload has no description field', async () => {
    const payload = makePayload({
      tool_name: 'Agent',
      tool_input: {},
    });
    const conns = await deriveConnections(payload, identity);
    expect(conns[0].targetNode).toBe('skill:unknown-skill');
  });

  it('returns project->tool plus project->project for Edit with cross-project file_path', async () => {
    const tempDir = createTempDir();
    try {
      const filePath = path.join(tempDir, 'x.ts');
      const payload = makePayload({ tool_name: 'Edit', tool_input: { file_path: filePath } });
      const conns = await deriveConnections(payload, identity);
      expect(conns.length).toBeGreaterThanOrEqual(2);
      expect(conns[0].connectionType).toBe('project->tool');
      expect(conns[0].targetNode).toBe('tool:Edit');
      const pp = conns.find(c => c.connectionType === 'project->project');
      expect(pp).toBeDefined();
    } finally {
      removeTempDir(tempDir);
    }
  });
});

// ── Hook runner orchestration tests (subprocess) ──────────────────────────────

describe('Hook runner orchestration (subprocess)', () => {
  let dataRoot: string;

  beforeEach(() => { dataRoot = createTempDir(); });
  afterEach(() => { removeTempDir(dataRoot); });

  const env = (d: string) => ({ DEVNEURAL_DATA_ROOT: d });

  const bashPayload = (overrides: Partial<HookPayload> = {}) =>
    JSON.stringify(makePayload({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, ...overrides }));

  it('exits 0 and writes nothing when tool_name is not in the allowlist', () => {
    const result = spawnHook(JSON.stringify(makePayload({ tool_name: 'Read' })), env(dataRoot));
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
  });

  it('exits 0, writes a JSONL log entry and creates weights.json when tool is in allowlist', () => {
    const result = spawnHook(bashPayload(), env(dataRoot));
    expect(result.status).toBe(0);
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
  });

  it('processes a non-default tool added to config.json allowlist', () => {
    fs.writeFileSync(
      path.join(dataRoot, 'config.json'),
      JSON.stringify({ allowlist: ['Read'] }),
    );
    const result = spawnHook(JSON.stringify(makePayload({ tool_name: 'Read' })), env(dataRoot));
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
  });

  it('exits 0 and writes nothing when stdin contains malformed JSON', () => {
    const result = spawnHook('{not json}', env(dataRoot));
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
  });

  it('exits 0 and writes nothing when stdin is empty', () => {
    const result = spawnHook('', env(dataRoot));
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(false);
  });

  it('multiple derived connections produce separate JSONL lines', () => {
    // Edit payload where file_path is in a different temp project
    const otherDir = createTempDir();
    try {
      const filePath = path.join(otherDir, 'file.ts');
      const payload = makePayload({
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
      });
      const result = spawnHook(JSON.stringify(payload), env(dataRoot));
      expect(result.status).toBe(0);
      const today = new Date();
      const y = today.getUTCFullYear();
      const mo = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      const logFile = path.join(dataRoot, 'logs', `${y}-${mo}-${d}.jsonl`);
      expect(fs.existsSync(logFile)).toBe(true);
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const entries = lines.map(l => JSON.parse(l));
      expect(entries.some(e => e.connection_type === 'project->tool')).toBe(true);
      expect(entries.some(e => e.connection_type === 'project->project')).toBe(true);
    } finally {
      removeTempDir(otherDir);
    }
  });
});

// ── Integration (full pipeline) ───────────────────────────────────────────────

describe('Integration: full pipeline', () => {
  let dataRoot: string;

  beforeEach(() => { dataRoot = createTempDir(); });
  afterEach(() => { removeTempDir(dataRoot); });

  it('Bash payload: exits 0, writes valid JSONL line, creates weights.json with raw_count:1', () => {
    const payload = makePayload({
      tool_name: 'Bash',
      session_id: 'test-session',
      tool_input: { command: 'echo hello' },
    });
    const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
    expect(result.status).toBe(0);

    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
    expect(fs.existsSync(logFile)).toBe(true);

    const line = fs.readFileSync(logFile, 'utf8').trim();
    const entry = JSON.parse(line);
    expect(entry.tool_name).toBe('Bash');
    expect(entry.session_id).toBe('test-session');
    expect(entry.connection_type).toBe('project->tool');
    expect(entry.target_node).toBe('tool:Bash');

    const weightsFile = path.join(dataRoot, 'weights.json');
    expect(fs.existsSync(weightsFile)).toBe(true);
    const weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
    const values = Object.values(weights.connections) as Array<{ raw_count: number }>;
    expect(values.length).toBeGreaterThanOrEqual(1);
    expect(values[0].raw_count).toBe(1);
  });

  it('Edit payload with cross-project file_path: both connections in JSONL and weights', () => {
    const otherDir = createTempDir();
    try {
      const filePath = path.join(otherDir, 'file.ts');
      const payload = makePayload({
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
      });
      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
      expect(result.status).toBe(0);

      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
      expect(fs.existsSync(logFile)).toBe(true);

      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const entries = lines.map(l => JSON.parse(l));
      expect(entries.some(e => e.connection_type === 'project->tool')).toBe(true);
      expect(entries.some(e => e.connection_type === 'project->project')).toBe(true);

      const weights = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8'));
      const keys = Object.keys(weights.connections);
      expect(keys.length).toBeGreaterThanOrEqual(2);
    } finally {
      removeTempDir(otherDir);
    }
  });
});

// ── readDevneuralJson ─────────────────────────────────────────────────────────

describe('readDevneuralJson', () => {
  let tempDir: string;

  const validConfig = {
    name: 'TestProject',
    localPath: 'c:/dev/test',
    githubUrl: 'https://github.com/user/test',
    stage: 'beta',
    tags: ['sandbox'],
    description: 'Test project',
  };

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { removeTempDir(tempDir); });

  it('reads stage and tags from devneural.jsonc in the current directory', async () => {
    fs.writeFileSync(path.join(tempDir, 'devneural.jsonc'), JSON.stringify(validConfig), 'utf8');
    const result = await readDevneuralJson(tempDir);
    expect(result).toBeDefined();
    expect(result!.stage).toBe('beta');
    expect(result!.tags).toEqual(['sandbox']);
  });

  it('walks up 3 directory levels to find devneural.jsonc', async () => {
    const deepDir = path.join(tempDir, 'a', 'b', 'c');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'devneural.jsonc'), JSON.stringify(validConfig), 'utf8');
    const result = await readDevneuralJson(deepDir);
    expect(result).toBeDefined();
    expect(result!.stage).toBe('beta');
  });

  it('returns undefined when no devneural.jsonc exists anywhere in the path', async () => {
    // Use a deeply nested temp path with no devneural.jsonc
    const deepDir = path.join(tempDir, 'x', 'y', 'z');
    fs.mkdirSync(deepDir, { recursive: true });
    const result = await readDevneuralJson(deepDir);
    expect(result).toBeUndefined();
  });

  it('returns undefined and emits a warning when devneural.jsonc contains malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(path.join(tempDir, 'devneural.jsonc'), '{ not json', 'utf8');
    const result = await readDevneuralJson(tempDir);
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[DevNeural]'), expect.anything());
    warnSpy.mockRestore();
  });

  it('returns result without stage key when devneural.jsonc is missing the stage field', async () => {
    const withoutStage = { ...validConfig };
    delete (withoutStage as Record<string, unknown>)['stage'];
    fs.writeFileSync(path.join(tempDir, 'devneural.jsonc'), JSON.stringify(withoutStage), 'utf8');
    const result = await readDevneuralJson(tempDir);
    expect(result).toBeDefined();
    expect(result!.stage).toBeUndefined();
  });

  it('does not throw when called with a non-existent start directory', async () => {
    await expect(readDevneuralJson('/nonexistent/path/that/does/not/exist')).resolves.toBeUndefined();
  });
});

// ── LogEntry type — stage and tags fields ─────────────────────────────────────

describe('LogEntry type — stage and tags', () => {
  it('LogEntry accepts optional stage and tags fields', () => {
    const entry: LogEntry = {
      schema_version: 1,
      timestamp: new Date().toISOString(),
      session_id: 'sess',
      tool_use_id: 'tu',
      project: 'proj',
      project_source: 'git-remote',
      tool_name: 'Bash',
      tool_input: {},
      connection_type: 'project->tool',
      source_node: 'project:proj',
      target_node: 'tool:Bash',
      stage: 'beta',
      tags: ['sandbox'],
    };
    expect(entry.stage).toBe('beta');
    expect(entry.tags).toEqual(['sandbox']);
  });

  it('LogEntry allows stage and tags to be absent', () => {
    const entry: LogEntry = {
      schema_version: 1,
      timestamp: new Date().toISOString(),
      session_id: 'sess',
      tool_use_id: 'tu',
      project: 'proj',
      project_source: 'git-remote',
      tool_name: 'Bash',
      tool_input: {},
      connection_type: 'project->tool',
      source_node: 'project:proj',
      target_node: 'tool:Bash',
    };
    expect(entry.stage).toBeUndefined();
    expect(entry.tags).toBeUndefined();
  });
});

// ── stage/tags not in weights.json ───────────────────────────────────────────

describe('weights.json does not contain stage/tags', () => {
  let dataRoot: string;

  beforeEach(() => { dataRoot = createTempDir(); });
  afterEach(() => { removeTempDir(dataRoot); });

  it('ConnectionRecord has no stage or tags fields after hook run', () => {
    // Create a devneural.jsonc in a temp cwd
    const cwd = createTempDir();
    try {
      fs.writeFileSync(path.join(cwd, 'devneural.jsonc'), JSON.stringify({
        name: 'Proj',
        localPath: cwd,
        githubUrl: 'https://github.com/user/proj',
        stage: 'beta',
        tags: ['sandbox'],
        description: 'Test',
      }), 'utf8');

      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd });
      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
      expect(result.status).toBe(0);

      const weightsFile = path.join(dataRoot, 'weights.json');
      expect(fs.existsSync(weightsFile)).toBe(true);
      const weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
      for (const record of Object.values(weights.connections) as Record<string, unknown>[]) {
        expect(record).not.toHaveProperty('stage');
        expect(record).not.toHaveProperty('tags');
      }
    } finally {
      removeTempDir(cwd);
    }
  });
});

// ── devneural.jsonc enrichment in subprocess ───────────────────────────────────

describe('Hook runner orchestration: devneural.jsonc enrichment (subprocess)', () => {
  let dataRoot: string;

  beforeEach(() => { dataRoot = createTempDir(); });
  afterEach(() => { removeTempDir(dataRoot); });

  it('JSONL log entry contains stage and tags when devneural.jsonc is in cwd', () => {
    const cwd = createTempDir();
    try {
      fs.writeFileSync(path.join(cwd, 'devneural.jsonc'), JSON.stringify({
        name: 'TestProject',
        localPath: cwd,
        githubUrl: 'https://github.com/user/testproj',
        stage: 'deployed',
        tags: ['revision-needed'],
        description: 'Test project',
      }), 'utf8');

      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
      expect(result.status).toBe(0);

      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
      expect(fs.existsSync(logFile)).toBe(true);

      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      const entries = lines.map(l => JSON.parse(l));
      const bashEntry = entries.find(e => e.connection_type === 'project->tool');
      expect(bashEntry?.stage).toBe('deployed');
      expect(bashEntry?.tags).toEqual(['revision-needed']);
    } finally {
      removeTempDir(cwd);
    }
  });

  it('JSONL log entry omits stage and tags when no devneural.jsonc in path', () => {
    const cwd = createTempDir();
    try {
      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
      expect(result.status).toBe(0);

      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      const logFile = path.join(dataRoot, 'logs', `${y}-${m}-${d}.jsonl`);
      expect(fs.existsSync(logFile)).toBe(true);

      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      const entries = lines.map(l => JSON.parse(l));
      for (const entry of entries) {
        expect(entry).not.toHaveProperty('stage');
        expect(entry).not.toHaveProperty('tags');
      }
    } finally {
      removeTempDir(cwd);
    }
  });

  it('hook runner exits 0 and proceeds normally when devneural.jsonc is malformed', () => {
    const cwd = createTempDir();
    try {
      fs.writeFileSync(path.join(cwd, 'devneural.jsonc'), '{ bad json !!', 'utf8');
      const payload = makePayload({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd });
      const result = spawnHook(JSON.stringify(payload), { DEVNEURAL_DATA_ROOT: dataRoot });
      expect(result.status).toBe(0);
      // Still creates weights.json (tool processing continues)
      expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
    } finally {
      removeTempDir(cwd);
    }
  });
});
