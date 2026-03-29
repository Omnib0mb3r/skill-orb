import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

describe('build smoke tests', () => {
  beforeAll(() => {
    execSync('node esbuild.mjs', { cwd: ROOT, stdio: 'pipe' });
  }, 90_000);

  it('produces dist/extension.js', () => {
    expect(existsSync(join(DIST, 'extension.js'))).toBe(true);
  });

  it('produces dist/webview.js', () => {
    expect(existsSync(join(DIST, 'webview.js'))).toBe(true);
  });

  it('dist/extension.js is CJS format (uses module.exports)', () => {
    const content = readFileSync(join(DIST, 'extension.js'), 'utf-8');
    // esbuild CJS output uses module.exports and/or require()
    expect(content).toMatch(/module\.exports|require\s*\(/);
  });

  it('dist/webview.js is IIFE format', () => {
    const content = readFileSync(join(DIST, 'webview.js'), 'utf-8');
    expect(content).toMatch(/\(\(\s*\)\s*=>|\(function\s*\(\s*\)/);
  });

  it('vscode module is not inlined in dist/extension.js', () => {
    // If vscode were bundled inline the file would be several MB; 500KB cap catches it.
    // Note: ws npm package is legitimately bundled here (~40-50KB).
    const size = statSync(join(DIST, 'extension.js')).size;
    expect(size).toBeLessThan(500_000);
  });

  it('dist/webview.js contains Three.js content', () => {
    const content = readFileSync(join(DIST, 'webview.js'), 'utf-8');
    expect(content).toMatch(/WebGLRenderer|BufferGeometry/i);
  });

  it('source maps present in dev build', () => {
    expect(existsSync(join(DIST, 'extension.js.map'))).toBe(true);
    expect(existsSync(join(DIST, 'webview.js.map'))).toBe(true);
  });

  it('production build is smaller than development build', () => {
    const devTotal =
      statSync(join(DIST, 'extension.js')).size +
      statSync(join(DIST, 'webview.js')).size;

    execSync('node esbuild.mjs --production', { cwd: ROOT, stdio: 'pipe' });
    const prodTotal =
      statSync(join(DIST, 'extension.js')).size +
      statSync(join(DIST, 'webview.js')).size;

    try {
      expect(prodTotal).toBeLessThan(devTotal);
    } finally {
      // Always restore dev build so later tests see source maps
      execSync('node esbuild.mjs', { cwd: ROOT, stdio: 'pipe' });
    }
  }, 180_000);
});

describe('vsix package smoke tests', () => {
  const vsixPath = join(ROOT, 'devneural-0.1.0.vsix');

  beforeAll(() => {
    if (existsSync(vsixPath)) {
      unlinkSync(vsixPath);
    }
    execSync('npx --no vsce package --no-dependencies', { cwd: ROOT, stdio: 'pipe' });
  }, 120_000);

  it('vsce package exits with code 0 and produces .vsix', () => {
    expect(existsSync(vsixPath)).toBe(true);
  });

  it('.vsix contains dist/extension.js', () => {
    const entries = getVsixEntries(vsixPath);
    expect(entries.some(e => e.includes('dist/extension.js'))).toBe(true);
  });

  it('.vsix contains dist/webview.js', () => {
    const entries = getVsixEntries(vsixPath);
    expect(entries.some(e => e.includes('dist/webview.js'))).toBe(true);
  });

  it('.vsix does NOT contain src/, webview/, or node_modules/', () => {
    const entries = getVsixEntries(vsixPath);
    expect(entries.some(e => /extension\/src\//.test(e))).toBe(false);
    expect(entries.some(e => /extension\/webview\//.test(e))).toBe(false);
    expect(entries.some(e => /node_modules/.test(e))).toBe(false);
  });
});

function getVsixEntries(vsixPath: string): string[] {
  try {
    // .vsix files are zip archives; use PowerShell's built-in zip support on Windows
    const escaped = vsixPath.replace(/\\/g, '\\\\');
    const output = execSync(
      `powershell -Command "Add-Type -Assembly 'System.IO.Compression.FileSystem'; [IO.Compression.ZipFile]::OpenRead('${escaped}').Entries | ForEach-Object { $_.FullName }"`,
      { encoding: 'utf-8' },
    );
    return output.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
