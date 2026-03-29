// Hand-rolled VS Code API mock for vitest unit tests.
import { vi } from 'vitest';

type EventCallback<T> = (data: T) => void;
type Disposable = { dispose: () => void };

function createEventEmitter<T>() {
  const listeners: EventCallback<T>[] = [];
  const event = (cb: EventCallback<T>): Disposable => {
    listeners.push(cb);
    return {
      dispose: () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
  };
  const fire = (data: T) => listeners.forEach(cb => cb(data));
  return { event, fire };
}

const configChangeEmitter = createEventEmitter<{ affectsConfiguration: (s: string) => boolean }>();
const activeEditorChangeEmitter = createEventEmitter<unknown>();

export const window = {
  createWebviewPanel: vi.fn((_viewType: string, _title: string) => {
    const disposeEmitter = createEventEmitter<void>();
    return {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: createEventEmitter<unknown>().event,
        cspSource: 'mock-csp',
        asWebviewUri: vi.fn((uri: Uri) => uri),
      },
      reveal: vi.fn(),
      onDidDispose: disposeEmitter.event,
      onDidChangeViewState: createEventEmitter<unknown>().event,
      dispose: vi.fn(),
      visible: true,
      active: true,
    };
  }),
  onDidChangeActiveTextEditor: activeEditorChangeEmitter.event,
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn(<T>(_key: string, defaultValue?: T): T => defaultValue as T),
    has: vi.fn(() => false),
    update: vi.fn(),
  })),
  onDidChangeConfiguration: configChangeEmitter.event,
  workspaceFolders: undefined as { uri: Uri; name: string }[] | undefined,
};

export const commands = {
  registerCommand: vi.fn((_command: string, _handler: (...args: unknown[]) => unknown): Disposable => ({
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(),
};

export class Uri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const joined = [base.path, ...pathSegments].join('/').replace(/\/+/g, '/');
    return new Uri(base.scheme, base.authority, joined, base.query, base.fragment);
  }

  static parse(value: string): Uri {
    return new Uri('file', '', value, '', '');
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  with(change: Partial<{ scheme: string; authority: string; path: string; query: string; fragment: string }>): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
}

export const env = {
  openExternal: vi.fn(),
};

export class ExtensionContext {
  workspaceState = {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn((): string[] => []),
  };
  extensionUri = Uri.file('/mock/extension');
  subscriptions: Disposable[] = [];
}

// Exposed emitters for test control
export const _configChangeEmitter = configChangeEmitter;
export const _activeEditorChangeEmitter = activeEditorChangeEmitter;
