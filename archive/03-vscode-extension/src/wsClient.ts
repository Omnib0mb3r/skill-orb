import WebSocket from 'ws';
import type { WsMessage } from './types';

export interface WsClientOptions {
  url: string;
  onMessage: (msg: WsMessage) => void;
}

const INITIAL_DELAY = 1_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_DELAY = 30_000;

export function createWsClient(options: WsClientOptions): {
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;
} {
  let ws: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let delay = INITIAL_DELAY;
  let disposed = false;

  function connect(): void {
    if (disposed) return;

    ws = new WebSocket(options.url);

    ws.on('open', () => {
      delay = INITIAL_DELAY; // reset backoff on successful connection
    });

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        options.onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      ws = undefined;
      if (!disposed) {
        scheduleReconnect();
      }
    });

    ws.on('error', () => {
      // error is always followed by close — let close handler handle retry
    });
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    const currentDelay = delay;
    delay = Math.min(delay * BACKOFF_MULTIPLIER, MAX_DELAY);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, currentDelay);
  }

  function disconnect(): void {
    disposed = true;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (ws) {
      ws.close();
      ws = undefined;
    }
  }

  function isConnected(): boolean {
    return ws !== undefined && (ws.readyState as number) === WebSocket.OPEN;
  }

  return { connect, disconnect, isConnected };
}
