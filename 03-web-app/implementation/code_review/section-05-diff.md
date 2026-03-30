diff --git a/03-web-app/src/main.ts b/03-web-app/src/main.ts
index 4724860..4676633 100644
--- a/03-web-app/src/main.ts
+++ b/03-web-app/src/main.ts
@@ -4,8 +4,9 @@ import { updateGraph, getGraphInstance, initOrb, updateRenderPositions, getNodeP
 import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
 import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
 import { createCameraController } from '../webview/camera';
-import { createHud, setConnectionStatus, setCameraMode } from '../webview/hud';
-import { evaluateQuery } from '../webview/search';
+import { createHud, setConnectionStatus, setCameraMode, updateVoiceButton } from '../webview/hud';
+import { evaluateQuery, detectVoiceIntent } from '../webview/search';
+import { initVoice } from '../webview/voice';
 import {
   createTooltip,
   buildInstanceMaps,
@@ -81,6 +82,31 @@ const hudElements = createHud({
   },
 });
 
+// Voice search
+const voiceController = initVoice({
+  onTranscript: (text) => {
+    const intent = detectVoiceIntent(text);
+    if (intent.action === 'search' && intent.query) {
+      hudElements.searchInput.value = intent.query;
+      applySearchVisuals(evaluateQuery(intent.query, lastNodes, lastEdges));
+    } else if (intent.action === 'returnToAuto') {
+      cameraController.returnToAuto();
+    } else if (intent.action === 'focus' && intent.target) {
+      applySearchVisuals(evaluateQuery(intent.target, lastNodes, lastEdges));
+    }
+  },
+  onStatusChange: (status) => updateVoiceButton(hudElements.voiceButton, status),
+});
+
+if (voiceController === null) {
+  updateVoiceButton(hudElements.voiceButton, 'unavailable');
+}
+
+hudElements.voiceButton.addEventListener('click', () => {
+  if (voiceController?.status === 'listening') voiceController.stopListening();
+  else voiceController?.startListening();
+});
+
 // Node interactions
 registerNodeInteractions({
   canvas,
diff --git a/03-web-app/webview/__tests__/voice.test.ts b/03-web-app/webview/__tests__/voice.test.ts
new file mode 100644
index 0000000..e47155d
--- /dev/null
+++ b/03-web-app/webview/__tests__/voice.test.ts
@@ -0,0 +1,105 @@
+import { describe, it, expect, vi, afterEach } from 'vitest';
+import { initVoice } from '../voice';
+import { detectVoiceIntent } from '../search';
+
+class MockSpeechRecognition {
+  lang = '';
+  interimResults = true;
+  maxAlternatives = 1;
+  continuous = true;
+
+  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
+  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
+  onend: (() => void) | null = null;
+
+  start = vi.fn();
+  stop = vi.fn();
+}
+
+function installMock(): MockSpeechRecognition {
+  const instance = new MockSpeechRecognition();
+  (window as any).SpeechRecognition = vi.fn(() => instance);
+  return instance;
+}
+
+afterEach(() => {
+  delete (window as any).SpeechRecognition;
+  delete (window as any).webkitSpeechRecognition;
+});
+
+describe('initVoice', () => {
+  it('returns null when SpeechRecognition is unavailable — hides mic button', () => {
+    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
+    expect(controller).toBeNull();
+  });
+
+  it('startListening calls recognition.start()', () => {
+    const mock = installMock();
+    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
+    controller!.startListening();
+    expect(mock.start).toHaveBeenCalled();
+  });
+
+  it('stopListening calls recognition.stop()', () => {
+    const mock = installMock();
+    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
+    controller!.startListening();
+    controller!.stopListening();
+    expect(mock.stop).toHaveBeenCalled();
+  });
+
+  it('onresult event fires onTranscript callback with transcript string', () => {
+    const mock = installMock();
+    const onTranscript = vi.fn();
+    const controller = initVoice({ onTranscript, onStatusChange: vi.fn() });
+    controller!.startListening();
+
+    mock.onresult!({
+      results: [[{ transcript: 'hello world' }]],
+      resultIndex: 0,
+    } as unknown as SpeechRecognitionEvent);
+
+    expect(onTranscript).toHaveBeenCalledWith('hello world');
+  });
+
+  it('onerror event fires onStatusChange with "error"', () => {
+    const mock = installMock();
+    const onStatusChange = vi.fn();
+    initVoice({ onTranscript: vi.fn(), onStatusChange });
+
+    mock.onerror!({ error: 'no-speech' } as SpeechRecognitionErrorEvent);
+
+    expect(onStatusChange).toHaveBeenCalledWith('error');
+  });
+});
+
+describe('detectVoiceIntent', () => {
+  it('"show me all projects" → { action: "search", query: "all projects" }', () => {
+    const result = detectVoiceIntent('show me all projects');
+    expect(result.action).toBe('search');
+    expect(result.query).toBe('all projects');
+  });
+
+  it('"focus on DevNeural" → { action: "focus", target: "DevNeural" }', () => {
+    const result = detectVoiceIntent('focus on DevNeural');
+    expect(result.action).toBe('focus');
+    expect(result.target).toBe('DevNeural');
+  });
+
+  it('"zoom out" → { action: "returnToAuto" }', () => {
+    const result = detectVoiceIntent('zoom out');
+    expect(result.action).toBe('returnToAuto');
+  });
+
+  it('"search for playwright" → { action: "search", query: "playwright" }', () => {
+    const result = detectVoiceIntent('search for playwright');
+    expect(result.action).toBe('search');
+    expect(result.query).toBe('playwright');
+  });
+
+  it('"unknown gibberish xyz" falls back to search with original transcript', () => {
+    const result = detectVoiceIntent('unknown gibberish xyz');
+    expect(result.action).toBe('search');
+    expect(result.query).toBe('unknown gibberish xyz');
+  });
+});
diff --git a/03-web-app/webview/hud.ts b/03-web-app/webview/hud.ts
index ebb4fd7..3dc64bf 100644
--- a/03-web-app/webview/hud.ts
+++ b/03-web-app/webview/hud.ts
@@ -1,4 +1,5 @@
 import type { CameraState } from './camera';
+import type { VoiceStatus } from './voice';
 
 export interface HudElements {
   statusIndicator: HTMLElement;
@@ -190,3 +191,35 @@ export function setCameraMode(elements: HudElements, state: CameraState): void {
   elements.cameraToggle.textContent = state;
   elements.returnToAutoButton.style.display = state === 'manual' ? 'inline-block' : 'none';
 }
+
+export function updateVoiceButton(button: HTMLButtonElement, status: VoiceStatus): void {
+  switch (status) {
+    case 'unavailable':
+      button.style.display = 'none';
+      break;
+    case 'idle':
+      button.style.display = '';
+      button.textContent = '🎤';
+      button.style.animation = '';
+      button.style.color = '';
+      break;
+    case 'listening':
+      button.style.display = '';
+      button.textContent = '🎤';
+      button.style.animation = 'dn-pulse 0.8s infinite';
+      button.style.color = '#ff4444';
+      break;
+    case 'processing':
+      button.style.display = '';
+      button.textContent = '⏳';
+      button.style.animation = '';
+      button.style.color = '';
+      break;
+    case 'error':
+      button.style.display = '';
+      button.textContent = '⚠️';
+      button.style.animation = '';
+      button.style.color = '#ff8800';
+      break;
+  }
+}
diff --git a/03-web-app/webview/search.ts b/03-web-app/webview/search.ts
index d95ae7a..04f74fe 100644
--- a/03-web-app/webview/search.ts
+++ b/03-web-app/webview/search.ts
@@ -1,5 +1,36 @@
 import type { GraphNode, GraphEdge } from '../src/types';
 
+export interface VoiceIntent {
+  action: 'search' | 'focus' | 'returnToAuto' | 'zoomIn' | 'zoomOut';
+  query?: string;
+  target?: string;
+}
+
+export function detectVoiceIntent(transcript: string): VoiceIntent {
+  const lower = transcript.toLowerCase().trim();
+  const trimmed = transcript.trim();
+
+  if (/^(zoom out|reset|show all)$/.test(lower)) {
+    return { action: 'returnToAuto' };
+  }
+
+  if (/^zoom in$/.test(lower)) {
+    return { action: 'zoomIn' };
+  }
+
+  const focusMatch = trimmed.match(/^(?:focus on|go to)\s+(.+)$/i);
+  if (focusMatch) {
+    return { action: 'focus', target: focusMatch[1].trim() };
+  }
+
+  const searchMatch = trimmed.match(/^(?:show me|search for|find)\s+(.+)$/i);
+  if (searchMatch) {
+    return { action: 'search', query: searchMatch[1].trim() };
+  }
+
+  return { action: 'search', query: transcript };
+}
+
 export interface SearchResult {
   matchingNodeIds: Set<string>;
   matchingEdgeIds: Set<string>;
diff --git a/03-web-app/webview/voice.ts b/03-web-app/webview/voice.ts
index 752811e..b3a4c44 100644
--- a/03-web-app/webview/voice.ts
+++ b/03-web-app/webview/voice.ts
@@ -1,2 +1,63 @@
-// Implemented in section-05-voice
-export {};
+export type VoiceStatus = 'unavailable' | 'idle' | 'listening' | 'processing' | 'error';
+
+export interface VoiceController {
+  readonly status: VoiceStatus;
+  startListening(): void;
+  stopListening(): void;
+}
+
+export interface VoiceCallbacks {
+  onTranscript(text: string): void;
+  onStatusChange(status: VoiceStatus): void;
+}
+
+export function initVoice(callbacks: VoiceCallbacks): VoiceController | null {
+  const SpeechRecognitionCtor =
+    (window as any).SpeechRecognition ??
+    (window as any).webkitSpeechRecognition;
+
+  if (!SpeechRecognitionCtor) return null;
+
+  const recognition = new SpeechRecognitionCtor() as SpeechRecognition;
+  recognition.lang = 'en-US';
+  recognition.interimResults = false;
+  recognition.maxAlternatives = 1;
+  recognition.continuous = false;
+
+  let currentStatus: VoiceStatus = 'idle';
+
+  function setStatus(s: VoiceStatus): void {
+    currentStatus = s;
+    callbacks.onStatusChange(s);
+  }
+
+  recognition.onresult = (event: SpeechRecognitionEvent) => {
+    const transcript = event.results[event.resultIndex][0].transcript;
+    setStatus('processing');
+    callbacks.onTranscript(transcript);
+    setStatus('idle');
+  };
+
+  recognition.onerror = (_event: SpeechRecognitionErrorEvent) => {
+    setStatus('error');
+    setTimeout(() => setStatus('idle'), 2000);
+  };
+
+  recognition.onend = () => {
+    if (currentStatus === 'listening') {
+      setStatus('idle');
+    }
+  };
+
+  return {
+    get status() { return currentStatus; },
+    startListening() {
+      setStatus('listening');
+      recognition.start();
+    },
+    stopListening() {
+      recognition.stop();
+      setStatus('idle');
+    },
+  };
+}
