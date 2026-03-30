import { parseLocalIntent } from './local-parser';
import { parseWithHaiku, UNREACHABLE_RESULT } from './haiku-parser';
import type { IntentResult } from './types';

export interface ParsedIntent extends IntentResult {
  /** true when confidence is 0.60–0.84 — formatter prefixes with "I think you're asking about..." */
  hedging: boolean;
  /** true when confidence < 0.60 — intent overridden to 'unknown', no API call downstream */
  clarification: boolean;
  /** true when Haiku API call failed entirely (network/quota error) */
  unreachable: boolean;
}

/**
 * Unified intent parsing pipeline: local parser → Haiku fallback → confidence gating.
 * Always returns a ParsedIntent — never throws.
 */
export async function parseIntent(query: string): Promise<ParsedIntent> {
  let best: IntentResult | null = null;
  let unreachable = false;

  // Step 1: try local parser (await for future async compatibility per plan)
  const localResult = await parseLocalIntent(query);

  if (localResult !== null && localResult.confidence >= 0.75) {
    // Fast-path: local parser is confident enough, skip Haiku
    best = localResult;
  } else {
    // Step 2: local not confident enough — call Haiku
    let haikuResult: IntentResult;
    try {
      haikuResult = await parseWithHaiku(query);
    } catch {
      // parseWithHaiku should never throw per its contract, but guard anyway
      unreachable = true;
      best = localResult;
      haikuResult = UNREACHABLE_RESULT;
    }

    if (haikuResult === UNREACHABLE_RESULT) {
      // Haiku API is down — fall back to whatever local produced (may be null)
      unreachable = true;
      best = localResult; // may be null if local also returned null
    } else {
      // Haiku responded — use as authoritative result
      best = haikuResult;
    }
  }

  // Step 3: build a base result (handles null best).
  // When both parsers fail, use 'haiku' as source (last attempted) and flag with unreachable.
  const base: IntentResult = best ?? {
    intent: 'unknown',
    confidence: 0,
    entities: {},
    source: 'haiku',
  };

  // Step 4: apply confidence gates
  const confidence = base.confidence;

  if (confidence < 0.60) {
    return {
      ...base,
      intent: 'unknown',
      hedging: false,
      clarification: true,
      unreachable,
    };
  }

  if (confidence < 0.85) {
    return {
      ...base,
      hedging: true,
      clarification: false,
      unreachable,
    };
  }

  return {
    ...base,
    hedging: false,
    clarification: false,
    unreachable,
  };
}
