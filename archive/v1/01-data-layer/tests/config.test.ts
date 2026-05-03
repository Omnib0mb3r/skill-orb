import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir, removeTempDir } from './helpers/tempDir';
import { loadConfig } from '../src/config/index';

let dataRoot: string;

beforeEach(() => {
  dataRoot = createTempDir();
  delete process.env['DEVNEURAL_DATA_ROOT'];
});

afterEach(() => {
  removeTempDir(dataRoot);
  delete process.env['DEVNEURAL_DATA_ROOT'];
});

describe('loadConfig', () => {
  it('returns defaults when config.json does not exist', () => {
    const config = loadConfig(dataRoot);
    expect(config.allowlist).toEqual(['Bash', 'Write', 'Edit', 'Agent']);
    expect(config.data_root).toBe('C:/dev/data/skill-connections');
  });

  it('reads and merges custom allowlist from config.json', () => {
    fs.writeFileSync(
      path.join(dataRoot, 'config.json'),
      JSON.stringify({ allowlist: ['Bash', 'Edit'] })
    );
    const config = loadConfig(dataRoot);
    expect(config.allowlist).toEqual(['Bash', 'Edit']);
    expect(config.data_root).toBe('C:/dev/data/skill-connections');
  });

  it('returns defaults and logs to stderr when config.json contains invalid JSON', () => {
    fs.writeFileSync(path.join(dataRoot, 'config.json'), 'this is not json');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(dataRoot);
    expect(config.allowlist).toEqual(['Bash', 'Write', 'Edit', 'Agent']);
    expect(config.data_root).toBe('C:/dev/data/skill-connections');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[DevNeural] config parse error:'),
      expect.anything()
    );
    spy.mockRestore();
  });

  it('reads data_root field from config.json when present', () => {
    fs.writeFileSync(
      path.join(dataRoot, 'config.json'),
      JSON.stringify({ data_root: '/custom/path' })
    );
    const config = loadConfig(dataRoot);
    expect(config.data_root).toBe('/custom/path');
  });

  it('DEVNEURAL_DATA_ROOT env var overrides the compiled-in default', () => {
    process.env['DEVNEURAL_DATA_ROOT'] = '/env/override';
    const config = loadConfig(dataRoot);
    expect(config.data_root).toBe('/env/override');
  });

  it('DEVNEURAL_DATA_ROOT env var overrides data_root in config.json', () => {
    fs.writeFileSync(
      path.join(dataRoot, 'config.json'),
      JSON.stringify({ data_root: '/file/path' })
    );
    process.env['DEVNEURAL_DATA_ROOT'] = '/env/override';
    const config = loadConfig(dataRoot);
    expect(config.data_root).toBe('/env/override');
  });
});
