# Code Review: section-05-voice

## Overall Assessment: CONCERNS — several correctness bugs require fixes before ship

---

## HIGH Issues

### 1. `startListening()` has no internal guard

`voice.ts`: `startListening()` calls `recognition.start()` unconditionally. The `main.ts` click handler guards against `'listening'` but not `'processing'`. The guard belongs inside `startListening()` itself.

**Fix:** Return early if `currentStatus !== 'idle'`.

---

### 2. `'processing'` state is phantom — UI never renders it

`voice.ts` onresult: `setStatus('processing')`, `callbacks.onTranscript(transcript)`, and `setStatus('idle')` are all synchronous. The `⏳` visual is immediately overwritten before any paint cycle.

**Fix:** Remove the `setStatus('processing')` call from `onresult` — it fires transitively and the UI never sees it.

---

### 3. `onerror` setTimeout handle not stored — races with new session

`voice.ts`: the 2-second error-reset `setTimeout` handle is never saved. If user starts a new session within 2 seconds, the timer fires mid-session and forces `setStatus('idle')` while recognition is running.

**Fix:** Store handle, clear it at the top of `startListening()`.

---

## MEDIUM Issues

### 4. `returnToAuto` voice action doesn't update camera HUD indicator

`main.ts`: voice handler calls `cameraController.returnToAuto()` but not `setCameraMode(hudElements, cameraController.state)`. The button-triggered path calls both.

**Fix:** Add `setCameraMode` call after `returnToAuto()` in voice handler.

---

### 5. `focus` action doesn't update `searchInput.value`

`main.ts`: `'search'` action populates the search box; `'focus'` action does not despite identical visual behavior. Inconsistent.

**Fix:** Add `hudElements.searchInput.value = intent.target` in the focus branch.

---

### 6. `zoomIn`/`zoomOut` declared in VoiceIntent but never handled

`detectVoiceIntent` can return `{ action: 'zoomIn' }` but `main.ts` silently drops it. Either implement or remove from the union.

---

### 7. `detectVoiceIntent` hard `$` anchors too strict for real speech

`"okay zoom out"` or `"zoom out please"` fall through to search fallback. Real speech recognition often includes filler words.

**Fix:** Drop `$` anchors from command patterns.

---

## LOW Issues

### 8. Test mock defaults contradict implementation config

`MockSpeechRecognition` defaults `continuous = true`, `interimResults = true`. Implementation sets both to `false`. No test verifies this.

**Fix:** Add assertions for these properties after `initVoice()`.

### 9. Fallback returns un-trimmed transcript

`detectVoiceIntent` fallback: `return { action: 'search', query: transcript }` — should be `transcript.trim()` for consistency.

### 10. No `destroy()` method

No way to `recognition.abort()` or clear timers. Low priority for a browser-only web app with no teardown lifecycle.
