import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  window,
  workspace,
  commands,
  Uri,
  ExtensionContext,
  _configChangeEmitter,
  _activeEditorChangeEmitter,
} from 'vscode';
import { readCachedSnapshot, writeCachedSnapshot, CACHE_KEY, MAX_CACHED_EDGES } from '../graphCache';
import { detectActiveProjects } from '../activeProject';
import { getWebviewContent } from '../panelManager';
import { activate, deactivate } from '../extension';
import type { CachedSnapshot, GraphEdge, GraphNode, GraphSnapshot } from '../types';

// ---------------------------------------------------------------------------
// WebSocket mock — must be defined before vi.mock('ws')
// ---------------------------------------------------------------------------

type MockWsInstance = {
  url: string;
  readyState: number;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  close: ReturnType<typeof vi.fn>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  simulateOpen(): void;
  simulateMessage(data: string): void;
  simulateClose(): void;
};

const { wsInstances, MockWebSocket } = vi.hoisted(() => {
  const wsInstances: MockWsInstance[] = [];

  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 0;
    url: string;
    handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map();
    close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    });

    constructor(url: string) {
      this.url = url;
      wsInstances.push(this as unknown as MockWsInstance);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event)!.push(handler);
    }

    private emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.forEach(h => h(...args));
    }

    simulateOpen(): void {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }

    simulateMessage(data: string): void {
      this.emit('message', Buffer.from(data));
    }

    simulateClose(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    }
  }

  return { wsInstances, MockWebSocket };
});

