# DevNeural

A living neural network of everything you build — projects, tools, skills, and their interconnections. DevNeural tracks every dependency, connection, and pattern across your entire dev ecosystem, then gives Claude the intelligence to reference that graph when starting new work.

---

## What It Does

DevNeural is not just a visualizer — it is a neural network Claude actively uses. It tracks every skill invocation, repo reference, and tool usage across all your projects, building a weighted dependency graph over time. When starting a new project, Claude queries DevNeural to surface existing tools, skills, and patterns — preventing duplicate work and unlocking cross-project intelligence.

- **Claude-native intelligence** — Claude queries the graph at session start to recommend relevant repos, skills, and tools
- **3D orb visualization** — floating VS Code webview panel rendering the neural network in real time
- **Connection strength** — active connections pulse and glow; color-coded by intensity (cool → warm = weak → strong)
- **Voice interface** — natural language queries ("What's connected to this project?", "What skills are we using most?")
- **NotebookLM integration** — auto-generates Obsidian notes and training materials from high-dependency clusters

---

## Architecture

```
Claude Code (any project)
  → PostToolUse hook
  → C:\dev\data\skill-connections\logs\
  → weights.json (0–10 scale per connection pair)
  → 02-api-server reads + streams via WebSocket
  → 03-web-app renders orb in VS Code webview
  → 04-session-intelligence injects context at session start
```

| Module | Purpose |
|---|---|
| `01-data-layer` | Hook runner — intercepts Claude tool events, writes logs and weights |
| `02-api-server` | Fastify REST + WebSocket server — serves graph data to all consumers |
| `03-web-app` | Three.js orb — VS Code webview panel |
| `04-session-intelligence` | SessionStart hook — injects top connections into every Claude session |
| `05-voice-interface` | NL query layer — routes voice queries to API calls |
| `06-notebooklm-integration` | Obsidian sync — generates session summaries from logs |

Shared runtime data lives **outside this repo** at `C:\dev\data\skill-connections\` so every project on the machine can write to it.

---

## Prerequisites

- **Node.js 18+**
- **npm 9+**
- **Claude Code CLI** (installed and configured)
- Windows 10/11 (paths in `start.bat` and default config are Windows-specific; other platforms require manual path adjustment)

---

## Setup

### 1. Clone and place the repo

The built artefacts are served from `C:\dev\tools\DevNeural`. Clone to your preferred projects location:

```bash
git clone https://github.com/Omnib0mb3r/DevNeural c:/dev/Projects/DevNeural
```

### 2. Create the shared data directory

```bash
mkdir -p "C:/dev/data/skill-connections/logs"
```

This directory holds `weights.json` and raw event logs. It is **not** inside the repo — every project on the machine writes here.

### 3. Install dependencies for each module

Run from the repo root:

```bash
cd c:/dev/Projects/DevNeural

cd 01-data-layer && npm install && cd ..
cd 02-api-server && npm install && cd ..
cd 03-web-app && npm install && cd ..
cd 04-session-intelligence && npm install && cd ..
cd 05-voice-interface && npm install && cd ..
cd 06-notebooklm-integration && npm install && cd ..
```

### 4. Build all modules

```bash
cd 01-data-layer && npm run build && cd ..
cd 02-api-server && npm run build && cd ..
cd 03-web-app && npm run build && cd ..
cd 04-session-intelligence && npm run build && cd ..
cd 05-voice-interface && npm run build && cd ..
cd 06-notebooklm-integration && npm run build && cd ..
```

### 5. Wire the Claude hooks

Register the PostToolUse hook (data layer) and SessionStart hook (session intelligence) into `~/.claude/settings.json`:

```bash
# PostToolUse hook — logs every tool call
# Add this manually to ~/.claude/settings.json hooks section,
# pointing to: node "C:/dev/tools/DevNeural/01-data-layer/dist/hook-runner.js"

# SessionStart hook — auto-installs via script:
cd 04-session-intelligence
npm run install-hook
```

The `install-hook` script is idempotent — safe to run again after rebuilds.

After registration, start a new Claude Code session. The session start banner will show:

```
DevNeural Context for <project-id>:
  Skills (top connections): ...
