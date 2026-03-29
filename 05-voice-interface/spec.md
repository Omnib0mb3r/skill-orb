# 05-voice-interface — Spec

## Purpose

A voice query interface for the DevNeural graph. Allows natural language queries ("What's connected to this project?", "What skills are we using most?") via the Claude Voice workflow, translates them to API calls, and feeds voice session activity back into the connection graph.

## Full Requirements Reference

See: `../requirements.md` — section "Voice Interface"

## Key Decisions (from interview)

- **Language:** TypeScript / Node.js
- **Integration point:** Claude Voice workflow (existing)
- **Bidirectional:** Voice sessions are both consumers of the graph and contributors to it

## What This Split Builds

1. **Voice query handler** — translates NL voice queries to API calls:
   - Parses intent from common query patterns ("What's connected to...", "What skills...", "Show me...")
   - Maps intent to 02-api-server REST endpoints
   - Formats API responses as natural language for voice output

2. **Voice session logging** — feeds voice activity back into the graph:
   - Logs voice session events as connection data via 01-data-layer
   - Captures which projects/skills are being queried via voice

3. **Claude Voice integration** — wiring to the existing Claude Voice workflow:
   - Entry point the voice workflow calls into
   - Response formatting for spoken output

## Interfaces

**Inputs:**
- Voice query text (from Claude Voice workflow)
- REST API from 02-api-server

**Outputs:**
- Natural language response for voice playback
- Connection log entries (written back to 01-data-layer)

## Dependencies

**Needs from other splits:**
- 02-api-server: REST query endpoints
- 01-data-layer: log write interface (to record voice session activity)

**Provides to other splits:** Nothing (terminal consumer + data contributor)

## Key Unknowns / Design Decisions for /deep-plan

- How Claude Voice workflow passes queries and receives responses (integration protocol)
- NL query parsing approach: pattern matching vs. structured intent extraction
- Which graph queries to support via voice (scope)
- Voice response format constraints (length, structure)
- How to identify the active project during a voice session
