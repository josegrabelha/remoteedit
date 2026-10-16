import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { utils } from 'ssh2';
import { test } from './helpers/TestHarness';
import { loadWithVscode, createConnectionManagerHarness, profile, vscodeStub } from './helpers/ConnectionManagerHarness';
import { generateKey } from '../ssh/SshKeyFiles';
import { renderSshKeyTools } from '../panel/webview/scripts/SshKeyTools';
const {posixDeploymentScript,SshKeyDeployment}=loadWithVscode(()=>require('../ssh/SshKeyDeployment')) as typeof import('../ssh/SshKeyDeployment');
const execute=promisify(execFile);
const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})} as any;
async function fixture(t:any, probe: {stdout?: string; stderr?: string; fallback?: string} = {stderr:'/etc/ssh/sshd_config: Permission denied'}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-assisted-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const key=utils.generateKeyPairSync('ed25519').public;
 const prefix=`import os,subprocess,types,pwd\npwd.getpwuid=lambda uid: types.SimpleNamespace(pw_dir=${JSON.stringify(dir)},pw_name='fixture')\ndef fixture_run(args,**kw):\n if args[0]=='ps': return types.SimpleNamespace(returncode=0,stdout='sshd: listener',stderr='')\n assert args[1] in ['-T','-G'] and args[2]=='-C', 'Connection Match context is required'\n assert args[3]=='user=fixture,addr=127.0.0.1,host=127.0.0.1,laddr=127.0.0.1,lport=2222'\n if args[1]=='-G': return types.SimpleNamespace(returncode=${probe.fallback ? 0 : 1},stdout=${JSON.stringify(probe.fallback || '')},stderr='Config test connection parameter (-C) provided without test mode (-T)')\n return types.SimpleNamespace(returncode=${probe.stdout ? 0 : 1},stdout=${JSON.stringify(probe.stdout || '')},stderr=${JSON.stringify(probe.stderr || '')})\nsubprocess.run=fixture_run\nos.environ['SSH_CONNECTION']='127.0.0.1 1000 127.0.0.1 2222'\n`;
 const run=async(name?:string,review?:any)=>JSON.parse((await execute('python3',['-c',prefix+posixDeploymentScript(key,review,name)])).stdout);
 return {dir,key,run,ssh:path.join(dir,'.ssh')};
}
test('assisted discovery reports configuration permission failure and creates nothing until commit',async t=>{
 const {dir,run,ssh}=await fixture(t);
 const unavailable=await run();assert.equal(unavailable.configurationUnavailable,true);assert.match(unavailable.reason,/Permission denied/);
 const review=await run('authorized_keys');assert.equal(review.exists,false);assert.equal(review.directoryExists,false);assert.equal(review.username,'fixture');
 assert.deepEqual(await fs.readdir(dir),[]);
 assert.equal((await run('authorized_keys',review)).installed,true);
 assert.equal((await fs.stat(ssh)).mode&0o777,0o700);assert.equal((await fs.stat(path.join(ssh,'authorized_keys'))).mode&0o777,0o600);
 assert.equal((await run('authorized_keys')).alreadyInstalled,true);
});
test('connection-specific sshd probe uses compatible test mode and preserves the actual failure for assisted discovery',async t=>{
 const error='sshd: no hostkeys available -- exiting.';
 const {run,dir}=await fixture(t,{stderr:error});
 const unavailable=await run();assert.equal(unavailable.configurationUnavailable,true);assert.equal(unavailable.reason,error);
 const review=await run('authorized_keys');assert.equal(review.assisted,true);assert.equal(review.exists,false);
 assert.deepEqual(await fs.readdir(dir),[]);
});
test('compatible sshd test mode keeps verified automatic deployment and connection Match context',async t=>{
 const {run,dir}=await fixture(t,{stdout:'pubkeyauthentication yes\n'+'authorizedkeysfile .ssh/authorized_keys\nusedns no\n'});
 const review=await run();assert.equal(review.configurationUnavailable,undefined);assert.equal(review.assisted,false);
 assert.equal(review.destination,path.join(dir,'.ssh','authorized_keys'));
 assert.deepEqual(await fs.readdir(dir),[]);
});
test('supported configuration-only fallback preserves verified deployment when host key checks prevent test mode',async t=>{
 const {run}=await fixture(t,{stderr:'sshd: no hostkeys available -- exiting.',fallback:'pubkeyauthentication yes\nauthorizedkeysfile .ssh/authorized_keys\nusedns no\n'});
 const review=await run();assert.equal(review.configurationUnavailable,undefined);assert.equal(review.assisted,false);
});
test('assisted existing files preserve content and detect stale, linked, unsafe and unwritable destinations',async t=>{
 const {run,ssh}=await fixture(t);await fs.mkdir(ssh,{mode:0o700});
 for(const name of ['authorized_keys','authorized_keys2']){
  const file=path.join(ssh,name);await fs.writeFile(file,'# original\r\n',{mode:0o600});
  const review=await run(name);assert.equal(review.exists,true);assert.equal((await run(name,review)).installed,true);assert.match(await fs.readFile(file,'utf8'),/^# original\r\n/);
  const repeat=await run(name);assert.equal(repeat.alreadyInstalled,true);assert.equal((await run(name,repeat)).alreadyInstalled,true);
  await fs.appendFile(file,'# changed');await assert.rejects(run(name,repeat),/changed/);
 }
 const file=path.join(ssh,'authorized_keys');await fs.chmod(file,0o400);await assert.rejects(run('authorized_keys'),/not writable/);await fs.chmod(file,0o600);
 await fs.unlink(file);await fs.symlink(path.join(ssh,'authorized_keys2'),file);await assert.rejects(run('authorized_keys'),/Unsafe/);
 await assert.rejects(run('../outside'),/Unsupported/);
 await fs.unlink(file);await fs.chmod(ssh,0o777);await assert.rejects(run('authorized_keys'),/Unsafe/);
});
test('assisted review rejects directory replacement and newly created files before commit',async t=>{
 const {run,ssh}=await fixture(t);await fs.mkdir(ssh,{mode:0o700});const review=await run('authorized_keys');
 await fs.writeFile(path.join(ssh,'authorized_keys'),'');await assert.rejects(run('authorized_keys',review),/changed/);
 await fs.unlink(path.join(ssh,'authorized_keys'));await fs.rename(ssh,ssh+'-old');await fs.mkdir(ssh,{mode:0o700});await assert.rejects(run('authorized_keys',review),/directory changed/);
});
test('assisted controller requires review, returns partial results and tests authentication only once',async t=>{
 const {SshKeyToolsController}=loadWithVscode(()=>require('../panel/SshKeyToolsController')) as typeof import('../panel/SshKeyToolsController');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-assisted-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const key=await generateKey({type:'ed25519',location:path.join(dir,'key')});
 const manager=createConnectionManagerHarness([profile('target')]);const messages:any[]=[];let writes=0,tests=0,releases=0;let selected:string[]=[];
 const controller=new SshKeyToolsController(manager.manager,p=>messages.push(p),async()=>{});t.after(()=>controller.dispose());
 (controller as any).deployment={close:async()=>{},release:async()=>{releases++;},prepare:async()=>({configurationUnavailable:true,reason:'Permission denied'}),discover:async()=>({destinations:[{name:'authorized_keys',review:{}},{name:'authorized_keys2',review:{}}]}),select:async(names:string[])=>{selected=names;return names.map(destination=>({destination,assisted:true}));},deploy:async()=>{writes++;return {installed:true,authentication:'unavailable',destinations:[{destination:'authorized_keys',installed:true},{destination:'authorized_keys2',installed:false,message:'Concurrent change'}]};},test:async()=>{tests++;return 'failed';},additionalDestinations:()=>['authorized_keys2']};
 await controller.handle({action:'prepare',targetId:'target',password:'fixture-password',location:key.privatePath});assert.equal(messages.at(-1).state,'unavailable',messages.at(-1).message);assert.equal(writes,0);
 await controller.handle({action:'discover'});assert.equal(messages.at(-1).state,'destinations');assert.equal(writes,0);
 await controller.handle({action:'select',destinations:['authorized_keys','authorized_keys2']});assert.deepEqual(selected,['authorized_keys','authorized_keys2']);assert.equal(messages.at(-1).assisted,true);assert.equal(writes,0);
 await controller.handle({action:'deploy'});assert.equal(writes,1);assert.equal(tests,1);assert.equal(releases,1);assert.equal(messages.at(-1).result.destinations[1].installed,false);
 await controller.handle({action:'additional'});assert.deepEqual(selected,['authorized_keys2']);assert.equal(writes,1);assert.equal(messages.at(-1).state,'review');
 await controller.handle({action:'use'});assert.equal(messages.at(-1).state,'error');assert.equal((await manager.manager.getProfile('target'))?.authType,'password');
});
test('assisted service rejects unapproved destinations and preserves each transaction outcome',async t=>{
 const deployment=new SshKeyDeployment();t.after(()=>deployment.close());const d=deployment as any;
 d.options={connectionId:'fixture'};d.platform='posix';d.key={publicKey:'fixture'};d.unavailable={reason:'Permission denied'};
 d.sessions={connect:async()=>{},disconnectAll:async()=>{}};
 const calls:string[]=[];d.execute=async(commit:boolean,_platform:string,review:any,name:string)=>{
  calls.push((commit?'write:':'read:')+name);
  if(commit&&name==='authorized_keys2')throw new Error('Concurrent change');
  return commit?{installed:true}:{destination:'/home/test/.ssh/'+name,assisted:true,exists:true,platform:'posix',digest:'digest',directoryIdentity:'same'};
 };
 await deployment.discover(token);await assert.rejects(deployment.select([],token),/at least/);await assert.rejects(deployment.select(['other'],token),/Invalid/);assert(!calls.some(x=>x.startsWith('write')));
 await deployment.select(['authorized_keys','authorized_keys2'],token);const result=await deployment.deploy();assert.equal(result.destinations?.length,2);assert.equal(result.destinations?.[0].installed,true);assert.equal(result.destinations?.[1].installed,false);assert.equal(result.installed,true);
 await assert.rejects(deployment.deploy(),/Review deployment/);
 d.token={...token,isCancellationRequested:true};await assert.rejects(deployment.discover(d.token),/cancelled/);
 new Function(renderSshKeyTools());
});

test('real OpenSSH configuration probe retains permission errors without changing the server configuration',async t=>{
 try{await fs.access('/usr/sbin/sshd');}catch{t.skip('OpenSSH server binary is unavailable');return;}
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-real-sshd-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const config=path.join(dir,'sshd_config');await fs.writeFile(config,'PubkeyAuthentication yes\n',{mode:0o000});
 const prefix=`import os,subprocess,types\nreal_run=subprocess.run\ndef probe(args,**kw):\n if args[0]=='ps': return types.SimpleNamespace(returncode=0,stdout='sshd: listener',stderr='')\n return real_run(['/usr/sbin/sshd','-f',${JSON.stringify(config)}]+args[1:],**kw)\nsubprocess.run=probe\nos.environ['SSH_CONNECTION']='127.0.0.1 1000 127.0.0.1 2222'\n`;
 const result=JSON.parse((await execute('python3',['-c',prefix+posixDeploymentScript(utils.generateKeyPairSync('ed25519').public)])).stdout);
 if(!/Permission denied/.test(result.reason||'')){t.skip('This runtime bypasses file read permissions');return;}
 assert.equal(result.configurationUnavailable,true);assert.match(result.reason,/Permission denied/);assert.equal((await fs.stat(config)).mode&0o777,0);
});
