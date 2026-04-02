import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { buildProjectRegistry } from '../../src/graph/registry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
}

function cleanup(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}

function writeDevNeuralJson(dir: string, content: object): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'devneural.jsonc'), JSON.stringify(content));
}

const validConfig = {
  name: 'My Repo',
  localPath: 'c:/dev/my-repo',
  githubUrl: 'https://github.com/user/my-repo',
  stage: 'alpha',
  tags: ['sandbox'],
  description: 'A test repo',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildProjectRegistry', () => {
  it('scans localReposRoot and returns a Map keyed by project node id', async () => {
    const root = makeTempDir();
    try {
      writeDevNeuralJson(path.join(root, 'my-repo'), validConfig);
      const registry = await buildProjectRegistry(root);
      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
      const meta = registry.get('project:github.com/user/my-repo');
      expect(meta?.stage).toBe('alpha');
      expect(meta?.tags).toEqual(['sandbox']);
      expect(meta?.localPath).toBe('c:/dev/my-repo');
    } finally {
      cleanup(root);
    }
  });

  it('returns an empty Map when localReposRoot does not exist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = await buildProjectRegistry('/no/such/directory/xyz123');
      expect(registry.size).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips directories that have no devneural.json', async () => {
    const root = makeTempDir();
    try {
      // Directory without devneural.json
      fs.mkdirSync(path.join(root, 'no-config-repo'));
      // Directory with devneural.json
      writeDevNeuralJson(path.join(root, 'has-config'), validConfig);
      const registry = await buildProjectRegistry(root);
      expect(registry.size).toBe(1);
      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it('skips directories where devneural.json is malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = makeTempDir();
    try {
      const badDir = path.join(root, 'bad-json-repo');
      fs.mkdirSync(badDir);
      fs.writeFileSync(path.join(badDir, 'devneural.jsonc'), '{ not valid json !!!');
      const registry = await buildProjectRegistry(root);
      expect(registry.size).toBe(0);
    } finally {
      cleanup(root);
      warnSpy.mockRestore();
    }
  });

  it('skips directories where devneural.json is missing required fields', async () => {
    const root = makeTempDir();
    try {
      const incompleteConfig = { name: 'Incomplete', stage: 'alpha' }; // missing githubUrl, localPath, etc.
      writeDevNeuralJson(path.join(root, 'incomplete-repo'), incompleteConfig);
      const registry = await buildProjectRegistry(root);
      expect(registry.size).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it('includes all valid projects even when some subdirectories are invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = makeTempDir();
    try {
      // Valid repo
      writeDevNeuralJson(path.join(root, 'good-repo'), validConfig);
      // Malformed JSON
      const badDir = path.join(root, 'bad-json-repo');
      fs.mkdirSync(badDir);
      fs.writeFileSync(path.join(badDir, 'devneural.jsonc'), 'not-json');
      // Missing fields
      writeDevNeuralJson(path.join(root, 'missing-fields-repo'), { name: 'Only Name' });
      // No devneural.json at all
      fs.mkdirSync(path.join(root, 'no-config-repo'));

      const registry = await buildProjectRegistry(root);
      expect(registry.size).toBe(1);
      expect(registry.has('project:github.com/user/my-repo')).toBe(true);
    } finally {
      cleanup(root);
      warnSpy.mockRestore();
    }
  });

  it('constructs the correct node id from the githubUrl field', async () => {
    const root = makeTempDir();
    try {
      const config = { ...validConfig, githubUrl: 'https://github.com/org/some-project' };
      writeDevNeuralJson(path.join(root, 'some-project'), config);
      const registry = await buildProjectRegistry(root);
      // 'https://github.com/org/some-project' → 'project:github.com/org/some-project'
      expect(registry.has('project:github.com/org/some-project')).toBe(true);
      expect(registry.has('project:https://github.com/org/some-project')).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
