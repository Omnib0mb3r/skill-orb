import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => ({}));

import {
  handleSnapshot,
  handleConnectionNew,
  handleVoiceFocus,
  handleVoiceHighlight,
  handleVoiceClear,
} from '../../src/ws/handlers';
import type { SceneRef } from '../../src/ws/handlers';
import { connect } from '../../src/ws/client';
import type { GraphSnapshot } from '../../src/types';

function makeScene(): SceneRef {
  return {
    clear: vi.fn(),
    rebuild: vi.fn(),
    addEdge: vi.fn(),
    setFocusNode: vi.fn(),
    setHighlightNodes: vi.fn(),
    clearHighlights: vi.fn(),
    resetCamera: vi.fn(),
  };
}

const emptySnapshot: GraphSnapshot = { nodes: [], edges: [] };

describe('WebSocket handlers', () => {
  let scene: SceneRef;

  beforeEach(() => {
    scene = makeScene();
  });

  it('graph:snapshot handler → clears scene, then rebuilds', () => {
    handleSnapshot(scene, emptySnapshot, () => true, vi.fn());
    expect(scene.clear).toHaveBeenCalledTimes(1);
    expect(scene.rebuild).toHaveBeenCalledWith(emptySnapshot);
  });

  it('connection:new handler → addEdge called, scene.clear NOT called', () => {
    const payload = { id: 'e1', source: 'a', target: 'b', connection_type: 'uses', timestamp: '2024-01-01T00:00:00Z' };
    handleConnectionNew(scene, payload);
    expect(scene.addEdge).toHaveBeenCalledWith(payload);
    expect(scene.clear).not.toHaveBeenCalled();
  });

  it('voice:focus handler → setFocusNode called with nodeId', () => {
    handleVoiceFocus(scene, { nodeId: 'project:foo' });
    expect(scene.setFocusNode).toHaveBeenCalledWith('project:foo');
  });

  it('voice:highlight handler → setHighlightNodes called with nodeIds', () => {
    handleVoiceHighlight(scene, { nodeIds: ['a', 'b', 'c'] });
    expect(scene.setHighlightNodes).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(scene.clearHighlights).not.toHaveBeenCalled();
  });

  it('voice:highlight with empty nodeIds → clearHighlights called (same as voice:clear)', () => {
    handleVoiceHighlight(scene, { nodeIds: [] });
    expect(scene.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.setHighlightNodes).not.toHaveBeenCalled();
  });

  it('voice:clear handler → clearHighlights and resetCamera called', () => {
    handleVoiceClear(scene);
    expect(scene.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.resetCamera).toHaveBeenCalledTimes(1);
  });

  it('snapshot received before scene init → buffered, applied once scene ready', () => {
    let stored: GraphSnapshot | null = null;
    const snapshot: GraphSnapshot = { nodes: [], edges: [] };

    handleSnapshot(scene, snapshot, () => false, (s) => { stored = s; });
    expect(scene.clear).not.toHaveBeenCalled();
    expect(stored).toBe(snapshot);

    handleSnapshot(scene, snapshot, () => true, vi.fn());
    expect(scene.clear).toHaveBeenCalledTimes(1);
    expect(scene.rebuild).toHaveBeenCalledWith(snapshot);
  });
});

// ----- Reconnect + pending snapshot tests -----

type WsInstance = {
  onopen: ((e: Event) => void) | null;
  onclose: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
};

function setupWsMock(): { instances: WsInstance[]; MockWS: ReturnType<typeof vi.fn> } {
  const instances: WsInstance[] = [];
  const MockWS = vi.fn().mockImplementation(() => {
    const inst: WsInstance = { onopen: null, onclose: null, onmessage: null };
    instances.push(inst);
    return inst;
  });
  vi.stubGlobal('WebSocket', MockWS as unknown as typeof WebSocket);
  return { instances, MockWS };
}

describe('WebSocket client reconnect', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnect → exponential backoff delay increases between successive attempts', () => {
    const { instances, MockWS } = setupWsMock();
    const scene = makeScene();

    connect('ws://localhost:3747/ws', scene, () => true);
    expect(MockWS).toHaveBeenCalledTimes(1);

    instances[0].onopen?.(new Event('open'));  // reset delay to 1000ms
    instances[0].onclose?.(new Event('close')); // schedule at 1000ms

    vi.advanceTimersByTime(999);
    expect(MockWS).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(MockWS).toHaveBeenCalledTimes(2);

    instances[1].onclose?.(new Event('close')); // schedule at 2000ms (doubled)

    vi.advanceTimersByTime(1999);
    expect(MockWS).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(MockWS).toHaveBeenCalledTimes(3);
  });
});

describe('applyPendingSnapshot', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applies buffered snapshot, then clears the buffer on subsequent call', () => {
    vi.useFakeTimers();
    const { instances } = setupWsMock();
    const scene = makeScene();
    let sceneReady = false;

    const handle = connect('ws://localhost:3747/ws', scene, () => sceneReady);

    const snapshot: GraphSnapshot = { nodes: [], edges: [] };
    instances[0].onmessage?.({
      data: JSON.stringify({ type: 'graph:snapshot', payload: snapshot }),
    } as MessageEvent);

    expect(scene.clear).not.toHaveBeenCalled();

    handle.applyPendingSnapshot(scene);
    expect(scene.clear).toHaveBeenCalledTimes(1);
    expect(scene.rebuild).toHaveBeenCalledWith(snapshot);

    handle.applyPendingSnapshot(scene);
    expect(scene.clear).toHaveBeenCalledTimes(1);
  });
});
