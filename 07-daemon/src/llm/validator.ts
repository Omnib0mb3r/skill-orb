/**
 * Output validation, repair retries, and self-critique.
 *
 * Local models (Qwen 7-8B) produce malformed JSON or out-of-spec
 * pages a non-trivial fraction of calls. To keep the wiki clean we
 * gate every LLM ingest output behind:
 *
 *   1. JSON parse with `format: "json"` enforcement at provider level
 *   2. Schema check against the expected shape (caller-supplied)
 *   3. Repair retry (up to N times): hand the bad output back to the
 *      same model with the validation errors and ask for a fix
 *   4. Optional self-critique pass: ask the same model "does this
 *      output follow DEVNEURAL.md? If not, fix."
 *
 * If all retries fail, the daemon logs and skips. Bad pages never
 * land on disk. Empty output is a valid result.
 */
import type { LlmProvider, LlmRole, CallResult } from './types.js';

const MAX_REPAIR_RETRIES = Number(
  process.env.DEVNEURAL_LLM_REPAIR_RETRIES ?? 2,
);

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

export type Validator<T> = (value: unknown) => ValidationResult<T>;

export interface ValidatedCallOptions {
  role: LlmRole;
  systemBlocks: { text: string; cache?: boolean }[];
  user: string;
  maxTokens: number;
  temperature?: number;
  /** Forwarded to provider.call — aborts in-flight HTTP request. */
  signal?: AbortSignal;
}

export interface ValidatedCallResult<T> {
  value: T | null;
  attempts: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  finalText: string;
  errors: string[];
}

/**
 * Run a validated LLM call: parse and check output against `validator`.
 * Repair-retries up to MAX_REPAIR_RETRIES times.
 */
export async function callValidated<T>(
  provider: LlmProvider,
  opts: ValidatedCallOptions,
  validator: Validator<T>,
  log: (msg: string) => void = () => undefined,
): Promise<ValidatedCallResult<T>> {
  const result: ValidatedCallResult<T> = {
    value: null,
    attempts: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheRead: 0,
    finalText: '',
    errors: [],
  };

  let response: CallResult | null = null;
  let priorErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt++) {
    result.attempts = attempt + 1;
    const userText =
      attempt === 0
        ? opts.user
        : repairPrompt(opts.user, response?.text ?? '', priorErrors);

    try {
      response = await provider.call(opts.role, {
        systemBlocks: opts.systemBlocks,
        user: userText,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      const e = err as Error;
      // AbortError: caller cancelled. Surface as a distinct error so the
      // caller can stop retrying instead of falling into repair loops.
      if (e.name === 'AbortError' || opts.signal?.aborted) {
        result.errors.push('aborted');
        return result;
      }
      result.errors.push(`call failed: ${e.message}`);
      return result;
    }

    result.totalInputTokens += response.inputTokens;
    result.totalOutputTokens += response.outputTokens;
    result.totalCacheRead += response.cacheReadTokens;
    result.finalText = response.text;

    const parsed = tryParseJson(response.text);
    if (!parsed.ok) {
      priorErrors = [`malformed JSON: ${parsed.error}`];
      log(
        `[validator] attempt ${attempt + 1}: parse failed: ${parsed.error?.slice(0, 200)}`,
      );
      continue;
    }

    const validation = validator(parsed.value);
    if (validation.ok && validation.value !== undefined) {
      result.value = validation.value;
      return result;
    }
    priorErrors = validation.errors;
    log(
      `[validator] attempt ${attempt + 1}: schema errors: ${validation.errors.join('; ').slice(0, 200)}`,
    );
  }

  result.errors = priorErrors;
  return result;
}

function repairPrompt(
  original: string,
  badOutput: string,
  errors: string[],
): string {
  return `${original}

----- previous attempt -----
${badOutput.slice(0, 4000)}
----- end previous attempt -----

The previous attempt failed validation:
${errors.map((e) => `- ${e}`).join('\n')}

Produce ONLY a corrected JSON object inside a single triple-backtick
\`\`\`json block. Do not include any prose before or after the block.
`;
}

interface ParseOk {
  ok: true;
  value: unknown;
}
interface ParseErr {
  ok: false;
  error: string;
}

function tryParseJson(text: string): ParseOk | ParseErr {
  // Allow either fenced ```json blocks or raw JSON.
  const fence = text.match(/```(?:json)?\s*\n([\s\S]+?)\n```/i);
  const body = (fence?.[1] ?? text).trim();
  if (!body) return { ok: false, error: 'empty response' };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------- Common validators used by ingest pipeline ----------

export interface Pass1Schema {
  affected_pages: string[];
  new_page_warranted: boolean;
  new_page_reason?: string;
}

export const validatePass1: Validator<Pass1Schema> = (raw) => {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['response not an object'] };
  }
  const obj = raw as Record<string, unknown>;
  const affected = obj.affected_pages;
  if (!Array.isArray(affected)) errors.push('affected_pages must be array');
  else if (affected.some((x) => typeof x !== 'string'))
    errors.push('affected_pages must contain strings');
  if (typeof obj.new_page_warranted !== 'boolean')
    errors.push('new_page_warranted must be boolean');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      affected_pages: (affected as string[]).slice(0, 5),
      new_page_warranted: obj.new_page_warranted as boolean,
      new_page_reason:
        typeof obj.new_page_reason === 'string'
          ? obj.new_page_reason
          : undefined,
    },
    errors: [],
  };
};

