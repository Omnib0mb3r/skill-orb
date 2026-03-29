# section-05-voice

## Overview

Voice search using the Web Speech API (`SpeechRecognition`). The web app runs in a
normal browser context with full microphone access — no VS Code CSP issues, no Whisper
pipeline required. A single mic button in the HUD activates speech recognition; the
transcribed text is routed to the search module.

**Depends on:** `section-03-camera-hud` (HUD mic button + search module)

**Parallel with:** `section-04-node-actions`

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/voice.ts` | Create — replace stub |
| `webview/search.ts` | Modify — add `detectVoiceIntent` pure function |
| `webview/hud.ts` | Modify — wire mic button to VoiceStatus state |

---

## Tests First

**`webview/__tests__/voice.test.ts`**

Mock `window.SpeechRecognition` (or `window.webkitSpeechRecognition`) in tests.

```typescript
// Test: initVoice returns null when SpeechRecognition is unavailable — hides mic button
// Test: startListening calls recognition.start()
// Test: stopListening calls recognition.stop()
// Test: onresult event fires onTranscript callback with transcript string
// Test: onerror event fires onError callback
// Test: detectVoiceIntent("show me all projects") → { action: 'search', query: 'project' }
// Test: detectVoiceIntent("focus on DevNeural") → { action: 'focus', target: 'DevNeural' }
// Test: detectVoiceIntent("zoom out") → { action: 'returnToAuto' }
// Test: detectVoiceIntent("search for playwright") → { action: 'search', query: 'playwright' }
// Test: detectVoiceIntent("unknown gibberish xyz") → { action: 'search', query: 'unknown gibberish xyz' }
```

---

## Implementation

### Voice Status States

```typescript
export type VoiceStatus = 'unavailable' | 'idle' | 'listening' | 'processing' | 'error';
```

### API

```typescript
export interface VoiceController {
  readonly status: VoiceStatus;
  startListening(): void;
  stopListening(): void;
}

export interface VoiceCallbacks {
  onTranscript(text: string): void;
  onStatusChange(status: VoiceStatus): void;
}

/**
 * Returns null if SpeechRecognition is not available in this browser.
 * Caller should hide the mic button when null is returned.
 */
export function initVoice(callbacks: VoiceCallbacks): VoiceController | null;
```

### Availability Check

```typescript
const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
if (!SpeechRecognition) return null;  // hide mic button
```

### Configuration

```typescript
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.maxAlternatives = 1;
recognition.continuous = false;  // single utterance per button press
```

### Voice Intent Detection (`webview/search.ts` addition)

```typescript
export interface VoiceIntent {
  action: 'search' | 'focus' | 'returnToAuto' | 'zoomIn' | 'zoomOut';
  query?: string;
  target?: string;
}

export function detectVoiceIntent(transcript: string): VoiceIntent;
```

Intent patterns (case-insensitive):
- `"zoom out"` | `"reset"` | `"show all"` → `{ action: 'returnToAuto' }`
- `"zoom in"` → `{ action: 'zoomIn' }`
- `"focus on <name>"` | `"go to <name>"` → `{ action: 'focus', target: name }`
- `"show me <X>"` | `"search for <X>"` | `"find <X>"` → `{ action: 'search', query: X }`
- Fallback: `{ action: 'search', query: transcript }`

### HUD mic button states

| VoiceStatus | Button appearance |
|---|---|
| `unavailable` | Hidden |
| `idle` | Mic icon, default color |
| `listening` | Mic icon, pulsing red |
| `processing` | Spinner |
| `error` | Mic icon with warning; reset to idle after 2s |

### src/main.ts wiring

```typescript
const voiceController = initVoice({
  onTranscript: (text) => {
    const intent = detectVoiceIntent(text);
    if (intent.action === 'search' && intent.query) {
      hudElements.searchInput.value = intent.query;
      applySearchVisuals(evaluateQuery(intent.query, lastNodes, lastEdges));
    } else if (intent.action === 'returnToAuto') {
      cameraController.returnToAuto();
    } else if (intent.action === 'focus' && intent.target) {
      applySearchVisuals(evaluateQuery(intent.target, lastNodes, lastEdges));
    }
  },
  onStatusChange: (status) => updateVoiceButton(hudElements.voiceButton, status),
});

hudElements.voiceButton.addEventListener('click', () => {
  if (voiceController?.status === 'listening') voiceController.stopListening();
  else voiceController?.startListening();
});
```
