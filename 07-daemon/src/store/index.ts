/**
 * Storage facade. The daemon owns one instance.
 */
import * as path from 'node:path';
import { DATA_ROOT } from '../paths.js';
import { VectorStore } from './vector-store.js';
import { IndexDb } from './index-db.js';
import { getEmbedDim } from '../embedder/index.js';

export interface RawChunkMetadata {
  project_id: string;
  session_id: string;
  timestamp_ms: number;
  kind: string;
  role: string;
  byte_length: number;
  text_preview: string;
}

export interface WikiPageMetadata {
  status: 'pending' | 'canonical' | 'archived';
  weight: number;
  trigger: string;
  insight: string;
  title: string;
}

export class Store {
  constructor(
    public readonly rawChunks: VectorStore<RawChunkMetadata>,
    public readonly wikiPages: VectorStore<WikiPageMetadata>,
    public readonly db: IndexDb,
  ) {}

  static async open(): Promise<Store> {
    const collectionsDir = path.posix.join(DATA_ROOT, 'chroma', 'collections');
    const dim = getEmbedDim();
    const rawChunks = await VectorStore.open<RawChunkMetadata>(
      path.posix.join(collectionsDir, 'raw_chunks'),
      'raw_chunks',
      dim,
    );
    const wikiPages = await VectorStore.open<WikiPageMetadata>(
      path.posix.join(collectionsDir, 'wiki_pages'),
      'wiki_pages',
      dim,
    );
    const db = new IndexDb();
    return new Store(rawChunks, wikiPages, db);
  }

  async flush(): Promise<void> {
    await this.rawChunks.flush();
    await this.wikiPages.flush();
  }

  async close(): Promise<void> {
    await this.flush();
    this.db.close();
  }
}
