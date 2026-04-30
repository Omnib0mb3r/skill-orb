/**
 * Initial corpus ingest pipeline.
 *
 * Bounded background pass that runs once on first daemon launch (or
 * on /devneural-reseed). Reads from the source scanners, runs each
 * yielded IngestInput through the standard ingest pipeline, with rate
 * limiting and a hard ceiling on total LLM cost.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Store } from '../store/index.js';
import { runIngest } from '../wiki/ingest.js';
import {
  scanSkills,
  scanProjects,
  scanCommits,
  scanSessions,
  type ScanOptions,
} from './scan.js';
import { isConfigured } from '../llm/anthropic.js';
import { DATA_ROOT } from '../paths.js';

const STATE_FILE = path.posix.join(DATA_ROOT, 'corpus-seed.state.json');

interface SeedState {
  version: 1;
  last_run: string | null;
  runs: number;
  budget_used_input_tokens: number;
  budget_used_output_tokens: number;
}

function loadState(): SeedState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as SeedState;
    }
  } catch {
    /* fall through */
  }
  return {
    version: 1,
    last_run: null,
    runs: 0,
    budget_used_input_tokens: 0,
    budget_used_output_tokens: 0,
  };
}

function saveState(state: SeedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export interface SeedOptions extends ScanOptions {
  maxBudgetInputTokens?: number;
  maxBudgetOutputTokens?: number;
  delayBetweenIngestsMs?: number;
  log?: (msg: string) => void;
}

export interface SeedResult {
  inputs_processed: number;
  pages_created: number;
  pages_updated: number;
  pages_flagged: number;
  cost_input_tokens: number;
  cost_output_tokens: number;
  skipped_reason?: string;
}

export async function runSeed(
  store: Store,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const result: SeedResult = {
    inputs_processed: 0,
    pages_created: 0,
    pages_updated: 0,
    pages_flagged: 0,
    cost_input_tokens: 0,
    cost_output_tokens: 0,
  };

  if (!isConfigured()) {
    result.skipped_reason = 'ANTHROPIC_API_KEY not set';
    log('[corpus-seed] skipped: ANTHROPIC_API_KEY not set');
    return result;
  }

  const state = loadState();
  state.runs++;
  const maxInput = options.maxBudgetInputTokens ?? 500_000;
  const maxOutput = options.maxBudgetOutputTokens ?? 100_000;
  const delay = options.delayBetweenIngestsMs ?? 250;

  log('[corpus-seed] starting initial corpus ingest');
  const generators = [
    { name: 'skills', gen: scanSkills(options) },
    { name: 'projects', gen: scanProjects(options) },
    { name: 'commits', gen: scanCommits(options) },
    { name: 'sessions', gen: scanSessions(options) },
  ];

  for (const { name, gen } of generators) {
    log(`[corpus-seed] scanning ${name}`);
    for await (const input of gen) {
      if (
        result.cost_input_tokens >= maxInput ||
        result.cost_output_tokens >= maxOutput
      ) {
        result.skipped_reason = 'budget exhausted';
        break;
      }
      try {
        const r = await runIngest(store, input, log);
        result.inputs_processed++;
        result.pages_created += r.pages_created.length;
        result.pages_updated += r.pages_updated.length;
        result.pages_flagged += r.pages_flagged.length;
        result.cost_input_tokens += r.cost.input_tokens;
        result.cost_output_tokens += r.cost.output_tokens;
        log(
          `[corpus-seed] ${input.source} created=${r.pages_created.length} updated=${r.pages_updated.length} skip=${r.skipped_reason ?? ''}`,
        );
      } catch (err) {
        log(`[corpus-seed] ${input.source} ERROR ${(err as Error).message}`);
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    if (result.skipped_reason) break;
  }

  state.last_run = new Date().toISOString();
  state.budget_used_input_tokens += result.cost_input_tokens;
  state.budget_used_output_tokens += result.cost_output_tokens;
  saveState(state);

  log(
    `[corpus-seed] done: inputs=${result.inputs_processed} created=${result.pages_created} updated=${result.pages_updated} flagged=${result.pages_flagged} tokens_in=${result.cost_input_tokens} out=${result.cost_output_tokens}`,
  );

  await store.flush();
  return result;
}

export function hasSeeded(): boolean {
  const state = loadState();
  return state.runs > 0 && state.last_run !== null;
}
