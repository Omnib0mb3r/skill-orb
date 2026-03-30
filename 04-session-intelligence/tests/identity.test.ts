import { describe, it, expect } from 'vitest';
import { resolveProjectIdentity } from '../src/identity';
import type { ProjectIdentity } from '../src/identity';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../');

describe('identity module re-export', () => {
  it('resolveProjectIdentity is importable from src/identity', async () => {
    expect(typeof resolveProjectIdentity).toBe('function');
  });

  it('returns id and source for a known git repo path', async () => {
    const result: ProjectIdentity = await resolveProjectIdentity(repoRoot);
    expect(result.id).toBeTruthy();
    expect(result.source).not.toBe('cwd');
  });

  it('falls back to normalized directory name when no .git is present', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-id-test-'));
    try {
      const result: ProjectIdentity = await resolveProjectIdentity(tmpDir);
      expect(result.source).toBe('cwd');
      expect(result.id).toBe(tmpDir.replace(/\\/g, '/').toLowerCase());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
