import { renderBody } from '../panel/webview/markup/Body';
import { renderStyles } from '../panel/webview/styles/Styles';
import { renderClientScript } from '../panel/webview/scripts/ClientScript';
import { renderComboboxControls } from '../panel/webview/scripts/ComboboxControls';
import { renderSshKeyToolsMarkup, renderSshKeyToolsStyles } from '../panel/webview/scripts/SshKeyTools';
import { renderSshHostKeyDialogMarkup, renderSshHostKeyDialogStyles, renderSshHostKeyDialogScript } from './SharedConfirmDialog';

/** Reuse the RE dialogs, form template and controls in a scoped DOM. Styles,
 * keyboard handlers and UI storage cannot collide with the WS/MT document.
 * The hidden connection form remains the source for the existing Edit page. */
export function renderConnectionManagementSurface(): string {
  const body = renderBody().replace(/^<\/head>\s*<body>/, '');
  const styles = renderStyles().replace(/:root/g, ':host').replace(/(?<![-\w])body\b/g, '.management-body');
  const markup = `<style>${styles}${renderSshKeyToolsStyles()}${renderSshHostKeyDialogStyles()}
    :host {position:fixed;inset:0;z-index:10000;display:block;}
    .management-body {padding:0;margin:0;background:transparent;}
    .management-body > main.page {display:none;}
  </style><div class="management-body">${body}${renderSshKeyToolsMarkup()}${renderSshHostKeyDialogMarkup()}</div>`;
  // Inline scripts cannot contain an HTML closing script tag, even inside strings.
  const encoded = JSON.stringify(markup).replace(/</g, '\\u003c');
  return `(() => {
    const outerWindow = globalThis.window, outerDocument = globalThis.document;
    const managementHost = outerDocument.createElement('div'); managementHost.id = 'connectionManagementSurface'; managementHost.hidden = true;
    managementHost.style.display = 'none'; outerDocument.body.appendChild(managementHost);
    const managementRoot = managementHost.attachShadow({mode:'open'}); managementRoot.innerHTML = ${encoded};
    const managementBody = managementRoot.querySelector('.management-body');
    const managementEvents = new EventTarget();
    const managementLocalState = new Map(); let managementApiState = {}, managementReturnFocus = null;
    const document = new Proxy(outerDocument, {get(target, key) {
      if(key === 'body' || key === 'documentElement') return managementBody;
      if(key === 'activeElement') return managementRoot.activeElement;
      if(key === 'getElementById') return id => managementRoot.getElementById(id);
      if(key === 'querySelector' || key === 'querySelectorAll' || key === 'contains' || key === 'addEventListener' || key === 'removeEventListener') return managementRoot[key].bind(managementRoot);
      const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
    }});
    const window = new Proxy(outerWindow, {get(target,key) {
      if(key === 'addEventListener' || key === 'removeEventListener' || key === 'dispatchEvent') return managementEvents[key].bind(managementEvents);
      if(key === 'RemoteEditControls') return managementEvents.RemoteEditControls;
      const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
    },set(target,key,value) { if(key === 'RemoteEditControls') {managementEvents.RemoteEditControls=value;return true;} return Reflect.set(managementEvents,key,value); }});
    const localStorage = {getItem:key => managementLocalState.get(key) || null, setItem:(key,value) => managementLocalState.set(key,value), removeItem:key => managementLocalState.delete(key)};
    const acquireVsCodeApi = () => ({getState:() => managementApiState, setState:value => {managementApiState=value;}, postMessage:message => {
      // Layout/preferences belong to the operational webview; management never
      // migrates or overwrites them using the hidden RE template.
      if(message.type === 'syncPersistentStorage') return;
      outerWindow.dispatchEvent(new CustomEvent('connectionManagementPost', {detail:{type:'connectionManagementMessage',message}}));
    }});
    ${renderSshHostKeyDialogScript()}
    ${renderComboboxControls('select[data-proxy]')}
    ${renderClientScript({showRemotePathBreadcrumbDirectoryDetails:true,openFileListItemsOnNameClick:true,permissionsDisplayMode:'symbolic'})}
    const managementSiblings = new Map();
    function present() {
      managementHost.hidden=false;managementHost.style.display='block';
      for(const sibling of outerDocument.body.children) {
        if(sibling === managementHost || managementSiblings.has(sibling)) continue;
        managementSiblings.set(sibling,sibling.inert); sibling.inert=true;
      }
    }
    function dismiss() {
      managementHost.hidden=true;managementHost.style.display='none';
      for(const [sibling,inert] of managementSiblings) sibling.inert=inert;
      managementSiblings.clear();
      if(managementReturnFocus) {managementReturnFocus.focus();managementReturnFocus=null;}
    }
    function updateVisibility() {
      const dialogs = Array.from(managementRoot.querySelectorAll('[role="dialog"].visible, [aria-modal="true"].visible'));
      if(dialogs.length) {
        present();
        // Some RE dialogs focus synchronously while this surface is hidden.
        // Restore focus only after presentation, without stealing a valid focus
        // on subsequent state updates or bypassing the existing ESC handlers.
        const open = dialogs.reverse().find(dialog => !dialog.closest('[inert]') && dialog.getClientRects().length);
        if(open && !open.contains(managementRoot.activeElement)) {
          const target = Array.from(open.querySelectorAll('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex="0"]'))
            .find(element => !element.closest('[hidden],[inert]') && element.getClientRects().length);
          if(target) target.focus();
          else {open.tabIndex=-1;open.focus();}
        }
      }
      else dismiss();
    }
    new MutationObserver(updateVisibility).observe(managementRoot,{subtree:true,attributes:true,attributeFilter:['class']});
    outerWindow.addEventListener('connectionManagementOpen', event => {
      managementReturnFocus = outerDocument.getElementById('manageProfilesButton');
      present();
      if(event.detail === 'showSettingsButton') {vscode.postMessage({type:'showSettings'});updateVisibility();return;}
      managementEvents.dispatchEvent(new MessageEvent('message',{data:{type:'showConnectionManagement',payload:{buttonId:event.detail}}}));
      updateVisibility();
    });
    outerWindow.addEventListener('message',event => {
      if(event.data?.type !== 'connectionManagementMessage') return;
      const wasHidden = managementHost.hidden;
      managementEvents.dispatchEvent(new MessageEvent('message',{data:event.data.message}));
      if(wasHidden && managementRoot.querySelector('[role="dialog"].visible, [aria-modal="true"].visible')) managementReturnFocus=outerDocument.getElementById('manageProfilesButton');
      updateVisibility();
    });
    ['resize','blur'].forEach(type => outerWindow.addEventListener(type,() => managementEvents.dispatchEvent(new Event(type))));
    // VS Code's webview bridge must receive unhandled keyboard events (including
    // native editing/clipboard commands). Modal handlers consume only their own
    // shortcuts; operational handlers ignore this surface via composedPath().
    ['pointerdown','contextmenu','mouseover','mouseout','focusin','focusout'].forEach(type => managementRoot.addEventListener(type,event => event.stopPropagation()));
    vscode.postMessage({type:'ready'});
  })();`;
}