```

### 6. Add a devneural.json to each tracked project

Place a `devneural.json` at the root of every project you want to appear in the graph:

```json
{
  "name": "MyProject",
  "localPath": "C:/dev/Projects/MyProject",
  "githubUrl": "https://github.com/youruser/MyProject",
  "stage": "alpha",
  "tags": [],
  "description": "Short description shown in the orb tooltip"
}
```

**Fields:**

| Field | Required | Values |
|---|---|---|
| `name` | yes | Display label in the orb |
| `localPath` | yes | Absolute path to the project root |
| `githubUrl` | yes | Canonical GitHub URL — used as the node ID |
| `stage` | yes | `alpha` \| `beta` \| `deployed` \| `archived` |
| `tags` | yes | `[]` or `["revision-needed"]` or `["sandbox"]` |
| `description` | yes | Short tooltip text |

The API server watches for `devneural.json` changes and rebuilds the graph automatically.

---

## Running

### Quick start (Windows)

Double-click `start.bat` or run from a terminal:

```bat
start.bat
```

This kills any existing processes on ports 3747 and 5173, starts the API server and web app in separate terminal windows, and opens the browser.

### Manual start

```bash
# Terminal 1 — API server (port 3747)
cd 02-api-server && npm run dev

# Terminal 2 — Web app / orb (port 5173)
cd 03-web-app && npm run dev
```

Then open `http://localhost:5173` in your browser, or open it in the VS Code webview panel.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DEVNEURAL_DATA_ROOT` | `C:/dev/data/skill-connections` | Override the shared data directory |
| `DEVNEURAL_API_URL` | _(none)_ | Override full API base URL for session-intelligence |
| `DEVNEURAL_PORT` | `3747` | Override API port when `DEVNEURAL_API_URL` is not set |

---

## Updating

After pulling new commits:

```bash
cd 01-data-layer && npm install && npm run build && cd ..
cd 02-api-server && npm install && npm run build && cd ..
cd 03-web-app && npm install && npm run build && cd ..
cd 04-session-intelligence && npm install && npm run build && npm run install-hook && cd ..
cd 05-voice-interface && npm install && npm run build && cd ..
cd 06-notebooklm-integration && npm install && npm run build && cd ..
```

Re-running `npm run install-hook` after a session-intelligence update is safe — it is idempotent.

---

## NotebookLM / Obsidian sync (06)

Copy the example config and fill in your paths:

```bash
cp 06-notebooklm-integration/config.example.json 06-notebooklm-integration/config.json
```

Edit `config.json`:

```json
{
  "vault_path": "C:/Users/you/Documents/ObsidianVault",
  "notes_subfolder": "DevNeural/Projects",
  "data_root": "C:/dev/data/skill-connections",
  "api_base_url": "http://localhost:3747",
  "prepend_sessions": true,
  "claude_model": "claude-haiku-4-5-20251001"
}
```

Run a sync:

```bash
cd 06-notebooklm-integration && npm run dev
```

Requires a valid `ANTHROPIC_API_KEY` environment variable.

---

## Tests

Each module has its own test suite:

```bash
cd 01-data-layer && npm test
cd 02-api-server && npm test
cd 03-web-app && npm test
cd 04-session-intelligence && npm test
cd 05-voice-interface && npm test
cd 06-notebooklm-integration && npm test
```

---

## Troubleshooting

**API server not responding**
Check that port 3747 is free: `netstat -aon | findstr :3747`

**Session start shows "API offline"**
The `04-session-intelligence` hook fires before the API server is running. Start the API server first, then open a new Claude session.

**Orb shows no nodes**
Verify at least one `devneural.json` file is present in a directory under `localReposRoot` and that the API server is running. Check stderr in the API server terminal for validation warnings.

**Hook not firing**
Confirm `~/.claude/settings.json` contains a `SessionStart` entry pointing to `session-start.js`. Restart Claude Code — hook config is read at session startup, not hot-reloaded.

**Port 5173 already in use**
`start.bat` kills it automatically. For manual starts: `npx kill-port 5173`

---

*Michael Collins // Stay on the level.*
