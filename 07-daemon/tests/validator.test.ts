import { describe, it, expect, vi } from 'vitest';
import {
  callValidated,
  validatePass1,
  validatePass2,
} from '../src/llm/validator.js';
import type { LlmProvider } from '../src/llm/types.js';

function fakeProvider(replies: string[]): LlmProvider {
  let i = 0;
  return {
    name: 'fake',
    description: 'test fake',
    isConfigured: () => true,
    configHint: () => '',
    modelIds: () => ({
      ingest: 'fake',
      lint: 'fake',
      reconcile: 'fake',
      selfQuery: 'fake',
    }),
    call: vi.fn(async () => {
      const text = replies[i] ?? '';
      i++;
      return {
        text,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 25,
        modelId: 'fake',
        providerName: 'fake',
      };
    }),
  };
}

describe('validatePass1', () => {
  it('accepts valid response', () => {
    const r = validatePass1({
      affected_pages: ['a', 'b'],
      new_page_warranted: false,
    });
    expect(r.ok).toBe(true);
    expect(r.value?.affected_pages).toEqual(['a', 'b']);
  });

  it('caps affected_pages at 5', () => {
    const r = validatePass1({
      affected_pages: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      new_page_warranted: false,
    });
    expect(r.ok).toBe(true);
    expect(r.value?.affected_pages).toHaveLength(5);
  });

  it('rejects missing fields', () => {
    const r = validatePass1({ affected_pages: ['x'] });
    expect(r.ok).toBe(false);
  });
});

describe('validatePass2', () => {
  it('accepts well-formed update + new page', () => {
    const r = validatePass2({
      page_updates: [
        {
          id: 'existing-page',
          evidence_add: ['session 123: applied here'],
          log_add: '2026-04-30 ingest: added',
        },
      ],
      new_pending_page: {
        id: 'new-thing-trigger-and-insight',
        title: 'New thing → use approach X',
        trigger: 'doing the thing',
        insight: 'use approach X',
        summary: 'Short summary explaining the choice.',
        pattern_body: 'When you do the thing, prefer approach X because...',
        evidence: ['session abc: did the thing'],
      },
    });
    expect(r.ok).toBe(true);
    expect(r.value?.page_updates).toHaveLength(1);
    expect(r.value?.new_pending_page?.id).toBe(
      'new-thing-trigger-and-insight',
    );
  });

  it('rejects new page without → in title', () => {
    const r = validatePass2({
      page_updates: [],
      new_pending_page: {
        id: 'bad-page',
        title: 'No separator here',
        trigger: 't',
        insight: 'i',
        summary: 's',
        pattern_body: 'b',
        evidence: ['e'],
      },
    });
    expect(r.value?.new_pending_page).toBeNull();
  });

  it('rejects new page without evidence', () => {
    const r = validatePass2({
      page_updates: [],
      new_pending_page: {
        id: 'no-evidence',
        title: 'Trigger → insight',
        trigger: 't',
        insight: 'i',
        summary: 's',
        pattern_body: 'b',
        evidence: [],
      },
    });
    expect(r.value?.new_pending_page).toBeNull();
  });

  it('rejects oversize summary on new page', () => {
    const r = validatePass2({
      page_updates: [],
      new_pending_page: {
        id: 'too-long',
        title: 'Trigger → insight',
        trigger: 't',
        insight: 'i',
        summary: 'x'.repeat(700),
        pattern_body: 'b',
        evidence: ['e'],
      },
    });
    expect(r.value?.new_pending_page).toBeNull();
  });
});

describe('callValidated', () => {
  it('succeeds on first attempt with good output', async () => {
    const provider = fakeProvider([
      '```json\n{"affected_pages":["a"],"new_page_warranted":false}\n```',
    ]);
    const r = await callValidated(
      provider,
      {
        role: 'ingest',
        systemBlocks: [{ text: 'sys' }],
        user: 'do thing',
        maxTokens: 500,
      },
      validatePass1,
    );
    expect(r.attempts).toBe(1);
    expect(r.value?.affected_pages).toEqual(['a']);
  });

  it('repairs malformed JSON via retry', async () => {
    const provider = fakeProvider([
      'this is not json at all, sorry',
      '```json\n{"affected_pages":[],"new_page_warranted":true}\n```',
    ]);
    const r = await callValidated(
      provider,
      {
        role: 'ingest',
        systemBlocks: [{ text: 'sys' }],
        user: 'do thing',
        maxTokens: 500,
      },
      validatePass1,
    );
    expect(r.attempts).toBe(2);
    expect(r.value?.new_page_warranted).toBe(true);
  });

  it('fails after exhausting retries', async () => {
    const provider = fakeProvider([
      'still not json',
      'still not json',
      'still not json',
    ]);
    const r = await callValidated(
      provider,
      {
        role: 'ingest',
        systemBlocks: [{ text: 'sys' }],
        user: 'do thing',
        maxTokens: 500,
      },
      validatePass1,
    );
    expect(r.value).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('accumulates token costs across attempts', async () => {
    const provider = fakeProvider([
      'bad',
      '```json\n{"affected_pages":[],"new_page_warranted":false}\n```',
    ]);
    const r = await callValidated(
      provider,
      {
        role: 'ingest',
        systemBlocks: [{ text: 'sys' }],
        user: 'do thing',
        maxTokens: 500,
      },
      validatePass1,
    );
    expect(r.totalInputTokens).toBe(200);
    expect(r.totalOutputTokens).toBe(100);
  });
});
