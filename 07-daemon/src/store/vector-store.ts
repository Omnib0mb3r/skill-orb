/**
 * Native in-process vector store.
 *
 * Replaces Chroma. Single-developer volumes (tens of thousands of
 * vectors over a year) are well-served by an in-memory linear cosine
 * scan with project-id metadata filtering. Persists each collection
 * as an append-only binary file plus a JSON metadata sidecar.
 *
 * If we ever need richer indexing (HNSW, IVF, billion-scale), this
 * module is the swap point.
 *
 * File layout per collection:
 *   <dir>/<name>.vec      raw Float32 vectors, packed
 *   <dir>/<name>.meta.jsonl  one JSON line per vector with metadata
 *   <dir>/<name>.head.json   header: dim, count, version
 *
 * On open we mmap the .vec file (or just read it once) and load the
 * jsonl metadata into memory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from '../paths.js';

export interface VectorRecord<M = Record<string, unknown>> {
  id: string;
  vector: Float32Array;
  metadata: M;
}

export interface SearchResult<M> {
  id: string;
  score: number;
  metadata: M;
}

export interface SearchOptions<M> {
  topK?: number;
  filter?: (m: M) => boolean;
  minScore?: number;
}

interface CollectionHeader {
  version: 1;
  dim: number;
  count: number;
  name: string;
}

export class VectorStore<M = Record<string, unknown>> {
  private vectors: Float32Array[] = [];
  private metadata: M[] = [];
  private ids: string[] = [];
  private idToIndex = new Map<string, number>();
  private dirty = false;

  private constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly dim: number,
  ) {}

  static async open<M>(
    dir: string,
    name: string,
    dim: number,
  ): Promise<VectorStore<M>> {
    ensureDir(dir);
    const store = new VectorStore<M>(dir, name, dim);
    await store.load();
    return store;
  }

  private headFile(): string {
    return path.posix.join(this.dir, `${this.name}.head.json`);
  }
  private vecFile(): string {
    return path.posix.join(this.dir, `${this.name}.vec`);
  }
  private metaFile(): string {
    return path.posix.join(this.dir, `${this.name}.meta.jsonl`);
  }

  private async load(): Promise<void> {
    const head = this.headFile();
    if (!fs.existsSync(head)) {
      this.writeHeader(0);
      return;
    }
    const parsed = JSON.parse(
      fs.readFileSync(head, 'utf-8'),
    ) as CollectionHeader;
    if (parsed.dim !== this.dim) {
      throw new Error(
        `vector store ${this.name} dim ${parsed.dim} does not match expected ${this.dim}`,
      );
    }

    if (fs.existsSync(this.vecFile())) {
      const buf = fs.readFileSync(this.vecFile());
      const dim = this.dim;
      const total = buf.length / 4 / dim;
      for (let i = 0; i < total; i++) {
        const slice = new Float32Array(
          buf.buffer,
          buf.byteOffset + i * dim * 4,
          dim,
        ).slice();
        this.vectors.push(slice);
      }
    }

    if (fs.existsSync(this.metaFile())) {
      const lines = fs
        .readFileSync(this.metaFile(), 'utf-8')
        .split('\n')
        .filter((l) => l.length > 0);
      for (const line of lines) {
        try {
          const parsedLine = JSON.parse(line) as { id: string; m: M };
          const idx = this.ids.length;
          this.ids.push(parsedLine.id);
          this.idToIndex.set(parsedLine.id, idx);
          this.metadata.push(parsedLine.m);
        } catch {
          /* skip bad line */
        }
      }
    }

    if (this.metadata.length !== this.vectors.length) {
      throw new Error(
        `vector store ${this.name} corrupt: ${this.vectors.length} vectors, ${this.metadata.length} metadata`,
      );
    }
  }

  private writeHeader(count: number): void {
    const header: CollectionHeader = {
      version: 1,
      dim: this.dim,
      count,
      name: this.name,
    };
    fs.writeFileSync(this.headFile(), JSON.stringify(header), 'utf-8');
  }

  async add(record: VectorRecord<M>): Promise<void> {
    if (record.vector.length !== this.dim) {
      throw new Error(
        `vector dim ${record.vector.length} != store dim ${this.dim}`,
      );
    }
    if (this.idToIndex.has(record.id)) {
      // Update in place
      const idx = this.idToIndex.get(record.id) as number;
      const v = this.vectors[idx];
      if (!v) {
        throw new Error('internal: missing vector slot');
      }
      v.set(record.vector);
      this.metadata[idx] = record.metadata;
    } else {
      const idx = this.vectors.length;
      this.vectors.push(record.vector.slice());
      this.metadata.push(record.metadata);
      this.ids.push(record.id);
      this.idToIndex.set(record.id, idx);
    }
    this.dirty = true;

    // Append to metaFile for durability; rewrite vec file on flush.
    fs.appendFileSync(
      this.metaFile(),
      JSON.stringify({ id: record.id, m: record.metadata }) + '\n',
      'utf-8',
    );
  }

  /**
   * Persist the in-memory vectors to .vec and rewrite the header.
   * Call on shutdown or periodically. Metadata is already durable
   * (append-only jsonl).
   */
  async flush(): Promise<void> {
    if (!this.dirty && fs.existsSync(this.vecFile())) return;
    const dim = this.dim;
    const buf = Buffer.allocUnsafe(this.vectors.length * dim * 4);
    for (let i = 0; i < this.vectors.length; i++) {
      const src = this.vectors[i];
      if (!src) continue;
      Buffer.from(src.buffer, src.byteOffset, dim * 4).copy(buf, i * dim * 4);
    }
    fs.writeFileSync(this.vecFile(), buf);
    this.writeHeader(this.vectors.length);
    this.dirty = false;
  }

  size(): number {
    return this.vectors.length;
  }

  search(
    query: Float32Array,
    options: SearchOptions<M> = {},
  ): SearchResult<M>[] {
    if (query.length !== this.dim) {
      throw new Error(
        `query dim ${query.length} != store dim ${this.dim}`,
      );
    }
    const topK = options.topK ?? 10;
    const minScore = options.minScore ?? -Infinity;
    const filter = options.filter;

    const results: { idx: number; score: number }[] = [];
    for (let i = 0; i < this.vectors.length; i++) {
      const meta = this.metadata[i];
      if (filter && !filter(meta as M)) continue;
      const v = this.vectors[i];
      if (!v) continue;
      let dot = 0;
      for (let j = 0; j < this.dim; j++) {
        dot += (v[j] ?? 0) * (query[j] ?? 0);
      }
      if (dot < minScore) continue;
      results.push({ idx: i, score: dot });
    }
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK).map((r) => ({
      id: this.ids[r.idx] ?? '',
      score: r.score,
      metadata: this.metadata[r.idx] as M,
    }));
  }

  getMetadata(id: string): M | undefined {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return undefined;
    return this.metadata[idx];
  }

  has(id: string): boolean {
    return this.idToIndex.has(id);
  }

  /**
   * Iterate metadata. Useful for SQLite reindexing.
   */
  *all(): IterableIterator<{ id: string; metadata: M }> {
    for (let i = 0; i < this.ids.length; i++) {
      yield { id: this.ids[i] ?? '', metadata: this.metadata[i] as M };
    }
  }
}
