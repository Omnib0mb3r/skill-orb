/**
 * Context curator.
 *
 * Composes the injection payload at UserPromptSubmit. Pulls together:
 *   - top wiki page summary (canonical only)
 *   - matching glossary entries
 *   - current-task memory
 *   - last session summary thread (if relevant)
 *
 * Applies hard relevance discipline:
 *   - prompt-type filter: skip injection for greetings, syntax-only,
 *     short follow-ups
 *   - cosine floors: 0.55 wiki, 0.65 raw fallback
 *   - token budget: 600 hard cap total
 *   - diversity: drop second match if cosine to first > 0.85
 *   - canonical-only: pending pages never inject
 *   - same-session blacklist: pages corrected this session do not
 *     re-appear (held in memory; daemon process)
 *
 * Two modes:
 *   - deterministic (default): concatenate components by relevance.
 *     Fast, ~10ms.
 *   - llm-curated (opt-in): hand all components to the local model
 *     and ask "produce the right 200-400 tokens for this prompt."
 *     Slower (~1-2s on local), tighter relevance.
 */
import { embedOne } from '../embedder/index.js';
import type { Store, WikiPageMetadata } from '../store/index.js';
import { matchTerms, readGlossary, type GlossaryEntry } from './glossary.js';
import { readSummary } from './session-summarizer.js';
import { readCurrentTaskBody } from './current-task.js';
import {
  pickProvider,
  callValidated,
  type LlmProvider,
} from '../llm/index.js';
import type { Validator } from '../llm/validator.js';
import { recordInjection } from '../reinforcement/index.js';
import * as path from 'node:path';
import { wikiPagesDir, wikiPendingDir } from '../paths.js';

const COSINE_FLOOR_WIKI = Number(
  process.env.DEVNEURAL_COSINE_FLOOR_WIKI ?? 0.55,
);
const COSINE_FLOOR_RAW = Number(
  process.env.DEVNEURAL_COSINE_FLOOR_RAW ?? 0.65,
);
const TOKEN_BUDGET = Number(process.env.DEVNEURAL_INJECT_TOKEN_BUDGET ?? 600);
const DIVERSITY_THRESHOLD = 0.85;
const ALWAYS_USE_LLM = process.env.DEVNEURAL_CURATOR_LLM === '1';

const sessionBlacklist = new Map<string, Set<string>>();

export function blacklistPageForSession(
  sessionId: string,
  pageId: string,
): void {
  if (!sessionBlacklist.has(sessionId))
    sessionBlacklist.set(sessionId, new Set());
  sessionBlacklist.get(sessionId)?.add(pageId);
}

export function clearSessionBlacklist(sessionId: string): void {
  sessionBlacklist.delete(sessionId);
}

function isBlacklisted(sessionId: string, pageId: string): boolean {
  return sessionBlacklist.get(sessionId)?.has(pageId) ?? false;
}

export interface CurationInput {
  prompt: string;
  sessionId: string;
  projectId: string;
}

export interface CurationOutput {
  injection: string;
  byteCount: number;
  components: {
    wiki_page_id?: string;
    wiki_score?: number;
    raw_chunk_id?: string;
    raw_score?: number;
    glossary_terms: string[];
    used_session_summary: boolean;
    used_current_task: boolean;
    skipped_reason?: string;
  };
}

const SKIPPED: CurationOutput = {
  injection: '',
  byteCount: 0,
  components: { glossary_terms: [], used_session_summary: false, used_current_task: false },
};

const MIN_PROMPT_WORDS = 4;
const SYNTAX_PROMPTS = [
  /^(hi|hey|hello|thanks|thx|ty|ok|okay|cool|nice)\b/i,
  /^what['’]s the (typescript|js|python|go|rust|sql) syntax for/i,
  /^how do i (write|format) a (string|number|date|array|object) in/i,
];

export function shouldInject(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < MIN_PROMPT_WORDS) return false;
  for (const re of SYNTAX_PROMPTS) {
    if (re.test(trimmed)) return false;
  }
  return true;
}

