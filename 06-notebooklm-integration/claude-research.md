# Research Findings: 06-notebooklm-integration

---

## 1. Existing Codebase Patterns

### 1.1 Data Layer (01-data-layer)

#### weights.json Schema

```typescript
interface WeightsFile {
  schema_version: 1;
  updated_at: string;       // ISO 8601 UTC
  connections: Record<string, ConnectionRecord>;  // keyed by "sourceNode||targetNode"
}

interface ConnectionRecord {
  source_node: string;      // e.g. "project:github.com/user/repo"
  target_node: string;      // e.g. "tool:Bash", "skill:typescript", "project:..."
  connection_type: 'project->tool' | 'project->skill' | 'project->project';
  raw_count: number;        // unbounded total observations
  weight: number;           // [0.0, 10.0], caps at 100 raw_count
  first_seen: string;       // ISO 8601 UTC
  last_seen: string;        // ISO 8601 UTC
}
```

- Edge keys use `||` separator (ASCII, not Unicode)
- Weight formula: `Math.round(Math.min(raw_count, 100) / 100 * 10 * 10000) / 10000`
- Atomic writes via `write-file-atomic` + `proper-lockfile`
- Data root: `C:\dev\data\skill-connections\` (via `DEVNEURAL_DATA_ROOT` env var)

#### Log File Format (JSONL)

```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;               // ISO 8601 UTC
  session_id: string;
  tool_use_id: string;
  project: string;                 // canonical project id
  project_source: 'git-remote' | 'git-root' | 'cwd';
  tool_name: string;
  tool_input: Record<string, unknown>;
  connection_type: ConnectionType;
  source_node: string;
  target_node: string;
  stage?: string;                  // from devneural.json
  tags?: string[];                 // from devneural.json
}
```

- Location: `<dataRoot>/logs/YYYY-MM-DD.jsonl` (UTC date)
- One JSON object per line, append-only, no locking

### 1.2 API Server (02-api-server)

#### Graph Data Structures

```typescript
interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: 'alpha' | 'beta' | 'deployed' | 'archived';
  tags?: string[];
  localPath?: string;
}

