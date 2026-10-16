import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { utils } from 'ssh2';
import { test } from './helpers/TestHarness';
import { defaultKeyComment, generateKey, inspectKey, resolveDeploymentKey, validatePublicKey } from '../ssh/SshKeyFiles';
import { renderSshKeyTools, renderSshKeyToolsMarkup, renderSshKeyToolsStyles } from '../panel/webview/scripts/SshKeyTools';
import { loadWithVscode, createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';

test('key type changes reset only the filename, preserve POSIX/Windows directories and leave unchanged types alone', () => {
  const script = renderSshKeyTools();
  const fn = script.slice(script.indexOf('  function skTypeChanged('), script.indexOf('  function openSshKeyTools('));
  for (const [location, expected] of [
    ['/Users/test/my keys/production', '/Users/test/my keys/id_rsa'],
    ['~/.ssh/custom', '~/.ssh/id_rsa'],
    ['C:\\Users\\test\\my keys\\custom', 'C:\\Users\\test\\my keys\\id_rsa'],
    ['C:/Users/test/custom', 'C:/Users/test/id_rsa'],
    ['custom', 'id_rsa'],
    ['\\\\server\\keys\\custom', '\\\\server\\keys\\id_rsa']
  ]) {
    const elements: Record<string, any> = {
      sshKeyType: {value:'ed25519'}, sshKeyLocation: {value:location}, sshKeyBitsBlock:{},
      sshKeyBits:{options:[] as string[], replaceChildren(){this.options=[];}, add(option:{value:string}){this.options.push(option.value);} }
    };
    const context: any = {sk:(id:string)=>elements[id], window:{}, Option:class {constructor(_label:string,public value:string){}}, skDirectory:'/home/test/.ssh', skDefaultLocation:'', skPreviousType:'ed25519'};
    runInNewContext(fn + ';skTypeChanged(false)',context);
    assert.equal(elements.sshKeyLocation.value,location);
    elements.sshKeyType.value='rsa';runInNewContext('skTypeChanged()',context);
    assert.equal(elements.sshKeyLocation.value,expected);
    assert.deepEqual(elements.sshKeyBits.options,['3072','4096']);
    elements.sshKeyLocation.value='custom-again';runInNewContext('skTypeChanged()',context);
    assert.equal(elements.sshKeyLocation.value,'custom-again');
    elements.sshKeyType.value='ecdsa';runInNewContext('skTypeChanged()',context);
    assert.equal(elements.sshKeyLocation.value,'id_ecdsa');
    assert.deepEqual(elements.sshKeyBits.options,['256','384','521']);
  }
});

test('default local comment is editable data and explicit empty comments remain empty in generated keys', async t => {
  assert.equal(defaultKeyComment(),os.userInfo().username+'@'+os.hostname());
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-comment-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const [index,comment] of [defaultKeyComment(),'custom identity',''].entries()) {
    const key=await generateKey({type:'ed25519',location:path.join(dir,String(index)),comment});
    assert.equal(key.publicKey.trim().split(/\s+/).slice(2).join(' '),comment);
    assert.equal((await fs.readFile(key.publicPath!,'utf8')).trim(),key.publicKey.trim());
  }
});

