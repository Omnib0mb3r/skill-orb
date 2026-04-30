import { describe, it, expect } from 'vitest';
import { scrubSecrets, scrubObject } from '../src/capture/secret-scrub.js';

describe('scrubSecrets', () => {
  it('redacts api keys in key=value form', () => {
    const out = scrubSecrets('API_KEY=sk-abcd1234efgh5678');
    expect(out).not.toContain('sk-abcd1234efgh5678');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    const out = scrubSecrets('Authorization: Bearer abcd1234567890wxyz');
    expect(out).not.toContain('abcd1234567890wxyz');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts passwords with quotes', () => {
    const out = scrubSecrets('"password": "supersecret123"');
    expect(out).not.toContain('supersecret123');
    expect(out).toContain('[REDACTED]');
  });

  it('leaves benign content alone', () => {
    const out = scrubSecrets('hello world, no secrets here');
    expect(out).toBe('hello world, no secrets here');
  });

  it('redacts inside JSON objects', () => {
    const out = scrubObject({ token: 'abcdefgh12345678', other: 'value' });
    expect(out).not.toContain('abcdefgh12345678');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('other');
  });

  it('handles null safely', () => {
    expect(scrubObject(null)).toBe('');
    expect(scrubSecrets(null)).toBe('');
    expect(scrubSecrets(undefined)).toBe('');
  });
});
