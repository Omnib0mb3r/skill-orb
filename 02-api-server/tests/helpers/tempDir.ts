import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'devneural-test-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
