import { toolNavigationActions, type ToolView } from './ToolNavigationActions';
import { renderConnectionManagementMenu } from '../panel/webview/markup/ConnectionManagementMenu';
import { connectionManagementActions, connectionImportActions } from '../connection/ConnectionManagementActions';

/** Management menu for WS/MT. Destinations reuse the existing management services. */
export function renderManagementButton(): string {
  return `<button id="manageProfilesButton" type="button" class="secondary management-menu-button has-tooltip" aria-label="Tools &amp; Settings" data-tooltip="Tools &amp; Settings" aria-haspopup="menu" aria-expanded="false" aria-controls="connectionManagementMenu"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-280v-40h560v40H200Zm0-180v-40h560v40H200Zm0-180v-40h560v40H200Z" /></svg></button>`;
}

export function renderManagementMenu(origin: ToolView = 'workspaceSync'): string {
  return `<div id="connectionManagementMenu" class="profile-dropdown-menu connection-management-menu" role="menu" aria-label="Tools &amp; Settings">${renderConnectionManagementMenu(origin)}</div>`;
}

export function renderManagementStyles(): string {
  return `
  #manageProfilesButton.management-menu-button { width:27px;min-width:27px;max-width:27px;height:27px;min-height:27px;padding:1px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 27px;line-height:0; }
  .management-menu-button svg { width:24px;height:24px;display:block;fill:currentColor; }
  .connection-management-menu { position:fixed;z-index:150;display:none;width:max-content;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);box-sizing:border-box;overflow:auto;padding:5px;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:5px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));box-shadow:0 8px 22px rgba(0,0,0,.35); }
  .connection-management-menu .profile-dropdown-item { width:100%;min-height:30px;height:auto;display:grid;grid-template-columns:minmax(0,1fr);gap:2px;align-items:center;padding:5px 7px;border:0;border-radius:3px;background:transparent;color:inherit;text-align:left;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);white-space:normal; }
  .connection-management-menu .profile-dropdown-item:hover:not(:disabled) { background:var(--vscode-list-hoverBackground); }
  .connection-management-menu .profile-dropdown-item:focus-visible { outline:1px solid var(--vscode-focusBorder);outline-offset:-1px; }
  .connection-management-menu .profile-dropdown-separator { height:1px;margin:5px 3px;background:var(--vscode-menu-separatorBackground,var(--vscode-panel-border)); }
  #manageProfilesImportButton { grid-template-columns:minmax(0,1fr) auto; }
  .connection-management-menu .profile-dropdown-chevron { width:15px;height:15px;display:block;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;fill:none;opacity:.78; }
  `;
}

export function renderManagementScript(origin: ToolView = 'workspaceSync'): string {
  const actions = [...connectionManagementActions, ...connectionImportActions].filter(action => action.id !== 'import');
  return `(() => {
    const button = document.getElementById('manageProfilesButton');
    const menu = document.getElementById('connectionManagementMenu');
    const submenu = document.getElementById('connectionImportMenu');
    const importButton = document.getElementById('manageProfilesImportButton');
    document.body.append(menu, submenu);
    const contains = target => menu.contains(target) || submenu.contains(target);
    const items = container => Array.from(container.querySelectorAll('button[role="menuitem"]'));
    function position(container, anchor, nested) {
      const rect = anchor.getBoundingClientRect(); container.style.display = 'block';
      const width = container.offsetWidth, height = container.offsetHeight;
      let left = nested ? rect.right + 4 : rect.right - width;
      if (nested && left + width > innerWidth - 8) left = rect.left - width - 4;
      container.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
      container.style.top = Math.max(8, Math.min(nested ? rect.top : rect.bottom + 4, innerHeight - height - 8)) + 'px';
    }
    function closeImport() { submenu.style.display = 'none'; importButton.setAttribute('aria-expanded', 'false'); }
    function close(focus) { closeImport(); menu.style.display = 'none'; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); }
    function open(key) { position(menu, button, false); button.setAttribute('aria-expanded', 'true'); const list = items(menu); (key === 'ArrowUp' || key === 'End' ? list[list.length - 1] : list[0]).focus(); }
    function openImport(focus) { position(submenu, importButton, true); importButton.setAttribute('aria-expanded', 'true'); if (focus) items(submenu)[0].focus(); }
    button.addEventListener('click', () => button.getAttribute('aria-expanded') === 'true' ? close(true) : open());
    button.addEventListener('keydown', event => { if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); open(event.key); } });
    importButton.addEventListener('click', () => importButton.getAttribute('aria-expanded') === 'true' ? closeImport() : openImport(true));
    document.getElementById('connectionImportMenuWrap').addEventListener('mouseenter', () => openImport(false));
    items(menu).filter(item => item !== importButton).forEach(item => item.addEventListener('mouseenter', closeImport));
    const navigation = ${JSON.stringify(toolNavigationActions(origin))};
    navigation.forEach(action => document.getElementById(action.buttonId).addEventListener('click', () => {
      close(true); window.dispatchEvent(new CustomEvent('connectionManagementPost', {detail:{type:'toolNavigation',payload:{destination:action.id}}}));
    }));
    const actions = ${JSON.stringify(actions)};
    actions.forEach(action => document.getElementById(action.buttonId).addEventListener('click', () => {
      close(true); window.dispatchEvent(new CustomEvent('connectionManagementOpen', {detail:action.buttonId}));
    }));
    [menu, submenu].forEach(container => container.addEventListener('keydown', event => {
      const list = items(container), index = list.indexOf(document.activeElement);
      if (event.key === 'ArrowRight' && document.activeElement === importButton) { event.preventDefault(); openImport(true); }
      else if (event.key === 'ArrowLeft' && container === submenu) { event.preventDefault(); closeImport(); importButton.focus(); }
      else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); if (container === menu) closeImport();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
        list[next].focus();
      }
    }));
    document.addEventListener('keydown', event => {
      if (button.getAttribute('aria-expanded') !== 'true') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (importButton.getAttribute('aria-expanded') === 'true') { closeImport(); importButton.focus(); } else close(true); }
      else if (event.key === 'Tab') close(false);
    }, true);
    document.addEventListener('click', event => { if (!contains(event.target) && !button.contains(event.target)) close(false); });
    document.addEventListener('focusin', event => { if (event.target !== button && !contains(event.target)) close(false); });
    document.addEventListener('scroll', event => { if (!contains(event.target)) close(false); }, true);
    window.addEventListener('resize', () => close(false));
  })();`;
}
