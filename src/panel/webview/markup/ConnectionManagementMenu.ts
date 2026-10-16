import { toolNavigationActions, type ToolView } from '../../../webview/ToolNavigationActions';
import { connectionManagementActions, connectionImportActions } from '../../../connection/ConnectionManagementActions';

export function renderConnectionManagementMenu(origin: ToolView = 'remoteEdit'): string {
  const button = (action: { buttonId: string; label: string }) =>
    `<button id="${action.buttonId}" class="profile-dropdown-item" type="button" role="menuitem">${action.label}</button>`;
  return toolNavigationActions(origin).map(button).join('\n') + '<div class="profile-dropdown-separator" role="separator"></div>' + connectionManagementActions.map(action => {
    const separator = action.id === 'import' || action.id === 'settings'
      ? '<div class="profile-dropdown-separator" role="separator"></div>' : '';
    if (action.id !== 'import') return separator + button(action);
    return separator + `<div id="connectionImportMenuWrap">
      <button id="${action.buttonId}" class="profile-dropdown-item" type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="connectionImportMenu"><span>${action.label}</span><svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 5 9.5 8l-3 3" /></svg></button>
      <div id="connectionImportMenu" class="profile-dropdown-menu connection-management-menu" role="menu" aria-label="Import">${connectionImportActions.map(button).join('')}</div>
    </div>`;
  }).join('\n');
}
