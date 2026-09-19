import type { RemoteSessionManager } from '../../remote/RemoteSessionManager';
import { loadWithVscode, vscodeStub, type ConnectionManagerHarness } from './ConnectionManagerHarness';
import { SidebarConnectionDraftStore } from '../../sidebar/ConnectionDraftStore';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { renderClientScript } from '../../panel/webview/scripts/ClientScript';

Object.assign(vscodeStub, { QuickPickItemKind: { Separator: -1 }, Uri: { file: (fsPath: string) => ({ fsPath }) } });

export const { RemoteEditPanel, RemoteEditSidebarController, RemoteEditPanelState } = loadWithVscode(() => ({
  ...require('../../panel/RemoteEditPanel') as typeof import('../../panel/RemoteEditPanel'),
  ...require('../../sidebar/SidebarController') as typeof import('../../sidebar/SidebarController'),
  ...require('../../panel/PanelState') as typeof import('../../panel/PanelState')
}));

// Exercise real connection methods and outbound serializers without starting unrelated VS Code views/services.
export function createConnectionUiHarness(harness: ConnectionManagerHarness, sessions: RemoteSessionManager) {
  const messages: { type: string; payload: any }[] = [];
  const panel: any = Object.create(RemoteEditPanel.prototype);
  Object.assign(panel, {
    connectionManager: harness.manager, sessions, output: harness.output,
    state: new RemoteEditPanelState(), sessionOrder: [],
    activeConnectionCancellationSources: new Map(), pendingConnectionOptions: new Map(),
    panel: { title: '', webview: { postMessage: async (message: { type: string; payload: any }) => { messages.push(structuredClone(message)); return true; } } },
    serverManagementController: { clearServerDashboardWarmupState() {}, warmUpServerDashboard() {} },
    postRemoteClipboardState() {}, postServerStatus() {}, updatePanelTitle() {},
    listDirectoryForConnection: async () => undefined
  });
  const sidebar: any = Object.create(RemoteEditSidebarController.prototype);
  let refreshes = 0;
  const pickRequests: any[] = [];
  const pickChoices: Array<(options: any) => unknown> = [];
  const revealed: unknown[] = [];
  Object.assign(sidebar, {
    context: harness.context, connectionManager: harness.manager, sessions, output: harness.output,
    connectingProfileIds: new Set(), connectionsProvider: { refresh: () => { refreshes++; } },
    connectionDrafts: new SidebarConnectionDraftStore(),
    connectionsTreeView: { reveal: async (item: unknown) => { revealed.push(item); } },
    refreshOpenConnectionsAndRevealStartPaths: async () => undefined,
    showQuickPickWithActiveItem: async (options: any) => {
      pickRequests.push(options);
      return pickChoices.length ? pickChoices.shift()!(options) : options.activeItem;
    }
  });
  return { panel, sidebar, messages, pickRequests, pickChoices, revealed, get refreshes() { return refreshes; } };
}

class FormElement {
  value = '';
  checked = false;
  disabled = false;
  textContent = '';
  hidden = false;
  dataset: Record<string, string> = {};
  children: FormElement[] = [];
  classList = { toggle() {}, add() {}, remove() {} };
  private html = '';
  get innerHTML(): string { return this.html; }
  set innerHTML(value: string) { this.html = value; this.children = []; }
  appendChild(child: FormElement): void { this.children.push(child); }
  addEventListener() {}
  closest() { return null; }
  querySelector() { return new FormElement(); }
  setAttribute() {}
  setSelectionRange() {}
  removeAttribute() {}
  focus() {}
  select() {}
  scrollIntoView() {}
}

