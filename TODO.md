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
- [ ] Tile-tap focus: clicking a session tile must bring the matching VS Code window to OS foreground. Currently flaky on Windows because `SetForegroundWindow` has caller-thread restrictions when the click originates in a browser.
- [ ] Nav-mode key inject: pressing 1-5, arrows, mic, enter, backspace must inject into the focused VS Code window. Currently lands in whatever window is OS-foreground at PS spawn time, which is the browser, not Claude.
- [ ] Mirror hardware StreamDeck.App behaviour. Long-term: have the tray app (already running) listen for daemon-side focus/key events and perform the OS-level work. Tray apps have fewer focus restrictions than browser-spawned children.

## Deferred / future

- Phase 4 Orb data rebind. Force-directed UI shipped; pages-as-nodes data layer awaiting more accumulated wiki content.
- Phase 5 settings audit + personalized recovery docs. Mostly documentation.
- Audio/video binary smoke test post whisper.cpp + ffmpeg install.

## Operational

- [ ] Audit and prune `~/.claude/settings.json.*.bak.*` backup files. Keep one canonical recovery point, drop the rest.
- [ ] `silence-all-hooks.ps1` cmd-/c logic is broken (re-runs trash settings). Either redesign with a multi-arg shim that preserves stdin pipethrough, or delete the script. Do not re-run as-is.
