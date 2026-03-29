# section-11-voice

## Overview

This section implements the voice search feature for the DevNeural webview: a Whisper-based offline transcription pipeline using `@huggingface/transformers`, wired to the HUD mic button and search module. It begins with a mandatory spike POC to validate microphone access in VS Code webviews before any production code is written.

**Dependencies:**
- `section-09-camera-hud` — HUD mic button and `voiceButton` element must exist; `search.ts` must be in place for `detectVoiceIntent` integration
- `section-04-scaffold` — `@huggingface/transformers` must be listed as a dependency and bundled in the webview IIFE

**Parallel with:** `section-10-node-actions` (independent).

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `webview/voice.ts` | Create — pipeline init, recording, transcription |
| `webview/search.ts` | Modify — add `detectVoiceIntent` pure function |
| `webview/hud.ts` | Modify — wire mic button states to `VoiceStatus` |
| `spike/voice-poc.html` | Create — standalone spike POC page |

All paths: `C:\dev\tools\DevNeural\03-vscode-extension\`

---

## Part 8.0: Mandatory Spike POC

**Before writing any production voice code**, validate that `getUserMedia` is accessible in a VS Code webview panel. This must be treated as a blocking prerequisite.

### Spike Goal

Create `spike/voice-poc.html` — a minimal standalone HTML page that:
1. Requests microphone access via `navigator.mediaDevices.getUserMedia({ audio: true })`
2. Records 3 seconds of audio
3. Converts to `Float32Array` via `AudioContext.decodeAudioData`
4. Logs the array length to the console

Load this page inside an actual VS Code webview panel (add a temporary command to `extension.ts` that opens a webview loading this file) and verify the browser console shows the expected output.

### Spike Pass Criteria

- No permission denied errors
- `Float32Array` length > 0
- No Content Security Policy violations blocking microphone access

### If Spike Fails

If `getUserMedia` is blocked or CSP-denied:
1. Log a warning in the extension output channel: `"Voice search unavailable: microphone access blocked in this VS Code environment"`
2. Hide the mic button in the HUD (`voiceButton.style.display = 'none'`)
3. Skip `voice.ts` production implementation entirely — do NOT polyfill or work around blocked microphone access
4. The rest of the extension (3D graph, search, node actions) continues working

---

## Tests First

Test file: `webview/__tests__/voice.test.ts`

Run with vitest + jsdom. Mock `@huggingface/transformers` pipeline — no model download in CI.

```typescript
// Spike validation
// Test: Spike POC file exists at spike/voice-poc.html (file presence check, not execution)

// Pipeline initialization
// Test: initVoicePipeline() resolves without error when pipeline mock is available
// Test: initVoicePipeline() is idempotent — calling twice does not create two pipelines
// Test: initVoicePipeline() caches model in Cache API after first load
// Test: pipeline status transitions: idle → downloading → ready

// Recording
// Test: startRecording() calls getUserMedia({ audio: true })
// Test: stopRecording() returns a Float32Array
// Test: Float32Array is converted via AudioContext.decodeAudioData (not raw Blob)

// Transcription
// Test: transcribe(float32Array) calls pipeline with correct input format
// Test: transcribe returns text string from pipeline output
// Test: transcribe status transitions: ready → recording → transcribing → ready
// Test: transcribe handles empty audio (silence) without throwing

// Error handling
// Test: If getUserMedia rejects, status transitions to 'error' with message
// Test: If pipeline throws during transcription, status transitions to 'error'
// Test: 'error' status shows error message in mic button tooltip
```

Additional test file: `webview/__tests__/voice-intent.test.ts`

```typescript
// detectVoiceIntent pure function (in search.ts)
// Test: "show all projects" → { type: 'type', value: 'project' }
// Test: "find tools" → { type: 'type', value: 'tool' }
// Test: "search for playwright" → { type: 'label', value: 'playwright' }
// Test: "uses playwright" → { type: 'reverse', value: 'playwright' }
// Test: "beta projects" → { type: 'stage', value: 'beta' }
// Test: "clear search" → { type: 'clear', value: '' }
// Test: Unrecognized utterance falls through to { type: 'label', value: <full text> }
// Test: detectVoiceIntent is case-insensitive
```

---

## Implementation: `webview/voice.ts`

### VoiceStatus Type

```typescript
export type VoiceStatus =
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'error';
```

### Module Interface

```typescript
/**
 * Lazily initializes the Whisper pipeline.
 * Downloads model on first call; subsequent calls return immediately.
 * Uses browser Cache API to persist model weights between sessions.
 */
export async function initVoicePipeline(): Promise<void>

/**
 * Returns current pipeline status.
 */
export function getVoiceStatus(): VoiceStatus

/**
 * Begins recording. Resolves when recording starts.
 * Caller should call stopRecording() after desired duration or on button release.
 */
export async function startRecording(): Promise<void>

/**
 * Stops recording and returns audio as Float32Array (mono, 16kHz).
 */
export async function stopRecording(): Promise<Float32Array>

/**
 * Transcribes audio. Requires pipeline to be initialized (initVoicePipeline called first).
 * @param audio - Float32Array from stopRecording()
 * @returns Transcribed text string, or empty string if silence detected
 */
export async function transcribe(audio: Float32Array): Promise<string>

/**
 * Subscribe to status changes. Returns unsubscribe function.
 */
export function onStatusChange(cb: (status: VoiceStatus) => void): () => void
```

### Pipeline Initialization

```typescript
import { pipeline } from '@huggingface/transformers';

let asr: Awaited<ReturnType<typeof pipeline>> | null = null;

