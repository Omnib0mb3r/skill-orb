/**
 * Multi-signal candidate page selection at ingest.
 *
 * Replaces "top K by embedding" with a UNION over four cheap signals:
 *   - embedding similarity (semantic)
 *   - cross-reference graph hops (transitive)
 *   - entity overlap (literal: file paths, commit hashes, project ids)
 *   - FTS over wiki bodies (keyword-precise)
 *
 * No LLM call; this is the cheap pre-filter that bounds Pass 1's input.
 */
import { embedOne } from '../embedder/index.js';
import type { Store } from '../store/index.js';
import type { WikiPageMetadata } from '../store/index.js';
import type { WikiPageRow } from '../store/index-db.js';

export interface CandidateOptions {
  topKEmbedding?: number;
  topKEntity?: number;
  topKFts?: number;
  hops?: number;
}

export interface CandidatePage {
  id: string;
  reasons: string[];
  embeddingScore?: number;
  metadata: WikiPageMetadata | undefined;
  row: WikiPageRow | undefined;
}

const ENTITY_RE =
  /\b(?:[a-z0-9]{8,40}|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|py|rs|go|md|jsonc?|yaml|yml|sh|bat|ps1|sql)|[A-Z][A-Z0-9_-]{2,})\b/g;

export async function selectCandidates(
  store: Store,
  newContent: string,
  opts: CandidateOptions = {},
): Promise<CandidatePage[]> {
  const topKEmbedding = opts.topKEmbedding ?? 15;
  const topKEntity = opts.topKEntity ?? 10;
  const topKFts = opts.topKFts ?? 5;
  const hops = opts.hops ?? 1;

  const pool = new Map<string, CandidatePage>();
  const add = (id: string, reason: string, embeddingScore?: number) => {
    const existing = pool.get(id);
    if (existing) {
      existing.reasons.push(reason);
      if (embeddingScore !== undefined && existing.embeddingScore === undefined) {
        existing.embeddingScore = embeddingScore;
      }
      return;
    }
    pool.set(id, {
      id,
      reasons: [reason],
      embeddingScore,
      metadata: store.wikiPages.getMetadata(id),
      row: store.db.pageById(id),
    });
  };

  // 1. Embedding similarity over wiki_pages
  if (store.wikiPages.size() > 0) {
    const queryVec = await embedOne(newContent.slice(0, 4000));
    const semanticHits = store.wikiPages.search(queryVec, {
      topK: topKEmbedding,
    });
    for (const h of semanticHits) {
      add(h.id, `embedding ${h.score.toFixed(3)}`, h.score);
    }
  }

  // 2. Cross-reference 1-hop neighbors of the embedding hits
  if (hops > 0) {
    const seeds = Array.from(pool.keys());
    for (const seed of seeds) {
      const neighbors = store.db.neighbors(seed, hops);
      for (const id of neighbors) {
        add(id, `cross-ref via ${seed}`);
      }
    }
  }

  // 3. Entity overlap (literal identifier matches)
  const entities = extractEntities(newContent);
  if (entities.length > 0) {
    const ftsQuery = entities.map((e) => `"${e.replace(/"/g, '')}"`).join(' OR ');
    try {
      const hits = store.db.ftsSearchWiki(ftsQuery, topKEntity);
      for (const h of hits) {
        add(h.page_id, `entity-overlap`);
      }
    } catch {
      /* malformed FTS expression; fall through */
    }
  }

  // 4. FTS over the new content's significant keywords
  const keywords = extractKeywords(newContent);
  if (keywords.length > 0) {
    const ftsQuery = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
    try {
      const hits = store.db.ftsSearchWiki(ftsQuery, topKFts);
      for (const h of hits) {
        add(h.page_id, `fts-keyword`);
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(pool.values()).slice(0, 50);
}

function extractEntities(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const matches = text.match(ENTITY_RE) ?? [];
  for (const m of matches) {
    if (m.length < 4 || m.length > 64) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    result.push(m);
    if (result.length >= 30) break;
  }
  return result;
}

const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'over',
  'when', 'what', 'where', 'which', 'while', 'have', 'will', 'been',
  'were', 'because', 'about', 'should', 'could', 'would', 'their',
  'there', 'these', 'those', 'just', 'like', 'also', 'each', 'such',
  'than', 'then', 'them', 'they', 'what', 'how', 'too',
]);

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/\b[a-z][a-z0-9_-]{4,}\b/g) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}
