import Anthropic from '@anthropic-ai/sdk';
import { z, ZodError } from 'zod';
// SDK v0.24.3 does not have messages.parse() — manual JSON parsing + Zod is the workaround.
// When @anthropic-ai/sdk gains messages.parse() with response_format support, migrate to that.
import type { IntentResult } from './types';

const client = new Anthropic();

// Zod schema for the structured JSON response from Haiku.
// Does NOT include 'source' — that is added by this parser after parsing.
const IntentResultSchema = z.object({
  intent: z.enum([
    'get_context',
    'get_top_skills',
    'get_connections',
    'get_node',
    'get_stages',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  entities: z.object({
    nodeName: z.string().optional(),
    stageFilter: z.string().optional(),
    limit: z.number().optional(),
  }),
});

const SYSTEM_PROMPT = `You are an intent classifier for a developer knowledge graph tool.

Classify the user's query into one of these intents and extract relevant entities:

Intents:
- get_context: user asks about their current project or what they are working on
- get_top_skills: user asks for top or most-used skills
- get_connections: user asks what a named thing (project/skill) is connected to
- get_node: user asks for details about a specific named node
- get_stages: user asks about project stages (alpha, beta, deployed, archived)
- unknown: query does not fit any of the above

Entity fields to extract (leave empty object if none apply):
- nodeName: a project or skill name mentioned in the query
- stageFilter: one of "alpha", "beta", "deployed", "archived" if mentioned
- limit: a numeric limit for top-N queries

Respond ONLY with a JSON object in this exact format (with entities populated when applicable):
{"intent": "get_node", "confidence": 0.9, "entities": {"nodeName": "DevNeural"}}
{"intent": "get_top_skills", "confidence": 0.85, "entities": {"limit": 5}}
{"intent": "get_stages", "confidence": 0.92, "entities": {"stageFilter": "deployed"}}
{"intent": "unknown", "confidence": 0.0, "entities": {}}

If the query does not fit any intent, set intent to "unknown" and confidence to 0.0.`;

/**
 * Sentinel returned when the API call fails (network error, HTTP error, etc.).
 * Section-05 checks `result === UNREACHABLE_RESULT` to detect API failure vs
 * a successful model response of intent: 'unknown'.
 *
 * NOTE for section-05: import and use the real UNREACHABLE_RESULT reference —
 * do NOT substitute a Symbol mock, as object identity checks require the same reference.
 */
export const UNREACHABLE_RESULT: IntentResult = Object.freeze({
  intent: 'unknown' as const,
  confidence: 0,
  entities: {},
  source: 'haiku' as const,
});

/**
 * Parse a voice query using claude-haiku-4-5.
 * Returns an IntentResult with source: 'haiku'.
 * On any API failure, returns UNREACHABLE_RESULT.
 */
export async function parseWithHaiku(query: string): Promise<IntentResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }],
    });

    // Extract text content from the response
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent) {
      console.error('[haiku-parser] Empty content array in response');
      return UNREACHABLE_RESULT;
    }

    // Parse and validate with Zod
    const parsed = JSON.parse((textContent as { type: 'text'; text: string }).text);
    const validated = IntentResultSchema.parse(parsed);

    return {
      ...validated,
      source: 'haiku',
    };
  } catch (err) {
    // Distinguish JSON parse errors from Zod validation errors for better diagnostics
    if (err instanceof ZodError) {
      console.error('[haiku-parser] Schema validation failed:', err.message);
    } else if (err instanceof SyntaxError) {
      console.error('[haiku-parser] JSON parse failed — model returned non-JSON:', err.message);
    } else {
      console.error('[haiku-parser] API error:', err instanceof Error ? err.message : err);
    }
    return UNREACHABLE_RESULT;
  }
}
