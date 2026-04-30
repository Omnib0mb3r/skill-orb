import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { IndexDb } from '../src/store/index-db.js';

let tmpDir: string;
let dbFile: string;
let db: IndexDb;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-idx-'));
  dbFile = path.join(tmpDir, 'index.db');
  db = new IndexDb(dbFile);
});

afterEach(() => {
  db.close();
});

describe('IndexDb', () => {
  it('upserts and queries raw chunks by recency', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      db.upsertRawChunk({
        id: `chunk-${i}`,
        project_id: 'P1',
        session_id: 'S1',
        timestamp_ms: now - i * 1000,
        kind: 'prose',
        role: 'user',
        byte_length: 100,
      });
    }
    const recent = db.recentRawChunks('P1', 3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.id).toBe('chunk-0');
    expect(recent[2]?.id).toBe('chunk-2');
  });

  it('FTS hits and ranks wiki pages', () => {
    db.upsertWikiPage(
      {
        id: 'pathfinding',
        title: 'Choosing pathfinding for grid routing',
        trigger: 'grid routing',
        insight: 'prefer A* over Dijkstra',
        status: 'canonical',
        weight: 0.7,
        hits: 1,
        corrections: 0,
        created_ms: 0,
        last_touched_ms: 0,
        projects_json: '[]',
        human_edited: 0,
      },
      'A* converges faster on uniform grids than Dijkstra when an admissible heuristic is available',
    );
    db.upsertWikiPage(
      {
        id: 'monday-sync',
        title: 'devneural.jsonc stage and monday sync',
        trigger: 'updating stage',
        insight: 'call move_project in same step',
        status: 'canonical',
        weight: 0.5,
        hits: 0,
        corrections: 0,
        created_ms: 0,
        last_touched_ms: 0,
        projects_json: '[]',
        human_edited: 0,
      },
      'When changing devneural.jsonc stage, also call monday.com move_project to keep the board synced',
    );

    const hits = db.ftsSearchWiki('Dijkstra heuristic');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.page_id).toBe('pathfinding');

    const hits2 = db.ftsSearchWiki('monday move_project');
    expect(hits2[0]?.page_id).toBe('monday-sync');
  });

  it('cross-ref neighbors expand 1-hop both directions', () => {
    db.setCrossRefs('A', ['B', 'C']);
    db.setCrossRefs('D', ['A']);
    const n = db.neighbors('A', 1);
    expect(n.has('B')).toBe(true);
    expect(n.has('C')).toBe(true);
    expect(n.has('D')).toBe(true);
    expect(n.size).toBe(3);
  });
});
