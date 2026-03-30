import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentResult } from '../../src/intent/types';

vi.mock('../../src/intent/local-parser', () => ({
  parseLocalIntent: vi.fn(),
}));

// Use vi.importActual so UNREACHABLE_RESULT is the real frozen object —
// this ensures the identity check in parser.ts is tested against the real sentinel.
vi.mock('../../src/intent/haiku-parser', async () => {
  const actual = await vi.importActual<typeof import('../../src/intent/haiku-parser')>(
    '../../src/intent/haiku-parser'
  );
  return {
    ...actual,
    parseWithHaiku: vi.fn(),
  };
});

import { parseIntent } from '../../src/intent/parser';
import { parseLocalIntent } from '../../src/intent/local-parser';
import { parseWithHaiku, UNREACHABLE_RESULT } from '../../src/intent/haiku-parser';

const mockParseLocal = vi.mocked(parseLocalIntent);
const mockParseHaiku = vi.mocked(parseWithHaiku);

function localResult(overrides?: Partial<IntentResult>): IntentResult {
  return {
    intent: 'get_top_skills',
    confidence: 0.95,
    entities: {},
    source: 'local',
    ...overrides,
  };
}

function haikuResult(overrides?: Partial<IntentResult>): IntentResult {
  return {
    intent: 'get_context',
    confidence: 0.90,
    entities: {},
    source: 'haiku',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseIntent - local parser fast-path', () => {
  it('local confidence >= 0.75 → Haiku NOT called, local result returned', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.95, intent: 'get_top_skills' }));

    const result = await parseIntent('what are my top skills');

    expect(mockParseHaiku).not.toHaveBeenCalled();
    expect(result.intent).toBe('get_top_skills');
    expect(result.hedging).toBe(false);
    expect(result.clarification).toBe(false);
    expect(result.unreachable).toBe(false);
  });

  it('local confidence < 0.75 → Haiku IS called with original query', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.60 }));
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.85 }));

    await parseIntent('what am I working on');

    expect(mockParseHaiku).toHaveBeenCalledOnce();
    expect(mockParseHaiku).toHaveBeenCalledWith('what am I working on');
  });

  it('local returns null → Haiku called', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.80 }));

    await parseIntent('something vague');

    expect(mockParseHaiku).toHaveBeenCalledOnce();
  });

  it('boundary: local confidence exactly 0.75 → Haiku NOT called', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.75 }));

    await parseIntent('query');

    expect(mockParseHaiku).not.toHaveBeenCalled();
  });

  it('boundary: local confidence exactly 0.74 → Haiku called', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.74 }));
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.85 }));

    await parseIntent('query');

    expect(mockParseHaiku).toHaveBeenCalledOnce();
  });
});

describe('parseIntent - confidence gates', () => {
  it('final confidence < 0.60 → clarification=true, intent overridden to unknown', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.40, intent: 'get_node' }));
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.50, intent: 'get_node' }));

    const result = await parseIntent('huh');

    expect(result.intent).toBe('unknown');
    expect(result.clarification).toBe(true);
    expect(result.hedging).toBe(false);
    expect(result.unreachable).toBe(false);
  });

  it('final confidence 0.60–0.84 → hedging=true, clarification=false', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.72, intent: 'get_stages' }));

    const result = await parseIntent('projects in testing');

    expect(result.intent).toBe('get_stages');
    expect(result.hedging).toBe(true);
    expect(result.clarification).toBe(false);
    expect(result.unreachable).toBe(false);
  });

  it('final confidence >= 0.85 → no hedging, no clarification', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.90, intent: 'get_context' }));

    const result = await parseIntent('what am I working on');

    expect(result.intent).toBe('get_context');
    expect(result.hedging).toBe(false);
    expect(result.clarification).toBe(false);
    expect(result.unreachable).toBe(false);
  });

  it('boundary: confidence exactly 0.60 → hedging=true', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.60 }));

    const result = await parseIntent('query');

    expect(result.hedging).toBe(true);
    expect(result.clarification).toBe(false);
  });

  it('boundary: confidence exactly 0.85 → no hedging', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.85 }));

    const result = await parseIntent('query');

    expect(result.hedging).toBe(false);
    expect(result.clarification).toBe(false);
  });
});

describe('parseIntent - Haiku unreachable', () => {
  it('Haiku unreachable → unreachable=true, falls back to local result', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.65, intent: 'get_connections', source: 'local' }));
    mockParseHaiku.mockResolvedValue(UNREACHABLE_RESULT);

    const result = await parseIntent('what connects to DevNeural');

    expect(result.unreachable).toBe(true);
    expect(result.intent).toBe('get_connections');
    expect(result.source).toBe('local');
  });

  it('Haiku unreachable AND local too low → unknown + clarification + unreachable', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.30, intent: 'get_node' }));
    mockParseHaiku.mockResolvedValue(UNREACHABLE_RESULT);

    const result = await parseIntent('something');

    expect(result.unreachable).toBe(true);
    expect(result.clarification).toBe(true);
    expect(result.intent).toBe('unknown');
  });

  it('Haiku unreachable AND local null → unknown + clarification + unreachable', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(UNREACHABLE_RESULT);

    const result = await parseIntent('something');

    expect(result.unreachable).toBe(true);
    expect(result.clarification).toBe(true);
    expect(result.intent).toBe('unknown');
  });

  it('Haiku throws (unexpected) → unreachable=true, falls back gracefully', async () => {
    mockParseLocal.mockReturnValue(localResult({ confidence: 0.65, intent: 'get_context' }));
    mockParseHaiku.mockRejectedValue(new Error('network timeout'));

    const result = await parseIntent('what am I working on');

    expect(result.unreachable).toBe(true);
    // Should not throw
  });
});

describe('parseIntent - entity passthrough', () => {
  it('passes entities from local result through', async () => {
    mockParseLocal.mockReturnValue(
      localResult({ confidence: 0.90, intent: 'get_node', entities: { nodeName: 'DevNeural' } })
    );

    const result = await parseIntent('tell me about DevNeural');

    expect(result.entities.nodeName).toBe('DevNeural');
  });

  it('passes entities from haiku result through', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(
      haikuResult({ confidence: 0.88, entities: { stageFilter: 'deployed' } })
    );

    const result = await parseIntent('what is deployed');

    expect(result.entities.stageFilter).toBe('deployed');
  });
});

describe('parseIntent - edge cases', () => {
  it('empty query string is handled gracefully', async () => {
    mockParseLocal.mockReturnValue(null);
    mockParseHaiku.mockResolvedValue(haikuResult({ confidence: 0.10, intent: 'unknown' }));

    const result = await parseIntent('');

    expect(result.intent).toBe('unknown');
    expect(result.clarification).toBe(true);
  });
});
