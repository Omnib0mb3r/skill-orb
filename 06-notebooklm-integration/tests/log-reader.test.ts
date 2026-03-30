import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSessionLog } from '../src/session/log-reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'sample-session.jsonl');
const TEST_DATE = '2026-03-30';

function makeTempRoot(): string {
  const root = join(tmpdir(), `devneural-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, 'logs'), { recursive: true });
  return root;
}

function writeFixture(root: string, date: string): void {
  writeFileSync(join(root, 'logs', `${date}.jsonl`), readFileSync(fixturePath, 'utf-8'), 'utf-8');
}

describe('readSessionLog', () => {
  it('returns null when JSONL file does not exist for the given date', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root = makeTempRoot();
      const result = await readSessionLog('1970-01-01', root);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('parses all log entries from the multi-line fixture', async () => {
    const root = makeTempRoot();
    writeFixture(root, TEST_DATE);
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    expect(result!.entries.length).toBeGreaterThanOrEqual(7);
    expect(result!.entries[0].timestamp).toBeTruthy();
  });

  it('identifies primary_project as the most-frequently-appearing project ID', async () => {
    const root = makeTempRoot();
    writeFixture(root, TEST_DATE);
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    // Fixture has 5 DevNeural entries vs 1 skill-connections entry
    expect(result!.primary_project).toBe('github.com/Omnib0mb3r/DevNeural');
  });

  it('calculates session_start and session_end from first and last timestamps', async () => {
    const root = makeTempRoot();
    writeFixture(root, TEST_DATE);
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    expect(result!.session_start).toBe('2026-03-30T10:00:00Z');
    expect(result!.session_end).toBe('2026-03-30T10:45:00Z');
  });

  it('includes all four connection_type values in connection_events', async () => {
    const root = makeTempRoot();
    writeFixture(root, TEST_DATE);
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    const types = result!.connection_events.map(e => e.connection_type);
    expect(types).toContain('project->tool');
    expect(types).toContain('project->skill');
    expect(types).toContain('project->project');
    expect(types).toContain('tool->skill');
  });

  it('returns all_projects as a deduplicated list of all project IDs seen', async () => {
    const root = makeTempRoot();
    writeFixture(root, TEST_DATE);
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    expect(result!.all_projects).toContain('github.com/Omnib0mb3r/DevNeural');
    expect(result!.all_projects).toContain('github.com/Omnib0mb3r/skill-connections');
    const unique = [...new Set(result!.all_projects)];
    expect(result!.all_projects.length).toBe(unique.length);
  });

  it('handles a single-line JSONL (one log entry)', async () => {
    const singleLine = JSON.stringify({
      timestamp: '2026-03-30T08:00:00Z',
      project: 'github.com/Omnib0mb3r/DevNeural',
      source_node: 'project:github.com/Omnib0mb3r/DevNeural',
      target_node: 'tool:Read',
      connection_type: 'project->tool',
      tool_name: 'Read',
      stage: 'post',
      tags: [],
      tool_input: {},
    });
    const root = makeTempRoot();
    writeFileSync(join(root, 'logs', `${TEST_DATE}.jsonl`), singleLine + '\n', 'utf-8');
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    expect(result!.entries.length).toBe(1);
    expect(result!.primary_project).toBe('github.com/Omnib0mb3r/DevNeural');
    expect(result!.session_start).toBe('2026-03-30T08:00:00Z');
    expect(result!.session_end).toBe('2026-03-30T08:00:00Z');
  });

  it('handles an empty JSONL file (returns SessionData with empty arrays, not null)', async () => {
    const root = makeTempRoot();
    writeFileSync(join(root, 'logs', `${TEST_DATE}.jsonl`), '', 'utf-8');
    const result = await readSessionLog(TEST_DATE, root);
    expect(result).not.toBeNull();
    expect(result!.entries).toEqual([]);
    expect(result!.connection_events).toEqual([]);
    expect(result!.all_projects).toEqual([]);
    // Empty file has no project entries; primary_project is empty string sentinel
    expect(result!.primary_project).toBe('');
  });
});
