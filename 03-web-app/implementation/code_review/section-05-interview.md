# Code Review Interview: section-05-voice

## User Decisions

**zoomIn/zoomOut:** Remove from VoiceIntent type and remove 'zoom in' pattern.

**Regex anchors:** Drop `$` end anchors so "zoom out please" still triggers returnToAuto.

## Auto-fixes to apply

1. Add guard in `startListening()`: return early if `currentStatus !== 'idle'`
2. Remove `setStatus('processing')` from `onresult` (phantom state)
3. Store `setTimeout` handle in `onerror`; clear it in `startListening()`
4. Add `setCameraMode(hudElements, cameraController.state)` after `returnToAuto()` in voice handler
5. Add `hudElements.searchInput.value = intent.target` in `focus` branch of voice handler
6. Remove `'zoomIn'` and `'zoomOut'` from VoiceIntent action union; remove 'zoom in' regex pattern
7. Drop `$` end anchors from `detectVoiceIntent` command patterns
8. Add test assertions for `continuous === false` and `interimResults === false`
9. Fix fallback to use `transcript.trim()`