test('deployment companions require a fingerprint match; encryption is conditional and public-only remains possible', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-companion-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const key=await generateKey({type:'ed25519',location:path.join(dir,'key')});
  assert.equal((await resolveDeploymentKey(key.publicPath!)).key.privatePath,key.privatePath);
  assert.equal((await resolveDeploymentKey(key.privatePath!)).key.privatePath,key.privatePath);
  assert.equal((await resolveDeploymentKey(key.publicPath!)).requiresPassphrase,false);
  assert.equal((await resolveDeploymentKey(key.publicPath!,'',undefined,false)).key.privatePath,undefined);
  const encrypted=await generateKey({type:'ed25519',location:path.join(dir,'encrypted'),passphrase:'test-secret'});
  const pending=await resolveDeploymentKey(encrypted.publicPath!);
  assert.equal(pending.requiresPassphrase,true);assert.equal(pending.key.privatePath,undefined);
  assert.equal(pending.candidatePath,encrypted.privatePath);assert.equal(pending.key.fingerprint,encrypted.fingerprint);
  const unlocked=await resolveDeploymentKey(encrypted.publicPath!,'','test-secret');
  assert.equal(unlocked.requiresPassphrase,true);assert.equal(unlocked.key.privatePath,encrypted.privatePath);
  await assert.rejects(resolveDeploymentKey(encrypted.publicPath!,'','wrong'),/encrypted/);
  assert.equal((await resolveDeploymentKey(encrypted.privatePath!)).requiresPassphrase,true);
  await assert.rejects(resolveDeploymentKey(key.publicPath!,encrypted.privatePath,'test-secret'),/does not match/);
  const original=await fs.readFile(key.privatePath!);
  await fs.writeFile(key.privatePath!,utils.generateKeyPairSync('ed25519').private);
  assert.equal((await resolveDeploymentKey(key.publicPath!)).key.privatePath,undefined);
  await assert.rejects(resolveDeploymentKey(key.publicPath!,key.privatePath),/match/);
  await fs.writeFile(key.privatePath!,original);await fs.unlink(key.privatePath!);
  assert.equal((await resolveDeploymentKey(key.publicPath!)).key.privatePath,undefined);
});

test('controller probes reveal metadata only, request unlocking before remote access and permit public-only review',async t=>{
  const {SshKeyToolsController}=loadWithVscode(()=>require('../panel/SshKeyToolsController')) as typeof import('../panel/SshKeyToolsController');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-key-ux-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const key=await generateKey({type:'ed25519',location:path.join(dir,'key'),passphrase:'test-secret'});
  const harness=createConnectionManagerHarness([profile('target')]);await harness.context.secrets.store(secretKey('target','password'),'existing-password');const messages:any[]=[];let connections=0;
  const controller=new SshKeyToolsController(harness.manager,p=>messages.push(p),async()=>{});t.after(()=>controller.dispose());
  (controller as any).deployment={close:async()=>{},prepare:async()=>{connections++;return {destination:'/home/user/.ssh/authorized_keys'};}};
  await controller.handle({action:'open'});assert.equal(messages.at(-1).defaultComment,defaultKeyComment());
  await controller.handle({action:'probe',location:key.publicPath,requestId:7});
  assert.equal(messages.at(-1).requestId,7);assert.equal(messages.at(-1).requiresPassphrase,true);assert.equal(connections,0);
  await controller.handle({action:'prepare',location:key.privatePath,targetId:'target'});
  assert.equal(messages.at(-1).state,'passphraseRequired');assert.equal(connections,0);
  await controller.handle({action:'prepare',location:key.publicPath,targetId:'target'});
  assert.equal(messages.at(-1).state,'review',messages.at(-1).message);assert.equal(messages.at(-1).key.privatePath,undefined);assert.equal(connections,1);
  await controller.handle({action:'prepare',location:key.publicPath,privatePath:key.privatePath,targetId:'target'});
  assert.equal(messages.at(-1).state,'passphraseRequired');assert.equal(connections,1);
  await controller.handle({action:'prepare',location:key.publicPath,privatePath:key.privatePath,passphrase:'test-secret',targetId:'target'});
  assert.equal(messages.at(-1).state,'review',messages.at(-1).message);assert.equal(messages.at(-1).key.privatePath,key.privatePath);assert.equal(connections,2);
  assert(!JSON.stringify(messages).includes('test-secret'));assert(!JSON.stringify(messages).includes('PRIVATE KEY'));
});


