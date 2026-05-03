import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { connectionKey, loadWeights, updateWeight, saveWeights } from '../src/weights/index';
import type { WeightsFile } from '../src/weights/types';
import * as properLockfile from 'proper-lockfile';

// vi.mock is hoisted before imports by vitest — proper-lockfile.lock() becomes a vi.fn()
vi.mock('proper-lockfile', () => ({
  lock: vi.fn(),
  unlock: vi.fn(),
  check: vi.fn(),
  lockSync: vi.fn(),
  unlockSync: vi.fn(),
  checkSync: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyWeights = (): WeightsFile => ({
  schema_version: 1,
  updated_at: new Date().toISOString(),
  connections: {},
});

// ── connectionKey ─────────────────────────────────────────────────────────────

describe('connectionKey', () => {
  it('returns "a||b" for source "a" and target "b"', () => {
    expect(connectionKey('a', 'b')).toBe('a||b');
  });
});

// ── loadWeights ───────────────────────────────────────────────────────────────

describe('loadWeights', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
  });

  afterEach(() => {
    if (dataRoot && fs.existsSync(dataRoot)) {
      fs.rmSync(dataRoot, { recursive: true });
    }
  });

  it('returns a valid empty WeightsFile when weights.json does not exist', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = loadWeights(dataRoot);
    expect(result.schema_version).toBe(1);
    expect(result.connections).toEqual({});
    expect(result.updated_at).toBeTruthy();
    expect(new Date(result.updated_at).toISOString()).toBe(result.updated_at);
    // ENOENT must be silent — no log
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('returns the parsed WeightsFile when the file is valid JSON', () => {
    const weights: WeightsFile = {
      schema_version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      connections: {
        'project:foo||tool:Bash': {
          source_node: 'project:foo',
          target_node: 'tool:Bash',
          connection_type: 'project->tool',
          raw_count: 5,
          weight: 0.5,
          first_seen: '2026-01-01T00:00:00.000Z',
          last_seen: '2026-01-01T01:00:00.000Z',
        },
      },
    };
    fs.writeFileSync(path.join(dataRoot, 'weights.json'), JSON.stringify(weights));
    const result = loadWeights(dataRoot);
    expect(result.schema_version).toBe(1);
    expect(result.connections['project:foo||tool:Bash'].raw_count).toBe(5);
    expect(result.connections['project:foo||tool:Bash'].connection_type).toBe('project->tool');
  });

  it('returns an empty graph and logs to stderr when the file contains invalid JSON', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path.join(dataRoot, 'weights.json'), '{not valid json}');

    const result = loadWeights(dataRoot);
    expect(result.schema_version).toBe(1);
    expect(result.connections).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith('[DevNeural] weights parse error:', expect.any(String));

    stderrSpy.mockRestore();
  });

  it('logs to stderr for non-ENOENT read errors (e.g., directory where file expected)', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Create a directory where weights.json should be — triggers EISDIR on readFileSync
    fs.mkdirSync(path.join(dataRoot, 'weights.json'));

    const result = loadWeights(dataRoot);
    expect(result.schema_version).toBe(1);
    expect(result.connections).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith('[DevNeural] weights read error:', expect.any(String));

    stderrSpy.mockRestore();
  });
});

// ── updateWeight ──────────────────────────────────────────────────────────────

