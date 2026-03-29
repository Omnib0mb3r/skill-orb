import * as vscode from 'vscode';

export function createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(
    'devneuralGraph',
    'DevNeural',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    },
  );
}

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = generateNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src ${webview.cspSource} 'nonce-${nonce}';
             style-src ${webview.cspSource} 'unsafe-inline';
             connect-src https:">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevNeural</title>
  <style>
    body { margin: 0; overflow: hidden; background: #0d0d0d; }
    #devneural-canvas { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="devneural-canvas"></canvas>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
