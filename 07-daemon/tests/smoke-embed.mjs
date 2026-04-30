// End-to-end smoke test: open store, embed text, add chunks, search.
// Not a vitest case because it pulls down the ONNX model on first run.
// Run with: node tests/smoke-embed.mjs
import { Store } from '../dist/store/index.js';
import { embedOne, getEmbedDim } from '../dist/embedder/index.js';

process.env.DEVNEURAL_DATA_ROOT ??= 'C:/tmp/devneural-p2-smoke';

async function main() {
  console.log('opening store...');
  const store = await Store.open();
  console.log('embed dim:', getEmbedDim());

  const docs = [
    {
      id: 'doc-pathfinding',
      text: 'For grid-based routing prefer A* over Dijkstra when an admissible heuristic is available.',
      kind: 'prose',
    },
    {
      id: 'doc-monday',
      text: 'When changing devneural.jsonc stage in alpha projects, also call the monday.com move_project MCP in the same step.',
      kind: 'prose',
    },
    {
      id: 'doc-shared-data',
      text: 'Design shared data directories outside any single repo. Use C:/dev/data/<topic>/ for cross-project state.',
      kind: 'prose',
    },
  ];

  console.log('embedding and adding...');
  for (const d of docs) {
    const vec = await embedOne(d.text);
    await store.rawChunks.add({
      id: d.id,
      vector: vec,
      metadata: {
        project_id: 'smoke',
        session_id: 'S1',
        timestamp_ms: Date.now(),
        kind: d.kind,
        role: 'user',
        byte_length: d.text.length,
        text_preview: d.text.slice(0, 100),
      },
    });
    store.db.upsertRawChunk({
      id: d.id,
      project_id: 'smoke',
      session_id: 'S1',
      timestamp_ms: Date.now(),
      kind: d.kind,
      role: 'user',
      byte_length: d.text.length,
    });
  }
  await store.flush();
  console.log('size after add:', store.rawChunks.size());

  const queries = [
    'best algorithm for grid pathfinding',
    'how do I sync monday board with the project stage',
    'where should I keep cross-project data',
  ];

  for (const q of queries) {
    const v = await embedOne(q);
    const hits = store.rawChunks.search(v, { topK: 3 });
    console.log(`\nQ: ${q}`);
    for (const h of hits) {
      console.log(`  ${h.score.toFixed(3)}  ${h.id}  ${h.metadata.text_preview}`);
    }
  }

  await store.close();
  console.log('\ndone');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
