# 05: Coexistence with Claude-Setup

> How DevNeural fits alongside the existing Claude setup recorded at https://github.com/Omnib0mb3r/Claude-Setup, plus other plugins (superpowers, GSD, deep-implement, deep-plan, etc.) without nuking them.
>
> **Personalized contents are completed in Phase 5 (settings audit).** This file holds the structure and the coexistence rules. Once Phase 5 runs and inspects the actual `~/.claude/settings.json` and `~/.claude/CLAUDE.md` content on `OTLCDEV`, the placeholders below are filled with the concrete inventory.

---

## The relationship

`Claude-Setup` is the canonical record of how the user's Claude Code installation is configured: hooks, MCPs, statusline, plugins, global `CLAUDE.md`. It is the recovery source if `~/.claude/` is wiped.

`DevNeural` is one *contributor* to that configuration. It adds 4 hook entries to `~/.claude/settings.json` and reads (but never writes) several other things in `~/.claude/`.

The rule: **DevNeural never assumes ownership of any file it didn't create.** Anything in `~/.claude/` that pre-exists is treated as "user-owned, do not modify."

---

## Hooks: the only thing DevNeural writes outside its data root

Of all the things in `~/.claude/`, only `settings.json` is modified by DevNeural, and only the `hooks` block, and only specific entries DevNeural recognizes as its own.

**DevNeural's hook entries (added by `npm run install-hooks`):**

| Event | Matcher | Command |
|---|---|---|
| `PreToolUse` | `*` | `node "C:/dev/Projects/DevNeural/07-daemon/dist/capture/hooks/hook-runner.js" pre` |
| `PostToolUse` | `*` | `node "C:/dev/Projects/DevNeural/07-daemon/dist/capture/hooks/hook-runner.js" post` |
| `UserPromptSubmit` | (none) | `node "C:/dev/Projects/DevNeural/07-daemon/dist/capture/hooks/hook-runner.js" prompt` |
| `Stop` | (none) | `node "C:/dev/Projects/DevNeural/07-daemon/dist/capture/hooks/hook-runner.js" stop` |

**Detection rules used by `install-hooks`:**

- An entry is "DevNeural v2" if its command contains `07-daemon/dist/capture/hooks/hook-runner.js`.
- An entry is "DevNeural v1" if its command contains `01-data-layer/dist/hook-runner.js` or `04-session-intelligence/dist/session-start.js`.
- All other entries are treated as foreign and **left alone**.

**Install behavior:**

1. Back up `~/.claude/settings.json` to `~/.claude/settings.json.devneural.bak`.
2. Strip any existing DevNeural v1 or v2 entries from the `hooks` block.
3. Add the four v2 entries above.
4. Write the file. All non-DevNeural entries (other hooks, plugin entries, MCP servers, model preferences, statusline, etc.) are preserved exactly.

---

## What DevNeural reads but never writes

- `~/.claude/CLAUDE.md` — your global instructions. DevNeural reads it as part of session context but never modifies.
- `~/.claude/skills/**/SKILL.md` — used as initial corpus seed material.
- `~/.claude/plugins/**/SKILL.md` — same.
- `~/.claude/projects/<slug>/<session>.jsonl` — session transcripts. Read incrementally via byte offset; never written to.
- Any other file under `~/.claude/` — not touched.

---

## Plugins DevNeural is known to coexist with

DevNeural has been verified to coexist with these (their hooks remain functional after DevNeural install):

- `superpowers` (skills, hooks, MCP)
- `deep-implement`, `deep-plan`, `deep-project`
- `gsd` family
- `cli-anything`
- standalone helpers like `gsd-statusline`, `gsd-context-monitor`, `gsd-prompt-guard`, `gsd-check-update`

If you have other plugins, DevNeural's surgical hook editing should leave them alone, but verify by diff:

```powershell
git diff (Get-Content $env:USERPROFILE\.claude\settings.json.devneural.bak) (Get-Content $env:USERPROFILE\.claude\settings.json)
```

You should only see additions to the `hooks` block.

---

## Phase 5 placeholder: actual settings inventory

Once Phase 5 runs, this section will contain:

- The complete current contents of `~/.claude/settings.json` on `OTLCDEV` (with secrets redacted)
- The complete current contents of `~/.claude/CLAUDE.md` (the global one)
- A categorized table of every hook entry: which tool owns it, what it does, whether DevNeural touches it
- A categorized table of every MCP entry: same
- The list of every plugin currently installed
- The list of every standalone hook script in `~/.claude/hooks/`
- A "what to back up before wiping" inventory keyed by Claude-Setup's recovery model
- A delta diff showing what changed in `~/.claude/settings.json` after DevNeural was installed

Until Phase 5 runs, this section is intentionally generic.

**Why deferred:** the settings.json on `OTLCDEV` is changing during Phases 1-4 work. Capturing it now would produce stale documentation that has to be rewritten anyway. Phase 5 captures it once everything has stabilized.

---

## What you do if Claude-Setup and DevNeural disagree

`Claude-Setup` is the canonical recovery source for everything except DevNeural's own additions. So:

- If `~/.claude/settings.json` is corrupted, restore from Claude-Setup, then run `cd 07-daemon && npm run install-hooks` to re-add DevNeural's entries.
- If `~/.claude/CLAUDE.md` is corrupted, restore from Claude-Setup. DevNeural is not involved.
- If a plugin breaks, restore from Claude-Setup or reinstall the plugin. DevNeural is not involved.
- If DevNeural's daemon misbehaves, see `07-troubleshooting.md`. Do not restore from Claude-Setup; it doesn't own DevNeural's data.

---

## What goes in Claude-Setup vs what goes in DevNeural

| Lives in Claude-Setup | Lives in DevNeural |
|---|---|
| Global `CLAUDE.md` | The wiki, the daemon, the dashboard |
| Standalone hook scripts under `~/.claude/hooks/` | DevNeural hook script (under DevNeural repo) |
| Plugin install commands | DevNeural setup commands |
| MCP server registrations (other than DevNeural's) | DevNeural's own MCP registration if/when added |
| Statusline config | (none) |
| Theme / model preferences | (none) |
| The reference copy of `settings.json` (your canonical version) | The four hook entries DevNeural adds at install time |

Treat them as independent: Claude-Setup is your machine's nervous system config, DevNeural is one organ that hooks into it.

---

## Reconstruction order if you start over

If `OTLCDEV` is wiped and you need to rebuild from scratch:

1. **Install OS** + Windows updates.
2. **Install prereqs** (Node, Git, ollama, VS Code, Tailscale, Claude Code) per `01-prerequisites.md`.
3. **Restore `~/.claude/`** from your `Claude-Setup` repo:
   - clone the repo
   - copy `settings.json` to `~/.claude/`
   - copy `CLAUDE.md` to `~/.claude/`
   - copy the standalone hook scripts to `~/.claude/hooks/`
   - reinstall any plugins via `/plugin install` in Claude Code
4. **Pull the ollama model** (`ollama pull qwen3:8b`).
5. **Clone DevNeural** to `C:/dev/Projects/DevNeural/`.
6. **Run setup**: `cd 07-daemon && npm install && npm run setup`.
7. The setup will detect existing hooks (from step 3), not nuke them, and add DevNeural's four entries.
8. **Optionally restore your wiki** from a backup (see `06-recovery-and-reconstruction.md`).
9. **Run npm run status** to verify.

You should be back in working order in under an hour, most of which is OS install and ollama model download.

---

Continue to `06-recovery-and-reconstruction.md` for the disaster-recovery procedures.
