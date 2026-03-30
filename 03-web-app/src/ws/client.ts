import type { WsMessage, GraphSnapshot } from '../types';
import {
  handleSnapshot,
  handleConnectionNew,
  handleVoiceFocus,
  handleVoiceHighlight,
  handleVoiceClear,
} from './handlers';
import type { SceneRef } from './handlers';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface ConnectionHandle {
  applyPendingSnapshot(scene: SceneRef): void;
}

export function connect(
  url: string,
  scene: SceneRef,
  isSceneReady: () => boolean,
): ConnectionHandle {
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let pendingSnapshot: GraphSnapshot | null = null;

  function doConnect(): void {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    };

    ws.onerror = () => {};

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        switch (msg.type) {
          case 'graph:snapshot':
            handleSnapshot(scene, msg.payload, isSceneReady, (s) => { pendingSnapshot = s; });
            break;
          case 'connection:new':
            handleConnectionNew(scene, msg.payload);
            break;
          case 'voice:focus':
            handleVoiceFocus(scene, msg.payload);
            break;
          case 'voice:highlight':
            handleVoiceHighlight(scene, msg.payload);
            break;
          case 'voice:clear':
            handleVoiceClear(scene);
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setTimeout(doConnect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
  }

  doConnect();

  return {
    applyPendingSnapshot(scene: SceneRef): void {
      if (pendingSnapshot !== null) {
        handleSnapshot(scene, pendingSnapshot, () => true, () => {});
        pendingSnapshot = null;
      }
    },
  };
}
