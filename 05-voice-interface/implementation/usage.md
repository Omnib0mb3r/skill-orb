# Usage Guide — 05-voice-interface

## Quick Start

The voice interface is a CLI that accepts a natural-language query about your DevNeural graph and outputs a human-readable text response. It also fires orb-highlighting events to a running `03-web-app` instance via `02-api-server`.

**Prerequisites:**

```bash
# Build the voice CLI
cd 05-voice-interface
npm run build

# Start the API server (required for data queries)
node ../02-api-server/dist/server.js
```

**Run a query:**

```bash
node dist/index.js "what skills am I using most?"
node dist/index.js "what's my current context?"
node dist/index.js "show me connections to TypeScript"
```

**As a Claude Code skill:**

```
/voice what skills am I using most?
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DEVNEURAL_PORT` | `3747` | Port for `02-api-server` (used for both data API and POST orb events) |
| `DEVNEURAL_API_URL` | _(derived from port)_ | Override full API base URL |

## Intent Types

| Query pattern | Intent | API call | Orb event |
|---|---|---|---|
| "what skills am I using" | `get_top_skills` | `GET /graph/top?limit=100` | `POST voice:highlight` (skill nodes) |
| "what's my current context" | `get_context` | `GET /graph/subgraph?project=...` | `POST voice:focus` + `POST voice:highlight` |
| "show me connections to X" | `get_connections` | `GET /graph` → `GET /graph/node/:id` | `POST voice:focus` |
| "what stage is X" | `get_stages` | `GET /graph` | `POST voice:highlight` (project nodes) |
| unknown / clarification | `unknown` | _(none)_ | `POST voice:clear` |

## Example Output

```
$ node dist/index.js "what skills am I using most?"
Your top skills: TypeScript (8 uses), React (5 uses), Node.js (4 uses)

$ node dist/index.js "what's my current context?"
Current project: DevNeural — using TypeScript, with connections to 02-api-server and 03-web-app

$ node dist/index.js "what is the weather"
I'm not sure what you mean — try asking about connections, skills, or your current project.
```

## Architecture

```
User query
  └─ src/index.ts (entry point)
       ├─ src/identity/index.ts       resolve project from cwd
       ├─ src/intent/parser.ts        local-parser → Haiku fallback
       ├─ src/routing/intent-map.ts   call 02-api-server REST endpoints
       ├─ src/formatter/response.ts   format human-readable text
       └─ src/formatter/orb-events.ts POST voice:* events to 02-api-server
```

## Test Suite

```bash
# 05-voice-interface unit + e2e tests (114 tests)
cd 05-voice-interface && npm test

# 03-web-app unit tests (162 tests)
cd 03-web-app && npm test

# 03-web-app vite build verification
cd 03-web-app && npx vite build
```

## Web App Integration

The `03-web-app` displays the skill graph and responds to voice events from `02-api-server` WebSocket:

- `voice:focus` — highlights a single node (e.g., current project)
- `voice:highlight` — dims all nodes except specified list
- `voice:clear` — resets all node highlighting

New modules added in this phase:
- `src/orb/interaction.ts` — hover/click handlers with Three.js raycasting
- `src/ui/hud.ts` — fixed-position overlay (node/edge counts, project label, last query)
- `src/main.ts` — wires renderer, physics simulation, WebSocket client, and interaction

## Files Created (Section 12)

```
03-web-app/src/orb/interaction.ts
03-web-app/src/ui/hud.ts
03-web-app/src/main.ts
03-web-app/tests/orb/interaction.test.ts
03-web-app/tests/ui/hud.test.ts
05-voice-interface/tests/e2e.test.ts
```