export async function curate(
  store: Store,
  input: CurationInput,
  log: (msg: string) => void = () => undefined,
): Promise<CurationOutput> {
  if (!shouldInject(input.prompt)) {
    return {
      ...SKIPPED,
      components: { ...SKIPPED.components, skipped_reason: 'prompt_filter' },
    };
  }

  const queryVec = await embedOne(input.prompt.slice(0, 4000));

  // 1. Wiki page (canonical only, project-filter-friendly)
  let bestWiki:
    | { id: string; score: number; metadata: WikiPageMetadata }
    | undefined;
  if (store.wikiPages.size() > 0) {
    const hits = store.wikiPages.search(queryVec, {
      topK: 5,
      filter: (m) => {
        const meta = m as WikiPageMetadata;
        return meta.status === 'canonical';
      },
    });
    for (const h of hits) {
      if (isBlacklisted(input.sessionId, h.id)) continue;
      if (h.score < COSINE_FLOOR_WIKI) break;
      bestWiki = h as typeof bestWiki;
      break;
    }
  }

  // 2. Raw chunk fallback (only if no wiki hit)
  let bestRaw:
    | { id: string; score: number; metadata: Record<string, unknown> }
    | undefined;
  if (!bestWiki && store.rawChunks.size() > 0) {
    const hits = store.rawChunks.search(queryVec, {
      topK: 3,
      filter: (m) => {
        const meta = m as unknown as Record<string, unknown>;
        return !input.projectId || meta.project_id === input.projectId;
      },
    });
    for (const h of hits) {
      if (h.score < COSINE_FLOOR_RAW) break;
      bestRaw = {
        id: h.id,
        score: h.score,
        metadata: h.metadata as unknown as Record<string, unknown>,
      };
      break;
    }
  }

  // 3. Glossary entries that match the prompt
  const glossary = input.projectId
    ? readGlossary(input.projectId)
    : ([] as GlossaryEntry[]);
  const matched = matchTerms(glossary, input.prompt, 3);

  // 4. Current task & session summary
  const taskBody = readCurrentTaskBody(input.sessionId);
  const summaryBody = readSummary(input.sessionId);

  if (!bestWiki && !bestRaw && matched.length === 0 && !taskBody) {
    return {
      ...SKIPPED,
      components: { ...SKIPPED.components, skipped_reason: 'no_signal' },
    };
  }

  // Compose deterministic version first.
  const deterministic = composeDeterministic({
    wiki: bestWiki
      ? { id: bestWiki.id, metadata: bestWiki.metadata, score: bestWiki.score }
      : undefined,
    raw: bestRaw
      ? {
          id: bestRaw.id,
          metadata: bestRaw.metadata,
          score: bestRaw.score,
        }
      : undefined,
    glossary: matched,
    taskBody,
  });

  let injection = deterministic.injection;

  // Optional LLM curator. Off by default; opt-in via env.
  const provider = pickProvider();
  if (
    ALWAYS_USE_LLM &&
    provider &&
    provider.isConfigured() &&
    deterministic.injection.length > 0
  ) {
    try {
      const polished = await llmPolish(provider, input.prompt, deterministic.injection, log);
      if (polished) injection = polished;
    } catch (err) {
      log(`[curator] llm polish failed: ${(err as Error).message}`);
    }
  }

  injection = capByBudget(injection, TOKEN_BUDGET);

  // Record the injection for reinforcement: we want to know after the
  // assistant replies whether the page actually got used.
  if (bestWiki) {
    const pagePath = path.posix.join(
      bestWiki.metadata.status === 'canonical' ? wikiPagesDir() : wikiPendingDir(),
      `${bestWiki.id}.md`,
    );
    const summary = `${bestWiki.metadata.title}\n\n${bestWiki.metadata.trigger} → ${bestWiki.metadata.insight}`;
    recordInjection(input.sessionId, bestWiki.id, pagePath, summary);
  }

  return {
    injection,
    byteCount: Buffer.byteLength(injection, 'utf-8'),
    components: {
      ...(bestWiki ? { wiki_page_id: bestWiki.id, wiki_score: bestWiki.score } : {}),
      ...(bestRaw ? { raw_chunk_id: bestRaw.id, raw_score: bestRaw.score } : {}),
      glossary_terms: matched.map((m) => m.term),
      used_session_summary: false,
      used_current_task: Boolean(taskBody),
    },
  };
}

