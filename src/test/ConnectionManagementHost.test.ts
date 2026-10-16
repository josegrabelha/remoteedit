import assert from 'node:assert/strict';
import { createConnectionManagerHarness, loadWithVscode, profile, inputUi } from './helpers/ConnectionManagerHarness';
import { test } from './helpers/TestHarness';

const { ConnectionManagementHost, RemoteEditSharedState } = loadWithVscode(() => ({
  ...require('../webview/ConnectionManagementHost') as typeof import('../webview/ConnectionManagementHost'),
  ...require('../state/RemoteEditSharedState') as typeof import('../state/RemoteEditSharedState')
}));

test('WS and MT management use isolated responses, shared profiles and Webview Master Password without native prompts', async () => {
  const h = createConnectionManagerHarness([profile('server')]);
  const ws: any[] = [], mt: any[] = [];
  const a = new ConnectionManagementHost(h.context, h.manager, h.output, message => ws.push(message), 'workspaceSync');
  const b = new ConnectionManagementHost(h.context, h.manager, h.output, message => mt.push(message), 'multiTarget');
  const initialPrompts = inputUi.prompts.length, initialPicks = inputUi.pickPrompts.length;
  try {
    assert.equal(await a.handle({type:'ready'}), false);
    await a.handle({type:'connectionManagementMessage',message:{type:'masterPassword',payload:{action:'state'}}});
    assert.equal(ws.at(-1).message.type, 'masterPasswordState');
    assert.equal(mt.length, 0);
    await a.handle({type:'connectionManagementMessage',message:{type:'masterPassword',payload:{action:'save',password:'shared-secret',confirmation:'shared-secret'}}});
    assert.equal((await h.manager.getMasterPasswordState()).configured, true);
    assert.equal(inputUi.prompts.length, initialPrompts);
    assert.equal(inputUi.pickPrompts.length, initialPicks);
    await a.handle({type:'connectionManagementMessage',message:{type:'renameConnection',payload:{id:'server',name:'Renamed'}}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await h.manager.getProfile('server'))?.name, 'Renamed');
    assert.ok(mt.some(m => m.message.type === 'profilesLoaded' && m.message.payload.profiles[0].name === 'Renamed'));
    assert.ok(ws.every(m => m.type === 'connectionManagementMessage'));
    const count = ws.length;
    a.dispose();
    RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar', 'saveProfile');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ws.length, count);
    await a.handle({type:'connectionManagementMessage',message:{type:'masterPassword',payload:{action:'remove'}}});
    assert.equal((await h.manager.getMasterPasswordState()).configured, true);
  } finally { a.dispose(); b.dispose(); }
});

test('management deletion confirmation is answered only by its own webview; operational messages are ignored', async () => {
  const h = createConnectionManagerHarness([profile('server')]);
  const ws: any[] = [], mt: any[] = [];
  const disconnected: string[] = [];
  const a = new ConnectionManagementHost(h.context,h.manager,h.output,m => ws.push(m),'workspaceSync', {
    hasConnection: () => true, disconnect: async (id: string) => { disconnected.push(id); }
  } as any);
  const b = new ConnectionManagementHost(h.context,h.manager,h.output,m => mt.push(m),'multiTarget');
  try {
    await a.handle({type:'connectionManagementMessage',message:{type:'connect',payload:{id:'server'}}});
    assert.equal(ws.length,0);
    const deleting = a.handle({type:'connectionManagementMessage',message:{type:'deleteConnection',payload:{id:'server'}}});
    await new Promise(resolve => setImmediate(resolve));
    const request = ws.find(m => m.message.type === 'showConfirmDialog');
    assert.ok(request);
    await b.handle({type:'connectionManagementMessage',message:{type:'confirmDialogResponse',payload:{requestId:request.message.payload.requestId,confirmed:true}}});
    assert.ok(await h.manager.getProfile('server'));
    await a.handle({type:'connectionManagementMessage',message:{type:'confirmDialogResponse',payload:{requestId:request.message.payload.requestId,confirmed:true}}});
    await deleting;
    assert.equal(await h.manager.getProfile('server'), undefined);
    assert.deepEqual(disconnected, ['server']);
  } finally { a.dispose(); b.dispose(); }
});

test('complete WS and MT management scripts parse with the shared RE controls in their own scope', () => {
  const { Script } = require('node:vm') as typeof import('node:vm');
  const { renderWorkspaceSyncHtml } = require('../workspaceSync/webview/WorkspaceSyncHtml') as typeof import('../workspaceSync/webview/WorkspaceSyncHtml');
  const { renderMultiTargetHtml } = require('../multiTarget/MultiTargetHtml') as typeof import('../multiTarget/MultiTargetHtml');
  for (const html of [renderWorkspaceSyncHtml({cspSource:'test'} as any), renderMultiTargetHtml({cspSource:'test'} as any)]) {
    const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
  }
});
