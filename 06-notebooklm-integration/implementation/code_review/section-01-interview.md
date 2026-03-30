# Code Review Interview — section-01-setup

## Blocker (Auto-fixed)

**src/ subdirectories not staged**
- Added `.gitkeep` files to `src/session/`, `src/summary/`, `src/obsidian/`
- Rationale: Without these, `tsc` would error on rootDir resolution when downstream sections add files to only one subdirectory

## Suggestions (Auto-fixed)

**sample-weights.json: insufficient edge coverage**
- Added a 5th DevNeural edge (`project->project`) so high_weight top-3 ranking logic has 5 edges to rank
- Added `tool:Bash -> skill:gsd-execute` edge matching the JSONL `tool->skill` connection for complete fixture coverage

## Let Go

**vitest globals option** — vitest auto-imports globals by default; low risk
**.gitignore coverage/** — not needed until coverage tooling is added