describe('updateWeight', () => {
  it('creates a new ConnectionRecord with raw_count=1, weight=0.1, and first_seen set', () => {
    const weights = emptyWeights();
    const now = new Date('2026-03-28T12:00:00.000Z');
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', now);

    const record = weights.connections['project:foo||tool:Bash'];
    expect(record).toBeDefined();
    expect(record.raw_count).toBe(1);
    expect(record.weight).toBe(0.1);
    expect(record.first_seen).toBe('2026-03-28T12:00:00.000Z');
  });

  it('increments raw_count and recalculates weight correctly for an existing connection (raw_count=2 → weight=0.2)', () => {
    const weights = emptyWeights();
    const t1 = new Date('2026-03-28T12:00:00.000Z');
    const t2 = new Date('2026-03-28T12:01:00.000Z');
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t1);
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t2);

    const record = weights.connections['project:foo||tool:Bash'];
    expect(record.raw_count).toBe(2);
    expect(record.weight).toBe(0.2);
  });

  it('caps weight at 10.0 when raw_count >= 100 (raw_count=200 → weight=10.0)', () => {
    const weights = emptyWeights();
    const now = new Date('2026-03-28T12:00:00.000Z');
    weights.connections['project:foo||tool:Bash'] = {
      source_node: 'project:foo',
      target_node: 'tool:Bash',
      connection_type: 'project->tool',
      raw_count: 199,
      weight: 10,
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
    };
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', now);

    const record = weights.connections['project:foo||tool:Bash'];
    expect(record.raw_count).toBe(200);
    expect(record.weight).toBe(10.0);
  });

  it('updates last_seen but does not change first_seen on a subsequent call', () => {
    const weights = emptyWeights();
    const t1 = new Date('2026-03-28T12:00:00.000Z');
    const t2 = new Date('2026-03-28T13:00:00.000Z');
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t1);
    updateWeight(weights, 'project:foo', 'tool:Bash', 'project->tool', t2);

    const record = weights.connections['project:foo||tool:Bash'];
    expect(record.first_seen).toBe('2026-03-28T12:00:00.000Z');
    expect(record.last_seen).toBe('2026-03-28T13:00:00.000Z');
  });

  it('mutates in place — the returned reference is the same object passed in', () => {
    const weights = emptyWeights();
    const result = updateWeight(weights, 'a', 'b', 'project->tool', new Date());
    expect(result).toBe(weights);
  });
});

// ── saveWeights ───────────────────────────────────────────────────────────────

describe('saveWeights', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
  });

  afterEach(() => {
    if (dataRoot && fs.existsSync(dataRoot)) {
      fs.rmSync(dataRoot, { recursive: true });
    }
  });

  it('writes valid JSON to weights.json in dataRoot', async () => {
    const weights = emptyWeights();
    await saveWeights(weights, dataRoot);

    const filePath = path.join(dataRoot, 'weights.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(parsed.schema_version).toBe(1);
    expect(parsed.connections).toBeDefined();
  });

  it('sets updated_at on the written file to a current UTC timestamp (does not mutate caller object)', async () => {
    const weights = emptyWeights();
    const originalUpdatedAt = weights.updated_at;
    const before = new Date();
    await saveWeights(weights, dataRoot);
    const after = new Date();

    // Caller's object is not mutated
    expect(weights.updated_at).toBe(originalUpdatedAt);

    // Written file has a fresh timestamp
    const parsed = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8'));
    const savedAt = new Date(parsed.updated_at);
    expect(savedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(savedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('atomic write — concurrent saves produce valid non-corrupt JSON', async () => {
    const w1 = emptyWeights();
    const w2 = emptyWeights();
    await Promise.all([saveWeights(w1, dataRoot), saveWeights(w2, dataRoot)]);

    const content = fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

// ── Concurrency ───────────────────────────────────────────────────────────────

describe('Concurrency', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weights-test-'));
  });

  afterEach(() => {
    if (dataRoot && fs.existsSync(dataRoot)) {
      fs.rmSync(dataRoot, { recursive: true });
    }
  });

  it('two concurrent write-file-atomic saves produce valid non-corrupt JSON (atomicity guarantee)', async () => {
    // write-file-atomic ensures the file is never partially written.
    // Note: without a lock wrapper (section-06), one update may clobber the other —
    // this test only asserts file integrity, not that both updates are preserved.
    const cycle = async (source: string) => {
      const w = loadWeights(dataRoot);
      updateWeight(w, source, 'tool:Bash', 'project->tool', new Date());
      await saveWeights(w, dataRoot);
    };

    await Promise.all([cycle('project:foo'), cycle('project:bar')]);

    const content = fs.readFileSync(path.join(dataRoot, 'weights.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content);
    expect(parsed.schema_version).toBe(1);
  });

  it('lock fallback — saveWeights succeeds when proper-lockfile.lock() would throw', async () => {
    // When section-06 hook-runner's lockfile.lock() fails, it falls back to calling
    // saveWeights directly. saveWeights is lock-agnostic, so it always succeeds.
    vi.mocked(properLockfile.lock).mockRejectedValueOnce(
      new Error('Simulated lock timeout'),
    );

    const weights = emptyWeights();
    await expect(saveWeights(weights, dataRoot)).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dataRoot, 'weights.json'))).toBe(true);
  });
});
