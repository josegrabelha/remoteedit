import type * as vscode from 'vscode';
import type { ConnectionProfile } from '../../connection/ConnectionManager';

class InputEvent<T> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: T): void { for (const listener of [...this.listeners]) listener(value); }
  dispose(): void { this.listeners.clear(); }
}

class InputCancellationSource {
  private readonly emitter = new InputEvent<void>();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event };
  cancel(): void { this.token.isCancellationRequested = true; this.emitter.fire(); }
  dispose(): void { this.emitter.dispose(); }
}

export const inputUi = {
  inputs: [] as (string | undefined)[],
  prompts: [] as unknown[],
  errors: [] as string[],
  information: [] as string[],
  picks: [] as unknown[],
  pickPrompts: [] as unknown[],
  configurationWrites: [] as { key: string; value: unknown }[],
  configuration: new Map<string, unknown>()
};

export const vscodeStub = {
  EventEmitter: InputEvent, CancellationTokenSource: InputCancellationSource,
  TreeItem: class {}, ThemeIcon: class {}, MarkdownString: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15 }, ConfigurationTarget: { Global: 1 },
  window: {
    showInputBox: async (options: unknown) => { inputUi.prompts.push(options); return inputUi.inputs.shift(); },
    showQuickPick: async (items: unknown, options: unknown) => {
      inputUi.pickPrompts.push({ items, options }); return inputUi.picks.shift();
    },
    showErrorMessage: async (message: string) => { inputUi.errors.push(message); },
    showInformationMessage: async (message: string) => { inputUi.information.push(message); },
    withProgress: async (_options: unknown, callback: (progress: unknown, token: InputCancellationSource['token']) => Promise<unknown>) => {
      const source = new InputCancellationSource();
      try { return await callback({ report() {} }, source.token); } finally { source.dispose(); }
    }
  },
  workspace: { getConfiguration: () => ({
    get: (key: string, fallback: unknown) => inputUi.configuration.has(key) ? inputUi.configuration.get(key) : fallback,
    inspect: (key: string) => ({ globalValue: inputUi.configuration.get(key) }),
    update: async (key: string, value: unknown) => {
      inputUi.configurationWrites.push({ key, value }); inputUi.configuration.set(key, value);
    }
  }) }
};

export function loadWithVscode<T>(load: () => T): T {
  const loader = require('node:module') as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === 'vscode'
    ? vscodeStub : Reflect.apply(original, loader, [request, parent, isMain]);
  try { return load(); } finally { loader._load = original; }
}

const { ConnectionManager } = loadWithVscode(() => require('../../connection/ConnectionManager') as typeof import('../../connection/ConnectionManager'));

export function profile(id: string, overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return { id, name: id, connectionType: 'sftp', host: `${id}.invalid`, port: 22, username: `${id}-user`,
    authType: 'password', startPath: '/', keepAlive: true, createdAt: 1, updatedAt: 1, ...overrides };
}

export const secretKey = (id: string, field: 'password' | 'passphrase') => `remoteedit.connectionSecret.${id}.${field}`;

export function createConnectionManagerHarness(profiles: ConnectionProfile[] = []) {
  for (const values of [inputUi.inputs, inputUi.prompts, inputUi.errors, inputUi.information, inputUi.picks, inputUi.pickPrompts, inputUi.configurationWrites]) values.length = 0;
  inputUi.configuration.clear();
  inputUi.configuration.set('diagnostics.debugLogs', true);
  inputUi.configuration.set('diagnostics.performanceLogs', true);
  const state = new Map<string, unknown>([['remoteedit.connectionProfiles', structuredClone(profiles)]]);
  const secrets = new Map<string, string>();
  const reads: string[] = [];
  const writes: { kind: 'state' | 'store' | 'delete'; key: string; value?: unknown }[] = [];
  const logs: string[] = [];
  const output = { appendLine: (line: string) => { logs.push(line); } } as vscode.OutputChannel;
  const context = {
    globalState: {
      get: <T>(key: string, fallback?: T) => structuredClone(state.has(key) ? state.get(key) : fallback),
      update: async (key: string, value: unknown) => {
        writes.push({ kind: 'state', key, value: structuredClone(value) });
        state.set(key, structuredClone(value));
      }
    },
    secrets: {
      get: async (key: string) => { reads.push(key); return secrets.get(key); },
      store: async (key: string, value: string) => { writes.push({ kind: 'store', key, value }); secrets.set(key, value); },
      delete: async (key: string) => { writes.push({ kind: 'delete', key }); secrets.delete(key); }
    }
  } as unknown as vscode.ExtensionContext;
  return { manager: new ConnectionManager(context, output), context, output, state, secrets, reads, writes, logs, ui: inputUi };
}

export type ConnectionManagerHarness = ReturnType<typeof createConnectionManagerHarness>;
