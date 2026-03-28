# DevNeural

A living neural network of everything you build — projects, tools, skills, and their interconnections. DevNeural tracks every dependency, connection, and pattern across your entire dev ecosystem, then gives Claude the intelligence to reference that graph when starting new work.

---

## Concept

DevNeural is more than a visualizer — it's a neural network Claude actively uses. It tracks every skill invocation, repo reference, and tool usage across all your projects, building a weighted dependency graph over time. When starting a new project, Claude queries DevNeural to surface existing tools, skills, and patterns that are relevant — preventing duplicate work and unlocking cross-project intelligence.

---

## Key Features

- **Claude-native intelligence** — Claude queries the graph at session start to recommend relevant repos, skills, and tools for the current project
- **Floating VS Code panel** — 3D neural network visualization visible while you work
- **Connection strength visualization** — active connections pulse and glow; stronger dependencies shift to warmer colors (uniform line thickness, color-coded intensity)
- **Voice interface** — query the network ("What's connected to this project?", "What skills are we using most?")
- **NotebookLM integration** — auto-generates training materials from high-dependency clusters
- **Training material suggestions** — recommendation engine based on usage patterns

---

## How It Works

1. **Connection logger** tracks every skill invocation across projects
2. **Metadata layer** (JSON) maintains connection weights (0–10 scale)
3. **Three.js frontend** visualizes the neural network with real-time updates
4. **Claude references** connection data to prioritize relevant repos when opening new projects
5. **Voice interface** queries the system

---

## Data Flow

```
Claude Code (any project)
  → skill invocation hook
  → C:\dev\data\skill-connections\logs\
  → weights.json (0-10 scale per connection)
  → DevNeural reads + renders in real time
  → Claude queries on session start → recommends relevant context
```

Voice sessions from Claude Voice workflow feed into the network as conversation logs, enriching the dependency model over time.

---

## File Structure

```
DevNeural/
  src/
    logger/       ← connection logger (reads Claude hook events)
    neural/       ← Three.js neural network visualization engine
    voice/        ← voice query interface
    api/          ← REST/WebSocket server
  data/           ← local dev data (symlink or pointer to C:\dev\data\skill-connections\)
```

---

## Shared Data

Runtime data lives **outside this repo** at `C:\dev\data\skill-connections\` so all projects can write to it.

```
C:\dev\data\skill-connections\
  weights.json    ← connection strengths (0-10 per project pair)
  logs\           ← raw invocation logs
```

---

## Build Sequence

1. Create connection logger + JSON schema
2. Wire Claude Code hooks in `claude-setup` to write invocation events
3. Build Three.js neural network visualization
4. Add WebSocket server for real-time updates
5. Add voice interface
6. NotebookLM integration

---

## Product Angle

Marketable to developers using Claude Code across multiple projects. Can be embedded on onthelevelconcepts.com as a living ecosystem map and integrated into the Claude training program.

---

*Michael Collins_ // Stay on the level.*