test('Deploy Public Key selection messages distinguish source private key, matching companion, encrypted companion and no test', () => {
  const script=renderSshKeyTools();
  const fragment=script.slice(script.indexOf('  function receiveSshKeyTools('),script.indexOf('  function skShowDestinations('));
  assert(fragment.startsWith('  function receiveSshKeyTools('));
  const elements:Record<string,any>={
    sshKeyToolsBackdrop:{classList:{contains:(name:string)=>name==='visible'}},
    sshKeyPrivatePath:{value:''},sshKeyDeployPassphrase:{value:''},
    sshKeyTestPrivateBlock:{hidden:false},sshKeyDeployPassphraseBlock:{hidden:true},sshKeyTestHint:{textContent:''}
  };
  const ctx:any={sk:(id:string)=>elements[id],skPage:'deploy',skProbeId:42,skPrivateManual:false};
  const deliver=(payload:any)=>runInNewContext(fragment+';receiveSshKeyTools(payload);',{...ctx,payload});
  deliver({state:'keySelection',requestId:42,sourceIsPrivate:false,privatePath:'/home/user/.ssh/key',requiresPassphrase:false});
  assert.equal(elements.sshKeyPrivatePath.value,'/home/user/.ssh/key');
  assert.equal(elements.sshKeyTestPrivateBlock.hidden,false);
  assert.equal(elements.sshKeyDeployPassphraseBlock.hidden,true);
  assert.match(elements.sshKeyTestHint.textContent,/Matching private key detected.*tested after deployment/);
  deliver({state:'keySelection',requestId:42,sourceIsPrivate:true,privatePath:'/home/user/.ssh/key',requiresPassphrase:false});
  assert.equal(elements.sshKeyTestPrivateBlock.hidden,true);
  assert.match(elements.sshKeyTestHint.textContent,/selected private key will also be used/);
  deliver({state:'keySelection',requestId:42,sourceIsPrivate:true,privatePath:undefined,requiresPassphrase:true});
  assert.equal(elements.sshKeyTestPrivateBlock.hidden,true);
  assert.equal(elements.sshKeyDeployPassphraseBlock.hidden,false);
  assert.match(elements.sshKeyTestHint.textContent,/passphrase to extract the public key/);
  deliver({state:'keySelection',requestId:42,sourceIsPrivate:false,privatePath:undefined,requiresPassphrase:true});
  assert.equal(elements.sshKeyTestPrivateBlock.hidden,false);
  assert.match(elements.sshKeyTestHint.textContent,/possible matching private key is encrypted/);
  assert.match(elements.sshKeyTestHint.textContent,/continue without the test/);
  deliver({state:'keySelection',requestId:42,sourceIsPrivate:false,privatePath:undefined,requiresPassphrase:false});
  assert.equal(elements.sshKeyPrivatePath.value,'');
  assert.equal(elements.sshKeyDeployPassphraseBlock.hidden,true);
  assert.match(elements.sshKeyTestHint.textContent,/proceed without an authentication test/);
  deliver({state:'keySelection',requestId:41,sourceIsPrivate:true,privatePath:'/stale',requiresPassphrase:false});
  assert.equal(elements.sshKeyPrivatePath.value,'');
  assert.equal(elements.sshKeyTestPrivateBlock.hidden,false);
});

