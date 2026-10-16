import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { renderConnectionEditor } from '../panel/webview/scripts/ConnectionEditor';
import { test } from './helpers/TestHarness';

test('shared editor tests drafts once, clears feedback on edits, cancels on exit and ignores late results', () => {
  const elements = new Map<string, any>(), messages: any[] = [];
  const element = (id: string): any => {
    if (!elements.has(id)) elements.set(id, { value:'', checked:false, dataset:{}, hidden:true, disabled:false,
      textContent:'', classList:{add(){},remove(){},toggle(){}}, events:new Map(),
      addEventListener(name: string, fn: unknown) {this.events.set(name,fn);}, replaceChildren(){}, querySelectorAll:()=>[],
      querySelector:()=>({textContent:''}), focus(){}, scrollTop:0 });
    return elements.get(id);
  };
  const context = createContext({ document:{getElementById:element,addEventListener(){}},
    window:{addEventListener(){},RemoteEditControls:{closeCombo(){},refresh(){}}},
    manageProfilesBackdrop:element('backdrop'),manageProfilesCloseButton:element('close'),manageProfilesList:element('list'),
    SAVED_SECRET_MASK:'********',normalizeConnectionTypeValue:(value: string)=>value,
    getConnectionValidationErrors:()=>[],analyzeJumpProfileCandidate:()=>({valid:true}),proxyProfiles:[],
    renderManageProfilesList(){},masterPasswordState:{configured:false},
    vscode:{postMessage:(message: any)=>messages.push(message)} });
  runInContext(renderConnectionEditor(),context);
  runInContext("connectionEditorProfile={id:'saved'}; connectionEditorInitial=JSON.stringify(connectionEditorPayload());",context);
  element('edit_host').value='unsaved.example'; element('edit_connectionType').value='sftp';
  element('edit_authType').value='password';element('edit_password').value='********';
  element('edit_passwordSourcePicker').dataset.source='connection';
  const editableField=element('edit_host'), disabledField=element('alreadyDisabled'), picker=element('picker');
  disabledField.disabled=true;
  element('manageConnectionEditor').querySelectorAll=()=>[editableField,disabledField,picker];
  element('manageConnectionTest').onclick();element('manageConnectionTest').onclick();
  assert.equal(editableField.disabled,true);assert.equal(picker.disabled,true);
  assert.equal(element('manageConnectionEditor').inert,true);
  assert.equal(element('manageConnectionBack').disabled,false);
  assert.equal(messages.length,1);assert.equal(messages[0].type,'testConnection');
  assert.equal(messages[0].payload.profile.host,'unsaved.example');assert.equal(messages[0].payload.profile.password,'');
  assert.equal(element('manageConnectionTest').textContent,'Testing...');
  context.result={requestId:messages[0].payload.requestId,success:true};
  runInContext('receiveConnectionTestResult(result)',context);
  assert.equal(editableField.disabled,false);assert.equal(picker.disabled,false);assert.equal(disabledField.disabled,true);
  assert.ok(!element('manageConnectionEditor').inert);
  assert.match(element('manageConnectionTestFeedback').textContent,/successful/);
  element('manageConnectionEditor').events.get('input')();assert.equal(element('manageConnectionTestFeedback').hidden,true);
  element('manageConnectionTest').onclick();
  context.result={requestId:messages.at(-1).payload.requestId,success:false,error:'Authentication failed'};
  runInContext('receiveConnectionTestResult(result)',context);
  assert.equal(editableField.disabled,false);assert.equal(disabledField.disabled,true);
  assert.match(element('manageConnectionTestFeedback').textContent,/Authentication failed/);
  element('manageConnectionEditor').events.get('change')();assert.equal(element('manageConnectionTestFeedback').hidden,true);
  element('manageConnectionTest').onclick();
  const requestId=messages.at(-1).payload.requestId;
  runInContext('finishConnectionEditor(false)',context);
  assert.equal(editableField.disabled,false);assert.equal(disabledField.disabled,true);
  assert.equal(messages.at(-1).type,'cancelConnectionTest');assert.equal(messages.at(-1).payload.requestId,requestId);
  context.result={requestId,success:true};runInContext('receiveConnectionTestResult(result)',context);
  assert.equal(element('manageConnectionTestFeedback').hidden,true);assert.equal(element('manageConnectionTest').hidden,true);
});
