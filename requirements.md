# DevNeural — Requirements

## Project Description

DevNeural is a living neural network that tracks every skill invocation, repo reference, and tool usage across all Claude Code projects. It builds a weighted dependency graph over time and gives Claude the intelligence to reference that graph when starting new work — surfacing relevant tools, skills, and patterns to prevent duplicate effort and unlock cross-project intelligence.

---

## Goals

- Track connections between projects, skills, and tools across the entire dev ecosystem
- Visualize the dependency graph as a 3D neural network in a floating VS Code panel
- Give Claude queryable access to the graph at session start for relevant context recommendations
- Support voice-based querying of the network
- Generate training materials from high-dependency clusters via NotebookLM integration

---

## Feature Requirements

### 1. Connection Logger
- Intercept Claude Code hook events (skill invocations, repo references, tool usage)
- Write structured invocation logs to `C:\dev\data\skill-connections\logs\`
- Log format should capture: timestamp, project, skill/tool name, session ID, connection type

### 2. Weights & Metadata Layer
- Maintain `C:\dev\data\skill-connections\weights.json`
- Connection strengths on a 0–10 scale per project/skill/tool pair
- Weights increase with repeated co-occurrence; decay over time (optional)
- JSON schema must be versioned and extensible

### 3. Three.js Neural Network Visualization
- Floating VS Code panel (webview) showing the full graph
- Nodes: projects, skills, tools
- Edges: connections with weight-based color coding (cool → warm = weak → strong)
- Active connections pulse and glow in real time
- Uniform line thickness; color encodes intensity (not thickness)
- Real-time updates via WebSocket

### 4. REST / WebSocket API Server
- Serves graph data to the VS Code panel
- WebSocket endpoint for real-time connection events
- REST endpoints for querying subgraphs, top connections, node details
- Reads from `weights.json` and the logs directory

### 5. Claude Session Intelligence
- At session start, Claude queries the API for nodes related to the current project
- Returns ranked list of relevant repos, skills, and tools
- Claude surfaces these recommendations before starting work

### 6. Voice Interface
- Voice query support: "What's connected to this project?", "What skills are we using most?"
- Integrates with Claude Voice workflow
- Voice session logs feed back into the connection graph

### 7. NotebookLM Integration
- Detect high-dependency clusters in the graph
- Auto-generate training materials (structured notes, summaries) from those clusters
- Recommendation engine suggests learning resources based on usage patterns

---

## Data Architecture

```
C:\dev\data\skill-connections\       ← shared data root (outside repo)
  weights.json                        ← connection strengths (0-10)
  logs\                               ← raw invocation event logs

DevNeural/
  src/
    logger/     ← reads Claude hook events, writes to shared data root
    neural/     ← Three.js visualization engine
    voice/      ← voice query interface
    api/        ← REST/WebSocket server
  data/         ← symlink or pointer to shared data root
```

---

## Constraints & Context

- Shared data lives at `C:\dev\data\skill-connections\` so all projects can write to it
- The VS Code panel must be non-blocking (floating, dismissible)
- Logger must be lightweight — no impact on Claude Code session startup time
- The project is intended to be marketable to Claude Code users with multiple projects
- Can be embedded on onthelevelconcepts.com as a living ecosystem map
- Integrates into a Claude training program

---

## Build Sequence (Known)

1. Connection logger + JSON schema
2. Wire Claude Code hooks to write invocation events
3. Three.js neural network visualization
4. WebSocket server for real-time updates
5. Voice interface
6. NotebookLM integration

---

*Michael Collins_ // Stay on the level.*
