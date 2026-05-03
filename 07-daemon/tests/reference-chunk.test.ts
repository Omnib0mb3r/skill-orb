import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/reference/chunk.js';

describe('chunkText', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps small text as a single chunk', () => {
    const chunks = chunkText('A short paragraph about something.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('short paragraph');
  });

  it('splits multi-paragraph long text into multiple chunks', () => {
    const para = 'a'.repeat(500);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(900);
    }
  });

  it('splits a giant single paragraph by sentence', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} with some content here.`);
    const text = sentences.join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(900);
    }
  });

  it('assigns sequential indices', () => {
    const text = Array.from({ length: 20 }, () => 'a'.repeat(200)).join('\n\n');
    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.index).toBe(i);
    }
  });

  it('records meaningful start/end offsets', () => {
    const text = `First paragraph here.\n\nSecond paragraph follows.`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.start_offset).toBeGreaterThanOrEqual(0);
      expect(c.end_offset).toBeGreaterThan(c.start_offset);
    }
  });
});
