import assert from 'node:assert/strict';
import { test } from './helpers/TestHarness';
import { loadWithVscode, vscodeStub } from './helpers/ConnectionManagerHarness';
import { toolNavigationActions, toolViews } from '../webview/ToolNavigationActions';
import { renderConnectionManagementMenu } from '../panel/webview/markup/ConnectionManagementMenu';
import { managementQuickPickItems, connectionManagementActions } from '../connection/ConnectionManagementActions';

(vscodeStub as any).commands ??= {};
(vscodeStub as any).StatusBarAlignment ??= {Left:1,Right:2};

const { handleToolNavigation } = loadWithVscode(() => require('../webview/ToolNavigation') as typeof import('../webview/ToolNavigation'));
const { ToolStatusBarButton } = loadWithVscode(() => require('../webview/ToolStatusBarButton') as typeof import('../webview/ToolStatusBarButton'));

test('all six menu destinations invoke existing open commands; Sidebar retains management only', async () => {
  const calls: string[] = [];
  const stub = vscodeStub as any;
  const previous = stub.commands;
  stub.commands = { executeCommand: async (command: string) => { calls.push(command); } };
  try {
    for (const origin of toolViews) {
      const actions = toolNavigationActions(origin.id);
      assert.equal(actions.length, 2);
      const markup = renderConnectionManagementMenu(origin.id);
      assert.ok(!markup.includes(`id="${origin.buttonId}"`));
      for (const action of actions) {
        assert.ok(markup.indexOf(`id="${action.buttonId}"`) < markup.indexOf('id="connectionManagementConnections"'));
        assert.equal(await handleToolNavigation({type:'toolNavigation',payload:{destination:action.id}}), true);
        assert.equal(calls.at(-1), action.command);
      }
    }
    assert.equal(calls.length, 6);
    await handleToolNavigation({type:'toolNavigation',payload:{destination:'workbench.action.closeAllEditors'}});
    await handleToolNavigation({type:'toolNavigation'});
    assert.equal(calls.length, 6);
    assert.equal(await handleToolNavigation({type:'run'}), false);
    assert.ok(managementQuickPickItems(connectionManagementActions).every(item => !item.label.startsWith('Open ')));
  } finally { stub.commands = previous; }
});

test('shared Status Bar responds to style, alignment, priority, hide, and disposal', () => {
  const stub = vscodeStub as any, previousWindow = stub.window, previousWorkspace = stub.workspace;
  const previousAlignment = stub.StatusBarAlignment;
  const values: Record<string, unknown> = {};
  const created: any[] = [];
  stub.StatusBarAlignment = {Left:1,Right:2};
  stub.workspace = {getConfiguration: () => ({get:(key:string, fallback:unknown) => values[key] ?? fallback})};
  stub.window = {createStatusBarItem:(alignment:number, priority:number) => {
    const item = {alignment,priority,text:'',command:'',tooltip:'',shown:false,disposed:false,show(){this.shown=true;},dispose(){this.disposed=true;}};
    created.push(item); return item;
  }};
  try {
    const button = new ToolStatusBarButton('remoteedit.multiTarget','remoteedit.multiTarget.open','Multi-Target','terminal',998);
    button.update();
    assert.equal(created[0].text,'$(terminal) Multi-Target');
    assert.equal(created[0].priority,998);
    assert.equal(created[0].alignment,1);
    assert.equal(created[0].command,'remoteedit.multiTarget.open');
    assert.equal(created[0].tooltip,'Open Multi-Target');
    values.statusBarButtonStyle='iconOnly'; button.update();
    assert.equal(created.length,1); assert.equal(created[0].text,'$(terminal)');
    values.statusBarButtonStyle='textOnly'; button.update(); assert.equal(created[0].text,'Multi-Target');
    values.statusBarButtonPosition='right'; values.statusBarButtonPriority=55; button.update();
    assert.ok(created[0].disposed); assert.equal(created[1].alignment,2); assert.equal(created[1].priority,55);
    values.statusBarButtonPosition='hidden'; button.update(); assert.ok(created[1].disposed);
    values.statusBarButtonPosition='left'; values.statusBarButtonPriority=NaN; button.update(); assert.equal(created[2].priority,998);
    button.dispose(); assert.ok(created[2].disposed);
  } finally { stub.window=previousWindow;stub.workspace=previousWorkspace;stub.StatusBarAlignment=previousAlignment; }
});

