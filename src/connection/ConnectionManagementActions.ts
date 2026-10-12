/** Shared ordering and destinations for Advanced View and Native Sidebar. */
export const connectionManagementTitle = 'Connection & Settings Management';

export const connectionManagementActions = [
  { id: 'connections', label: 'Connections', buttonId: 'connectionManagementConnections', webview: true },
  { id: 'trustedSshHosts', label: 'Trusted SSH Hosts', buttonId: 'manageTrustedSshHostsButton', webview: true },
  { id: 'proxies', label: 'Proxies', buttonId: 'manageProxyProfilesButton', webview: true },
  { id: 'masterPassword', label: 'Master Password', buttonId: 'manageMasterPasswordButton', webview: false },
  { id: 'import', label: 'Import', buttonId: 'manageProfilesImportButton', webview: false },
  { id: 'export', label: 'Export', buttonId: 'manageProfilesExportButton', webview: false },
  { id: 'settings', label: 'Settings', buttonId: 'showSettingsButton', webview: false }
] as const;

export const connectionImportActions = [
  { id: 'backup', label: 'Import Remote Edit Backup', buttonId: 'connectionImportBackup', webview: false },
  { id: 'applications', label: 'Import Connections from Other Applications', buttonId: 'connectionImportOpen', webview: true }
] as const;

export type ManagementWebviewAction = Extract<
  typeof connectionManagementActions[number] | typeof connectionImportActions[number],
  { webview: true }
>['id'];

export function managementQuickPickItems<T extends { id: string; label: string; webview: boolean }>(actions: readonly T[]) {
  return actions.map(action => ({ ...action, label: action.label + (action.webview ? ' (Webview)' : '') }));
}

export function managementWebviewButton(action: ManagementWebviewAction): string {
  return [...connectionManagementActions, ...connectionImportActions].find(item => item.id === action)!.buttonId;
}
