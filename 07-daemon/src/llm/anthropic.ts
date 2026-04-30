/**
 * Anthropic SDK wrapper for ingest, lint, reconcile, self-query.
 *
 * Uses prompt caching: the standing instruction set (DEVNEURAL.md) and
 * a wiki-state preamble are cached so repeated ingests reuse them.
 *
 * Models per spec section 11:
 *   - Ingest: claude-haiku-4-5
 *   - Lint:   claude-sonnet-4-6
 *   - Reconcile: claude-sonnet-4-6
 *   - Self-query: claude-haiku-4-5
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import { wikiSchemaFile } from '../paths.js';

const MODEL_INGEST =
  process.env.DEVNEURAL_MODEL_INGEST ?? 'claude-haiku-4-5';
const MODEL_LINT = process.env.DEVNEURAL_MODEL_LINT ?? 'claude-sonnet-4-6';
const MODEL_RECONCILE =
  process.env.DEVNEURAL_MODEL_RECONCILE ?? 'claude-sonnet-4-6';
const MODEL_SELF_QUERY =
  process.env.DEVNEURAL_MODEL_SELF_QUERY ?? 'claude-haiku-4-5';

let client: Anthropic | null = null;
let schemaCache: { content: string; mtime: number } | null = null;

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      'ANTHROPIC_API_KEY not set. Wiki ingest, lint, reconcile, and self-query are disabled.',
    );
  }
}

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicNotConfiguredError();
  client = new Anthropic({
    apiKey,
    defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
  });
  return client;
}

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function loadSchema(): string {
  const file = wikiSchemaFile();
  if (!fs.existsSync(file)) {
    return '# DEVNEURAL.md\n\nFallback schema. See docs/spec/DEVNEURAL.md.\n';
  }
  const stat = fs.statSync(file);
  if (schemaCache && schemaCache.mtime === stat.mtimeMs) {
    return schemaCache.content;
  }
  const content = fs.readFileSync(file, 'utf-8');
  schemaCache = { content, mtime: stat.mtimeMs };
  return content;
}

interface CallOptions {
  model: string;
  systemBlocks: { text: string; cache?: boolean }[];
  user: string;
  maxTokens: number;
  temperature?: number;
}

interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

async function call(opts: CallOptions): Promise<CallResult> {
  const c = getClient();
  const response = await c.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0,
    system: opts.systemBlocks.map((b) => ({
      type: 'text' as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    })),
    messages: [{ role: 'user' as const, content: opts.user }],
  });

  const text =
    response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim() ?? '';

  const usage = response.usage as unknown as {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  return {
    text,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}

export async function callIngestPass(
  preamble: string,
  user: string,
  maxTokens = 2000,
): Promise<CallResult> {
  const schema = loadSchema();
  return call({
    model: MODEL_INGEST,
    systemBlocks: [
      { text: schema, cache: true },
      { text: preamble, cache: true },
    ],
    user,
    maxTokens,
  });
}

export async function callLintPass(
  preamble: string,
  user: string,
  maxTokens = 2000,
): Promise<CallResult> {
  const schema = loadSchema();
  return call({
    model: MODEL_LINT,
    systemBlocks: [
      { text: schema, cache: true },
      { text: preamble, cache: true },
    ],
    user,
    maxTokens,
  });
}

export async function callReconcilePass(
  preamble: string,
  user: string,
  maxTokens = 2000,
): Promise<CallResult> {
  const schema = loadSchema();
  return call({
    model: MODEL_RECONCILE,
    systemBlocks: [
      { text: schema, cache: true },
      { text: preamble, cache: true },
    ],
    user,
    maxTokens,
  });
}

export async function callSelfQuery(
  preamble: string,
  user: string,
  maxTokens = 800,
): Promise<CallResult> {
  const schema = loadSchema();
  return call({
    model: MODEL_SELF_QUERY,
    systemBlocks: [
      { text: schema, cache: true },
      { text: preamble, cache: true },
    ],
    user,
    maxTokens,
  });
}

export function modelIds(): {
  ingest: string;
  lint: string;
  reconcile: string;
  selfQuery: string;
} {
  return {
    ingest: MODEL_INGEST,
    lint: MODEL_LINT,
    reconcile: MODEL_RECONCILE,
    selfQuery: MODEL_SELF_QUERY,
  };
}
