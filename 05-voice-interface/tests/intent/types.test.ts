import { describe, it, expect } from 'vitest';
import type { IntentResult, VoiceResponse } from '../../src/intent/types';

describe('IntentResult type', () => {
  it('accepts a valid IntentResult with all required fields', () => {
    const result: IntentResult = {
      intent: 'get_top_skills',
      confidence: 0.95,
      entities: {},
      source: 'local',
    };
    expect(result.intent).toBe('get_top_skills');
    expect(typeof result.confidence).toBe('number');
  });

  it('allows entities with optional fields omitted', () => {
    const result: IntentResult = {
      intent: 'unknown',
      confidence: 0,
      entities: {},
      source: 'haiku',
    };
    expect(result.entities.nodeName).toBeUndefined();
  });

  it('accepts VoiceResponse with orbEvent undefined', () => {
    const response: VoiceResponse = { text: 'Hello' };
    expect(response.orbEvent).toBeUndefined();
  });

  it('accepts VoiceResponse with a voice:highlight orbEvent', () => {
    const response: VoiceResponse = {
      text: 'You use these skills most.',
      orbEvent: {
        type: 'voice:highlight',
        payload: { nodeIds: ['skill:typescript', 'skill:node'] },
      },
    };
    expect(response.orbEvent?.type).toBe('voice:highlight');
  });
});