export interface Pass2NewPage {
  id: string;
  title: string;
  trigger: string;
  insight: string;
  summary: string;
  pattern_body: string;
  evidence: string[];
  cross_refs?: string[];
}

export interface Pass2Schema {
  page_updates: Array<{
    id: string;
    evidence_add?: string[];
    log_add?: string;
    cross_refs_add?: string[];
    cross_refs_remove?: string[];
    pattern_rewrite?: string | null;
    summary_rewrite?: string | null;
    flag_for_review?: boolean;
  }>;
  new_pending_page: Pass2NewPage | null;
}

const ID_RE = /^[a-z0-9][a-z0-9-]+$/;

export const validatePass2: Validator<Pass2Schema> = (raw) => {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['response not an object'] };
  }
  const obj = raw as Record<string, unknown>;
  const updates = obj.page_updates;
  if (updates !== undefined && !Array.isArray(updates)) {
    errors.push('page_updates must be array if present');
  }
  const cleanedUpdates: Pass2Schema['page_updates'] = [];
  for (const u of (updates ?? []) as unknown[]) {
    if (!u || typeof u !== 'object') {
      errors.push('page_updates entry must be object');
      continue;
    }
    const item = u as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!ID_RE.test(id)) {
      errors.push(`invalid update id: ${id}`);
      continue;
    }
    cleanedUpdates.push({
      id,
      evidence_add: stringArray(item.evidence_add),
      log_add: typeof item.log_add === 'string' ? item.log_add : undefined,
      cross_refs_add: stringArray(item.cross_refs_add),
      cross_refs_remove: stringArray(item.cross_refs_remove),
      pattern_rewrite:
        typeof item.pattern_rewrite === 'string'
          ? item.pattern_rewrite
          : null,
      summary_rewrite:
        typeof item.summary_rewrite === 'string'
          ? item.summary_rewrite
          : null,
      flag_for_review: item.flag_for_review === true,
    });
  }

  const newPageRaw = obj.new_pending_page;
  let newPage: Pass2NewPage | null = null;
  if (newPageRaw && typeof newPageRaw === 'object') {
    const np = newPageRaw as Record<string, unknown>;
    const id = typeof np.id === 'string' ? np.id : '';
    const title = typeof np.title === 'string' ? np.title : '';
    const trigger = typeof np.trigger === 'string' ? np.trigger : '';
    const insight = typeof np.insight === 'string' ? np.insight : '';
    const summary = typeof np.summary === 'string' ? np.summary : '';
    const body =
      typeof np.pattern_body === 'string' ? np.pattern_body : '';
    const evidence = stringArray(np.evidence) ?? [];

    const localErrors: string[] = [];
    if (!ID_RE.test(id)) localErrors.push(`new_pending_page.id invalid: ${id}`);
    if (!title.includes('→'))
      localErrors.push(`new_pending_page.title missing →: ${title}`);
    if (!trigger) localErrors.push('new_pending_page.trigger missing');
    if (!insight) localErrors.push('new_pending_page.insight missing');
    if (!summary || summary.length > 600)
      localErrors.push(
        `new_pending_page.summary missing or too long (${summary.length})`,
      );
    if (!body || body.length > 6000)
      localErrors.push(
        `new_pending_page.pattern_body missing or too long (${body.length})`,
      );
    if (evidence.length === 0)
      localErrors.push('new_pending_page.evidence must have at least one entry');

    if (localErrors.length === 0) {
      newPage = {
        id,
        title,
        trigger,
        insight,
        summary,
        pattern_body: body,
        evidence,
        ...(stringArray(np.cross_refs)
          ? { cross_refs: stringArray(np.cross_refs) }
          : {}),
      };
    } else {
      errors.push(...localErrors);
    }
  } else if (newPageRaw !== null && newPageRaw !== undefined) {
    errors.push('new_pending_page must be object or null');
  }

  // Lenient: if some entries are bad but the overall shape is parseable,
  // return ok=true with what survived. Rejected new page becomes null,
  // rejected updates are dropped. Caller logs `errors` for diagnostics.
  return {
    ok: true,
    value: {
      page_updates: cleanedUpdates,
      new_pending_page: newPage,
    },
    errors,
  };
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const v of value) {
    if (typeof v === 'string') result.push(v);
  }
  return result;
}
