// Entry point for the DevNeural webview bundle.
// Full implementation in section-06-threejs-scene and beyond.
import { WebGLRenderer } from 'three';

// Expose renderer class so the extension host can detect WebGL support.
// Side-effectful assignment prevents tree-shaking — used in section-06.
(window as unknown as Record<string, unknown>)['DevNeuralRendererClass'] = WebGLRenderer;

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type: string; payload: unknown };
  void message; // Routing implemented in section-06
});
