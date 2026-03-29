import * as vscode from 'vscode';
import { createWsClient } from './wsClient';
import { createPanel, getWebviewContent } from './panelManager';
import { readCachedSnapshot, writeCachedSnapshot } from './graphCache';
import { detectActiveProjects } from './activeProject';
import type { GraphNode, WsMessage } from './types';

let currentPanel: vscode.WebviewPanel | undefined;
let wsClient: ReturnType<typeof createWsClient> | undefined;
let currentNodes: GraphNode[] = [];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devneural.openGraphView', () => {
      openOrRevealPanel(context);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devneural')) {
        reconnectWs(context);
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!currentPanel) return;
      const ed = editor as { document?: { uri: vscode.Uri } } | undefined;
      const filePath = ed?.document?.uri.fsPath;
      const nodeIds = detectActiveProjects(filePath, currentNodes);
      void currentPanel.webview.postMessage({
        type: 'setActiveProjects',
        payload: { nodeIds },
      });
    }),
  );
}

function openOrRevealPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }

  currentPanel = createPanel(context);
  currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionUri);

  currentPanel.onDidDispose(() => disposePanel(), null, context.subscriptions);

  const cached = readCachedSnapshot(context.workspaceState);
  if (cached) {
    void currentPanel.webview.postMessage({ type: 'graph:snapshot', payload: cached });
  }

  startWs(context);
}

function disposePanel(): void {
  currentPanel = undefined;
  wsClient?.disconnect();
  wsClient = undefined;
}

function startWs(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('devneural');
  const host = config.get<string>('apiServerHost', 'localhost');
  const port = config.get<number>('apiServerPort', 3747);
  const url = `ws://${host}:${port}/ws`;

  wsClient = createWsClient({
    url,
    onMessage: (msg: WsMessage) => {
      if (!currentPanel) return;
      if (msg.type === 'graph:snapshot') {
        currentNodes = msg.payload.nodes;
        void writeCachedSnapshot(context.workspaceState, msg.payload);
        void currentPanel.webview.postMessage({ type: 'graph:snapshot', payload: msg.payload });
      } else if (msg.type === 'connection:new') {
        void currentPanel.webview.postMessage({ type: 'connection:new', payload: msg.payload });
      }
    },
  });

  wsClient.connect();
}

function reconnectWs(context: vscode.ExtensionContext): void {
  wsClient?.disconnect();
  wsClient = undefined;
  if (currentPanel) {
    startWs(context);
  }
}

export function deactivate(): void {
  wsClient?.disconnect();
  wsClient = undefined;
  currentPanel?.dispose();
  currentPanel = undefined;
  currentNodes = [];
}
