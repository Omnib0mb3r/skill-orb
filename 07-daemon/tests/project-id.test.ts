import { describe, it, expect } from 'vitest';
import { normalizeRemote, hashId } from '../src/identity/project-id.js';

describe('normalizeRemote', () => {
  it('strips .git suffix and trailing slash', () => {
    expect(normalizeRemote('https://github.com/User/Repo.git/')).toBe(
      'https://github.com/user/repo',
    );
  });

  it('converts SSH github form to https', () => {
    expect(normalizeRemote('git@github.com:User/Repo.git')).toBe(
      'https://github.com/user/repo',
    );
  });

  it('lowercases', () => {
    expect(normalizeRemote('HTTPS://GitHub.com/Foo/Bar')).toBe(
      'https://github.com/foo/bar',
    );
  });
});

describe('hashId', () => {
  it('is 12 hex chars', () => {
    const id = hashId('https://github.com/foo/bar');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input', () => {
    const a = hashId('https://github.com/foo/bar');
    const b = hashId('https://github.com/foo/bar');
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    const a = hashId('https://github.com/foo/bar');
    const b = hashId('https://github.com/foo/baz');
    expect(a).not.toBe(b);
  });
});