test('menu clicks close their origin menu and emit navigation messages in RE, WS, and MT', async () => {
  const { runInNewContext } = require('node:vm') as typeof import('node:vm');
  const { renderManagementScript } = require('../webview/ConnectionManagementMenu') as typeof import('../webview/ConnectionManagementMenu');
  const { renderConnectionImport } = require('../panel/webview/scripts/ConnectionImport') as typeof import('../panel/webview/scripts/ConnectionImport');
  for (const origin of toolViews) {
    const elements = new Map<string, any>();
    const messages: any[] = [];
    const element = (id:string):any => {
      if (!elements.has(id)) elements.set(id,{style:{display:'block'},listeners:new Map(),attributes:new Map(),
        addEventListener(name:string,callback:any){this.listeners.set(name,callback);},
        setAttribute(name:string,value:string){this.attributes.set(name,value);},getAttribute(name:string){return this.attributes.get(name);},
        querySelectorAll:()=>[],contains:()=>false,focus() {}});
      return elements.get(id);
    };
    const context:any = {document:{getElementById:element,body:{append(){}},addEventListener(){}},
      window:{addEventListener(){},dispatchEvent:(event:any)=>messages.push(event.detail)},
      CustomEvent:class {constructor(readonly type:string,readonly options:any){} get detail(){return this.options.detail;}},
      vscode:{postMessage:(message:any)=>messages.push(message)},closeConnectionManagementMenu:()=>{element('connectionManagementMenu').style.display='none';}};
    let script = renderManagementScript(origin.id);
    if (origin.id === 'remoteEdit') {
      const source=renderConnectionImport();
      script=source.slice(source.indexOf('  const toolNavigation ='), source.indexOf("  document.getElementById('connectionManagementConnections').addEventListener"));
    }
    runInNewContext(script,context);
    for (const action of toolNavigationActions(origin.id)) {
      element('connectionManagementMenu').style.display='block';
      element(action.buttonId).listeners.get('click')();
      assert.equal(element('connectionManagementMenu').style.display,'none');
      assert.equal(messages.at(-1).type,'toolNavigation');
      assert.equal(messages.at(-1).payload.destination,action.id);
    }
  }
});

test('Multi-Target title and Status Bar settings match RE/WS options and preserve default order', () => {
  const manifest = require('../../package.json');
  const properties = Object.assign({},...manifest.contributes.configuration.map((group:any)=>group.properties));
  for (const key of ['editorTitleButtonPosition','statusBarButtonPosition','statusBarButtonStyle','statusBarButtonPriority']) {
    const mt=properties['remoteedit.multiTarget.'+key],ws=properties['remoteedit.workspaceSync.'+key];
    assert.equal(mt.type,ws.type);
    assert.deepEqual(mt.enum,ws.enum);
    assert.equal(mt.default,key==='statusBarButtonPriority'?998:ws.default);
  }
  assert.equal(properties['remoteedit.statusBarButtonPriority'].default,1000);
  assert.equal(properties['remoteedit.workspaceSync.statusBarButtonPriority'].default,999);
  assert.deepEqual(manifest.contributes.menus['editor/title'].find((item:any)=>item.command==='remoteedit.multiTarget.open'),{
    command:'remoteedit.multiTarget.open',when:'config.remoteedit.multiTarget.editorTitleButtonPosition == right',group:'navigation@101'
  });
});
