# DevNeural

A living neural network of everything you build — projects, tools, skills, and their interconnections. DevNeural tracks every dependency, connection, and pattern across your entire dev ecosystem, then gives Claude the intelligence to reference that graph when starting new work.

---

## Ecosystem Map

> Every repo, every hook, every external path. Start here if you're lost or setting up a new machine.

### Repos and their roles

| Repo | Role | Stage |
|---|---|---|
| [DevNeural](https://github.com/Omnib0mb3r/DevNeural) | **Graph brain** — API server, orb visualization, session context injection, tool-use logging | infrastructure |
| [devneural-projects](https://github.com/Omnib0mb3r/devneural-projects) | **Project lifecycle** — monday.com MCP, stage sync, task boards, `fill-devneural.mjs` hook | infrastructure |
| [dev-template](https://github.com/Omnib0mb3r/dev-template) | **Project starter** — `devneural.jsonc`, `OTLC-Brainstorm.MD`, `CLAUDE.md` for every new project | infrastructure |
| [Claude-Setup](https://github.com/Omnib0mb3r/Claude-Setup) | **Config backup** — reference copy of `~/.claude/settings.json` and global `CLAUDE.md` | deployed |
| [autolisp-skill](https://github.com/Omnib0mb3r/autolisp-skill) | AutoLISP Claude Code skill — rules and best practices | deployed |
| [blkbom](https://github.com/Omnib0mb3r/blkbom) | AutoLISP Block BOM Generator for AutoCAD | deployed |
| [conveyornum](https://github.com/Omnib0mb3r/conveyornum) | AHK v2 conveyor number keyboard wedge for AutoCAD | deployed |
| [conveyor-designer](https://github.com/Omnib0mb3r/conveyor-designer) | Conveyor system design tool | alpha |
| [Landmark40](https://github.com/Omnib0mb3r/Landmark40) | Landmark Lodge No. 40 official website | deployed |
| [omnibomber-site](https://github.com/Omnib0mb3r/omnibomber-site) | OmniB0mb3r personal brand website | deployed |

### Tag connections (graph edges)

Tags in `devneural.jsonc` are what create edges in the graph. Projects that share tags are connected.

| Tag cluster | Projects |
|---|---|
| `autolisp` · `autocad` | autolisp-skill, blkbom, conveyornum |
| `conveyor` | conveyor-designer, conveyornum |
| `claude` · `skill` | autolisp-skill, Claude-Setup |
| `tool` | blkbom, conveyornum |
| `website` | Landmark40, omnibomber-site |

### How a session flows

```
Claude opens in any project
  │
  ├─ SessionStart: fill-devneural.mjs        [devneural-projects]
  │    └─ auto-fills devneural.jsonc REPLACE_ME values on first run
  │
  ├─ SessionStart: session-start.js          [DevNeural/04-session-intelligence]
  │    └─ queries graph API → injects top skill/project connections into context
  │
  └─ Claude is now running
       │
       ├─ PostToolUse: hook-runner.js        [DevNeural/01-data-layer]
       │    └─ logs every tool call → updates weights.json
       │
       ├─ PreToolUse: devneural-skill-tracker.js  [~/.claude/hooks/ — standalone]
       │    └─ tracks skill invocations
       │
       ├─ stage changes in devneural.jsonc
       │    └─ Claude calls move_project MCP  [devneural-projects] → monday.com
       │
       └─ bug or task identified
            └─ Claude calls add_task MCP      [devneural-projects] → monday.com
```

### External paths (all hard-coded references)

Everything outside a git repo that must exist on the machine:

| Path | What it is | Owned by |
|---|---|---|
| `C:\dev\Projects\DevNeural\` | This repo | DevNeural |
| `C:\dev\Projects\devneural-projects\` | Project lifecycle repo | devneural-projects |
| `C:\dev\data\skill-connections\` | Shared data dir — `weights.json` + logs. Not in any repo. | DevNeural/01 |
| `C:\Users\mcollins\.claude\settings.json` | Global Claude hooks + MCP config | Claude-Setup (backup) |
| `C:\Users\mcollins\.claude\hooks\devneural-skill-tracker.js` | Standalone PreToolUse hook | Claude-Setup (backup) |
| `C:\Users\mcollins\.claude\hooks\gsd-check-update.js` | GSD update check hook | GSD plugin |
| `C:\Users\mcollins\.claude\hooks\gsd-context-monitor.js` | PostToolUse context monitor | GSD plugin |
| `C:\Users\mcollins\.claude\hooks\gsd-prompt-guard.js` | PreToolUse prompt guard | GSD plugin |
| `C:\Users\mcollins\.claude\hooks\gsd-statusline.js` | Status line renderer | GSD plugin |

> For the full migration checklist when moving to a new machine, see [Machine Migration Guide](#machine-migration-guide).

---

## Current State

**Repo:** `C:\dev\Projects\DevNeural` (master branch)

**What's working:**
- API server (`02-api-server`) — Fastify REST + WebSocket on port 3747, Monday sync route wired
- Orb (`03-web-app`) — Three.js visualization, single-click highlight, double-click opens GitHub, auto camera-fit on simulation cool
- Session intelligence (`04-session-intelligence`) — SessionStart hook installed in `~/.claude/settings.json`
- Data layer (`01-data-layer`) — PostToolUse hook logging to `C:\dev\data\skill-connections\`

**To resume:** run `start.bat` from `C:\dev\Projects\DevNeural`, open `http://localhost:5173`

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

## Machine Migration Guide

> If you move DevNeural to a new machine or new path, every item below must be updated. This is the complete list — nothing else outside this table holds a hard-coded path.

### External files that reference this repo

| File | What to update |
|---|---|
| `C:\Users\mcollins\.claude\settings.json` | All hook `command` values pointing to DevNeural (see table below) |
| `C:\Users\mcollins\.claude\hooks\devneural-skill-tracker.js` | Standalone PreToolUse hook — not in this repo, must be copied to new machine manually |

### Hook paths in `~/.claude/settings.json`

| Hook type | Matcher | Command |
|---|---|---|
| `SessionStart` | `startup`, `resume`, `clear`, `compact` | `node "C:/dev/Projects/DevNeural/04-session-intelligence/dist/session-start.js"` |
| `PostToolUse` | _(all tools)_ | `node C:/dev/Projects/DevNeural/01-data-layer/dist/hook-runner.js` |
| `PreToolUse` | `Write\|Edit` | `node "C:/Users/mcollins/.claude/hooks/devneural-skill-tracker.js"` _(standalone)_ |
| `SessionStart` | _(all)_ | `node c:/dev/Projects/devneural-projects/scripts/fill-devneural.mjs` |

### Related repos and directories that must also move

| Path | What it is |
|---|---|
| `C:\dev\Projects\DevNeural\` | **This repo** |
| `C:\dev\Projects\devneural-projects\` | Separate repo — contains `scripts/fill-devneural.mjs` |
| `C:\dev\data\skill-connections\` | Shared data directory — create manually: `mkdir -p C:/dev/data/skill-connections/logs` |

### After moving — checklist

1. Update all hook paths in `~/.claude/settings.json` to the new repo location
2. Rebuild all modules: `npm install && npm run build` in each numbered subdirectory
3. Copy `devneural-skill-tracker.js` to `~/.claude/hooks/` on the new machine
4. Create the shared data directory: `mkdir -p C:/dev/data/skill-connections/logs`
5. Start the API server and open a new Claude session — verify the SessionStart banner appears

---

## Prerequisites

- **Node.js 18+**
- **npm 9+**
- **Claude Code CLI** (installed and configured)
- Windows 10/11 (paths in `start.bat` and default config are Windows-specific; other platforms require manual path adjustment)

---

## Setup

### 1. Clone and place the repo

```bash
git clone https://github.com/Omnib0mb3r/DevNeural c:/dev/Projects/DevNeural
```

### 2. Create the shared data directory

```bash
mkdir -p "C:/dev/data/skill-connections/logs"
```

### 3. Install and build all modules

```bash
cd c:/dev/Projects/DevNeural

cd 01-data-layer && npm install && npm run build && cd ..
cd 02-api-server && npm install && npm run build && cd ..
cd 03-web-app && npm install && npm run build && cd ..
cd 04-session-intelligence && npm install && npm run build && cd ..
cd 05-voice-interface && npm install && npm run build && cd ..
cd 06-notebooklm-integration && npm install && npm run build && cd ..
```

### 4. Wire the Claude hooks

Add the following to `~/.claude/settings.json` under the `hooks` key:

```json
"SessionStart": [
  {
    "matcher": "startup",
    "hooks": [{ "type": "command", "command": "node \"C:/dev/Projects/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10, "statusMessage": "Loading DevNeural context..." }]
  },
  {
    "matcher": "resume",
    "hooks": [{ "type": "command", "command": "node \"C:/dev/Projects/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10 }]
  },
  {
    "matcher": "clear",
    "hooks": [{ "type": "command", "command": "node \"C:/dev/Projects/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10 }]
  },
  {
    "matcher": "compact",
    "hooks": [{ "type": "command", "command": "node \"C:/dev/Projects/DevNeural/04-session-intelligence/dist/session-start.js\"", "timeout": 10 }]
  },
  {
    "hooks": [{ "type": "command", "command": "node c:/dev/Projects/devneural-projects/scripts/fill-devneural.mjs", "timeout": 10 }]
  }
],
"PostToolUse": [
  {
    "hooks": [{ "type": "command", "command": "node C:/dev/Projects/DevNeural/01-data-layer/dist/hook-runner.js" }]
  }
],
"PreToolUse": [
  {
    "matcher": "Write|Edit",
    "hooks": [{ "type": "command", "command": "node \"C:/Users/mcollins/.claude/hooks/devneural-skill-tracker.js\"" }]
  }
]
```

### 5. Add a devneural.jsonc to each tracked project

Use the [dev-template](https://github.com/Omnib0mb3r/dev-template) — it includes a pre-configured `devneural.jsonc` that auto-fills on first session start.

---

## Running

### Quick start (Windows)

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
cd 04-session-intelligence && npm install && npm run build && cd ..
cd 05-voice-interface && npm install && npm run build && cd ..
cd 06-notebooklm-integration && npm install && npm run build && cd ..
```

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

Requires a valid `ANTHROPIC_API_KEY` environment variable.

---

## Troubleshooting

**API server not responding**
Check that port 3747 is free: `netstat -aon | findstr :3747`

**Session start shows "API offline"**
Start the API server first, then open a new Claude session.

**Orb shows no nodes**
Verify at least one `devneural.jsonc` file is present in a tracked project and that the API server is running.

**Hook not firing**
Confirm `~/.claude/settings.json` contains the correct `SessionStart` entries. Restart Claude Code — hook config is read at session startup, not hot-reloaded.

**Port 5173 already in use**
`start.bat` kills it automatically. For manual starts: `npx kill-port 5173`

**Moved the repo and hooks stopped working**
See the [Machine Migration Guide](#machine-migration-guide) above — update every path in `~/.claude/settings.json` and rebuild all modules.

---

*Michael Collins // Stay on the level.*
