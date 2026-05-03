diff --git a/01-data-layer/src/identity/index.ts b/01-data-layer/src/identity/index.ts
new file mode 100644
index 0000000..2e4d16e
--- /dev/null
+++ b/01-data-layer/src/identity/index.ts
@@ -0,0 +1,85 @@
+import * as cp from 'child_process';
+import * as path from 'path';
+import * as fs from 'fs';
+
+import type { ProjectIdentity } from '../types';
+
+export type { ProjectIdentity };
+
+/** Walk up the directory tree from `from`, looking for a directory entry named `name`.
+ *  Returns the parent directory containing `name`, or null if not found. */
+function findUp(name: string, from: string): string | null {
+  if (!from || !from.trim()) return null;
+  try {
+    let current = from;
+    while (true) {
+      const target = path.join(current, name);
+      if (fs.existsSync(target)) {
+        return current;
+      }
+      const parent = path.dirname(current);
+      if (parent === current) {
+        return null;
+      }
+      current = parent;
+    }
+  } catch {
+    return null;
+  }
+}
+
+/** Normalize SSH or HTTPS git remote URLs to host/owner/repo format.
+ *  Returns input unchanged for unrecognized formats. */
+export function normalizeGitUrl(url: string): string {
+  // SSH: git@github.com:user/repo.git → github.com/user/repo
+  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
+  if (sshMatch) {
+    return `${sshMatch[1]}/${sshMatch[2]}`;
+  }
+
+  // HTTPS: https://github.com/user/repo.git → github.com/user/repo
+  const httpsMatch = url.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
+  if (httpsMatch) {
+    return `${httpsMatch[1]}/${httpsMatch[2]}`;
+  }
+
+  // Unrecognized format — return unchanged
+  return url;
+}
+
+/** Convert backslashes to forward slashes; lowercase the drive letter. */
+export function normalizePath(p: string): string {
+  let normalized = p.replace(/\\/g, '/');
+  normalized = normalized.replace(/^[A-Z]:/, match => match.toLowerCase());
+  return normalized;
+}
+
+/** Resolve the canonical project identity from a working directory path.
+ *  Priority: git-remote > git-root > cwd. Never throws. */
+export async function resolveProjectIdentity(cwd: string): Promise<ProjectIdentity> {
+  try {
+    if (!cwd) {
+      return { id: '', source: 'cwd' };
+    }
+
+    const gitRoot = findUp('.git', cwd);
+
+    if (gitRoot) {
+      try {
+        const output = cp.execSync(`git -C "${gitRoot}" remote get-url origin`, {
+          encoding: 'utf8',
+          stdio: ['pipe', 'pipe', 'pipe'],
+        });
+        const remoteUrl = (output as string).trim();
+        const id = normalizeGitUrl(remoteUrl);
+        return { id, source: 'git-remote' };
+      } catch {
+        return { id: normalizePath(gitRoot), source: 'git-root' };
+      }
+    }
+
+    return { id: normalizePath(cwd), source: 'cwd' };
+  } catch {
+    return { id: normalizePath(cwd), source: 'cwd' };
+  }
+}
diff --git a/01-data-layer/tests/identity.test.ts b/01-data-layer/tests/identity.test.ts
new file mode 100644
index 0000000..2963dd1
--- /dev/null
+++ b/01-data-layer/tests/identity.test.ts
@@ -0,0 +1,122 @@
+import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
+import * as os from 'os';
+import * as path from 'path';
+import * as fs from 'fs';
+
+vi.mock('child_process', () => ({
+  execSync: vi.fn(),
+}));
+
+import * as cp from 'child_process';
+import { normalizeGitUrl, normalizePath, resolveProjectIdentity } from '../src/identity/index';
+
+// ── normalizeGitUrl ───────────────────────────────────────────────────────────
+
+describe('normalizeGitUrl', () => {
+  it('converts SSH format to host/owner/repo', () => {
+    expect(normalizeGitUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
+  });
+
+  it('converts HTTPS format to host/owner/repo', () => {
+    expect(normalizeGitUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
+  });
+
+  it('strips trailing .git only (not mid-path occurrences)', () => {
+    expect(normalizeGitUrl('https://github.com/user/my.git.repo.git')).toBe('github.com/user/my.git.repo');
+  });
+
+  it('returns input unchanged for unrecognized formats', () => {
+    expect(normalizeGitUrl('/bare/path/to/repo')).toBe('/bare/path/to/repo');
+    expect(normalizeGitUrl('file:///path/to/repo')).toBe('file:///path/to/repo');
+    expect(normalizeGitUrl('git://github.com/user/repo.git')).toBe('git://github.com/user/repo.git');
+    expect(normalizeGitUrl('ssh://git@github.com:2222/user/repo.git')).toBe('ssh://git@github.com:2222/user/repo.git');
+  });
+});
+
+// ── normalizePath ─────────────────────────────────────────────────────────────
+
+describe('normalizePath', () => {
+  it('converts backslashes to forward slashes and lowercases drive letter', () => {
+    expect(normalizePath('C:\\dev\\tools\\DevNeural')).toBe('c:/dev/tools/DevNeural');
+  });
+
+  it('lowercases the Windows drive letter', () => {
+    expect(normalizePath('C:/Users/foo')).toBe('c:/Users/foo');
+  });
+});
+
+// ── resolveProjectIdentity ────────────────────────────────────────────────────
+
+describe('resolveProjectIdentity', () => {
+  let tmpDir: string;
+
+  beforeEach(() => {
+    vi.mocked(cp.execSync).mockReset();
+  });
+
+  afterEach(() => {
+    vi.restoreAllMocks();
+    if (tmpDir && fs.existsSync(tmpDir)) {
+      fs.rmSync(tmpDir, { recursive: true });
+    }
+  });
+
+  it('returns source git-remote and normalized URL when git remote exists', async () => {
+    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
+    fs.mkdirSync(path.join(tmpDir, '.git'));
+
+    vi.mocked(cp.execSync).mockReturnValue('git@github.com:user/myrepo.git\n' as any);
+
+    const result = await resolveProjectIdentity(tmpDir);
+    expect(result.source).toBe('git-remote');
+    expect(result.id).toBe('github.com/user/myrepo');
+  });
+
+  it('returns source git-root and normalized path when .git exists but no remote', async () => {
+    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
+    fs.mkdirSync(path.join(tmpDir, '.git'));
+
+    vi.mocked(cp.execSync).mockImplementation(() => {
+      throw new Error('no remote configured');
+    });
+
+    const result = await resolveProjectIdentity(tmpDir);
+    expect(result.source).toBe('git-root');
+    expect(result.id).toBe(normalizePath(tmpDir));
+  });
+
+  it('returns source cwd and normalized path when no .git directory exists', async () => {
+    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-nocwd-'));
+    // No .git in tmpDir or its ancestors (standard temp dir is safe)
+
+    const result = await resolveProjectIdentity(tmpDir);
+    expect(result.source).toBe('cwd');
+    expect(result.id).toBe(normalizePath(tmpDir));
+  });
+
+  it('returns source git-root when git binary is not on PATH (.git dir exists)', async () => {
+    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
+    fs.mkdirSync(path.join(tmpDir, '.git'));
+
+    vi.mocked(cp.execSync).mockImplementation(() => {
+      const err = new Error('ENOENT') as NodeJS.ErrnoException;
+      err.code = 'ENOENT';
+      throw err;
+    });
+
+    const result = await resolveProjectIdentity(tmpDir);
+    // .git exists so falls to git-root, not cwd
+    expect(result.source).toBe('git-root');
+    expect(result.id).toBe(normalizePath(tmpDir));
+  });
+
+  it('returns source cwd when cwd is an empty string', async () => {
+    const result = await resolveProjectIdentity('');
+    expect(result.source).toBe('cwd');
+    expect(result.id).toBe('');
+  });
+
+  it('never throws — returns a result on any filesystem or subprocess error', async () => {
+    await expect(resolveProjectIdentity('/nonexistent/path/that/has/no/.git')).resolves.toBeDefined();
+  });
+});
