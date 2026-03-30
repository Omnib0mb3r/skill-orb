import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentResult } from '../../src/intent/types';

// Use vi.hoisted so mockCreate is available inside the vi.mock factory
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
  };
});

// Import AFTER mock is set up
import { parseWithHaiku, UNREACHABLE_RESULT } from '../../src/intent/haiku-parser';

function makeResponse(json: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('parseWithHaiku - SDK call parameters', () => {
  it('calls Anthropic SDK with correct model and max_tokens', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_top_skills', confidence: 0.92, entities: {} })
    );
    await parseWithHaiku('what are my top skills');
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.max_tokens).toBe(256);
  });

  it('passes the query as user message content', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_context', confidence: 0.85, entities: {} })
    );
    await parseWithHaiku('what am I working on');
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'what am I working on' },
    ]);
  });
});

describe('parseWithHaiku - successful responses', () => {
  it('returns IntentResult with source: haiku for get_top_skills', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_top_skills', confidence: 0.92, entities: {} })
    );
    const result = await parseWithHaiku('what are my top skills');
    expect(result.intent).toBe('get_top_skills');
    expect(result.confidence).toBe(0.92);
    expect(result.source).toBe('haiku');
    expect(result.entities).toEqual({});
  });

  it('includes entity fields when Haiku returns them', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        intent: 'get_node',
        confidence: 0.88,
        entities: { nodeName: 'DevNeural' },
      })
    );
    const result = await parseWithHaiku('tell me about DevNeural');
    expect(result.intent).toBe('get_node');
    expect(result.entities.nodeName).toBe('DevNeural');
    expect(result.source).toBe('haiku');
  });

  it('passes through unknown intent with low confidence (model-decided unknown)', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'unknown', confidence: 0, entities: {} })
    );
    const result = await parseWithHaiku("what's the weather");
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('haiku');
    // This is NOT the UNREACHABLE_RESULT — model responded successfully
    expect(result).not.toBe(UNREACHABLE_RESULT);
  });
});

describe('parseWithHaiku - error paths', () => {
  it('returns UNREACHABLE_RESULT on network failure', async () => {
    mockCreate.mockRejectedValue(new Error('fetch failed'));
    const result = await parseWithHaiku('what are my top skills');
    expect(result).toBe(UNREACHABLE_RESULT);
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('haiku');
  });

  it('returns UNREACHABLE_RESULT on HTTP 429 quota error', async () => {
    const err = new Error('rate_limit_error');
    (err as NodeJS.ErrnoException & { status?: number }).status = 429;
    mockCreate.mockRejectedValue(err);
    const result = await parseWithHaiku('what are my top skills');
    expect(result).toBe(UNREACHABLE_RESULT);
  });

  it('returns UNREACHABLE_RESULT on invalid JSON response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json {{' }],
    });
    const result = await parseWithHaiku('what are my top skills');
    expect(result).toBe(UNREACHABLE_RESULT);
  });

  it('returns UNREACHABLE_RESULT when content array is empty', async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const result = await parseWithHaiku('what are my top skills');
    expect(result).toBe(UNREACHABLE_RESULT);
  });
});

describe('parseWithHaiku - Zod schema enforcement', () => {
  it('returns UNREACHABLE_RESULT if confidence is outside 0–1 range', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_top_skills', confidence: 1.5, entities: {} })
    );
    const result = await parseWithHaiku('what are my top skills');
    expect(result).toBe(UNREACHABLE_RESULT);
  });

  it('returns UNREACHABLE_RESULT if intent is not a valid IntentName', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'invalid_intent', confidence: 0.8, entities: {} })
    );
    const result = await parseWithHaiku('something');
    expect(result).toBe(UNREACHABLE_RESULT);
  });

  it('passes stageFilter entity through correctly', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_stages', confidence: 0.91, entities: { stageFilter: 'deployed' } })
    );
    const result = await parseWithHaiku('what projects are deployed');
    expect(result.intent).toBe('get_stages');
    expect(result.entities.stageFilter).toBe('deployed');
    expect(result.source).toBe('haiku');
  });

  it('passes limit entity through correctly', async () => {
    mockCreate.mockResolvedValue(
      makeResponse({ intent: 'get_top_skills', confidence: 0.88, entities: { limit: 5 } })
    );
    const result = await parseWithHaiku('show me top 5 skills');
    expect(result.intent).toBe('get_top_skills');
    expect(result.entities.limit).toBe(5);
    expect(result.source).toBe('haiku');
  });
});
