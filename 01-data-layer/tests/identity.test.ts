import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import * as cp from 'child_process';
import { normalizeGitUrl, normalizePath, resolveProjectIdentity } from '../src/identity/index';

// ── normalizeGitUrl ───────────────────────────────────────────────────────────

describe('normalizeGitUrl', () => {
  it('converts SSH format to host/owner/repo', () => {
    expect(normalizeGitUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
  });

  it('converts SSH format without .git suffix', () => {
    expect(normalizeGitUrl('git@github.com:user/repo')).toBe('github.com/user/repo');
  });

  it('converts HTTPS format to host/owner/repo', () => {
    expect(normalizeGitUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
  });

  it('strips trailing .git only (not mid-path occurrences)', () => {
    expect(normalizeGitUrl('https://github.com/user/my.git.repo.git')).toBe('github.com/user/my.git.repo');
  });

  it('returns input unchanged for unrecognized formats', () => {
    expect(normalizeGitUrl('/bare/path/to/repo')).toBe('/bare/path/to/repo');
    expect(normalizeGitUrl('file:///path/to/repo')).toBe('file:///path/to/repo');
    expect(normalizeGitUrl('git://github.com/user/repo.git')).toBe('git://github.com/user/repo.git');
    expect(normalizeGitUrl('ssh://git@github.com:2222/user/repo.git')).toBe('ssh://git@github.com:2222/user/repo.git');
  });
});

// ── normalizePath ─────────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('converts backslashes to forward slashes and lowercases entire path', () => {
    expect(normalizePath('C:\\dev\\tools\\DevNeural')).toBe('c:/dev/tools/devneural');
  });

  it('lowercases the Windows drive letter and full path', () => {
    expect(normalizePath('C:/Users/Foo')).toBe('c:/users/foo');
  });

  it('passes Unix paths through unchanged (no backslashes, no drive letter)', () => {
    expect(normalizePath('/home/user/project')).toBe('/home/user/project');
  });
});

// ── resolveProjectIdentity ────────────────────────────────────────────────────

describe('resolveProjectIdentity', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.mocked(cp.execFileSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns source git-remote and normalized URL when git remote exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));

    vi.mocked(cp.execFileSync).mockReturnValue('git@github.com:user/myrepo.git\n' as any);

    const result = await resolveProjectIdentity(tmpDir);
    expect(result.source).toBe('git-remote');
    expect(result.id).toBe('github.com/user/myrepo');
  });

  it('returns source git-root and normalized path when .git exists but no remote', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));

    vi.mocked(cp.execFileSync).mockImplementation(() => {
      throw new Error('no remote configured');
    });

    const result = await resolveProjectIdentity(tmpDir);
    expect(result.source).toBe('git-root');
    expect(result.id).toBe(normalizePath(tmpDir));
  });

  it('returns source cwd and normalized path when no .git directory exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-nocwd-'));

    const result = await resolveProjectIdentity(tmpDir);
    expect(result.source).toBe('cwd');
    expect(result.id).toBe(normalizePath(tmpDir));
  });

  it('returns source git-root when git binary is not on PATH (.git dir exists)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));

    vi.mocked(cp.execFileSync).mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    // Note: spec test bullet says 'cwd', but implementation correctly returns
    // 'git-root' since .git exists — background prose at spec line 77 confirms this.
    const result = await resolveProjectIdentity(tmpDir);
    expect(result.source).toBe('git-root');
    expect(result.id).toBe(normalizePath(tmpDir));
  });

  it('returns source cwd when cwd is an empty string', async () => {
    const result = await resolveProjectIdentity('');
    expect(result.source).toBe('cwd');
    expect(result.id).toBe('');
  });

  it('never throws — returns a result on any filesystem or subprocess error', async () => {
    await expect(resolveProjectIdentity('/nonexistent/path/that/has/no/.git')).resolves.toBeDefined();
  });
});
