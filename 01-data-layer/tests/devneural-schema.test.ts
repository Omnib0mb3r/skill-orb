import { describe, it, expect } from 'vitest';
import { validateDevNeuralConfig } from '../src/schema/devneural-config';

const validConfig = {
  name: 'DevNeural',
  localPath: 'c:/dev/tools/DevNeural',
  githubUrl: 'https://github.com/mcollins-f6i/DevNeural',
  stage: 'alpha',
  tags: [],
  description: 'Living neural network of project interconnections',
};

describe('validateDevNeuralConfig', () => {
  it('accepts a valid config with all required fields', () => {
    const result = validateDevNeuralConfig(validConfig);
    expect(result.name).toBe('DevNeural');
    expect(result.stage).toBe('alpha');
    expect(result.tags).toEqual([]);
    expect(result.localPath).toBe('c:/dev/tools/DevNeural');
  });

  it('accepts all valid stage values', () => {
    for (const stage of ['alpha', 'beta', 'deployed', 'archived']) {
      expect(() => validateDevNeuralConfig({ ...validConfig, stage })).not.toThrow();
    }
  });

  it('accepts valid tag values', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, tags: ['revision-needed', 'sandbox'] }),
    ).not.toThrow();
  });

  it('accepts an empty tags array', () => {
    expect(() => validateDevNeuralConfig({ ...validConfig, tags: [] })).not.toThrow();
  });

  it('tolerates extra unknown fields without throwing', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, unknownField: 'ignored', anotherField: 42 }),
    ).not.toThrow();
  });

  it('throws when stage is missing', () => {
    const { stage: _s, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/stage/i);
  });

  it('throws when name is missing', () => {
    const { name: _n, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/name/i);
  });

  it('throws when localPath is missing', () => {
    const { localPath: _l, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/localPath/i);
  });

  it('throws when githubUrl is missing', () => {
    const { githubUrl: _g, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/githubUrl/i);
  });

  it('throws when githubUrl does not start with https://github.com/', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, githubUrl: 'https://gitlab.com/user/repo' }),
    ).toThrow(/githubUrl/i);
  });

  it('throws when githubUrl uses http instead of https', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, githubUrl: 'http://github.com/user/repo' }),
    ).toThrow(/githubUrl/i);
  });

  it('throws when githubUrl is a bare github.com URL without https://', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, githubUrl: 'github.com/user/repo' }),
    ).toThrow(/githubUrl/i);
  });

  it('throws when description is missing', () => {
    const { description: _d, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/description/i);
  });

  it('throws when tags is missing', () => {
    const { tags: _t, ...without } = validConfig;
    expect(() => validateDevNeuralConfig(without)).toThrow(/tags/i);
  });

  it('throws on invalid stage value with a message naming the field', () => {
    expect(() => validateDevNeuralConfig({ ...validConfig, stage: 'production' })).toThrow(
      /stage/i,
    );
  });

  it('throws on another invalid stage value', () => {
    expect(() => validateDevNeuralConfig({ ...validConfig, stage: 'released' })).toThrow(
      /stage/i,
    );
  });

  it('throws when tags contains an unrecognized value', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, tags: ['unknown-tag'] }),
    ).toThrow(/tag/i);
  });

  it('throws when localPath is a relative path (no drive letter or leading slash)', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, localPath: 'relative/path' }),
    ).toThrow(/localPath/i);
  });

  it('throws when localPath starts with ./', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, localPath: './some/path' }),
    ).toThrow(/localPath/i);
  });

  it('accepts Unix absolute localPath starting with /', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, localPath: '/home/user/project' }),
    ).not.toThrow();
  });

  it('accepts Windows absolute localPath with drive letter', () => {
    expect(() =>
      validateDevNeuralConfig({ ...validConfig, localPath: 'C:/Users/user/project' }),
    ).not.toThrow();
  });

  it('throws when name is whitespace-only', () => {
    expect(() => validateDevNeuralConfig({ ...validConfig, name: '   ' })).toThrow(/name/i);
  });

  it('throws when description is whitespace-only', () => {
    expect(() => validateDevNeuralConfig({ ...validConfig, description: '\t' })).toThrow(
      /description/i,
    );
  });

  it('deduplicates duplicate tag values', () => {
    const result = validateDevNeuralConfig({ ...validConfig, tags: ['sandbox', 'sandbox'] });
    expect(result.tags).toEqual(['sandbox']);
  });

  it('throws when raw is not an object', () => {
    expect(() => validateDevNeuralConfig('not an object')).toThrow();
    expect(() => validateDevNeuralConfig(null)).toThrow();
    expect(() => validateDevNeuralConfig(42)).toThrow();
    expect(() => validateDevNeuralConfig([])).toThrow();
    expect(() => validateDevNeuralConfig([{ name: 'x' }])).toThrow();
  });
});