test('clearing the matching private key disables automatic detection until the main file changes',()=>{
  const script=renderSshKeyTools();
  const fragment=script.slice(script.indexOf('  function skProbeSelection('),script.indexOf('  function skDeployPage('));
  assert(fragment.startsWith('  function skProbeSelection('));
  const elements:Record<string,any>={
    sshKeyPublicPath:{value:'/home/user/.ssh/id_ed25519.pub'},
    sshKeyPrivatePath:{value:'/home/user/.ssh/id_ed25519'},
    sshKeyDeployPassphrase:{value:'test-secret'},
    sshKeyDeployPassphraseBlock:{hidden:false},sshKeyTestPrivateBlock:{hidden:false},sshKeyTestHint:{textContent:''}
  };
  const sent:any[]=[];let timer:(()=>void)|undefined;
  const ctx:any={sk:(id:string)=>elements[id],skProbeId:0,skPrivateManual:false,skSkipPrivate:false,
    skProbeTimer:null,skBusy:false,skPage:'deploy',clearTimeout:()=>{},setTimeout:(callback:()=>void)=>{timer=callback;return 1;},
    vscode:{postMessage:(message:any)=>sent.push(message)}};
  // Browser input events fire after the edited input's value has changed.
  // Simulate clearing the field, not merely dispatching the handler.
  elements.sshKeyPrivatePath.value='';
  runInNewContext(fragment+';skDeploymentPathChanged("sshKeyPrivatePath");',ctx);
  timer?.();
  assert.equal(elements.sshKeyDeployPassphrase.value,'');
  assert.equal(elements.sshKeyPrivatePath.value,'');
  assert.equal(sent.at(-1).payload.autoDetectPrivate,false);
  runInNewContext('skDeploymentPathChanged("sshKeyPublicPath");',ctx);
  timer?.();
  assert.equal(sent.at(-1).payload.autoDetectPrivate,true);
  assert.equal(sent.at(-1).payload.privatePath,'');
});

