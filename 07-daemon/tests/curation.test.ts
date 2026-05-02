import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  shouldInject,
  parseGlossary,
  matchTerms,
  writeGlossary,
  readGlossary,
} from '../src/curation/index.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-cur-'));
});

describe('shouldInject', () => {
  it('skips greetings', () => {
    expect(shouldInject('hi')).toBe(false);
    expect(shouldInject('thanks')).toBe(false);
    expect(shouldInject('ok cool')).toBe(false);
  });

  it('skips short prompts', () => {
    expect(shouldInject('do x')).toBe(false);
    expect(shouldInject('add a button')).toBe(false);
  });

  it('skips syntax-only questions', () => {
    expect(
      shouldInject("what's the typescript syntax for generic constraints"),
    ).toBe(false);
    expect(shouldInject('how do i format a date in javascript')).toBe(false);
  });

  it('accepts substantive prompts', () => {
    expect(
      shouldInject('how should I structure the daemon lifecycle for windows'),
    ).toBe(true);
    expect(
      shouldInject('walk me through the wiki ingest two-pass design'),
    ).toBe(true);
  });
});

describe('glossary parse and match', () => {
  it('round-trips entries', () => {
    process.env.DEVNEURAL_DATA_ROOT = tmp;
    const entries = [
      { term: 'the orb', definition: '03-web-app, Three.js viz' },
      { term: 'the daemon', definition: '07-daemon, the brain' },
    ];
    writeGlossary('proj1', 'TestProject', entries);
    const back = readGlossary('proj1');
    expect(back).toHaveLength(2);
    const terms = back.map((e) => e.term).sort();
    expect(terms).toEqual(['the daemon', 'the orb']);
  });

  it('parseGlossary extracts entries from markdown', () => {
    const md = `---
project_id: proj1
---

- "the orb" = 03-web-app, the Three.js visualization
- "the daemon" = 07-daemon, the brain
- not an entry
`;
    const entries = parseGlossary(md);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.term).toBe('the orb');
    expect(entries[1]?.term).toBe('the daemon');
  });

  it('matchTerms finds prompts mentioning shorthand', () => {
    const entries = [
      { term: 'the orb', definition: 'viz' },
      { term: 'the daemon', definition: 'brain' },
    ];
    const hits = matchTerms(entries, 'tell me how the daemon talks to the orb');
    const names = hits.map((h) => h.term);
    expect(names).toContain('the daemon');
    expect(names).toContain('the orb');
  });

  it('matchTerms prefers longer terms first', () => {
    const entries = [
      { term: 'orb', definition: 'short' },
      { term: 'the orb', definition: 'long' },
    ];
    const hits = matchTerms(entries, 'lets talk about the orb today', 1);
    expect(hits[0]?.term).toBe('the orb');
  });
});
