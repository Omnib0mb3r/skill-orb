import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, checkApiKey } from '../src/config.js';

const validConfig = {
  vault_path: '/home/user/vault',
  data_root: '/home/user/devneural/data',
};

function writeTempConfig(content: unknown): string {
  const p = join(tmpdir(), `devneural-test-${Date.now()}-${Math.random()}.json`);
  writeFileSync(p, JSON.stringify(content), 'utf-8');
  return p;
}

describe('loadConfig', () => {
  it('returns valid config when all required fields present', () => {
    const p = writeTempConfig(validConfig);
    try {
      const cfg = loadConfig(p);
      expect(cfg.vault_path).toBe('/home/user/vault');
      expect(cfg.data_root).toBe('/home/user/devneural/data');
    } finally {
      unlinkSync(p);
    }
  });

  it('throws with descriptive message when vault_path is missing', () => {
    const p = writeTempConfig({ data_root: '/home/user/data' });
    try {
      expect(() => loadConfig(p)).toThrow(/vault_path/);
    } finally {
      unlinkSync(p);
    }
  });

  it('throws with descriptive message when data_root is missing', () => {
    const p = writeTempConfig({ vault_path: '/home/user/vault' });
    try {
      expect(() => loadConfig(p)).toThrow(/data_root/);
    } finally {
      unlinkSync(p);
    }
  });

  it('applies defaults for optional fields', () => {
    const p = writeTempConfig(validConfig);
    try {
      const cfg = loadConfig(p);
      expect(cfg.notes_subfolder).toBe('DevNeural/Projects');
      expect(cfg.api_base_url).toBe('http://localhost:3747');
      expect(cfg.prepend_sessions).toBe(true);
      expect(cfg.claude_model).toBe('claude-haiku-4-5-20251001');
    } finally {
      unlinkSync(p);
    }
  });

  it('throws when config file does not exist', () => {
    const missing = join(tmpdir(), 'devneural-nonexistent-config-99999.json');
    expect(() => loadConfig(missing)).toThrow(/Config file not found/);
  });

  it('reads path from DEVNEURAL_OBSIDIAN_CONFIG env var when no arg provided', () => {
    const p = writeTempConfig(validConfig);
    const prev = process.env.DEVNEURAL_OBSIDIAN_CONFIG;
    process.env.DEVNEURAL_OBSIDIAN_CONFIG = p;
    try {
      const cfg = loadConfig();
      expect(cfg.vault_path).toBe('/home/user/vault');
    } finally {
      if (prev === undefined) {
        delete process.env.DEVNEURAL_OBSIDIAN_CONFIG;
      } else {
        process.env.DEVNEURAL_OBSIDIAN_CONFIG = prev;
      }
      unlinkSync(p);
    }
  });

  it('throws when config JSON is malformed', () => {
    const p = join(tmpdir(), `devneural-bad-${Date.now()}.json`);
    writeFileSync(p, '{ not valid json }', 'utf-8');
    try {
      expect(() => loadConfig(p)).toThrow(/not valid JSON/);
    } finally {
      unlinkSync(p);
    }
  });
});

describe('checkApiKey', () => {
  let prevKey: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn> | null = null;
  let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    prevKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = prevKey;
    }
    exitSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it('config check throws with clear message when ANTHROPIC_API_KEY env var is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(vi.fn() as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    checkApiKey();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
  });
});
