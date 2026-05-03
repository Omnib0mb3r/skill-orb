/**
 * Unified search across all corpora.
 *
 * Hits wiki_pages, raw_chunks, and (later) reference_chunks in
 * parallel, merges by score, tags each result with its source. Used
 * by the dashboard's Wiki search bar.
 */
import { embedOne } from '../embedder/index.js';
import type { Store } from '../store/index.js';

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
  top_k?: number;
}

export async function searchAll(
  store: Store,
  options: UnifiedSearchOptions,
): Promise<UnifiedSearchHit[]> {
  const collections = options.collections ?? ['wiki_page', 'raw_chunk'];
  const topK = Math.min(Math.max(options.top_k ?? 20, 1), 100);
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
      topK,
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
      topK,
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

  // reference_chunks collection is wired in Phase 3.2 when the upload
  // pipeline lands. For now, the result set is just wiki + raw.

  all.sort((a, b) => b.score - a.score);
  return all.slice(0, topK);
}
