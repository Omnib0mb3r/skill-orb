# Combined Spec: 03-web-app + 05-voice-interface

Synthesized from: spec.md, claude-research.md, claude-interview.md

---

## What We're Building

A combined implementation of two DevNeural splits:

**03-web-app** — A browser-based web application housing the DevNeural "orb": a Three.js visualization of the live connection graph. Replaces the archived VS Code extension. Serves as the primary visual interface for the DevNeural system.

**05-voice-interface** — A voice-and-text query interface for the DevNeural graph, accessible via a `/voice` Claude Code slash command. Translates natural language queries to API calls, formats responses for readability, and drives the orb visualization in real-time via the existing WebSocket infrastructure.

Both splits are planned and built together because the voice interface's primary output channel IS the orb web app — they are tightly coupled on the output side.

---

## Architecture Overview

```
User (Claude Voice / typed)
       │
       ▼
 /voice slash command
       │
       ▼
05-voice-interface (Node.js, CommonJS)
  ├── NL Intent Parser (local fast-path + Haiku fallback)
  ├── Intent → API Router
  ├── 02-api-server HTTP client
  └── Response formatter (plain text + WebSocket orb event)
       │
       ├── text response → Claude chat
       │
       └── orb event → 02-api-server WebSocket → 03-web-app (Three.js orb)
                                ▲
                    02-api-server (existing)
                    REST + WebSocket (port 3747)
```

The voice interface is **read-only**: it queries the graph but never writes connection data.

---

## 03-web-app: Web Application + Orb Visualization

### Purpose

A locally-running web application that renders the DevNeural connection graph as an interactive Three.js 3D orb. Users can visually browse connections between projects, skills, and tools.

### Key Requirements

1. **Serve the app locally** — Simple HTTP server (no cloud deployment). Runs on a configurable port (default: 3748).

2. **Connect to 02-api-server WebSocket** — On load, connects to `ws://localhost:3747/ws` and subscribes to graph events.

3. **Three.js graph visualization** — Renders nodes (projects, skills, tools) and weighted edges as an interactive 3D force graph. Node types have distinct visual treatments.

4. **Real-time updates** — Reacts to `graph:snapshot` and `connection:new` WebSocket events from 02-api-server. New connections appear without page reload.

5. **Voice command integration** — Listens for `voice:command` events from 02-api-server WebSocket. Reacts by highlighting nodes, filtering the graph, or animating in response to voice queries.

6. **Node interaction** — Click/hover on nodes to see connection details. Focus view on a selected node.

### WebSocket Event Protocol (Extended for Voice)

The 02-api-server needs two new broadcast event types for voice integration:

```typescript
// Existing events (unchanged):
{ type: "graph:snapshot", payload: InMemoryGraph }
{ type: "connection:new", payload: GraphEdge }

// New events for voice:
{ type: "voice:focus", payload: { nodeId: string } }
// → Orb highlights and centers the named node

{ type: "voice:highlight", payload: { nodeIds: string[] } }
// → Orb highlights a set of nodes (e.g., top skills result)

{ type: "voice:clear", payload: {} }
// → Orb returns to default view
```

### Tech Stack

- **Framework**: Vanilla HTML/CSS/JS or minimal bundler (Vite) — keep it lightweight
- **3D library**: Three.js with 3d-force-graph or direct Three.js scene management
- **Language**: TypeScript compiled to static files, or direct JS
- **Dev server**: Vite or a simple `serve` package

---

## 05-voice-interface: Voice Query Handler

### Purpose

Processes natural language queries about the DevNeural graph, routes them to the correct API endpoints, and formats responses for both chat display and orb visualization control.

### Entry Point

A Claude Code skill (slash command) `/voice` that:
1. Accepts a text query (from Claude Voice dictation or typed)
2. Runs intent parsing
3. Queries 02-api-server
4. Formats the response as readable text
5. Sends an orb control event via 02-api-server WebSocket
6. Returns the text response to Claude chat

### Supported Intents (V1 Scope)

| Intent | Example Phrases | API Endpoint |
|--------|-----------------|-------------|
| `get_context` | "what's my project context", "what am I working on" | `GET /graph/subgraph?project=<cwd-project>` |
| `get_top_skills` | "what skills am I using most", "top skills" | `GET /graph/top?limit=10` + filter for skills |
| `get_connections` | "what's connected to [X]", "show connections for [X]" | `GET /graph/node/:id` |
| `get_node` | "show me [X]", "tell me about [X]" | `GET /graph/node/:id` |
| `get_stages` | "what projects are in [stage]", "what's in alpha/beta" | `GET /graph` + filter by stage metadata |
| `unknown` | anything else | Clarification response |

