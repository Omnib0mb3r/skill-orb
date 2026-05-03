import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Creates a unique temp directory under os.tmpdir().
 * Returns the absolute path.
 */
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-test-'));
}

/**
 * Removes the given directory and all its contents recursively.
 * Silently ignores errors (e.g., already removed).
 */
export function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
