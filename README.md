# Skill Orb

Real-time 3D visualization of cross-project skill and dependency connections in Claude Code workflows.

---

## Concept

An interactive orb that tracks every time Claude uses a skill from another project, building a live dependency graph over time. Designed for developers working with Claude across multiple repos.

---

## Key Features

- **Floating VS Code panel** — 3D orb visible while you work
- **Connection strength visualization** — active connections pulse and glow; stronger dependencies shift to warmer colors (uniform line thickness, color-coded intensity)
- **Voice interface** — query the orb ("What's our status?", "How many products?")
- **NotebookLM integration** — auto-generates training materials from high-dependency clusters
- **Context recommendations** — helps Claude decide which other repos to pull in for context
- **Training material suggestions** — recommendation engine based on usage patterns

---

## How It Works

1. **Connection logger** tracks every skill invocation across projects
2. **Metadata layer** (JSON) maintains connection weights (0–10 scale)
3. **Three.js frontend** visualizes the orb with real-time updates
4. **Claude references** connection data to prioritize relevant repos
5. **Voice interface** queries the system

---

## Data Flow

```
Claude Code (any project)
  → skill invocation hook
  → C:\dev\data\skill-connections\logs\
  → weights.json (0-10 scale per connection)
  → skill-orb reads + renders in real time
```

Voice sessions from Claude Voice workflow feed into the orb as conversation logs, enriching the dependency model over time.

---

## File Structure

```
skill-orb/
  src/
    logger/       ← connection logger (reads Claude hook events)
    orb/          ← Three.js visualization engine
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
3. Build Three.js orb visualization
4. Add WebSocket server for real-time updates
5. Add voice interface
6. NotebookLM integration

---

## Product Angle

Marketable to developers using Claude Code across multiple projects. Can be embedded on onthelevelconcepts.com as a living ecosystem map and integrated into the Claude training program.

---

*Michael Collins_ // Stay on the level.*
