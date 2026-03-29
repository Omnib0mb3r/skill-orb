import * as fs from 'fs';
import * as path from 'path';
import type { Config } from '../types';

const DEFAULT_DATA_ROOT = 'C:/dev/data/skill-connections';
const DEFAULT_ALLOWLIST = ['Bash', 'Write', 'Edit', 'Agent'];

/**
 * Loads config from <dataRoot>/config.json and merges with defaults.
 * @param dataRoot - directory to search for config.json; does NOT determine the
 *   returned data_root field (that comes from DEVNEURAL_DATA_ROOT env var, the
 *   config.json data_root field, or the hardcoded default — in that priority order).
 */
export function loadConfig(dataRoot: string): Config {
  const envDataRoot = process.env['DEVNEURAL_DATA_ROOT'];
  const effectiveDataRoot = (envDataRoot && envDataRoot.length > 0)
    ? envDataRoot
    : DEFAULT_DATA_ROOT;

  const defaults: Config = {
    allowlist: DEFAULT_ALLOWLIST,
    data_root: effectiveDataRoot,
  };

  try {
    const raw = fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error('[DevNeural] config parse error:', (err as Error).message);
      return defaults;
    }

    return {
      // element types are not validated here — consumer (hook-runner) is responsible
      allowlist: Array.isArray(parsed['allowlist'])
        ? (parsed['allowlist'] as string[])
        : DEFAULT_ALLOWLIST,
      data_root: (envDataRoot && envDataRoot.length > 0)
        ? envDataRoot
        : (typeof parsed['data_root'] === 'string' ? parsed['data_root'] : DEFAULT_DATA_ROOT),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaults;
    }
    // Unexpected error — return defaults silently
    return defaults;
  }
}
