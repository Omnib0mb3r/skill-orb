# Claude Research: 05-voice-interface

Generated during /deep-plan session. Combines codebase analysis and web research.

---

## Part 1: Codebase Research

### 1.1 Data Layer Integration (01-data-layer)

**Module system**: CommonJS (`"module": "CommonJS"`, strict mode, ES2022 target, tsc → `/dist`).

**Log writing interface** — the two functions needed:

```typescript
// src/logger/index.ts
appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void>
buildLogEntry(payload, identity, connectionType, ...): LogEntry
```

`LogEntry` shape (relevant fields for voice):
```typescript
interface LogEntry {
  schema_version: 1;
  timestamp: string;           // ISO 8601 UTC
  session_id: string;
  tool_use_id: string;
  project: string;             // canonical project id (no prefix)
  connection_type: ConnectionType;  // 'project->tool' | 'project->skill' | 'project->project'
  source_node: string;         // "project:<id>"
  target_node: string;         // "tool:<name>", "skill:<name>", etc.
  tool_name: string;
  tool_input: Record<string, unknown>;
  stage?: string;
  tags?: string[];
}
```

`ConnectionType`: `'project->tool' | 'project->skill' | 'project->project'`

Weight capping: `Math.min(raw_count, 100) / 100 * 10` → [0.0, 10.0]