async function initVoicePipeline(): Promise<void> {
  if (asr !== null) return; // idempotent
  setStatus('downloading');
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
    dtype: 'q8',
    device: 'wasm',
  });
  setStatus('ready');
}
```

Model: `onnx-community/whisper-tiny.en` — quantized INT8, ~40MB download, cached in browser Cache API after first load. Uses WebAssembly backend (`device: 'wasm'`) — no CUDA or WebGPU required.

### Audio Capture and Conversion

Recording flow:
1. `getUserMedia({ audio: true })` → `MediaStream`
2. `MediaRecorder` with `audio/webm;codecs=opus`
3. Collect `Blob` chunks on `dataavailable`
4. On `stopRecording()`: assemble `Blob`, convert via `AudioContext.decodeAudioData`
5. Resample to mono 16kHz using `OfflineAudioContext`:

```typescript
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  // Resample to 16kHz mono
  const offlineCtx = new OfflineAudioContext(1, decoded.duration * 16000, 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}
```

### Transcription

```typescript
async function transcribe(audio: Float32Array): Promise<string> {
  if (!asr) throw new Error('Pipeline not initialized');
  setStatus('transcribing');
  try {
    const result = await asr(audio, { language: 'english', task: 'transcribe' });
    setStatus('ready');
    const text = Array.isArray(result) ? result[0].text : (result as any).text;
    return (text ?? '').trim();
  } catch (err) {
    setStatus('error');
    throw err;
  }
}
```

---

## Implementation: `detectVoiceIntent` in `webview/search.ts`

Add to `search.ts` (pure function, no Three.js references):

```typescript
export interface VoiceIntent {
  type: 'type' | 'stage' | 'label' | 'reverse' | 'clear';
  value: string;
}

export function detectVoiceIntent(utterance: string): VoiceIntent {
  const text = utterance.toLowerCase().trim();

  if (/^(clear|reset|show all|show everything)/.test(text)) {
    return { type: 'clear', value: '' };
  }
  if (/\b(projects?)\b/.test(text)) return { type: 'type', value: 'project' };
  if (/\b(tools?)\b/.test(text)) return { type: 'type', value: 'tool' };
  if (/\b(skills?)\b/.test(text)) return { type: 'type', value: 'skill' };
  if (/\b(alpha|beta|deployed|archived|sandbox)\b/.test(text)) {
    const match = text.match(/\b(alpha|beta|deployed|archived|sandbox)\b/);
    return { type: 'stage', value: match![1] };
  }
  if (/^(uses|connects to|connected to)\s+(.+)$/.test(text)) {
    const match = text.match(/^(?:uses|connects to|connected to)\s+(.+)$/);
    return { type: 'reverse', value: match![1] };
  }
  if (/^(search for|find|show)\s+(.+)$/.test(text)) {
    const match = text.match(/^(?:search for|find|show)\s+(.+)$/);
    return { type: 'label', value: match![1] };
  }
  return { type: 'label', value: text };
}
```

---

## HUD Integration

In `webview/main.ts`, wire the voice button after HUD creation:

```typescript
import { initVoicePipeline, startRecording, stopRecording, transcribe, onStatusChange, getVoiceStatus } from './voice';
import { detectVoiceIntent } from './search';

// Mic button click — toggle recording
hudElements.voiceButton.addEventListener('click', async () => {
  const status = getVoiceStatus();
  if (status === 'idle' || status === 'downloading') {
    await initVoicePipeline(); // no-op if already ready
  }
  if (status === 'ready') {
    await startRecording();
    hudElements.voiceButton.setAttribute('data-state', 'recording');
  } else if (status === 'recording') {
    const audio = await stopRecording();
    const text = await transcribe(audio);
    if (text) {
      const intent = detectVoiceIntent(text);
      // Map intent to search query string
      const query = intent.type === 'clear' ? '' :
                    intent.type === 'reverse' ? `uses ${intent.value}` :
                    intent.value;
      hudElements.searchInput.value = query;
      hudElements.searchInput.dispatchEvent(new Event('input'));
    }
  }
});

// Status badge on mic button
onStatusChange((status) => {
  hudElements.voiceButton.setAttribute('data-voice-status', status);
  hudElements.voiceButton.title = {
    idle: 'Voice search (click to load model)',
    downloading: 'Downloading Whisper model...',
    ready: 'Click to speak',
    recording: 'Recording... click to stop',
    transcribing: 'Transcribing...',
    error: 'Voice error — click to retry',
  }[status] ?? status;
});
```

### Mic Button CSS States

Style `voiceButton[data-voice-status]` variants in the webview's inline style or stylesheet:
- `downloading`: spinner animation on the button icon
- `recording`: red pulse ring
- `transcribing`: loading dots animation
- `error`: red tint with tooltip

---

## Content Security Policy Note

The CSP for the webview panel must allow `blob:` URLs for `AudioContext` and `MediaRecorder`. In `panelManager.ts`, update the CSP `connect-src` to include `blob:` if not already present. Do NOT add `ws:` or `wss:` — the extension host owns the WebSocket.

---

## Edge Cases

- **Model not yet cached, user clicks record immediately**: `initVoicePipeline()` transitions through `downloading` → `ready` automatically; button shows spinner while downloading.
- **Silence / no speech**: pipeline returns empty string or only whitespace — do nothing (don't submit empty query).
- **Webview regains focus after tab switch**: `retainContextWhenHidden` preserves pipeline state; no re-init needed.
- **Multiple rapid clicks**: `startRecording` is guarded by status check; clicking during `recording` calls `stopRecording`.
- **Model download failure** (network offline): catch in `initVoicePipeline`, transition to `error`, log to console.