interface GraphEdge {
  id: string;                      // "source||target"
  source: string;
  target: string;
  connection_type: ConnectionType;
  raw_count: number;
  weight: number;                  // [0, 10]
  first_seen: string;
  last_seen: string;
}
```

#### REST Endpoints Available

```
GET /health
GET /graph                         → full graph (all nodes + edges)
GET /graph/node/:id                → single node + incident edges
GET /graph/subgraph?project=...    → project-centric subgraph
GET /graph/top?limit=...           → top N edges by weight (default: 10, max: 100)
GET /events?limit=...              → log entries
```

### 1.3 Project Conventions

| Aspect | Convention |
|--------|-----------|
| Module format | ESM (matches 02, 03, 05 — use NodeNext in tsconfig) |
| TypeScript | Strict mode, no `any`, explicit error handling |
| Testing | Vitest, `globals: false`, `environment: 'node'` |
| Error handling | "Never throws" for I/O — catch, log to stderr with `[DevNeural]` prefix |
| File writes | Atomic writes for data files |
| Test files | `/tests/*.test.ts` |
| Build output | `/dist` via `tsc` |
| Dev runner | `tsx` for TS-native execution |

### 1.4 Testing Setup

- **Framework:** Vitest (`vitest run` for CI, `vitest` for watch)
- **Temp dirs:** `fs.mkdtempSync()` + cleanup in `afterEach`
- **Integration tests:** Spawn subprocesses via `spawnSync`
- **Mocking:** `vi.fn()` and `vi.mock()` for external deps

---

## 2. NotebookLM API Integration

### Current API Status

**No public NotebookLM API exists for consumer/standard accounts.**

A **NotebookLM Enterprise API** launched in September 2025 (alpha/preview) — available only to Google Cloud enterprise customers.

### Enterprise API Capabilities

| Operation | Notes |
|-----------|-------|
| Create/delete notebooks | Via `notebooks.create`, `notebooks.batchDelete` |
| Add sources | Via `notebooks.sources.batchCreate` |
| Upload file | Via `notebooks.sources.uploadFile` |
| Generate audio overview | Supported |
| List/share notebooks | Supported |

**Authentication:** Bearer token via `gcloud auth print-access-token`

**Accepted document formats:** Markdown (.md), PDF, TXT, DOCX, PPTX, XLSX, Google Docs/Slides, URLs, YouTube videos, MP3, images

**Key limits:**
- 500 notebooks/user, 300 sources/notebook
- 500 queries/user/day, 200MB max file size
- Notebooks not shareable publicly (same GCP project only)

**Base endpoint:**
```
https://[LOCATION]-discoveryengine.googleapis.com/v1alpha/projects/[PROJECT_NUMBER]/locations/[LOCATION]/notebooks
```

### Alternatives / Fallback Strategy

| Option | Viable for | Notes |
|--------|-----------|-------|
| NotebookLM Enterprise API | Production (GCP customers) | $9/license/mo, alpha |
| `notebooklm-py` (unofficial) | Prototyping, personal use | Python library, unofficial |
| Gemini API + Drive API | Production fallback | DIY equivalent: upload to Drive, use Gemini for Q&A |
| Markdown file export | Always available | Write structured .md files for manual import |

**Design implication:** The integration must treat NotebookLM as an optional output target. The primary deliverable is structured training documents (markdown). NotebookLM upload is a "push" step that can be skipped or replaced.

### Sources

- [NotebookLM Enterprise — Create notebooks API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks)
- [NotebookLM Enterprise — Add sources API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks-sources)
- [Google AI Developers Forum — API status](https://discuss.ai.google.dev/t/how-to-access-notebooklm-via-api/5084)
- [notebooklm-py unofficial Python client](https://github.com/teng-lin/notebooklm-py)

---

## 3. Graph Community Detection Algorithms

### Algorithm Comparison for JS/TS

| Algorithm | Quality | Speed | npm Support | Notes |
|-----------|---------|-------|-------------|-------|
| **Louvain** | Good | Very fast | `graphology-communities-louvain` | Standard choice, widely validated |
| Leiden | Better | Fast | **None on npm** | Fixes Louvain's disconnected community issue; Python only |
| Label Propagation | OK | Very fast | None (research) | Less accurate in practice |
| Spectral Clustering | Good | Slow | None | Requires matrix eigendecomposition; not viable in JS |

**Decision: Use `graphology-communities-louvain`.** It is the only production-quality community detection package in the JS/TS ecosystem.

### Louvain Algorithm

Two-phase iterative modularity optimization:
1. **Local moving:** Move each node to the neighbor community that maximizes modularity gain
2. **Aggregation:** Collapse communities into super-nodes, repeat

Near-linear time complexity O(n log n). Benchmarks: ~52ms for 1000-node graph.

**API:**
```typescript
import louvain from 'graphology-communities-louvain';

// Assign community attribute to each node
louvain.assign(graph, {
  resolution: 1.0,        // >1 = more/smaller communities
  getEdgeWeight: 'weight',
  fastLocalMoves: true,
});

// Get statistics
const result = louvain.detailed(graph);
// result.count (community count), result.modularity, result.communities
```

### Sources

- [graphology-communities-louvain docs](https://graphology.github.io/standard-library/communities-louvain.html)
- [Louvain method — Wikipedia](https://en.wikipedia.org/wiki/Louvain_method)
- [From Louvain to Leiden — Nature Scientific Reports](https://www.nature.com/articles/s41598-019-41695-z)

---

## 4. TypeScript Graph Analysis Libraries

### Primary Recommendation: `graphology`

Graphology is the definitive TypeScript/JS graph library (2025). It underpins Sigma.js, ships native TypeScript declarations, and has a comprehensive standard library.

**Core package + standard library:**

```bash
npm install graphology
npm install graphology-communities-louvain  # community detection
npm install graphology-metrics              # centrality (betweenness, pagerank, etc.)
npm install graphology-operators            # subgraph extraction, union, intersection
npm install graphology-shortest-path       # Dijkstra, BFS
npm install graphology-traversal           # BFS/DFS iteration
npm install graphology-components          # connected components
```

**Key APIs:**

```typescript
import Graph from 'graphology';
import { subgraph } from 'graphology-operators';
import { centrality } from 'graphology-metrics';

// Build weighted graph
const graph = new Graph({ type: 'undirected', multi: false });
graph.addNode('project:github.com/user/repo', { type: 'project' });
graph.addEdge('source', 'target', { weight: 7.5 });

// Subgraph extraction
const sub = subgraph(graph, ['A', 'B', 'C']);
const sub2 = subgraph(graph, (key, attrs) => attrs.weight > 5);

// Centrality
centrality.betweenness.assign(graph, { normalize: true });
const pr = centrality.pagerank(graph, { alpha: 0.85 });
```

### Alternatives

| Library | Verdict |
|---------|---------|
| ngraph | Lighter; lacks algorithm breadth; no TS types |
| jsnx | Unmaintained since ~2019; avoid |
| @graphty/algorithms | Emerging (2024-2025); watch for future use |
| vis-network / sigma.js | Visualization only; use graphology underneath |

### Sources

- [graphology GitHub](https://github.com/graphology/graphology)
- [graphology standard library](https://graphology.github.io/standard-library/)
- [graphology-metrics npm](https://www.npmjs.com/package/graphology-metrics)

---

## 5. Learning Recommendation System Patterns

### Signal Types for Underutilized Skill Detection

| Signal | Method | Meaning |
|--------|--------|---------|
| **Usage frequency** | `raw_count` per skill node | Raw underuse |
| **Betweenness centrality** | `centrality.betweenness` | Bridge skills connecting clusters — high value |
| **PageRank** | `centrality.pagerank` | Importance weighted by neighbor importance |
| **Co-occurrence gaps** | Neighbors of known skills not in user set | Adjacent skills user hasn't adopted |
| **Recency decay** | Time-weighted `last_seen` | Dormant high-value skills |
| **Community membership** | Louvain communities | Partial cluster adoption — suggest rest of cluster |

### No-ML Recommendation Patterns

**Pattern 1: Graph Neighborhood Gap**
```typescript
// Skills adjacent to user's skills not yet adopted
const adjacentUnused = graph.neighbors(usedSkillNode)
  .filter(n => !userSkills.has(n))
  .sort((a, b) => graph.getEdgeAttribute(a, 'weight') - ...);
```

**Pattern 2: Centrality-Based Prioritization**
- Compute betweenness centrality; recommend high-betweenness skills not in user's set
- High-betweenness = "bridge" skills that unlock access to many other skills

**Pattern 3: Community Detection for Cluster Recommendations**
- Run Louvain; find communities user is partially in; recommend most-used skills from that community

**Pattern 4: Frequency + Recency**
- High centrality + low recency = "dormant high-value" — surface as reminder

**Pattern 5: Co-occurrence Gap Matrix**
- For each skill pair the user has, find common graph-neighbors they're missing

### Sources

- [PLOS Complex Systems — Skills co-occurrence in UK job adverts](https://journals.plos.org/complexsystems/article/figures?id=10.1371/journal.pcsy.0000028)
- [Google ML Recommendation — Collaborative filtering basics](https://developers.google.com/machine-learning/recommendation/collaborative/basics)
- [Neo4j betweenness centrality — production patterns](https://neo4j.com/docs/graph-data-science/current/algorithms/betweenness-centrality/)

---

## 6. Testing Conventions for 06-notebooklm-integration

Following project conventions:
- **Framework:** Vitest, `globals: false`, `environment: 'node'`
- **Unit tests:** Pure functions (cluster scoring, document generation, recommendation scoring) — fast, no I/O
- **Integration tests:** Real `weights.json` reads, real cluster detection on fixture data
- **Mocking:** Mock NotebookLM API calls in unit tests; use real data fixtures for integration
- **File:** `tests/*.test.ts`
- **Script:** `"test": "vitest run"`