vi.mock('ws', () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCommandHandler(name: string): () => void {
  const call = vi.mocked(commands.registerCommand).mock.calls.find(([cmd]) => cmd === name);
  if (!call) throw new Error(`Command "${name}" not registered`);
  return call[1] as () => void;
}

function makeEdge(id: string, weight: number): GraphEdge {
  return {
    id,
    source: 'a',
    target: 'b',
    connection_type: 'used',
    weight,
    raw_count: 1,
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2024-01-01T00:00:00Z',
  };
}

function makeNode(id: string, type: GraphNode['type'] = 'project', localPath?: string): GraphNode {
  return { id, type, label: id, localPath };
}

// ---------------------------------------------------------------------------
// Pure function tests — graphCache
// ---------------------------------------------------------------------------

describe('graphCache', () => {
  it('readCachedSnapshot returns undefined on a fresh context', () => {
    const ws = { get: vi.fn().mockReturnValue(undefined) };
    expect(readCachedSnapshot(ws)).toBeUndefined();
  });

  it('readCachedSnapshot returns the stored value', () => {
    const snap: CachedSnapshot = { nodes: [], edges: [] };
    const ws = { get: vi.fn().mockReturnValue(snap) };
    expect(readCachedSnapshot(ws)).toBe(snap);
  });

  it('writeCachedSnapshot stores a snapshot via workspaceState.update', async () => {
    const ws = { update: vi.fn().mockResolvedValue(undefined) };
    const snap: GraphSnapshot = { nodes: [], edges: [makeEdge('e1', 1)] };
    await writeCachedSnapshot(ws, snap);
    expect(ws.update).toHaveBeenCalledWith(CACHE_KEY, expect.objectContaining({ edges: [makeEdge('e1', 1)] }));
  });

  it(`writeCachedSnapshot trims to ${MAX_CACHED_EDGES} edges sorted by weight desc`, async () => {
    const ws = { update: vi.fn().mockResolvedValue(undefined) };
    const edges = Array.from({ length: MAX_CACHED_EDGES + 10 }, (_, i) =>
      makeEdge(`e${i}`, i),
    );
    const snap: GraphSnapshot = { nodes: [], edges };
    await writeCachedSnapshot(ws, snap);

    const stored = ws.update.mock.calls[0][1] as CachedSnapshot;
    expect(stored.edges).toHaveLength(MAX_CACHED_EDGES);
    // First edge should have the highest weight
    expect(stored.edges[0].weight).toBe(MAX_CACHED_EDGES + 9);
    expect(stored.edges[MAX_CACHED_EDGES - 1].weight).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Pure function tests — activeProject detection
// ---------------------------------------------------------------------------

describe('active project detection (pure functions)', () => {
  const nodes: GraphNode[] = [
    makeNode('proj-a', 'project', '/home/dev/project-a'),
    makeNode('proj-b', 'project', '/home/dev/project-b'),
    makeNode('tool-x', 'tool'),
  ];

  it('returns node id when active file path starts with localPath', () => {
    expect(detectActiveProjects('/home/dev/project-a/src/index.ts', nodes)).toEqual(['proj-a']);
  });

  it('returns empty array when no node matches', () => {
    expect(detectActiveProjects('/home/dev/other/file.ts', nodes)).toEqual([]);
  });

  it('returns empty array for undefined activeFilePath', () => {
    expect(detectActiveProjects(undefined, nodes)).toEqual([]);
  });

  it('returns empty array for empty localPath nodes', () => {
    const noPathNodes: GraphNode[] = [makeNode('x', 'project')];
    expect(detectActiveProjects('/any/path', noPathNodes)).toEqual([]);
  });

  it('does not match a localPath that is a string prefix but not a path prefix', () => {
    const ambiguous: GraphNode[] = [makeNode('proj', 'project', '/home/dev/proj')];
    // '/home/dev/project/file.ts' starts with '/home/dev/proj' as a string but is a different directory
    expect(detectActiveProjects('/home/dev/project/file.ts', ambiguous)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure function tests — getWebviewContent
// ---------------------------------------------------------------------------

describe('getWebviewContent', () => {
  const mockWebview = {
    cspSource: 'mock-csp',
    asWebviewUri: vi.fn((uri: Uri) => new Uri('vscode-webview', 'extension', uri.path, '', '')),
  };
  const extensionUri = Uri.file('/mock/extension');

  let html: string;
  beforeEach(() => {
    html = getWebviewContent(mockWebview as unknown as import('vscode').Webview, extensionUri);
  });

  it('returns HTML containing a <canvas> element', () => {
    expect(html).toContain('<canvas');
  });

  it('includes a nonce attribute on the <script> tag', () => {
    expect(html).toMatch(/nonce="[A-Za-z0-9]{32}"/);
  });

  it('CSP contains connect-src https:', () => {
    expect(html).toContain('connect-src https:');
  });

  it('CSP does NOT contain connect-src ws://', () => {
    expect(html).not.toContain('connect-src ws://');
  });

  it('CSP contains script-src with webview.cspSource and the nonce', () => {
    expect(html).toMatch(/script-src mock-csp 'nonce-[A-Za-z0-9]{32}'/);
  });

  it('script src uses a webview URI (starts with vscode-webview://)', () => {
    expect(html).toMatch(/src="vscode-webview:\/\//);
  });
});

// ---------------------------------------------------------------------------
// Extension integration tests — shared setup
// ---------------------------------------------------------------------------

let ctx: InstanceType<typeof ExtensionContext>;

function resetExtensionState() {
  vi.clearAllMocks();
  wsInstances.length = 0;
  ctx = new ExtensionContext();
}

function cleanupExtension() {
  deactivate();
  ctx.subscriptions.forEach(s => s.dispose());
}

// ---------------------------------------------------------------------------
// Panel lifecycle tests
// ---------------------------------------------------------------------------

describe('panel lifecycle', () => {
  beforeEach(() => {
    resetExtensionState();
    activate(ctx);
  });

  afterEach(cleanupExtension);

  it('openGraphView creates a new panel when none exists', () => {
    getCommandHandler('devneural.openGraphView')();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      'devneuralGraph',
      'DevNeural',
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('openGraphView called a second time calls panel.reveal instead of creating a duplicate', () => {
    const handler = getCommandHandler('devneural.openGraphView');
    handler();
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    handler();
    expect(panel.reveal).toHaveBeenCalledTimes(1);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('panel.onDidDispose sets currentPanel to undefined (second call creates new panel)', () => {
    const handler = getCommandHandler('devneural.openGraphView');
    handler();
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    // Simulate VS Code disposing the panel
    panel.dispose();
    // After dispose, calling the command again should create a new panel
    handler();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('panel.onDidDispose closes the WebSocket connection', () => {
    getCommandHandler('devneural.openGraphView')();
    expect(wsInstances).toHaveLength(1);
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    panel.dispose();
    // ws should have been closed
    expect(wsInstances[0].close).toHaveBeenCalled();
  });

  it('panel.onDidDispose cancels any pending reconnect timer (clearTimeout is called)', () => {
    vi.useFakeTimers();
    try {
      getCommandHandler('devneural.openGraphView')();
      wsInstances[0].simulateClose(); // triggers reconnect timer
      const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
      panel.dispose(); // should cancel the timer
      vi.advanceTimersByTime(5_000);
      // Only 1 WS instance (no reconnect after dispose)
      expect(wsInstances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('panel is created with retainContextWhenHidden: true', () => {
    getCommandHandler('devneural.openGraphView')();
    const options = vi.mocked(window.createWebviewPanel).mock.calls[0][3];
    expect(options).toMatchObject({ retainContextWhenHidden: true });
  });
});

// ---------------------------------------------------------------------------
// WebSocket client tests
// ---------------------------------------------------------------------------

describe('WebSocket client', () => {
  beforeEach(() => {
    resetExtensionState();
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
  });

  afterEach(cleanupExtension);

  it('connects to ws://HOST:PORT/ws using apiServerHost and apiServerPort from settings', () => {
    cleanupExtension(); // deactivate + dispose old ctx subscriptions to avoid stale listeners
    vi.clearAllMocks();
    wsInstances.length = 0;
    ctx = new ExtensionContext();

    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, def: unknown) => {
        if (key === 'apiServerHost') return 'myserver';
        if (key === 'apiServerPort') return 9999;
        return def;
      }),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof workspace.getConfiguration>);

    activate(ctx);
    getCommandHandler('devneural.openGraphView')();

    expect(wsInstances[0].url).toBe('ws://myserver:9999/ws');
  });

  it('on message type "graph:snapshot", relays parsed payload to webview via postMessage', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    const snap: GraphSnapshot = { nodes: [makeNode('n1')], edges: [] };
    wsInstances[0].simulateMessage(JSON.stringify({ type: 'graph:snapshot', payload: snap }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'graph:snapshot' }),
    );
  });

  it('on message type "connection:new", relays parsed payload to webview via postMessage', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    const conn = { id: 'c1', source: 'a', target: 'b', connection_type: 'used', timestamp: 'now' };
    wsInstances[0].simulateMessage(JSON.stringify({ type: 'connection:new', payload: conn }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'connection:new' }),
    );
  });

  it('on WebSocket close, schedules reconnect with 1-second initial delay', () => {
    vi.useFakeTimers();
    try {
      wsInstances[0].simulateClose();
      expect(wsInstances).toHaveLength(1); // not yet reconnected
      vi.advanceTimersByTime(1_000);
      expect(wsInstances).toHaveLength(2); // reconnected after 1s
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnect delays follow exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s', () => {
    vi.useFakeTimers();
    try {
      const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
      for (let i = 0; i < expectedDelays.length; i++) {
        wsInstances[wsInstances.length - 1].simulateClose();
        // Just before the delay expires: no new ws yet
        vi.advanceTimersByTime(expectedDelays[i] - 1);
        expect(wsInstances).toHaveLength(i + 1);
        // At the delay: new ws created
        vi.advanceTimersByTime(1);
        expect(wsInstances).toHaveLength(i + 2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnect loop does not fire after panel is disposed', () => {
    vi.useFakeTimers();
    try {
      wsInstances[0].simulateClose(); // triggers 1s reconnect timer
      const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
      panel.dispose(); // cancels the timer
      vi.advanceTimersByTime(5_000);
      expect(wsInstances).toHaveLength(1); // no reconnect
    } finally {
      vi.useRealTimers();
    }
  });

  it('config change on a devneural.* key tears down current WebSocket and starts new connection', () => {
    expect(wsInstances).toHaveLength(1);
    _configChangeEmitter.fire({ affectsConfiguration: (s: string) => s === 'devneural' });
    // Old WS disconnected, new WS started
    expect(wsInstances[0].close).toHaveBeenCalled();
    expect(wsInstances).toHaveLength(2);
  });

  it('graph:snapshot caches at most 500 edges sorted by weight descending to workspaceState', async () => {
    const edges = Array.from({ length: 600 }, (_, i) => makeEdge(`e${i}`, i));
    wsInstances[0].simulateMessage(
      JSON.stringify({ type: 'graph:snapshot', payload: { nodes: [], edges } }),
    );
    // Allow microtasks to settle
    await Promise.resolve();
    const stored = vi.mocked(ctx.workspaceState.update).mock.calls[0]?.[1] as CachedSnapshot;
    expect(stored.edges).toHaveLength(500);
    expect(stored.edges[0].weight).toBe(599); // highest weight first
  });
});

// ---------------------------------------------------------------------------
// State persistence tests
// ---------------------------------------------------------------------------

describe('state persistence', () => {
  afterEach(cleanupExtension);

  it('on panel creation, sends cached snapshot from workspaceState to webview if it exists', () => {
    const cached: CachedSnapshot = { nodes: [makeNode('n1')], edges: [] };
    resetExtensionState();
    vi.mocked(ctx.workspaceState.get).mockReturnValue(cached);
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'graph:snapshot', payload: cached }),
    );
  });

  it('on first live graph:snapshot, updates workspaceState with the capped snapshot', async () => {
    resetExtensionState();
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
    const snap: GraphSnapshot = { nodes: [makeNode('n1')], edges: [makeEdge('e1', 1)] };
    wsInstances[0].simulateMessage(JSON.stringify({ type: 'graph:snapshot', payload: snap }));
    await Promise.resolve();
    expect(ctx.workspaceState.update).toHaveBeenCalledWith(
      CACHE_KEY,
      expect.objectContaining({ nodes: snap.nodes }),
    );
  });

  it('workspaceState.get on a fresh context returns undefined without throwing', () => {
    resetExtensionState();
    activate(ctx);
    expect(() => readCachedSnapshot(ctx.workspaceState)).not.toThrow();
    expect(readCachedSnapshot(ctx.workspaceState)).toBeUndefined();
  });

  it('cached snapshot with more than 500 edges is trimmed to 500 by weight before storing', async () => {
    resetExtensionState();
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
    const edges = Array.from({ length: 600 }, (_, i) => makeEdge(`e${i}`, i));
    wsInstances[0].simulateMessage(
      JSON.stringify({ type: 'graph:snapshot', payload: { nodes: [], edges } }),
    );
    await Promise.resolve();
    const stored = vi.mocked(ctx.workspaceState.update).mock.calls[0][1] as CachedSnapshot;
    expect(stored.edges).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// Active project detection — integration (setActiveProjects postMessage)
// ---------------------------------------------------------------------------

describe('active project detection (integration)', () => {
  beforeEach(() => {
    resetExtensionState();
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
    // Seed current nodes via a graph snapshot
    const nodes: GraphNode[] = [
      makeNode('proj-a', 'project', '/home/dev/project-a'),
      makeNode('tool-x', 'tool'),
    ];
    wsInstances[0].simulateMessage(
      JSON.stringify({ type: 'graph:snapshot', payload: { nodes, edges: [] } }),
    );
  });

  afterEach(cleanupExtension);

  it('active file path starting with a known localPath returns that node id', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    vi.mocked(panel.webview.postMessage).mockClear();
    _activeEditorChangeEmitter.fire({
      document: { uri: { fsPath: '/home/dev/project-a/src/index.ts' } },
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setActiveProjects',
        payload: { nodeIds: ['proj-a'] },
      }),
    );
  });

  it('active file path matching no localPath sends empty array', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    vi.mocked(panel.webview.postMessage).mockClear();
    _activeEditorChangeEmitter.fire({
      document: { uri: { fsPath: '/home/dev/other/file.ts' } },
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setActiveProjects', payload: { nodeIds: [] } }),
    );
  });

  it('empty localPath on all nodes produces no match and does not throw', () => {
    cleanupExtension(); // must deactivate first to clear currentPanel before reset
    resetExtensionState();
    activate(ctx);
    getCommandHandler('devneural.openGraphView')();
    wsInstances[wsInstances.length - 1].simulateMessage(
      JSON.stringify({
        type: 'graph:snapshot',
        payload: { nodes: [makeNode('x', 'project')], edges: [] },
      }),
    );
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    expect(() =>
      _activeEditorChangeEmitter.fire({ document: { uri: { fsPath: '/any/path' } } }),
    ).not.toThrow();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { nodeIds: [] } }),
    );
  });

  it('sends setActiveProjects postMessage with matched node ids on editor change', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    vi.mocked(panel.webview.postMessage).mockClear();
    _activeEditorChangeEmitter.fire({
      document: { uri: { fsPath: '/home/dev/project-a/README.md' } },
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'setActiveProjects',
      payload: { nodeIds: ['proj-a'] },
    });
  });

  it('sends setActiveProjects with empty array when no project matches (not omitted)', () => {
    const panel = vi.mocked(window.createWebviewPanel).mock.results[0].value;
    vi.mocked(panel.webview.postMessage).mockClear();
    _activeEditorChangeEmitter.fire(undefined);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'setActiveProjects',
      payload: { nodeIds: [] },
    });
  });
});
