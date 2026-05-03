/**
 * Reference corpus storage.
 *
 * Adds a third Chroma collection alongside raw_chunks and wiki_pages:
 * reference_chunks. Holds embedded chunks of uploaded docs (PDF,
 * image OCR, audio/video transcripts in later phases). Backed by a
 * SQLite metadata table so the dashboard can list and filter docs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { VectorStore } from '../store/vector-store.js';
import { getEmbedDim } from '../embedder/index.js';
import { DATA_ROOT, ensureDir } from '../paths.js';

export interface ReferenceChunkMetadata {
  doc_id: string;
  kind: 'pdf' | 'image' | 'audio' | 'video' | 'markdown' | 'docx' | 'other';
  project_id: string;
  chunk_index: number;
  text_preview: string;
  upload_ts_ms: number;
}

export interface ReferenceDocMeta {
  doc_id: string;
  filename: string;
  kind: string;
  project_id: string;
  tags: string[];
  upload_ts: string;
  page_count?: number;
  char_count: number;
  chunk_count: number;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error?: string;
  warnings?: string[];
}

export class ReferenceStore {
  private constructor(
    public readonly chunks: VectorStore<ReferenceChunkMetadata>,
    private readonly db: Database.Database,
  ) {
    this.migrate();
  }

  static async open(): Promise<ReferenceStore> {
    const dim = getEmbedDim();
    const collectionsDir = path.posix.join(DATA_ROOT, 'chroma', 'collections');
    const chunks = await VectorStore.open<ReferenceChunkMetadata>(
      path.posix.join(collectionsDir, 'reference_chunks'),
      'reference_chunks',
      dim,
    );
    const db = new Database(path.posix.join(DATA_ROOT, 'index.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    return new ReferenceStore(chunks, db);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reference_meta (
        doc_id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        project_id TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        upload_ts INTEGER NOT NULL,
        page_count INTEGER,
        char_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        warnings_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ref_project ON reference_meta (project_id);
      CREATE INDEX IF NOT EXISTS idx_ref_upload ON reference_meta (upload_ts DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS reference_fts USING fts5(
        doc_id UNINDEXED,
        filename,
        text,
        tokenize='porter'
      );
    `);
  }

  upsertDoc(meta: ReferenceDocMeta): void {
    const stmt = this.db.prepare(
      `INSERT INTO reference_meta (doc_id, filename, kind, project_id, tags_json, upload_ts, page_count, char_count, chunk_count, status, error, warnings_json)
       VALUES (@doc_id, @filename, @kind, @project_id, @tags_json, @upload_ts, @page_count, @char_count, @chunk_count, @status, @error, @warnings_json)
       ON CONFLICT(doc_id) DO UPDATE SET
         filename=excluded.filename,
         kind=excluded.kind,
         project_id=excluded.project_id,
         tags_json=excluded.tags_json,
         page_count=excluded.page_count,
         char_count=excluded.char_count,
         chunk_count=excluded.chunk_count,
         status=excluded.status,
         error=excluded.error,
         warnings_json=excluded.warnings_json`,
    );
    stmt.run({
      doc_id: meta.doc_id,
      filename: meta.filename,
      kind: meta.kind,
      project_id: meta.project_id,
      tags_json: JSON.stringify(meta.tags),
      upload_ts: Date.parse(meta.upload_ts),
      page_count: meta.page_count ?? null,
      char_count: meta.char_count,
      chunk_count: meta.chunk_count,
      status: meta.status,
      error: meta.error ?? null,
      warnings_json: meta.warnings ? JSON.stringify(meta.warnings) : null,
    });
  }

  ftsIndex(docId: string, filename: string, text: string): void {
    this.db
      .prepare(`DELETE FROM reference_fts WHERE doc_id = ?`)
      .run(docId);
    this.db
      .prepare(`INSERT INTO reference_fts (doc_id, filename, text) VALUES (?, ?, ?)`)
      .run(docId, filename, text);
  }

  listDocs(options: { project_id?: string; limit?: number } = {}): ReferenceDocMeta[] {
    const limit = options.limit ?? 100;
    let rows;
    if (options.project_id) {
      rows = this.db
        .prepare(
          `SELECT * FROM reference_meta WHERE project_id = ? ORDER BY upload_ts DESC LIMIT ?`,
        )
        .all(options.project_id, limit);
    } else {
      rows = this.db
        .prepare(`SELECT * FROM reference_meta ORDER BY upload_ts DESC LIMIT ?`)
        .all(limit);
    }
    return (rows as Array<{
      doc_id: string;
      filename: string;
      kind: string;
      project_id: string;
      tags_json: string;
      upload_ts: number;
      page_count: number | null;
      char_count: number;
      chunk_count: number;
      status: ReferenceDocMeta['status'];
      error: string | null;
      warnings_json: string | null;
    }>).map((r) => ({
      doc_id: r.doc_id,
      filename: r.filename,
      kind: r.kind,
      project_id: r.project_id,
      tags: JSON.parse(r.tags_json) as string[],
      upload_ts: new Date(r.upload_ts).toISOString(),
      ...(r.page_count !== null ? { page_count: r.page_count } : {}),
      char_count: r.char_count,
      chunk_count: r.chunk_count,
      status: r.status,
      ...(r.error !== null ? { error: r.error } : {}),
      ...(r.warnings_json !== null ? { warnings: JSON.parse(r.warnings_json) as string[] } : {}),
    }));
  }

  getDoc(docId: string): ReferenceDocMeta | null {
    const docs = this.listDocs({});
    return docs.find((d) => d.doc_id === docId) ?? null;
  }

  async flush(): Promise<void> {
    await this.chunks.flush();
  }
}

export function detectKind(filename: string): ReferenceChunkMetadata['kind'] {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (['pdf'].includes(ext)) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'].includes(ext))
    return 'image';
  if (['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['md', 'markdown', 'txt'].includes(ext)) return 'markdown';
  if (['docx'].includes(ext)) return 'docx';
  return 'other';
}

export function ensureReferenceDirs(): void {
  ensureDir(path.posix.join(DATA_ROOT, 'reference'));
  ensureDir(path.posix.join(DATA_ROOT, 'reference', 'queue'));
  ensureDir(path.posix.join(DATA_ROOT, 'reference', 'docs'));
  ensureDir(path.posix.join(DATA_ROOT, 'reference', 'images'));
}

void fs;
