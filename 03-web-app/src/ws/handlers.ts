import type { GraphSnapshot, WsMessage } from '../types';

export type ConnectionNewPayload = Extract<WsMessage, { type: 'connection:new' }>['payload'];

export interface SceneRef {
  clear(): void;
  rebuild(snapshot: GraphSnapshot): void;
  addEdge(edge: ConnectionNewPayload): void;
  setFocusNode(nodeId: string): void;
  setHighlightNodes(nodeIds: string[]): void;
  clearHighlights(): void;
  resetCamera(): void;
}

export function handleSnapshot(
  scene: SceneRef,
  payload: GraphSnapshot,
  isReady: () => boolean,
  setPending: (s: GraphSnapshot) => void,
): void {
  if (!isReady()) {
    setPending(payload);
    return;
  }
  scene.clear();
  scene.rebuild(payload);
}

export function handleConnectionNew(scene: SceneRef, payload: ConnectionNewPayload): void {
  scene.addEdge(payload);
}

export function handleVoiceFocus(scene: SceneRef, payload: { nodeId: string }): void {
  scene.setFocusNode(payload.nodeId);
}

export function handleVoiceHighlight(scene: SceneRef, payload: { nodeIds: string[] }): void {
  if (payload.nodeIds.length === 0) {
    scene.clearHighlights();
  } else {
    scene.setHighlightNodes(payload.nodeIds);
  }
}

export function handleVoiceClear(scene: SceneRef): void {
  scene.clearHighlights();
  scene.resetCamera();
}
