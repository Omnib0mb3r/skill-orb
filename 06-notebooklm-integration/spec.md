# 06-notebooklm-integration — Spec

## Purpose

Detect high-dependency clusters in the DevNeural graph and auto-generate training materials from them via NotebookLM. Includes a recommendation engine that suggests learning resources based on usage patterns.

## Full Requirements Reference

See: `../requirements.md` — section "NotebookLM Integration"

## Key Decisions (from interview)

- **Language:** TypeScript / Node.js
- **Data source:** Can read directly from weights.json (01-data-layer) or via the API (02-api-server)
- **Output:** Structured training documents fed into NotebookLM as sources

## What This Split Builds

1. **Cluster detection** — graph algorithm that:
   - Identifies high-weight subgraphs (tightly connected groups of projects/skills/tools)
   - Ranks clusters by density, weight, and recency
   - Produces named cluster descriptors for training material generation

2. **Training material generator** — for each detected cluster:
   - Auto-generates structured notes and summaries
   - Captures connection patterns, usage frequency, co-occurrence data
   - Formats output as NotebookLM-compatible source documents

3. **NotebookLM integration** — feeds materials into NotebookLM:
   - NotebookLM API or upload mechanism
   - Creates/updates notebooks per cluster

4. **Recommendation engine** — suggests learning resources:
   - Analyzes usage patterns in the graph
   - Recommends skills/tools/patterns the user underuses relative to their project graph
   - Output: actionable learning suggestions

## Interfaces

**Inputs:**
- weights.json from 01-data-layer (or via 02-api-server)
- Log files from 01-data-layer (for usage pattern analysis)

**Outputs:**
- Structured training documents (markdown or NotebookLM format)
- NotebookLM notebooks/sources
- Learning recommendations

## Dependencies

**Needs from other splits:**
- 01-data-layer: weights.json schema, log format
- Optionally 02-api-server: graph query endpoints for cluster queries

**Provides to other splits:** Nothing (terminal consumer)

## Key Unknowns / Design Decisions for /deep-plan

- NotebookLM API availability and integration approach (API vs. manual export?)
- Cluster detection algorithm: community detection (Louvain, etc.) vs. threshold-based subgraph extraction
- What makes a "useful" cluster for training materials (minimum size, weight threshold)
- Training material format: what structure does NotebookLM expect?
- Recommendation engine: what signals indicate underutilized skills?
- Trigger model: on-demand vs. scheduled vs. event-driven (when weights update significantly)
