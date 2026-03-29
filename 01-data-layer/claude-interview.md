# Interview Transcript: 01-data-layer

*Conducted: 2026-03-28*

---

## Q1: What exactly constitutes a 'connection' worth recording?

**Question:** What exactly constitutes a 'connection' worth recording? The spec mentions project/skill/tool pairs — but what's the relationship being tracked? (e.g., 'tool X was used in project Y', 'skill A triggered tool B', 'tool B and tool C co-occurred in the same session'?)

**Answer:** Project to project, project to tool, project to skill, skill to tool. Also manual to any — when in a brainstorming session, can manually force connections.

**Implication:** The graph has multiple edge types:
- `project→project` (projects that are related/interconnected)
- `project→tool` (tools used within a project)
- `project→skill` (skills invoked within a project)
- `skill→tool` (tools a skill invokes internally)
- Manual connections: not in scope for this split (01-data-layer)

---

## Q2: Weight update strategy?

**Question:** The spec says weights use a 0–10 scale. Research shows three strategies: (1) simple increment (count normalized to 0–10), (2) EMA (exponentially weighted), (3) recency-decay (time-based fade). Which fits DevNeural's intent?

**Answer:** Simple increment (normalize to 0–10). Recommended.

**Implication:** `weight = min(raw_count, 100) / 100 * 10` (cap = 100 interactions, see Q10 below).

---

## Q3: Failure mode?

**Question:** If the logger script errors (file write fails, disk full, etc.) — what should happen?

**Answer:** Silent fail — never interrupt Claude.

**Implication:** Logger exits 0 on all errors. Only stderr output for debugging. No blocking of Claude sessions.

---

## Q4: Manual connections scope?

**Question:** You mentioned manual connections — how should a user create one?

**Answer:** Not needed in this split — just the hook-driven logging.

**Implication:** Manual connection API is out of scope for 01-data-layer. Log and weight everything automatically via hooks.

---

## Q5: Skill invocation detection?

**Question:** The spec mentions 'Both Claude Code hooks AND skill invocation wrappers'. Skill invocations don't fire PostToolUse — they fire as an Agent tool call. Should we hook the Agent tool (PostToolUse with tool_name='Agent') to detect skill invocations, or is there a separate mechanism?

**Answer:** Hook Agent tool calls in PostToolUse (tool_name=="Agent").

**Implication:** When PostToolUse fires with `tool_name == "Agent"`, extract skill identity from `tool_input.description` and/or `tool_input.subagent_type`. Log `project→skill` and `skill→tool` edges from this event. The `tool_input.prompt` may contain the skill name via the Skill tool invocation.

---

## Q6: Weights file scope?

**Question:** Should the logger write to a single shared weights.json for all projects, or per-project weights files?

**Answer:** Single shared weights.json (`C:\dev\data\skill-connections\weights.json`).

**Implication:** One global graph file. All edge types (project→tool, project→skill, etc.) live in a single JSON document. Cross-project relationships can be expressed directly.

---

## Q7: Tool allowlist?

**Question:** Should ALL tool invocations be logged, or only specific ones?

**Answer:** Configurable allowlist (default: Bash, Write, Edit, Agent).

**Implication:** The logger reads an allowlist from config. Default set: `["Bash", "Write", "Edit", "Agent"]`. Read/Glob/Grep are excluded by default. The allowlist is configurable via a config file (e.g., `C:\dev\data\skill-connections\config.json`).

---

## Q8: Project identity strategy?

**Question:** How should 'project' be identified from the hook payload?

**Answer:** Cascade: git remote → git root → CWD (Recommended).

**Implication:**
1. Walk up from `cwd` (from hook payload) to find `.git` directory
2. Try `git remote get-url origin` — normalize SSH/HTTPS to `host/owner/repo` form
3. Fallback to normalized git root path
4. Final fallback to normalized `cwd`
Use the result as the project identifier in log entries and as graph node IDs.

---

## Q9: Log entry fields?

**Question:** The spec defines log entry format as: `{ timestamp, project, skill/tool name, session ID, connection_type }`. Anything else needed in each log entry?

**Answer:** `tool_input` (the arguments passed to the tool).

**Implication:** Log entry format:
```json
{
  "timestamp": "2026-03-28T10:22:00.123Z",
  "session_id": "abc123",
  "project": "github.com/user/DevNeural",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "connection_type": "project→tool"
}
```

---

## Q10: Weight normalization cap?

**Question:** For the 0–10 weight scale: what's the max cap before normalization?

**Answer:** Cap at 100 interactions = weight 10.

**Implication:** `weight = min(raw_count, 100) / 100 * 10`. 100 uses = maximum weight of 10. This gives gradual weight growth over time.

---

## Q11: Log file retention?

**Question:** Log rotation: one JSONL file per day is the standard approach. Is there a retention policy?

**Answer:** Keep forever (no rotation).

**Implication:** Log files accumulate indefinitely. Filename format: `C:\dev\data\skill-connections\logs\YYYY-MM-DD.jsonl`. No deletion or rotation logic needed in MVP.

---

## Summary of Key Design Decisions

| Decision | Choice |
|---|---|
| Connection types | project→project, project→tool, project→skill, skill→tool |
| Manual connections | Out of scope for 01-data-layer |
| Weight strategy | Simple increment, capped at 100, normalized 0–10 |
| Failure mode | Silent fail (exit 0), stderr only |
| Skill detection | PostToolUse where tool_name=="Agent" |
| Weights scope | Single global weights.json |
| Tool allowlist | Default: Bash, Write, Edit, Agent (configurable) |
| Project identity | Cascade: git remote → git root → CWD |
| Extra log fields | tool_input included in each entry |
| Log rotation | None (keep forever) |
