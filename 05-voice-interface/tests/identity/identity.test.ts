import { describe, it, expect } from 'vitest';
import { resolveProjectIdentity } from '../../src/identity/index';

describe('identity re-export', () => {
  it('resolveProjectIdentity is a function', () => {
    expect(typeof resolveProjectIdentity).toBe('function');
  });

  it('resolves a project identity for the current directory', async () => {
    const identity = await resolveProjectIdentity(process.cwd());
    expect(typeof identity.id).toBe('string');
    expect(['git-remote', 'git-root', 'cwd']).toContain(identity.source);
  });
});