export function createJumpWebviewHarness(profiles: unknown[], lifecycle = false) {
  const messages: any[] = [];
  const context: any = {
    profiles, connectionGroups: [], selectedProfileId: '', activeConnectionId: '', pendingConnectionNameGroupId: '', pendingConnectionNameNewGroupName: '',
    jumpProfileDropdownFilterText: '', saveProfileMenuOpen: false, FILES_STATUS_GLOBAL_KEY: 'global', SAVED_SECRET_MASK: '********',
    document: { createElement: () => new FormElement() },
    vscode: { postMessage: (message: unknown) => messages.push(JSON.parse(JSON.stringify(message))) },
    showUnsavedConnectionProfileSwitchDialog: async () => 'discard',
    showConnectionNameDialog: async () => ({ name: 'Quick saved', groupId: '' })
  };
  const viewOnly = ['setStatus', 'setBusy', 'setControls', 'hideProfileDropdown', 'hideJumpProfileDropdown',
    'updateProfileDropdownLabel', 'renderProfileDropdown', 'renderConnectionNameGroupOptions', 'updateCredentialState',
    'updateConnectionTypeDropdown', 'updateAuthFields'];
  for (const name of viewOnly) context[name] = () => undefined;
  for (const name of ['profileName', 'host', 'connectionType', 'port', 'username', 'jumpProfileId', 'authType', 'password',
    'rememberPassword', 'privateKeyPath', 'passphrase', 'rememberPassphrase', 'startPath', 'keepAlive',
    'ftpsAllowSelfSignedCertificate', 'ftpsCaCertificatePath', 'profileSelect', 'profileDropdownButton', 'profileDropdownLabel',
    'jumpProfileBlock', 'jumpProfileDropdownButton', 'jumpProfileDropdownLabel', 'jumpProfileDropdownMenu', 'jumpRouteSummary',
    'saveProfileSplitButton', 'saveProfileMenuButton', 'saveProfileMenu', 'saveProfileAsButton']) {
    context[name] = new FormElement();
  }
  if (lifecycle) {
    Object.assign(context, {
      sessions: [], clientPendingSessionsByConnectionId: new Map(), selectedEntryPaths: new Set(),
      profileDisconnectingIds: new Set(), serverPortForwardAutoStartedConnectionIds: new Set(),
      currentEntries: [], entriesRenderGeneration: 0, connectionButtonState: '', profileDropdownOpen: false,
      remoteSearchDialogOpen: false, remoteCommandDialogOpen: false, pathFavoritesOpen: false,
      manageProfilesDialogOpen: false, renameProfileId: '',
      saveProfileButtonFeedbackProfileId: '', currentPath: new FormElement(),
      sessionTabs: new FormElement(), browserSectionDivider: null, sessionTabsScrollbar: null,
      SESSION_TAB_CONNECTING_ICON: '', SESSION_TAB_ERROR_ICON: '', SESSION_TAB_REMOTE_ICON: '',
      requestAnimationFrame: (callback: () => void) => callback(),
      setBusy: (busy: boolean, message: string) => { context.busy = busy; context.statusMessage = message; }
    });
    for (const name of ['filesStatusByConnectionId', 'filesStableStatusByConnectionId',
      'serverLogShortcutsSessionByConnectionId', 'serverPortForwardRuntimeByConnectionId']) context[name] = new Map();
    for (const name of ['clearFilterText', 'renderEntriesEmptyMessage', 'renderProfiles', 'updateActiveSessionUi',
      'updatePathFavoriteControls', 'clearSessionTabDragState',
      'updateConnectionViewUi', 'clearFilesStatusResetTimerForMissingSessions', 'requestServerPortForwardStatesForSession',
      'maybeAutoStartServerPortForwardsForSession', 'pruneConnectionViewState', 'pruneNavigationHistoryForSessions',
      'saveActiveFileListSnapshot', 'pruneFileListSnapshotsForSessions', 'restoreFilesStatusForActiveConnection',
      'restoreFileListSnapshotForConnection', 'hideContextMenu', 'initializeNavigationHistoryForActiveSession',
      'syncConnectionFormWithActiveSession', 'updateRemotePathNavigationControls', 'maybeRequestServerDashboardForActiveView',
      'updateServerAutoRefreshTimer', 'getRemoteSearchStateForActiveConnection', 'applyRemoteSearchFormForActiveConnection',
      'renderRemoteSearchState', 'renderRemoteCommandBadge']) context[name] = () => undefined;
  }
  // Parse the complete generated script because the source modules intentionally split function bodies.
  // Execute exact production declarations and their dependencies, replacing only unrelated view/dialog work.
  const script = renderClientScript({ showRemotePathBreadcrumbDirectoryDetails: true, openFileListItemsOnNameClick: true, permissionsDisplayMode: 'symbolic' });
  const source = ts.createSourceFile('webview.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map<string, ts.FunctionDeclaration>();
  let messageHandler: ts.Node | undefined;
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.addEventListener'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'message'
      && node.arguments[1].getText(source).includes('switch (message.type)')) messageHandler = node.arguments[1];
    ts.forEachChild(node, collect);
  };
  collect(source);
  const selected = new Set<string>();
  const include = (name: string): void => {
    if (selected.has(name) || name in context) return;
    const declaration = functions.get(name);
    if (!declaration) throw new Error(`Missing generated function ${name}`);
    selected.add(name);
    const dependencies = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && functions.has(node.expression.text)) include(node.expression.text);
      ts.forEachChild(node, dependencies);
    };
    dependencies(declaration);
  };
  for (const name of ['selectProfile', 'requestSelectProfile', 'selectJumpProfile', 'selectConnectionType', 'collectConnectionPayload',
    'saveCurrentConnection', 'saveCurrentConnectionAs', 'buildConnectionCopyName', 'isSelectedSavedConnectionDirty', 'getJumpProfileSelectionError', 'analyzeJumpProfileCandidate', 'updateJumpProfilePicker']) include(name);
  if (lifecycle) {
    for (const name of ['createClientConnectionId', 'createClientPendingSession', 'getPendingSessionForCurrentForm',
      'hasAnyConnectingSession', 'isSessionConnected', 'getActiveSession', 'renderSessionTabs']) include(name);
  }
  createContext(context);
  runInContext([...selected].map(name => functions.get(name)!.getText(source)).join('\n'), context);
  if (lifecycle) {
    if (!messageHandler) throw new Error('Missing generated message handler');
    runInContext('dispatchMessage = ' + messageHandler.getText(source), context);
  }
  return { context, messages };
}
