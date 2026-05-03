# 06: Recovery and reconstruction

> "I lost my machine" / "I want to start fresh" / "Something is broken and I need to roll back."
> Procedures from least invasive to most invasive.

---

## Tier 1: Soft reset

**When:** something feels wrong but you don't want to lose data.

```powershell
# Stop the daemon (find PID first)
Get-Content C:/dev/data/skill-connections/daemon.pid
taskkill /F /PID <pid>

# Rebuild
cd C:/dev/Projects/DevNeural/07-daemon
npm run build

# Re-run setup (idempotent)
npm run setup

# Verify
npm run status
```

This rebuilds the daemon, re-runs hook installation, and prints status. No data loss.

---

## Tier 2: Reinstall hooks only

**When:** hooks aren't firing or you want to re-sync the hook entries with the current `dist/` paths.

```powershell
cd C:/dev/Projects/DevNeural/07-daemon
npm run install-hooks
```

This rewrites only the DevNeural hook entries in `~/.claude/settings.json`. All other entries left intact. Backup is at `~/.claude/settings.json.devneural.bak`.

To roll back this step:
```powershell
Copy-Item $env:USERPROFILE\.claude\settings.json.devneural.bak $env:USERPROFILE\.claude\settings.json -Force
```

---

## Tier 3: Reset the daemon state, keep the wiki

**When:** vector store is corrupted, SQLite is locked, observations are corrupted, but the wiki is fine.

```powershell
# Stop the daemon
taskkill /F /PID (Get-Content C:/dev/data/skill-connections/daemon.pid)

# Backup current state
$backup = "C:/dev/data/skill-connections-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item C:/dev/data/skill-connections $backup -Recurse

# Remove indexes and observations (keeps wiki/, models/, projects.json)
Remove-Item C:/dev/data/skill-connections/index.db, C:/dev/data/skill-connections/index.db-shm, C:/dev/data/skill-connections/index.db-wal -Force -ErrorAction SilentlyContinue
Remove-Item C:/dev/data/skill-connections/chroma -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item C:/dev/data/skill-connections/projects/*/observations.jsonl -Force -ErrorAction SilentlyContinue
Remove-Item C:/dev/data/skill-connections/projects/*/observations.archive -Recurse -Force -ErrorAction SilentlyContinue

# Restart
node C:/dev/Projects/DevNeural/07-daemon/dist/daemon.js > C:/dev/data/skill-connections/daemon.log 2>&1 &
```

The daemon will rebuild Chroma collections and SQLite from the wiki's existing pages on next ingest pass. Past raw transcript chunks are lost (capture starts fresh), but pages persist.

---

## Tier 4: Full data wipe, keep config

**When:** you want a clean slate but keep your `~/.claude/settings.json` and the DevNeural repo.

```powershell
# Stop daemon
taskkill /F /PID (Get-Content C:/dev/data/skill-connections/daemon.pid) -ErrorAction SilentlyContinue

# Backup wiki (the precious part)
$wikiBackup = "C:/dev/wiki-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
Compress-Archive C:/dev/data/skill-connections/wiki $wikiBackup

# Wipe data root
Remove-Item C:/dev/data/skill-connections -Recurse -Force

# Re-run setup (recreates data root, scaffolds wiki)
cd C:/dev/Projects/DevNeural/07-daemon
npm run setup

# Restore wiki if you want
Expand-Archive $wikiBackup C:/dev/data/skill-connections/
```

---

## Tier 5: Complete reconstruction from scratch

**When:** new machine, OS reinstall, or "I can't fix it, just rebuild it."

Pre-recovery checklist:

- [ ] Have `Claude-Setup` repo URL and credentials to clone
- [ ] Have the wiki backup (see Tier 4 or your own backup process)
- [ ] Have any `.devneural-ignore` paths noted
- [ ] Have any custom env vars (`DEVNEURAL_DATA_ROOT`, `DEVNEURAL_OLLAMA_MODEL`) noted

Procedure:

1. **OS + prereqs:** install per `01-prerequisites.md`.

2. **Restore your `~/.claude/`:**
   - Clone Claude-Setup
   - Copy `settings.json`, `CLAUDE.md`, hook scripts back into `~/.claude/`
   - Reinstall plugins through Claude Code (`/plugin install ...`)

3. **Pull ollama model:**
   ```powershell
   ollama pull qwen3:8b
   ```

4. **Clone DevNeural:**
   ```powershell
   git clone https://github.com/Omnib0mb3r/DevNeural C:/dev/Projects/DevNeural
   cd C:/dev/Projects/DevNeural/07-daemon
   npm install
   ```

5. **Set custom env vars** (if you had any):
   ```powershell
   [Environment]::SetEnvironmentVariable("DEVNEURAL_DATA_ROOT", "D:/devneural-data", "User")
   [Environment]::SetEnvironmentVariable("DEVNEURAL_OLLAMA_MODEL", "qwen2.5:7b-instruct", "User")
   ```
   Restart your shell.

6. **Run setup:**
   ```powershell
   npm run setup
   ```

7. **Restore wiki backup** (optional, if you have one):
   ```powershell
   Expand-Archive <your-wiki-backup>.zip C:/dev/data/skill-connections/
   ```

   Note: the wiki is a git repo. You can also just `git clone` it from a private remote you've been pushing to, if you set that up.

8. **Verify:**
   ```powershell
   npm run status
   ```
   All green or actionable warnings.

9. **Re-trigger initial corpus seed** (only needed if you didn't restore a wiki):
   ```powershell
   curl -X POST http://127.0.0.1:3747/reseed
   ```

---

## Backing up the wiki proactively

The wiki is your accumulated insights. Loss is recoverable but expensive (months of accumulated patterns). Back it up.

### Manual backup

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Compress-Archive C:/dev/data/skill-connections/wiki "C:/Backups/devneural-wiki-$stamp.zip"
```

### Scheduled backup

Task Scheduler entry, daily at 3am:
- Action: PowerShell with the command above
- Trigger: Daily at 03:00

### Git remote

Even better: push the wiki's git repo to a private remote.

```powershell
cd C:/dev/data/skill-connections/wiki
git remote add origin https://github.com/<you>/devneural-wiki-private.git
git push -u origin master
```

After this, every ingest auto-commits and you can `git push` periodically (or via a post-commit hook). Recovery becomes `git clone`.

---

## Restoring just one wiki page

If you accidentally edited a page wrong (the daemon respects human edits but you might have edited badly):

```powershell
cd C:/dev/data/skill-connections/wiki
git log -- pages/<page-id>.md
git checkout <some-commit> -- pages/<page-id>.md
```

The wiki git repo retains every ingest as a commit, so any historical version is available.

---

## Restoring observations / transcripts

These are not first-class backed-up. Reasons:
- They are large (sessions can be MB each).
- They are reproducible by replaying Claude Code session jsonls.

If a critical observation set is lost, the underlying source (`~/.claude/projects/<slug>/<session>.jsonl`) is still on disk and the daemon will pick it up incrementally on next start. You may lose the daemon's offset memory (in `transcript-offsets.json`) and re-process some content; that's harmless.

---

## What NOT to back up

- `node_modules/` (regenerable from `npm install`)
- `dist/` (regenerable from `npm run build`)
- `chroma/` (regenerable from wiki + transcript replay)
- `index.db` and `index.db-*` (regenerable)
- `models/` (regenerable; will re-download)

The only irreplaceable data is `wiki/` and your raw observations. The wiki matters most.

---

Continue to `07-troubleshooting.md` for symptom-driven fixes.
