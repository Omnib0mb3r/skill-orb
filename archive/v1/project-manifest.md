<!-- SPLIT_MANIFEST
01-data-layer
02-api-server
03-vscode-extension
04-session-intelligence
05-voice-interface
06-notebooklm-integration
END_MANIFEST -->

# DevNeural — Project Manifest

## Overview

DevNeural decomposes into 6 splits, each mapping to a distinct system with clear boundaries. The data layer is the MVP and the foundation everything else depends on. Splits 05 and 06 can run in parallel once the API server is complete.

---

## Splits

### 01-data-layer (MVP)
**Purpose:** Capture connection events and maintain the weighted dependency graph.

- TypeScript connection logger that intercepts Claude Code hook events
- Hook wiring: PostToolUse + skill wrapper hooks defined in settings.json
- Structured log format: `{ timestamp, project, skill/tool name, session ID, connection type }`
- Maintains `C:\dev\data\skill-connections\weights.json` with 0–10 connection strengths per project/skill/tool pair
- Versioned JSON schema for weights and logs
- Shared data root lives outside this repo: `C:\dev\data\skill-connections\`

**Inputs:** Claude Code hook events (PostToolUse, skill wrappers)
**Outputs:** Structured log files, weights.json

---

### 02-api-server
**Purpose:** Serve graph data to all consumers via REST and WebSocket.

- Node.js/TypeScript server (Express or Fastify)
- REST endpoints: graph data, subgraph queries, top connections, node details
- WebSocket endpoint for real-time connection events
- Reads from `weights.json` and logs directory in shared data root
- Emits events when new connections are logged

**Inputs:** weights.json + log files from 01-data-layer
**Outputs:** REST JSON responses, WebSocket event stream

**Depends on:** 01-data-layer (schema + data root)

---

### 03-vscode-extension
**Purpose:** Floating VS Code panel with live 3D neural network visualization.

- Proper VS Code extension (.vsix) with package.json
- Webview panel rendering Three.js 3D graph
- Nodes: projects, skills, tools
- Edges: color-coded by weight (cool → warm = weak → strong), uniform thickness
- Active connections pulse and glow in real time
- Connects to API server via WebSocket for live updates
- Panel is non-blocking and dismissible

**Inputs:** WebSocket stream from 02-api-server
**Outputs:** Visual panel in VS Code

**Depends on:** 02-api-server (WebSocket contract)

---

### 04-session-intelligence
**Purpose:** Surface relevant context to Claude at the start of every session.

- SessionStart hook in settings.json, fires on every Claude Code session open
- Queries the API for nodes related to the current project directory
- Returns ranked list of relevant repos, skills, and tools
- Formats recommendations as Claude-readable context
- Must work universally across all projects (configured globally)

**Inputs:** Current project path, API server
**Outputs:** Structured context injected into Claude's session

**Depends on:** 02-api-server (query endpoints)

---

### 05-voice-interface
**Purpose:** Natural language querying of the neural network.

- Voice query support: "What's connected to this project?", "What skills are we using most?"
- Integrates with existing Claude Voice workflow
- Translates NL queries to API calls, formats responses for voice output
- Voice session logs feed back into connection graph via 01-data-layer

**Inputs:** Voice input, API server
**Outputs:** Spoken query results, new connection log entries

**Depends on:** 02-api-server (query endpoints), 01-data-layer (log write-back)

---

### 06-notebooklm-integration
**Purpose:** Auto-generate training materials from high-dependency clusters.

- Graph cluster detection algorithm (identify high-weight subgraphs)
- Auto-generate structured notes and summaries for each cluster
- NotebookLM API integration for training material creation
- Recommendation engine: suggest learning resources based on usage patterns

**Inputs:** weights.json + log files from 01-data-layer (or via API)
**Outputs:** Structured training documents, NotebookLM sources

**Depends on:** 01-data-layer (schema), optionally 02-api-server (graph query)

---

## Dependency Map

```
01-data-layer (MVP — build first)
  └── 02-api-server
        ├── 03-vscode-extension
        ├── 04-session-intelligence
        └── 05-voice-interface (also writes back to 01)

01-data-layer
  └── 06-notebooklm-integration (can also use 02-api-server)
```

## Execution Order

| Phase | Splits | Parallel? |
|-------|--------|-----------|
| 1 | 01-data-layer | — |
| 2 | 02-api-server | — |
| 3 | 03-vscode-extension, 04-session-intelligence | Yes |
| 4 | 05-voice-interface, 06-notebooklm-integration | Yes |

---

## Next Steps

After approval, run `/deep-plan` for each split in order:

```
/deep-plan @01-data-layer/spec.md
/deep-plan @02-api-server/spec.md
/deep-plan @03-vscode-extension/spec.md
/deep-plan @04-session-intelligence/spec.md
/deep-plan @05-voice-interface/spec.md
/deep-plan @06-notebooklm-integration/spec.md
```
