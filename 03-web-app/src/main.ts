import { createScene } from '../webview/renderer';
import { updateGraph, getGraphInstance, initOrb, updateRenderPositions } from '../webview/orb';
import type { WsMessage } from './types';

const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
const { scene, startAnimationLoop } = createScene(canvas);

const graphOrb = getGraphInstance();
scene.add(graphOrb);

initOrb(scene);

startAnimationLoop(() => {
  graphOrb.tickFrame();
  updateRenderPositions();
});

// Browser WebSocket — connects to the DevNeural Python server
const WS_URL = 'ws://localhost:27182';

function connect(): void {
  const ws = new WebSocket(WS_URL);

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === 'graph:snapshot') {
        updateGraph(msg.payload);
      }
      // connection:new handler wired in section-02-animation
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}

connect();
