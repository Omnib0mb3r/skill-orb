import { createScene } from '../webview/renderer';
import { updateGraph, getGraphInstance, initOrb, updateRenderPositions } from '../webview/orb';
import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
import type { WsMessage } from './types';

const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
const { scene, startAnimationLoop } = createScene(canvas);

const graphOrb = getGraphInstance();
scene.add(graphOrb);

initOrb(scene);
initAnimation(scene);

startAnimationLoop((delta: number) => {
  graphOrb.tickFrame();
  updateRenderPositions();
  tickBreathing(delta * 1000);
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
        onSnapshot(msg.payload.edges.map(e => ({
          id: e.id,
          last_seen: new Date(e.last_seen).getTime(),
        })));
      }
      if (msg.type === 'connection:new') {
        onConnectionNew({
          source: msg.payload.source,
          target: msg.payload.target,
          connectionType: msg.payload.connection_type,
        });
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}

connect();