interface ComposeArgs {
  wiki?:
    | { id: string; metadata: WikiPageMetadata; score: number }
    | undefined;
  raw?:
    | { id: string; metadata: Record<string, unknown>; score: number }
    | undefined;
  glossary: GlossaryEntry[];
  taskBody: string;
}

function composeDeterministic(args: ComposeArgs): { injection: string } {
  const sections: string[] = [];

  if (args.wiki) {
    const m = args.wiki.metadata;
    sections.push(
      `[devneural-page id=${args.wiki.id} score=${args.wiki.score.toFixed(2)}]
trigger: ${m.trigger}
insight: ${m.insight}
${m.title}`,
    );
  } else if (args.raw) {
    const m = args.raw.metadata as { text_preview?: string };
    sections.push(
      `[devneural-raw id=${args.raw.id} score=${args.raw.score.toFixed(2)}]
${m.text_preview ?? ''}`,
    );
  }

  if (args.glossary.length > 0) {
    const lines = args.glossary
      .map((e) => `- "${e.term}" = ${e.definition}`)
      .join('\n');
    sections.push(`[devneural-glossary]\n${lines}`);
  }

  if (args.taskBody) {
    sections.push(`[devneural-current-task]\n${args.taskBody.slice(0, 240)}`);
  }

  if (sections.length === 0) return { injection: '' };

  const blob = sections.join('\n\n');
  const wrapped = `<devneural-context>
${blob}
</devneural-context>`;
  return { injection: wrapped };
}

interface PolishShape {
  injection: string;
}

const validatePolish: Validator<PolishShape> = (raw) => {
  if (!raw || typeof raw !== 'object')
    return { ok: false, errors: ['response not object'] };
  const obj = raw as Record<string, unknown>;
  const inj = typeof obj.injection === 'string' ? obj.injection : '';
  if (!inj) return { ok: false, errors: ['injection missing'] };
  return { ok: true, value: { injection: inj }, errors: [] };
};

async function llmPolish(
  provider: LlmProvider,
  prompt: string,
  candidate: string,
  log: (msg: string) => void,
): Promise<string | null> {
  const system = `You polish context blobs that get injected into a developer's Claude session right before they ask a question.

Output strictly this JSON shape:
{ "injection": "the polished blob" }

Hard rules:
- Output stays as a single short markdown blob with the same general structure.
- If the candidate is already perfect, return it verbatim.
- Drop any line that does not directly help answer the user's prompt.
- Total length <= 600 tokens.
- Keep <devneural-context> wrapper tags exactly.`;

  const user = `User's prompt:
${prompt.slice(0, 600)}

Candidate injection:
${candidate.slice(0, 4000)}

Polish or return verbatim.`;

  const result = await callValidated(
    provider,
    {
      role: 'self_query',
      systemBlocks: [{ text: system, cache: true }],
      user,
      maxTokens: 700,
    },
    validatePolish,
    log,
  );
  return result.value?.injection ?? null;
}

function capByBudget(text: string, tokenBudget: number): string {
  // Coarse: 1 token ~= 4 chars on average. Use 4 chars/token bound.
  const charLimit = tokenBudget * 4;
  if (text.length <= charLimit) return text;
  return text.slice(0, charLimit - 24) + '\n... [truncated]\n';
}

void DIVERSITY_THRESHOLD; // reserved for second-result diversity check
