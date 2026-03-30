# Interview Transcript

---

## Q1: How should this handle NotebookLM upload?

**Answer:** Make it agnostic — remove the specific NotebookLM hook entirely. Generate a "context of context" (COC) document that can be fed into any bucket: R&D, product documentation, knowledge base, etc.

---

## Q2: What should trigger the integration?

**Answer:** On-demand CLI command (user runs it manually). Scheduled/cron as well (both options).

*Note: Later revised in Q11 — final answer is manual CLI only (no scheduled run for now).*

---

## Q3: What should each generated document contain?

**Answer:** Cluster summary narrative.

---

## Q4: What defines a cluster worth generating a document for?

**Answer:** User questioned the framing ("what's the point of this doc") — redirected the conversation toward rethinking the whole module.

---

## Q5: Primary audience / downstream use?

**Answer:** Multiple — one doc rich enough to serve all purposes (AI context injection, R&D notes, product docs, knowledge base).

---

## Q6: [Rethink] What's the primary job of these documents?

**Answer:** User stepped back and reframed the entire module concept:

> "I think we need to step back and rethink this. Obsidian will be my second brain in life. Important output from DevNeural needs to update there to help drive new projects and such."

**New direction:** At the end of each session, DevNeural should push a summary to the user's **Obsidian vault** — capturing session info (project worked on, lessons learned). Obsidian becomes the "second brain" that accumulates knowledge over time.

---

## Q7: Where is the Obsidian vault? How should DevNeural write into it?

**Answer:** Vault path and folder structure should be **configurable in a config file** — set once, used automatically.

---

## Q8: What should a session summary capture?

**Answer (multi-select):**
- Project(s) worked on (from DevNeural graph)
- Lessons learned / notes
- Graph insights (notable patterns, new connections, high-weight edges)

*(Tools & skills list was not selected — focus is on higher-level narrative, not raw tool lists)*

---

## Q9: Should graph analysis (cluster detection, skill recommendations) still exist as periodic reports pushed to Obsidian?

**Answer:** Maybe later — start with session summaries only. Graph reports as a phase 2.

---

## Q10: How should Obsidian notes be organized?

**Answer:** One file per project (appended per session).
- File: `<vault>/DevNeural/Projects/<project-name>.md`
- Each session adds a new dated section to that file

---

## Q11: How should a session summary be triggered?

**Answer:** Manual CLI command — user runs `node summary.js` (or equivalent) whenever they want.

*(Not a SessionStop hook — user wants explicit control)*

---

## Q12: For 'lessons learned' — how should that section be populated?

**Answer:** Both: AI drafts a summary from the session logs; Obsidian note includes a blank placeholder section for the user to fill in manually.
