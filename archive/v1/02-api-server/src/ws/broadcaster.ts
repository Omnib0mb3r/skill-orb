import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from './types.js';

let wss: WebSocketServer | null = null;

export function setWss(server: WebSocketServer): void {
  wss = server;
}

export function broadcast(msg: ServerMessage): void {
  if (!wss) return;
  const serialized = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

export function getClientCount(): number {
  return wss?.clients.size ?? 0;
}
