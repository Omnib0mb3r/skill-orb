import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ObsidianSyncConfig } from '../src/types.js';

// Must be called before importing the module under test
vi.mock('@anthropic-ai/sdk');

// Import after mock is set up
const { runPipeline } = await import('../src/generate-summary.js');
const AnthropicModule = await import('@anthropic-ai/sdk');
const MockAnthropic = vi.mocked(AnthropicModule.default);

const TEST_DATE = '2026-03-30';
const TEST_PROJECT = 'github.com/user/TestProject';

function setupMockCreate(what: string, lessons: string) {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ what_i_worked_on: what, lessons_learned: lessons }),
      },
    ],
  });
  MockAnthropic.mockImplementation(() => ({
    messages: { create: mockCreate },
  }) as never);
  return mockCreate;
}

function writeSampleJSONL(dataRoot: string, date: string): void {
  const logsDir = path.join(dataRoot, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const entries = [
    {
      timestamp: `${date}T10:00:00Z`,
      project: TEST_PROJECT,
      source_node: `project:${TEST_PROJECT}`,
      target_node: 'tool:Read',
      connection_type: 'project->tool',
      tool_name: 'Read',
      stage: 'post',
      tags: [],
      tool_input: { file_path: '/src/index.ts' },
    },
    {
      timestamp: `${date}T10:05:00Z`,
      project: TEST_PROJECT,
      source_node: `project:${TEST_PROJECT}`,
      target_node: 'tool:Write',
      connection_type: 'project->tool',
      tool_name: 'Write',
      stage: 'post',
      tags: [],
      tool_input: { file_path: '/src/output.ts' },
    },
    {
      timestamp: `${date}T10:10:00Z`,
      project: TEST_PROJECT,
      source_node: `project:${TEST_PROJECT}`,
      target_node: 'skill:obsidian-integration',
      connection_type: 'project->skill',
      tool_name: 'Skill',
      stage: 'post',
      tags: [],
      tool_input: { path: '/skills/obsidian.md' },
    },
  ];
  const jsonl = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(logsDir, `${date}.jsonl`), jsonl, 'utf-8');
}

function writeSampleWeightsJson(dataRoot: string, date: string): void {
  const edgeKey1 = `project:${TEST_PROJECT}||tool:Read`;
  const edgeKey2 = `project:${TEST_PROJECT}||skill:obsidian-integration`;
  const data = {
    schema_version: 1,
    updated_at: `${date}T10:00:00Z`,
    connections: {
      [edgeKey1]: {
        source_node: `project:${TEST_PROJECT}`,
        target_node: 'tool:Read',
        connection_type: 'project->tool',
        raw_count: 10,
        weight: 0.5,
        first_seen: `${date}T08:00:00Z`,
        last_seen: `${date}T10:00:00Z`,
      },
      [edgeKey2]: {
        source_node: `project:${TEST_PROJECT}`,
        target_node: 'skill:obsidian-integration',
        connection_type: 'project->skill',
        raw_count: 1,
        weight: 0.1,
        first_seen: `${date}T10:10:00Z`,
        last_seen: `${date}T10:10:00Z`,
      },
    },
  };
  fs.writeFileSync(path.join(dataRoot, 'weights.json'), JSON.stringify(data), 'utf-8');
}

let tmpDataRoot: string;
let tmpVaultPath: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-inttest-data-'));
  tmpVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-inttest-vault-'));
  process.env.ANTHROPIC_API_KEY = 'test-key-for-vitest';
});

afterEach(() => {
  fs.rmSync(tmpDataRoot, { recursive: true, force: true });
  fs.rmSync(tmpVaultPath, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<ObsidianSyncConfig> = {}): ObsidianSyncConfig {
  return {
    vault_path: tmpVaultPath,
    notes_subfolder: 'Projects',
    data_root: tmpDataRoot,
    api_base_url: 'http://localhost:3747',
    prepend_sessions: true,
    claude_model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

describe('runPipeline integration', () => {
  it('full pipeline creates Obsidian file with correct format', async () => {
    writeSampleJSONL(tmpDataRoot, TEST_DATE);
    writeSampleWeightsJson(tmpDataRoot, TEST_DATE);
    setupMockCreate('Worked on the TestProject integration.', 'Always mock external APIs in tests.');

    const result = await runPipeline({
      date: TEST_DATE,
      _config: makeConfig(),
    });

    expect(result.exitCode).toBe(0);
    const expectedFile = path.join(tmpVaultPath, 'Projects', 'testproject.md');
    expect(fs.existsSync(expectedFile)).toBe(true);
    const content = fs.readFileSync(expectedFile, 'utf-8');
    expect(content).toContain(`## Session: ${TEST_DATE}`);
    expect(content).toContain('Worked on the TestProject integration.');
  });

  it('exits 0 with message when no log file found for date', async () => {
    // No JSONL file written — data root is empty
    const result = await runPipeline({
      date: TEST_DATE,
      _config: makeConfig(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/no.*activity|nothing to write/i);
  });

  it('exits 1 with clear message when ANTHROPIC_API_KEY missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await runPipeline({
      date: TEST_DATE,
      _config: makeConfig(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('ANTHROPIC_API_KEY');
  });

  it('dry-run returns rendered markdown without writing file', async () => {
    writeSampleJSONL(tmpDataRoot, TEST_DATE);
    writeSampleWeightsJson(tmpDataRoot, TEST_DATE);
    setupMockCreate('Dry run test content.', 'Keep tests isolated.');

    const result = await runPipeline({
      date: TEST_DATE,
      dryRun: true,
      _config: makeConfig(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.rendered).toBeDefined();
    expect(result.rendered).toContain(`## Session: ${TEST_DATE}`);
    const expectedFile = path.join(tmpVaultPath, 'Projects', 'testproject.md');
    expect(fs.existsSync(expectedFile)).toBe(false);
  });

  it('second run for same date skips write and exits 0 (idempotency)', async () => {
    writeSampleJSONL(tmpDataRoot, TEST_DATE);
    writeSampleWeightsJson(tmpDataRoot, TEST_DATE);
    setupMockCreate('Initial content.', 'First run lessons.');

    const config = makeConfig();
    await runPipeline({ date: TEST_DATE, _config: config });

    const expectedFile = path.join(tmpVaultPath, 'Projects', 'testproject.md');
    const mtimeBefore = fs.statSync(expectedFile).mtimeMs;

    // Second run — no force
    const result2 = await runPipeline({ date: TEST_DATE, _config: config });

    expect(result2.exitCode).toBe(0);
    const mtimeAfter = fs.statSync(expectedFile).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('--force on second run overwrites existing session', async () => {
    writeSampleJSONL(tmpDataRoot, TEST_DATE);
    writeSampleWeightsJson(tmpDataRoot, TEST_DATE);

    const config = makeConfig();

    setupMockCreate('Original content.', 'First lessons.');
    await runPipeline({ date: TEST_DATE, _config: config });

    setupMockCreate('Updated content after force.', 'Second lessons.');
    const result2 = await runPipeline({ date: TEST_DATE, force: true, _config: config });

    expect(result2.exitCode).toBe(0);
    const expectedFile = path.join(tmpVaultPath, 'Projects', 'testproject.md');
    const content = fs.readFileSync(expectedFile, 'utf-8');
    expect(content).toContain('Updated content after force.');
    expect(content).not.toContain('Original content.');
  });
});
