diff --git a/03-web-app/src/types.ts b/03-web-app/src/types.ts
index d129db0..f685c4d 100644
--- a/03-web-app/src/types.ts
+++ b/03-web-app/src/types.ts
@@ -30,6 +30,9 @@ export type WsMessage =
       payload: Pick<GraphEdge, 'id' | 'source' | 'target' | 'connection_type'> & {
         timestamp: string;
       };
-    };
+    }
+  | { type: 'voice:focus'; payload: { nodeId: string } }
+  | { type: 'voice:highlight'; payload: { nodeIds: string[] } }
+  | { type: 'voice:clear'; payload: Record<string, never> };
 
 export type CachedSnapshot = GraphSnapshot; // edges already capped to 500
diff --git a/03-web-app/src/ws/client.ts b/03-web-app/src/ws/client.ts
new file mode 100644
index 0000000..d7cab2a
--- /dev/null
+++ b/03-web-app/src/ws/client.ts
@@ -0,0 +1,66 @@
+import type { WsMessage, GraphSnapshot } from '../types';
+import {
+  handleSnapshot,
+  handleConnectionNew,
+  handleVoiceFocus,
+  handleVoiceHighlight,
+  handleVoiceClear,
+} from './handlers';
+import type { SceneRef } from './handlers';
+
+const INITIAL_RECONNECT_DELAY_MS = 1_000;
+const MAX_RECONNECT_DELAY_MS = 30_000;
+
+let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
+let pendingSnapshot: GraphSnapshot | null = null;
+
+export function connect(url: string, scene: SceneRef, isSceneReady: () => boolean): void {
+  const ws = new WebSocket(url);
+
+  ws.onopen = () => {
+    reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
+  };
+
+  ws.onmessage = (event: MessageEvent) => {
+    try {
+      const msg = JSON.parse(event.data as string) as WsMessage;
+      switch (msg.type) {
+        case 'graph:snapshot':
+          handleSnapshot(scene, msg.payload, isSceneReady, (s) => { pendingSnapshot = s; });
+          break;
+        case 'connection:new':
+          handleConnectionNew(scene, {
+            id: msg.payload.id,
+            source: msg.payload.source,
+            target: msg.payload.target,
+            connection_type: msg.payload.connection_type,
+            timestamp: msg.payload.timestamp,
+          });
+          break;
+        case 'voice:focus':
+          handleVoiceFocus(scene, msg.payload);
+          break;
+        case 'voice:highlight':
+          handleVoiceHighlight(scene, msg.payload);
+          break;
+        case 'voice:clear':
+          handleVoiceClear(scene);
+          break;
+      }
+    } catch {
+      // ignore malformed messages
+    }
+  };
+
+  ws.onclose = () => {
+    setTimeout(() => connect(url, scene, isSceneReady), reconnectDelay);
+    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
+  };
+}
+
+export function applyPendingSnapshot(scene: SceneRef): void {
+  if (pendingSnapshot !== null) {
+    handleSnapshot(scene, pendingSnapshot, () => true, () => {});
+    pendingSnapshot = null;
+  }
+}
diff --git a/03-web-app/src/ws/handlers.ts b/03-web-app/src/ws/handlers.ts
new file mode 100644
index 0000000..1a8a44b
--- /dev/null
+++ b/03-web-app/src/ws/handlers.ts
@@ -0,0 +1,52 @@
+import type { GraphSnapshot } from '../types';
+
+export interface ConnectionNewPayload {
+  id: string;
+  source: string;
+  target: string;
+  connection_type: string;
+  timestamp: string;
+}
+
+export interface SceneRef {
+  clear(): void;
+  rebuild(snapshot: GraphSnapshot): void;
+  addEdge(edge: ConnectionNewPayload): void;
+  setFocusNode(nodeId: string): void;
+  setHighlightNodes(nodeIds: string[]): void;
+  clearHighlights(): void;
+}
+
+export function handleSnapshot(
+  scene: SceneRef,
+  payload: GraphSnapshot,
+  isReady: () => boolean,
+  setPending: (s: GraphSnapshot) => void,
+): void {
+  if (!isReady()) {
+    setPending(payload);
+    return;
+  }
+  scene.clear();
+  scene.rebuild(payload);
+}
+
+export function handleConnectionNew(scene: SceneRef, payload: ConnectionNewPayload): void {
+  scene.addEdge(payload);
+}
+
+export function handleVoiceFocus(scene: SceneRef, payload: { nodeId: string }): void {
+  scene.setFocusNode(payload.nodeId);
+}
+
+export function handleVoiceHighlight(scene: SceneRef, payload: { nodeIds: string[] }): void {
+  if (payload.nodeIds.length === 0) {
+    scene.clearHighlights();
+  } else {
+    scene.setHighlightNodes(payload.nodeIds);
+  }
+}
+
+export function handleVoiceClear(scene: SceneRef): void {
+  scene.clearHighlights();
+}
diff --git a/03-web-app/tests/ws/handlers.test.ts b/03-web-app/tests/ws/handlers.test.ts
new file mode 100644
index 0000000..06d4261
--- /dev/null
+++ b/03-web-app/tests/ws/handlers.test.ts
@@ -0,0 +1,182 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+
+vi.mock('three', () => ({}));
+
+import {
+  handleSnapshot,
+  handleConnectionNew,
+  handleVoiceFocus,
+  handleVoiceHighlight,
+  handleVoiceClear,
+} from '../../src/ws/handlers';
+import type { SceneRef } from '../../src/ws/handlers';
+import { connect, applyPendingSnapshot } from '../../src/ws/client';
+import type { GraphSnapshot } from '../../src/types';
+
+function makeScene(): SceneRef {
+  return {
+    clear: vi.fn(),
+    rebuild: vi.fn(),
+    addEdge: vi.fn(),
+    setFocusNode: vi.fn(),
+    setHighlightNodes: vi.fn(),
+    clearHighlights: vi.fn(),
+  };
+}
+
+const emptySnapshot: GraphSnapshot = { nodes: [], edges: [] };
+
+describe('WebSocket handlers', () => {
+  let scene: SceneRef;
+
+  beforeEach(() => {
+    scene = makeScene();
+  });
+
+  it('graph:snapshot handler → clears scene, then rebuilds', () => {
+    handleSnapshot(scene, emptySnapshot, () => true, vi.fn());
+    expect(scene.clear).toHaveBeenCalledTimes(1);
+    expect(scene.rebuild).toHaveBeenCalledWith(emptySnapshot);
+  });
+
+  it('connection:new handler → addEdge called, scene.clear NOT called', () => {
+    const payload = { id: 'e1', source: 'a', target: 'b', connection_type: 'uses', timestamp: '2024-01-01T00:00:00Z' };
+    handleConnectionNew(scene, payload);
+    expect(scene.addEdge).toHaveBeenCalledWith(payload);
+    expect(scene.clear).not.toHaveBeenCalled();
+  });
+
+  it('voice:focus handler → setFocusNode called with nodeId', () => {
+    handleVoiceFocus(scene, { nodeId: 'project:foo' });
+    expect(scene.setFocusNode).toHaveBeenCalledWith('project:foo');
+  });
+
+  it('voice:highlight handler → setHighlightNodes called with nodeIds', () => {
+    handleVoiceHighlight(scene, { nodeIds: ['a', 'b', 'c'] });
+    expect(scene.setHighlightNodes).toHaveBeenCalledWith(['a', 'b', 'c']);
+    expect(scene.clearHighlights).not.toHaveBeenCalled();
+  });
+
+  it('voice:highlight with empty nodeIds → clearHighlights called (same as voice:clear)', () => {
+    handleVoiceHighlight(scene, { nodeIds: [] });
+    expect(scene.clearHighlights).toHaveBeenCalledTimes(1);
+    expect(scene.setHighlightNodes).not.toHaveBeenCalled();
+  });
+
+  it('voice:clear handler → clearHighlights called', () => {
+    handleVoiceClear(scene);
+    expect(scene.clearHighlights).toHaveBeenCalledTimes(1);
+  });
+
+  it('snapshot received before scene init → buffered, applied once scene ready', () => {
+    let stored: GraphSnapshot | null = null;
+    const snapshot: GraphSnapshot = { nodes: [], edges: [] };
+
+    // Not ready → stores in pending, does NOT call scene
+    handleSnapshot(scene, snapshot, () => false, (s) => { stored = s; });
+    expect(scene.clear).not.toHaveBeenCalled();
+    expect(scene.rebuild).not.toHaveBeenCalled();
+    expect(stored).toBe(snapshot);
+
+    // Ready → clears and rebuilds
+    handleSnapshot(scene, snapshot, () => true, vi.fn());
+    expect(scene.clear).toHaveBeenCalledTimes(1);
+    expect(scene.rebuild).toHaveBeenCalledWith(snapshot);
+  });
+});
+
+// ----- Reconnect + pending snapshot tests -----
+
+type WsInstance = {
+  onopen: ((e: Event) => void) | null;
+  onclose: ((e: Event) => void) | null;
+  onmessage: ((e: MessageEvent) => void) | null;
+};
+
+function setupWsMock(): { instances: WsInstance[]; MockWS: ReturnType<typeof vi.fn> } {
+  const instances: WsInstance[] = [];
+  const MockWS = vi.fn().mockImplementation(() => {
+    const inst: WsInstance = { onopen: null, onclose: null, onmessage: null };
+    instances.push(inst);
+    return inst;
+  });
+  vi.stubGlobal('WebSocket', MockWS as unknown as typeof WebSocket);
+  return { instances, MockWS };
+}
+
+describe('WebSocket client reconnect', () => {
+  beforeEach(() => {
+    vi.useFakeTimers();
+  });
+
+  afterEach(() => {
+    vi.useRealTimers();
+    vi.unstubAllGlobals();
+    vi.clearAllMocks();
+  });
+
+  it('reconnect → exponential backoff delay increases between successive attempts', () => {
+    const { instances, MockWS } = setupWsMock();
+    const scene = makeScene();
+
+    connect('ws://localhost:3747/ws', scene, () => true);
+    expect(MockWS).toHaveBeenCalledTimes(1);
+
+    // Successful open resets delay to 1000ms
+    instances[0].onopen?.(new Event('open'));
+
+    // First close → reconnect scheduled at 1000ms
+    instances[0].onclose?.(new Event('close'));
+
+    // Should NOT reconnect before 1000ms
+    vi.advanceTimersByTime(999);
+    expect(MockWS).toHaveBeenCalledTimes(1);
+
+    // Should reconnect at exactly 1000ms
+    vi.advanceTimersByTime(1);
+    expect(MockWS).toHaveBeenCalledTimes(2);
+
+    // Second close (no open) → reconnect at 2000ms (doubled)
+    instances[1].onclose?.(new Event('close'));
+
+    vi.advanceTimersByTime(1999);
+    expect(MockWS).toHaveBeenCalledTimes(2);
+
+    vi.advanceTimersByTime(1);
+    expect(MockWS).toHaveBeenCalledTimes(3);
+  });
+});
+
+describe('applyPendingSnapshot', () => {
+  afterEach(() => {
+    vi.useRealTimers();
+    vi.unstubAllGlobals();
+    vi.clearAllMocks();
+  });
+
+  it('applies buffered snapshot, then clears the buffer on subsequent call', () => {
+    vi.useFakeTimers();
+    const { instances } = setupWsMock();
+    const scene = makeScene();
+    let sceneReady = false;
+
+    connect('ws://localhost:3747/ws', scene, () => sceneReady);
+
+    const snapshot: GraphSnapshot = { nodes: [], edges: [] };
+    instances[0].onmessage?.({
+      data: JSON.stringify({ type: 'graph:snapshot', payload: snapshot }),
+    } as MessageEvent);
+
+    // Scene not ready → buffered
+    expect(scene.clear).not.toHaveBeenCalled();
+
+    // Apply pending
+    applyPendingSnapshot(scene);
+    expect(scene.clear).toHaveBeenCalledTimes(1);
+    expect(scene.rebuild).toHaveBeenCalledWith(snapshot);
+
+    // Second call is a no-op (buffer cleared)
+    applyPendingSnapshot(scene);
+    expect(scene.clear).toHaveBeenCalledTimes(1);
+  });
+});
