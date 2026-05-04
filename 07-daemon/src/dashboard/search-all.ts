/**
 * Unified search across all corpora.
 *
 * Hits wiki_pages, raw_chunks, and (later) reference_chunks in
 * parallel, merges by score, tags each result with its source. Used
 * by the dashboard's Wiki search bar.
 */
import { embedOne } from '../embedder/index.js';
import type { Store } from '../store/index.js';
import type { ReferenceStore } from '../reference/store.js';

export interface UnifiedSearchHit {
  source: 'wiki_page' | 'raw_chunk' | 'reference_chunk';
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface UnifiedSearchOptions {
  query: string;
  project_id?: string;
  collections?: Array<'wiki_page' | 'raw_chunk' | 'reference_chunk'>;
  /** @deprecated Use limit + offset. Kept for backwards compatibility. */
  top_k?: number;
  /** Page size for the merged result list. Default 10, capped at 100. */
  limit?: number;
  /** Zero-based page offset across the merged result list. Default 0. */
  offset?: number;
}

/* Per-collection candidate pool. We pull this many hits from each
 * vector store before merging and sorting, so pagination can walk
 * through more than the top-N most-similar hits. Capped to keep
 * memory bounded; 500 hits across 3 collections = 1500 hit objects
 * temporary, well within budget. */
const CANDIDATE_POOL_PER_COLLECTION = 500;

export interface UnifiedSearchPage {
  results: UnifiedSearchHit[];
  total: number;
  offset: number;
  limit: number;
}

export async function searchAll(
  store: Store,
  options: UnifiedSearchOptions,
  referenceStore?: ReferenceStore,
): Promise<UnifiedSearchPage> {
  const collections = options.collections ?? ['wiki_page', 'raw_chunk'];
  // limit takes precedence; fall back to legacy top_k; default 10.
  const limit = Math.min(Math.max(options.limit ?? options.top_k ?? 10, 1), 100);
  const offset = Math.max(0, options.offset ?? 0);
  const candidatePerCollection = CANDIDATE_POOL_PER_COLLECTION;
  const vec = await embedOne(options.query.slice(0, 4000));

  const all: UnifiedSearchHit[] = [];

  if (collections.includes('wiki_page') && store.wikiPages.size() > 0) {
    const hits = (
      store.wikiPages as unknown as {
        search: (
          q: Float32Array,
          o: { topK: number; filter?: (m: unknown) => boolean },
        ) => Array<{ id: string; score: number; metadata: unknown }>;
      }
    ).search(vec, {
      topK: candidatePerCollection,
      filter: (m) => {
        const meta = m as Record<string, unknown>;
        // wiki pages may have project_ids in projects array; soft filter only if provided
        if (options.project_id) {
          const projects = meta.projects as string[] | undefined;
          if (projects && projects.length > 0) {
            return projects.includes(options.project_id);
          }
        }
        return true;
      },
    });
    for (const h of hits) {
      all.push({
        source: 'wiki_page',
        id: h.id,
        score: h.score,
        metadata: h.metadata as Record<string, unknown>,
      });
    }
  }

  if (collections.includes('raw_chunk') && store.rawChunks.size() > 0) {
    const hits = (
      store.rawChunks as unknown as {
        search: (
          q: Float32Array,
          o: { topK: number; filter?: (m: unknown) => boolean },
        ) => Array<{ id: string; score: number; metadata: unknown }>;
      }
    ).search(vec, {
      topK: candidatePerCollection,
      filter: (m) => {
        const meta = m as Record<string, unknown>;
        if (options.project_id && meta.project_id !== options.project_id) {
          return false;
        }
        return true;
      },
    });
    for (const h of hits) {
      all.push({
        source: 'raw_chunk',
        id: h.id,
        score: h.score,
        metadata: h.metadata as Record<string, unknown>,
      });
    }
  }

  if (
    collections.includes('reference_chunk') &&
    referenceStore &&
    referenceStore.chunks.size() > 0
  ) {
    const hits = (
      referenceStore.chunks as unknown as {
        search: (
          q: Float32Array,
          o: { topK: number; filter?: (m: unknown) => boolean },
        ) => Array<{ id: string; score: number; metadata: unknown }>;
      }
    ).search(vec, {
      topK: candidatePerCollection,
      filter: (m) => {
        const meta = m as Record<string, unknown>;
        if (options.project_id && meta.project_id !== options.project_id) {
          return false;
        }
        return true;
      },
    });
    for (const h of hits) {
      all.push({
        source: 'reference_chunk',
        id: h.id,
        score: h.score,
        metadata: h.metadata as Record<string, unknown>,
      });
    }
  }

  all.sort((a, b) => b.score - a.score);
  const total = all.length;
  return {
    results: all.slice(offset, offset + limit),
    total,
    offset,
    limit,
  };
}
