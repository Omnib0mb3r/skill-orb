import { describe, it, expect } from 'vitest';
import { parseLocalIntent, normalizeConfidence } from '../../src/intent/local-parser';

describe('normalizeConfidence', () => {
  it('returns a value in the 0.0–1.0 range', () => {
    // apparatus BayesClassifier returns real positive probabilities
    const probs = [
      { label: 'get_top_skills', value: 0.0008 },
      { label: 'get_context', value: 0.00009 },
      { label: 'get_connections', value: 0.00003 },
    ];
    const result = normalizeConfidence(probs);
    expect(result).toBeGreaterThanOrEqual(0.0);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('returns ~0.5 when top-2 probabilities are close together', () => {
    const probs = [
      { label: 'get_top_skills', value: 0.5 },
      { label: 'get_context', value: 0.45 },
    ];
    const result = normalizeConfidence(probs);
    expect(result).toBeGreaterThan(0.4);
    expect(result).toBeLessThan(0.6);
  });

  it('returns near 1.0 when top-1 is much larger than top-2', () => {
    const probs = [
      { label: 'get_top_skills', value: 0.9 },
      { label: 'get_context', value: 0.01 },
    ];
    const result = normalizeConfidence(probs);
    expect(result).toBeGreaterThan(0.9);
  });

  it('handles single entry by using default for top2', () => {
    const probs = [{ label: 'get_context', value: 0.5 }];
    const result = normalizeConfidence(probs);
    expect(result).toBeGreaterThanOrEqual(0.0);
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

describe('parseLocalIntent - keyword fast-path', () => {
  it('"what skills am I using most" → get_top_skills, confidence 0.95, source local', () => {
    const result = parseLocalIntent('what skills am I using most');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('get_top_skills');
    expect(result!.confidence).toBe(0.95);
    expect(result!.source).toBe('local');
  });

  it('"what\'s my current context" → get_context, confidence ≥ 0.90, source local', () => {
    const result = parseLocalIntent("what's my current context");
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('get_context');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
    expect(result!.source).toBe('local');
  });

  it('"show me alpha projects" → get_stages, confidence ≥ 0.90, source local', () => {
    const result = parseLocalIntent('show me alpha projects');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('get_stages');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
    expect(result!.source).toBe('local');
  });

  it('ambiguous query matching both get_connections and get_context does NOT return fast-path result', () => {
    // "what's connected to my current project" has keywords from both get_connections and get_context
    const result = parseLocalIntent("what's connected to my current project");
    // Either returns null (low confidence after classifier) or a classifier result — but NOT a 0.95 fast-path hit
    // The fast-path must not fire when two intents match
    if (result !== null) {
      // If classifier fires, it should not have the 0.95 fixed confidence
      expect(result.confidence).not.toBe(0.95);
    }
    // No assertion on null since classifier may still resolve it
  });
});

describe('parseLocalIntent - BayesClassifier fallback', () => {
  it('"list top skills" → get_top_skills, confidence ≥ 0.75', () => {
    const result = parseLocalIntent('list top skills');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('get_top_skills');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('"what tools does DevNeural use" → get_connections or get_node', () => {
    const result = parseLocalIntent('what tools does DevNeural use');
    // May return null if confidence is low, or resolve to connections/node
    if (result !== null) {
      expect(['get_connections', 'get_node']).toContain(result.intent);
    }
  });

  it('"what\'s the weather" → returns null (confidence < 0.75, defers to Haiku)', () => {
    const result = parseLocalIntent("what's the weather");
    expect(result).toBeNull();
  });
});

describe('parseLocalIntent - entity extraction', () => {
  it('returns empty entities object (entity extraction is deferred to pipeline)', () => {
    const result = parseLocalIntent('what are my top skills');
    if (result !== null) {
      expect(result.entities).toEqual({});
    }
  });
});
