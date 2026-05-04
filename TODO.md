# DevNeural TODO

Captured 2026-05-04. Living list. Tick when shipped.

## Polish (from agent E handover read)

- [ ] Android push notification end-to-end test on a real device. iOS verified live; Android Chrome push not yet exercised.
- [ ] PWA install prompt UX wiring. `08-dashboard/components/InstallPrompt.tsx` scaffold exists; `beforeinstallprompt` listener + mobile install button not yet hooked up.
- [ ] System panel sparklines. Add Tremor `<SparkAreaChart>` for CPU + memory trend (last 60 samples). Currently just bars.
- [ ] Axe a11y sweep on every dashboard route. Lighthouse passes 95/100/223ms; manual axe pass deferred.
- [ ] `prefers-reduced-motion` audit. Orb particles, transitions, breathing glow.
- [ ] Tailwind arbitrary class cleanup: replace lingering `text-[11px]` with `text-nano` utility.
- [ ] Scanned PDF OCR fallback. `07-daemon/src/reference/pdf.ts` warns on image-only PDFs; rasterize-then-OCR (pdf2pic + tesseract) deferred.
- [ ] Off-site git remote for wiki repo (`C:\dev\data\skill-connections\wiki\`). Currently local-only versioning.

## Validation

- [ ] Trigger a real reinforcement event in conversation. Send Claude a prompt where the wiki should match, watch dashboard ReinforcementPanel for an `injected` row, then watch for `hit` / `raw-hit` after the reply lands. Confirms curator + reinforcement + panel chain end-to-end.

## Stream deck (virtual deck in dashboard)

- [x] Arrow tile foreground color: was greyed-out slate, now pure white for visibility.
- [x] Tile-tap focus and Nav-mode key inject. Routed through StreamDeck.App tray (commit `3147c41` in stream-deck repo, `59cfd2e` in DevNeural). Tray app holds the OS focus rights the bridge could not. Daemon writes to `%LOCALAPPDATA%\stream-deck\virtual-input\<sessionId>.in`, app's VirtualInputWatcher dispatches through the same WindowManager.FocusWindow + NavKeymap.InjectFor paths the physical deck uses.
- [x] Workspace resolution: ResolveVSCodeWindowSmart walks cwd segments deepest-to-shallowest so a session launched in a subdir (e.g. `07-daemon`) still resolves the workspace-root VS Code window (`DevNeural`).

## Deferred / future

- Phase 4 Orb data rebind. Force-directed UI shipped; pages-as-nodes data layer awaiting more accumulated wiki content.
- Phase 5 settings audit + personalized recovery docs. Mostly documentation.
- Audio/video binary smoke test post whisper.cpp + ffmpeg install.

## Operational

- [ ] Audit and prune `~/.claude/settings.json.*.bak.*` backup files. Keep one canonical recovery point, drop the rest.
- [ ] `silence-all-hooks.ps1` cmd-/c logic is broken (re-runs trash settings). Either redesign with a multi-arg shim that preserves stdin pipethrough, or delete the script. Do not re-run as-is.
- [x] Bridge `focusWindow` + `injectKey` + nav PS helpers removed (commit `aee3053`). Bridge is now text-only.
- [x] deck-hook.sh double-escape bug fixed at source (stream-deck commit `605688b`). Segment-walk in C# is still useful as a fallback when Claude is launched from a workspace subdirectory.
