import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { VectorStore } from '../src/store/vector-store.js';

interface Meta {
  project_id: string;
  kind: string;
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-vec-'));
});

function unitVector(seed: number, dim = 4): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i);
  let n = 0;
  for (let i = 0; i < dim; i++) n += (v[i] ?? 0) * (v[i] ?? 0);
  n = Math.sqrt(n);
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / n;
  return v;
}

describe('VectorStore', () => {
  it('persists across reopen', async () => {
    const dim = 4;
    const a = await VectorStore.open<Meta>(tmpDir, 'test', dim);
    await a.add({
      id: 'one',
      vector: unitVector(1, dim),
      metadata: { project_id: 'P1', kind: 'prose' },
    });
    await a.add({
      id: 'two',
      vector: unitVector(2, dim),
      metadata: { project_id: 'P2', kind: 'code-mixed' },
    });
    await a.flush();

    const b = await VectorStore.open<Meta>(tmpDir, 'test', dim);
    expect(b.size()).toBe(2);
    expect(b.has('one')).toBe(true);
    expect(b.getMetadata('two')?.project_id).toBe('P2');
  });

  it('returns top-K by cosine, descending', async () => {
    const dim = 4;
    const store = await VectorStore.open<Meta>(tmpDir, 'topk', dim);
    for (let i = 0; i < 5; i++) {
      await store.add({
        id: `id-${i}`,
        vector: unitVector(i, dim),
        metadata: { project_id: 'P1', kind: 'prose' },
      });
    }
    const query = unitVector(0, dim);
    const hits = store.search(query, { topK: 3 });
    expect(hits).toHaveLength(3);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]?.score).toBeLessThanOrEqual(hits[i - 1]?.score ?? Infinity);
    }
    expect(hits[0]?.id).toBe('id-0');
  });

  it('filters by metadata predicate', async () => {
    const dim = 4;
    const store = await VectorStore.open<Meta>(tmpDir, 'filter', dim);
    await store.add({
      id: 'p1-prose',
      vector: unitVector(0, dim),
      metadata: { project_id: 'P1', kind: 'prose' },
    });
    await store.add({
      id: 'p2-prose',
      vector: unitVector(0, dim),
      metadata: { project_id: 'P2', kind: 'prose' },
    });
    const hits = store.search(unitVector(0, dim), {
      topK: 5,
      filter: (m) => m.project_id === 'P1',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('p1-prose');
  });

  it('rejects mismatched dim', async () => {
    const store = await VectorStore.open<Meta>(tmpDir, 'dim', 4);
    await expect(
      store.add({
        id: 'bad',
        vector: new Float32Array(3),
        metadata: { project_id: 'P1', kind: 'prose' },
      }),
    ).rejects.toThrow();
  });
});