**Data root**: `C:\dev\data\skill-connections\` (outside repo), with `logs\YYYY-MM-DD.jsonl` daily files.

**Concurrency**: Uses `write-file-atomic` + `proper-lockfile` — voice logger should follow the same pattern.

### 1.2 API Server (02-api-server)

**Module system**: ESM (`"type": "module"`, NodeNext resolution). Server runs at port 3747 (env: `PORT` or `DEVNEURAL_API_URL`).

**Available REST endpoints**:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | `{status:'ok', uptime}` — ping check |
| `GET /graph` | Full graph (all nodes + edges) |
| `GET /graph/node/:id` | Single node + its edges |
| `GET /graph/subgraph?project=<id>` | Edges connected to a project |
| `GET /graph/top?limit=10` | Top N edges by weight |
| `GET /events?limit=50` | Recent log entries |

Node id format: `"project:github.com/user/repo"`, `"tool:Bash"`, `"skill:gsd:execute-phase"`.

**GraphEdge shape**:
```typescript
interface GraphEdge {
  source: string;  target: string;  weight: number;
  connection_type: ConnectionType;  raw_count: number;
  first_seen: string;  last_seen: string;
}
```

### 1.3 Session Intelligence Patterns (04-session-intelligence)

**API client pattern** (`src/api-client.ts`):
```typescript
// Safe fetch: returns null on error, no throws
async function fetchSubgraph(projectId: string, config: ApiClientConfig): Promise<GraphResponse | null>
```

**Formatter pattern** (`src/formatter.ts`):
```typescript
// Pure function, groups by skill vs project connections
function formatSubgraph(projectId, response, config: FormatterConfig): string
// FormatterConfig: { maxResultsPerType: number, minWeight: number }
```

- Filters by source node, connection type, weight threshold
- Groups results by type (skills vs project connections)
- Uses relative timestamps ("today", "3 days ago")
- Returns multiline readable text

**Entry point pattern** (`src/session-start.ts`):
1. Reads JSON payload from stdin
2. Resolves project identity from cwd
3. Calls API
4. Formats response
5. Writes to stdout

Voice interface should follow this same orchestration pattern.

### 1.4 Testing Setup

- **Framework**: Vitest (v1.6.0+), `vitest run` for CI, `vitest` for watch mode
- **Config**: `vitest.config.ts` in each split root
- **Test location**: `tests/*.test.ts`
- **Patterns**:
  - `createTempDir()` / `removeTempDir()` for sandbox tests
  - `pollUntil()` for async watcher tests
  - subprocess tests via `spawnSync` with `tsx`

### 1.5 Module System Decision for 05

**Recommendation: CommonJS** — align with 01-data-layer and 04-session-intelligence (the two splits we directly reuse patterns from). HTTP calls to 02-api-server (ESM) work fine across the CJS/ESM boundary.

### 1.6 Identifier & Convention Summary

- Project IDs in API calls: `"github.com/user/repo"` (no prefix)
- Node IDs in graph: `"project:..."`, `"tool:..."`, `"skill:..."`
- Connection keys: `"source||target"` (ASCII, not Unicode — Windows cp1252 issue)
- Skill names: kebab-case or `namespace:kebab-case`
- Env vars: `DEVNEURAL_API_URL`, `DEVNEURAL_DATA_ROOT`

---

## Part 2: Web Research

### 2.1 Claude Voice Workflow — What It Actually Is

**Critical finding**: Claude Code voice mode is **dictation-to-text only** — not a voice API.

- Push-to-talk → cloud transcription → text inserted into CLI prompt
- Tools, MCP servers, hooks, and slash commands receive the transcribed text **exactly like typed input**
- No TTS output: Claude Code does not speak responses
- No programmatic voice API or hook — the integration point is standard text I/O
- Works only with Claude.ai account auth (not API key, Bedrock, or Vertex)

**Implication for 05-voice-interface**: The "Claude Voice integration" in the spec means a module that:
1. Accepts text strings (the transcribed query) as input
2. Returns text strings (the formatted response) as output
3. Has no special voice protocol — it's just a text processor

If a standalone voice interface is desired (outside Claude Code), it requires external STT (Whisper, Deepgram) and TTS (ElevenLabs, Google TTS) — not provided by Claude.

### 2.2 NL Intent Parsing Approaches

#### Approach 1: Claude Haiku + Structured Output (Recommended for Cloud)

Fastest path, most accurate, lowest setup friction:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const IntentSchema = z.object({
  intent: z.enum(["get_connections", "list_top", "get_node", "get_subgraph", "unknown"]),
  confidence: z.number().min(0).max(1),
  entities: z.object({
    projectId: z.string().optional(),
    skillName: z.string().optional(),
    limit: z.number().optional(),
  }),
});

// Uses constrained decoding — guaranteed schema compliance, no retries needed
const response = await client.messages.parse({
  model: "claude-haiku-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: voiceQueryText }],
  output_config: { format: zodOutputFormat(IntentSchema) },
});
```

Cost: ~$0.0001/query (Haiku 4.5). Latency: 300–800ms.

#### Approach 2: Offline Hybrid (for Local/Offline Mode)

Two-stage pipeline:
1. `compromise` or `wink-nlp` for fast entity/verb extraction
2. `natural.BayesClassifier` for intent routing from those extractions

```typescript
import natural from "natural";
const classifier = new natural.BayesClassifier();
// Train on domain examples: "show me connections", "what's connected to..."
classifier.addDocument("what skills am I using", "list_top");
classifier.addDocument("show connections for this project", "get_subgraph");
classifier.train();

const intent = classifier.classify(voiceQueryText); // sub-millisecond
```

#### Library Comparison

| Library | Best For | Bundle | Speed | Offline |
|---------|---------|--------|-------|---------|
| `@anthropic-ai/sdk` + Haiku | General, high accuracy | Network | 300–800ms | No |
| `wink-nlp` | Entity extraction, pre-processing | <3MB model | 650K tokens/sec | Yes |
| `compromise` | English entity/verb extraction | ~250KB | 1MB text/sec | Yes |
| `natural` | Bayesian intent classification | ~2MB | Sub-ms | Yes |
| `@xenova/transformers` | Zero-shot BERT | 25–100MB | 200–500ms | After download |

**Recommendation**: Hybrid pipeline — pattern matching fast-path for well-known queries, Claude Haiku fallback for ambiguous ones. Pure offline with natural.BayesClassifier for the voice session logging use case.

### 2.3 REST API Integration Patterns

#### Intent Registry Pattern (Recommended)

```typescript
const intentMap: Record<string, (entities: Entities) => RequestConfig> = {
  "get_connections": (e) => ({ url: `/graph/node/${encodeURIComponent(e.nodeId)}` }),
  "get_subgraph":    (e) => ({ url: `/graph/subgraph?project=${encodeURIComponent(e.projectId)}` }),
  "list_top":        (e) => ({ url: `/graph/top?limit=${e.limit ?? 10}` }),
  "get_node":        (e) => ({ url: `/graph/node/${encodeURIComponent(e.nodeId)}` }),
};
```

#### Confidence Thresholds

| Range | Action |
|-------|--------|
| < 0.60 | Ask user to rephrase |
| 0.60–0.85 | Confirm before executing ("Did you mean...?") |
| ≥ 0.85 | Execute directly |

#### Voice-Specific Error Handling

All errors must produce speakable responses — never expose status codes or stack traces:

```typescript
const voiceErrors = {
  LOW_CONFIDENCE: "I'm not sure I understood. Could you rephrase?",
  UNKNOWN_INTENT: "I'm not sure what you'd like to do. Try 'show connections' or 'what skills am I using'.",
  API_ERROR:       "I couldn't reach the DevNeural graph right now.",
  MISSING_ENTITY:  "Which project are you referring to?",
};
```

#### Session State

Voice sessions need context carry-forward for pronouns ("show me the next one", "tell me more about that"). Maintain a lightweight session state with last intent, last result, and last entities.

### 2.4 Voice Response Formatting for TTS

**Core rules**:
1. Strip all markdown: `**bold**`, `*italic*`, `# headers`, `` `code` ``, `[links](url)`, bullet characters
2. Never speak URLs — paraphrase as "the documentation link"
3. Target 1–3 sentences per response
4. Spell out abbreviations: `&` → "and", `%` → "percent", `#` → "number"
5. Use commas for natural breath pauses in lists
6. Avoid dashes, parentheses, brackets

**LLM-to-spoken-prose conversion** (recommended over manual string manipulation):

```typescript
const spokenResponse = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 150,  // enforce brevity
  system: `Convert data to natural spoken English. Rules:
    - Maximum 2 sentences
    - No markdown, no bullets, no URLs
    - Spell out abbreviations
    - Use conversational tone`,
  messages: [{ role: "user", content: JSON.stringify(apiResult) }],
});
```

**SSML** (only when driving Google/AWS/Azure TTS directly):
```xml
<speak>
  <s>You have <say-as interpret-as="cardinal">12</say-as> connections.</s>
  <break time="300ms"/>
  <s>The strongest is to skill <say-as interpret-as="characters">gsd</say-as>.</s>
</speak>
```

### 2.5 Offline / Local NL Processing

**wink-nlp** — recommended default for offline pre-processing:
- <3MB model, MIT license, zero external dependencies
- 650,000 tokens/sec, <80MB RAM
- Custom Entity Recognition (CER) for domain-specific terms
- Needs `esModuleInterop: true` and `allowSyntheticDefaultImports: true` in tsconfig

**compromise** — English-only entity/verb extraction:
- ~250KB, grammar-based POS matching
- Best for extracting "what the user is talking about" (entities + key verbs)
- No intent classification built-in — combine with lookup table

**natural.BayesClassifier** — quick offline intent classification:
- 10–20 training examples per intent is sufficient for narrow domains
- Sub-millisecond inference, no model files needed
- Good fit for DevNeural's bounded intent set (~5–8 intents)

**Trade-off summary**:
- Latency wins: local (<1ms) vs cloud (300–800ms)
- Accuracy wins: cloud (open domain) vs local (narrow, well-trained domain)
- DevNeural voice has a narrow, well-defined intent space → local is viable

---

## Part 3: Testing Plan

### Framework
- **Vitest** (consistent with all splits)
- `vitest.config.ts` with `environment: 'node'`, `testTimeout: 15000`
- Tests in `tests/*.test.ts`

### Test Coverage Plan

1. **Intent parsing unit tests**:
   - Each intent type correctly parsed from example phrases
   - Confidence thresholds applied correctly
   - Unknown intent returns "unknown" gracefully

2. **API client integration tests** (mock API or live):
   - Intent-to-endpoint mapping
   - Graceful null return on API failure

3. **Response formatter unit tests**:
   - Markdown stripped from output
   - Length limits respected
   - Spoken prose output (no special characters)

4. **Log writing tests**:
   - Voice query writes correct LogEntry shape
   - source_node/target_node set correctly for voice queries
   - appendLogEntry called with correct dataRoot

5. **Entry point integration tests** (subprocess pattern like 04):
   - Input text → intent → API call → formatted response → logged
   - Graceful degradation when API is offline

### Testing Approach Notes
- Mock the API server (return fixture JSON) for unit tests — no live server needed
- Integration test: spin up real API server against temp data directory
- Follow subprocess testing pattern from 04-session-intelligence