### NL Intent Parsing — Hybrid Pipeline

**Stage 1: Local fast-path** (sub-millisecond, offline)

Pattern-based routing using a small keyword/phrase table:

```
Keywords → Intent mapping:
"context", "working on", "current project" → get_context
"skills", "using most", "top skills" → get_top_skills
"connected", "connections", "links" → get_connections
"stage", "alpha", "beta", "deployed" → get_stages
"show me", "tell me about" → get_node (needs entity)
```

If high-confidence match (>= 1 strong keyword match), route directly.

**Stage 2: Haiku fallback** (when local match fails)

Call Claude Haiku with `zodOutputFormat` structured output:

```typescript
const IntentSchema = z.object({
  intent: z.enum(["get_context", "get_top_skills", "get_connections",
                   "get_node", "get_stages", "unknown"]),
  confidence: z.number(),
  entities: z.object({
    nodeName: z.string().optional(),   // project/skill name mentioned
    stageFilter: z.string().optional(), // "alpha", "beta", etc.
    limit: z.number().optional(),
  }),
});
```

### Project Identity Resolution

Same pattern as 04-session-intelligence:
1. Read current working directory from invocation context
2. Resolve git remote URL → project ID (e.g., `"github.com/mcollins/DevNeural"`)
3. If a project is explicitly named in the query (entity extraction), use that instead

### Response Formatting

- Strip all markdown special characters
- Target 1–3 sentences for short queries
- For list results: "You use 5 skills most heavily. The top is deep-plan with a weight of 8.2, followed by gsd and session-intelligence."
- When API is offline: "The DevNeural graph isn't running. Start it with: node C:/dev/tools/DevNeural/02-api-server/dist/server.js"

### Orb Control Events

After formatting the text response, send a WebSocket event to 02-api-server:

- `get_context` / `get_subgraph` → `voice:focus` on the project node + `voice:highlight` on all connected nodes
- `get_top_skills` → `voice:highlight` on the top skill nodes
- `get_connections` / `get_node` → `voice:focus` on the named node
- `get_stages` → `voice:highlight` on all project nodes matching the stage
- `unknown` → `voice:clear`

### API Server Extensions Required

The 02-api-server needs:
1. A new endpoint or extension so the voice module can broadcast WebSocket events: `POST /voice/command { type, payload }` → broadcasts to all connected WebSocket clients
2. The three new WebSocket event types (`voice:focus`, `voice:highlight`, `voice:clear`)

---

## Dependencies

### 05-voice-interface requires:
- 02-api-server: existing REST endpoints + new `/voice/command` broadcast endpoint
- Node.js, TypeScript (CommonJS like 01, 04)
- `@anthropic-ai/sdk` (Haiku fallback)
- `zod` (structured output schema)
- `natural` (BayesClassifier for local fast-path)

### 03-web-app requires:
- 02-api-server: existing WebSocket (+ new voice event types)
- Three.js (3D graph rendering)
- Vite or similar (dev/build tooling)
- TypeScript (browser target)

---

## What's Out of Scope (V1)

- Writing to the graph (voice is read-only)
- Launching tasks or searching git from voice (future)
- TTS output (Claude voice mode handles text-to-speech if desired)
- Cloud deployment of the web app
- Multi-language support

---

## Architectural Notes

**Why combine 03-web-app + 05 in one plan:**
The voice interface's primary visual output is the orb. Without the web app, voice is just text in a chat window. They are designed to be experienced together. Building the WebSocket event protocol once serves both.

**Why keep 02-api-server as the bridge:**
The 02-api-server already has a WebSocket broadcaster. Adding a `/voice/command` endpoint means voice events flow through the same established channel the orb already listens to. No new server, no new port.

**Why local-first NL parsing:**
The DevNeural intent space is narrow (6 intents). A small BayesClassifier trained on ~20 examples per intent will handle common queries with sub-millisecond latency. Haiku is a fallback for unusual phrasing, keeping API costs near zero.

**Why read-only:**
Voice queries are exploratory and observational. Adding graph noise from "looking at" the graph would dilute the signal that comes from actual tool use. The graph should reflect work activity, not curiosity queries.