test('Manual Installation public key fills the remaining modal area without user resizing', () => {
  const markup=renderSshKeyToolsMarkup();
  const css=renderSshKeyToolsStyles();
  assert(markup.includes('<textarea id="sshKeyManualPublic" rows="4" wrap="soft" readonly aria-label="Public Key"></textarea>'));
  assert.match(css, /#sshKey_manual:not\(\[hidden\]\)\{[^}]*display:flex;flex-direction:column;height:100%;min-height:0;min-width:0\}/);
  assert.match(css, /#sshKeyManualPublic\{[^}]*flex:1 1 auto;resize:none;[^}]*width:100%;max-width:100%;overflow:auto;/);
  assert(css.includes('.ssh-key-dialog .file-properties-body{flex:1 1 auto;min-height:0;overflow:auto}'));
});

test('SSH Key Tools authorized file choices reuse RE checkboxes and the assisted step keeps a fixed Continue button', () => {
  const script=renderSshKeyTools();
  assert(script.includes("box.type='checkbox';box.className='dialog-checkbox';box.value=d.name;"));
  assert(renderSshKeyToolsStyles().includes('#sshKeyNextDeploy,#sshKeyPrimary{width:140px;min-width:140px}'));
  assert(!script.includes("sk('sshKeyPrimary').style.width="));
  assert(script.includes("unavailable:'Continue',destinations:'Continue'"));
});

test('SSH Key Tools keeps pickers and lightweight requests free of progress while showing real SSH work', () => {
  const markup = renderSshKeyToolsMarkup();
  const css = renderSshKeyToolsStyles();
  assert(markup.includes('<span class="spinner" aria-hidden="true"></span><span id="sshKeyFeedbackText"></span>'));
  assert(css.includes('#sshKeyFeedback.busy .spinner{display:block}'));
  const script=renderSshKeyTools();
  const fn=script.slice(script.indexOf('  function skFeedback('),script.indexOf('  function skShow('));
  assert(fn.includes('skBusy&&!!skProgressMessages[skBusyAction]'));
  assert(!script.includes('Selecting SSH key file…'));
  assert(!script.includes('Checking selected SSH key…'));
  const makeContext=()=>{
    const classes=new Set<string>();
    const fields=[{disabled:false},{disabled:false}];
    const elements:Record<string,any>={
      sshKeyFeedback:{classList:{toggle:(name:string,on:boolean)=>on?classes.add(name):classes.delete(name)}},
      sshKeyFeedbackText:{textContent:''},
      sshKeyToolsBackdrop:{querySelectorAll:()=>fields},
      sshKeyClose:{disabled:false,hidden:false,textContent:''},
      sshKeyPrimary:{disabled:false},
      sshKeyDestinations:{querySelector:()=>null,querySelectorAll:()=>[]}
    };
    const posted:any[]=[];
    const context:any={sk:(id:string)=>elements[id],skBusy:false,skBusyAction:'',skPage:'home',skCommit:false,skOrigin:null,skUpdateAccessReveal:()=>{},window:{},vscode:{postMessage:(message:any)=>posted.push(message)}};
    runInNewContext(fn,context);
    return {classes,fields,elements,posted,context};
  };
  for(const action of ['open','pick','use']){
    const {classes,fields,elements,posted,context}=makeContext();
    runInNewContext('skRequest('+JSON.stringify(action)+');',context);
    assert.equal(classes.has('busy'),false,action+' should not display a spinner');
    assert.equal(elements.sshKeyFeedbackText.textContent,'',action+' should not display progress text');
    assert.equal(fields.every(field=>field.disabled),true,action+' must still guard pending requests');
    assert.equal(posted.at(-1).payload.action,action);
    runInNewContext('skBusy=false;skBusyAction="";skSetBusy();',context);
    assert.equal(classes.has('busy'),false);
    assert.equal(fields.every(field=>!field.disabled),true);
  }
  const messages:Record<string,string>={
    generate:'Generating SSH key…',inspect:'Inspecting SSH key…',prepare:'Checking SSH connection…',
    discover:'Finding authorized keys files…',select:'Checking selected authorized keys files…',
    additional:'Checking additional authorized keys files…',deploy:'Installing public key…'
  };
  for(const [action,message] of Object.entries(messages)){
    const {classes,elements,context}=makeContext();
    runInNewContext('skRequest('+JSON.stringify(action)+');',context);
    assert(classes.has('busy'),action+' must show a spinner');
    assert.equal(elements.sshKeyFeedbackText.textContent,message);
    runInNewContext('skBusyAction="test";skFeedback("Testing SSH authentication…");skSetBusy();',context);
    assert(classes.has('busy'),action+' to test should keep the spinner active');
    runInNewContext('skBusy=false;skBusyAction="";skSetBusy();skFeedback("Operation cancelled.");',context);
    assert(!classes.has('busy'),action+' cancellation must hide the spinner');
    assert.equal(elements.sshKeyFeedbackText.textContent,'Operation cancelled.');
  }
});

test('probing a locally selected SSH key does not show a transient progress message', () => {
  const script=renderSshKeyTools();
  const fragment=script.slice(script.indexOf('  function skProbeSelection('),script.indexOf('  function skDeploymentPathChanged('));
  const elements:Record<string,any>={
    sshKeyPublicPath:{value:'/home/user/.ssh/id_ed25519.pub'},
    sshKeyPrivatePath:{value:''},sshKeyDeployPassphrase:{value:''},
    sshKeyTestHint:{textContent:'Old selection status'},
    sshKeyTestPrivateBlock:{hidden:false},sshKeyDeployPassphraseBlock:{hidden:true}
  };
  let timer:(()=>void)|undefined;
  const posted:any[]=[];
  const context:any={sk:(id:string)=>elements[id],skProbeId:0,skProbeTimer:null,skPrivateManual:false,skSkipPrivate:false,
    skBusy:false,skPage:'deploy',clearTimeout:()=>{},setTimeout:(callback:()=>void)=>{timer=callback;return 1;},
    vscode:{postMessage:(message:any)=>posted.push(message)}};
  runInNewContext(fragment+';skProbeSelection();',context);
  assert.equal(elements.sshKeyTestHint.textContent,'');
  timer?.();
  assert.equal(posted.at(-1).payload.action,'probe');
  assert.equal(elements.sshKeyTestHint.textContent,'');
});

test('SSH Key Details includes Comment directly after Fingerprint and shows a placeholder if absent', () => {
  const script=renderSshKeyTools();
  const fn=script.slice(script.indexOf('  function skShowDetails('),script.indexOf('  function skProbeSelection('));
  let pairs:any[]=[];
  const key={type:'ssh-ed25519',bits:256,fingerprint:'SHA256:abcd',comment:'developer laptop',privatePath:'/key',publicPath:'/key.pub'};
  const ctx:any={skKey:null,skGeneratedPassphrase:'',skDetailsSnapshot:{key,passphrase:'',generated:false},skShow:()=>{},skPairs:(_node:any,rows:any[])=>{pairs=rows;},sk:()=>({textContent:''})};
  runInNewContext(fn+';skShowDetails();',ctx);
  assert.equal(pairs.findIndex(row=>row[0]==='Comment'),pairs.findIndex(row=>row[0]==='Fingerprint')+1);
  assert.equal(pairs.find(row=>row[0]==='Comment')[1],'developer laptop');
  ctx.skDetailsSnapshot={...ctx.skDetailsSnapshot,key:{...key,comment:''}};
  runInNewContext('skShowDetails();',ctx);
  assert.equal(pairs.find(row=>row[0]==='Comment')[1],'—');
});

test('invalid Ed25519 generation is retried before writing files and exhausted attempts leave no keys',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-keygen-retry-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const comment='test@local';
  const fixture=await generateKey({type:'ed25519',location:path.join(dir,'fixture'),comment});
  const pair={private:(await fs.readFile(fixture.privatePath!,'utf8')).trim(),public:(await fs.readFile(fixture.publicPath!,'utf8')).trim()};
  const original=utils.generateKeyPair;
  const output=path.join(dir,'recovered');
  let attempts=0;
  try {
    // Deliberately return a malformed public half once, then a valid matching
    // pair. No generated files may exist when the second attempt begins.
    (utils as any).generateKeyPair=(_type:unknown,_options:unknown,cb:Function)=>{
      attempts++;
      if(attempts===2){
        assert.equal(require('node:fs').existsSync(output),false);
        assert.equal(require('node:fs').existsSync(output+'.pub'),false);
      }
      queueMicrotask(()=>cb(null,attempts===1?{...pair,public:'ssh-ed25519 AAAA malformed'}:pair));
    };
    const recovered=await generateKey({type:'ed25519',location:output,comment});
    assert.equal(attempts,2);
    assert.equal((await inspectKey(recovered.privatePath!)).comment,comment);
    assert.equal((await inspectKey(recovered.publicPath!)).fingerprint,recovered.fingerprint);

    attempts=0;
    (utils as any).generateKeyPair=(_type:unknown,_options:unknown,cb:Function)=>{
      attempts++;
      queueMicrotask(()=>cb(null,{...pair,public:'ssh-ed25519 AAAA malformed'}));
    };
    const failed=path.join(dir,'not-written');
    await assert.rejects(generateKey({type:'ed25519',location:failed,comment}),/Invalid or encrypted SSH key|Generated SSH key pair validation failed/);
    assert.equal(attempts,5);
    await assert.rejects(fs.stat(failed),{code:'ENOENT'});
    await assert.rejects(fs.stat(failed+'.pub'),{code:'ENOENT'});
  } finally {
    (utils as any).generateKeyPair=original;
  }
});

test('Inspect SSH Key reads public comments and companion/private OpenSSH comments without modifying the key',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-inspect-comment-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const [index,comment] of ['account@host','QA shared machine',''].entries()){
    const key=await generateKey({type:'ed25519',location:path.join(dir,String(index)),comment});
    assert.equal(key.comment,comment);
    assert.equal(validatePublicKey(key.publicKey).comment,comment);
    assert.equal((await inspectKey(key.publicPath!)).comment,comment);
    assert.equal((await inspectKey(key.privatePath!)).comment,comment);
    const before=await fs.readFile(key.privatePath!);
    await fs.unlink(key.publicPath!);
    assert.equal((await inspectKey(key.privatePath!)).comment,comment);
    assert.deepEqual(await fs.readFile(key.privatePath!),before);
  }
  const protectedKey=await generateKey({type:'ed25519',location:path.join(dir,'protected'),comment:'secure@laptop',passphrase:'test-phrase'});
  assert.equal((await inspectKey(protectedKey.privatePath!,'test-phrase')).comment,'secure@laptop');
});
