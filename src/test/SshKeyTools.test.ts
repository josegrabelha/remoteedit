import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { utils, Server } from 'ssh2';
import * as net from 'node:net';
import { generateKey, inspectKey, validatePublicKey } from '../ssh/SshKeyFiles';
import { shouldOfferSshKeySetup } from '../ssh/SshKeyDiagnostics';
import { test } from './helpers/TestHarness';
import { loadWithVscode, createConnectionManagerHarness, profile, secretKey, vscodeStub, inputUi } from './helpers/ConnectionManagerHarness';
import { listenLoopback } from './helpers/LoopbackServer';
const { posixDeploymentScript, SshKeyDeployment } = loadWithVscode(() => require('../ssh/SshKeyDeployment')) as typeof import('../ssh/SshKeyDeployment');
const { initializeHostKeyTrust } = loadWithVscode(() => require('../ssh/hostKeys/HostKeyRuntime')) as typeof import('../ssh/hostKeys/HostKeyRuntime');
const execute = promisify(execFile);

test('SSH Key Tools authenticates all key families and checks OpenSSH interoperability', {timeout:90000}, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'re-key-tools-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const subscriptions: {dispose():void}[]=[];
  Object.assign(vscodeStub,{env:{}});inputUi.configuration.set('ssh.hostKeyVerification',false);
  loadWithVscode(()=>initializeHostKeyTrust({globalStorageUri:{fsPath:dir},subscriptions} as any,{appendLine(){}} as any));
  t.after(()=>subscriptions.forEach(x=>x.dispose()));
  const host=utils.generateKeyPairSync('ed25519');let accepted: Buffer | undefined;let signed=0,passwords=0;
  const sockets=new Set<net.Socket>();
  const server=new Server({hostKeys:[host.private]},client=>{
    client.on('error',()=>{});client.on('authentication',ctx=>{
      if(ctx.method==='password'){passwords++;ctx.reject(['publickey']);return;}
      if(ctx.method!=='publickey'||!accepted?.equals(ctx.key.data)){ctx.reject(['publickey']);return;}
      if(ctx.signature){const parsed=utils.parseKey(ctx.key.data);if(parsed instanceof Error||Array.isArray(parsed)||parsed.verify(ctx.blob!,ctx.signature,ctx.hashAlgo)!==true){ctx.reject();return;}signed++;}ctx.accept();
    });
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();session.on('exec',acceptExec=>{const stream=acceptExec();stream.write('Linux\n');stream.exit(0);stream.end();});
      session.on('sftp',acceptSftp=>{const sftp=acceptSftp();const attrs={mode:0o40755,uid:0,gid:0,size:0,atime:0,mtime:0};sftp.on('REALPATH',(id:number)=>sftp.name(id,[{filename:'/',longname:'/',attrs}]));sftp.on('STAT',(id:number)=>sftp.attrs(id,attrs));sftp.on('LSTAT',(id:number)=>sftp.attrs(id,attrs));sftp.on('OPENDIR',(id:number)=>sftp.handle(id,Buffer.from('dir')));sftp.on('READDIR',(id:number)=>sftp.status(id,1));sftp.on('CLOSE',(id:number)=>sftp.status(id,0));});
    }));
  });
  const listener=await listenLoopback(net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));server.injectSocket(socket);}));
  t.after(async()=>{sockets.forEach(s=>s.destroy());await listener.close();});
  // Representative integration cases cover all three algorithms and both
  // encrypted/plain private keys without twelve redundant SSH handshakes.
  const cases = [
    { type: 'ed25519', bits: 256, encrypted: false },
    { type: 'rsa', bits: 3072, encrypted: true },
    { type: 'ecdsa', bits: 256, encrypted: false }
  ] as const;
  for (const { type, bits, encrypted } of cases) {
    const location = path.join(dir, `${type}-${bits}-${encrypted}`);
    const passphrase = encrypted ? 'test-only-passphrase' : undefined;
    const key = await generateKey({ type, bits, location, passphrase, comment: 'RE test' });
    assert.equal(key.bits, bits);
    assert.equal((await inspectKey(location, passphrase)).fingerprint, key.fingerprint);
    if (process.platform !== 'win32') assert.equal((await fs.stat(location)).mode & 0o777, 0o600);
    assert.equal((await inspectKey(location + '.pub')).fingerprint, key.fingerprint);
    try {
      const fingerprint = (await execute('ssh-keygen', ['-lf', location + '.pub'])).stdout;
      assert(fingerprint.includes(key.fingerprint));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parsed = utils.parseKey(await fs.readFile(location), passphrase);
    assert(!(parsed instanceof Error) && !Array.isArray(parsed));
    accepted = parsed.getPublicSSH();
    if (encrypted) await assert.rejects(inspectKey(location), /encrypted/);
    const deployment = new SshKeyDeployment();
    (deployment as any).options = { connectionId: 'fixture', connectionType: 'sftp', host: '127.0.0.1',
      port: listener.port, username: 'test', authType: 'password', password: 'must-not-be-used' };
    (deployment as any).key = key;
    try { assert.equal(await deployment.test(passphrase), 'passed', `${type} ${bits} encrypted=${encrypted}`); }
    finally { await deployment.close(); }
  }
  assert.equal(signed, cases.length);
  assert.equal(passwords, 0);
});

test('SSH Key Tools never overwrites either key file, rejects mismatches and cancels before writing',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-key-collisions-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'key');await fs.writeFile(file+'.pub','keep public');
  await assert.rejects(generateKey({type:'ed25519',location:file}),/already exists/);assert.equal(await fs.readFile(file+'.pub','utf8'),'keep public');await assert.rejects(fs.stat(file));
  await fs.unlink(file+'.pub');const key=await generateKey({type:'ed25519',location:file});const original=await fs.readFile(file);
  await assert.rejects(generateKey({type:'ed25519',location:file}),/already exists/);assert.deepEqual(await fs.readFile(file),original);
  await fs.unlink(file+'.pub');assert.equal((await inspectKey(file)).fingerprint,key.fingerprint);
  await fs.writeFile(file+'.pub',utils.generateKeyPairSync('ed25519').public);await assert.rejects(inspectKey(file),/do not match/);
  const cancelled=path.join(dir,'cancelled');await assert.rejects(generateKey({type:'ed25519',location:cancelled},()=>true),/cancelled/);await assert.rejects(fs.stat(cancelled));
  assert.throws(()=>validatePublicKey('command="echo test" '+key.publicKey),/single OpenSSH/);assert.throws(()=>validatePublicKey(key.publicKey+'\n'+key.publicKey),/single OpenSSH/);
});

test('fresh SSH Key Tools drafts suppress unrelated stored passphrases while ordinary drafts preserve them',async()=>{
  const harness=createConnectionManagerHarness([profile('target',{authType:'privateKey',privateKeyPath:'/old/key'})]);
  await harness.context.secrets.store(secretKey('target','passphrase'),'old-secret');
  assert.equal((await harness.manager.buildConnectOptions({id:'target',privateKeyPath:'/new/key'})).passphrase,'old-secret');
  assert.equal((await harness.manager.buildConnectOptions({id:'target',privateKeyPath:'/new/key',freshPrivateKey:true})).passphrase,undefined);
});

test('contextual SSH key setup requires explicit evidence',()=>{
  assert.equal(shouldOfferSshKeySetup('sftp',undefined,'The server requires public key authentication.'),true);
  for(const message of ['All configured authentication methods failed','Password is incorrect','SSH host key changed'])assert.equal(shouldOfferSshKeySetup('sftp',undefined,message),false);
  assert.equal(shouldOfferSshKeySetup('sftp','/key','The server requires public key authentication.'),false);
  assert.equal(shouldOfferSshKeySetup('ftp',undefined,'The server requires public key authentication.'),false);
});

test('POSIX deployment transaction preserves bytes and permissions, avoids duplicates and refuses stale/linked files',async t=>{
  if(process.platform==='win32'){t.skip('POSIX transaction requires Python and POSIX filesystem semantics');return;}
  try { await execute('python3',['--version']); } catch {t.skip('Python is unavailable for the POSIX transaction fixture');return;}
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-key-deploy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ssh=path.join(dir,'.ssh');await fs.mkdir(ssh,{mode:0o700});const target=path.join(ssh,'authorized_keys');
  const key=utils.generateKeyPairSync('ed25519').public;
  const prefix=`import os,subprocess,types\nimport pwd\npwd.getpwuid=lambda uid: types.SimpleNamespace(pw_dir=${JSON.stringify(dir)},pw_name='test')\ndef fixture_run(args,**kw):\n if args[0]=='ps': return types.SimpleNamespace(returncode=0,stdout='sshd: listener',stderr='')\n return types.SimpleNamespace(returncode=0,stdout='pubkeyauthentication yes\\nauthorizedkeysfile .ssh/authorized_keys\\nusedns no\\n',stderr='')\nsubprocess.run=fixture_run\nos.environ['SSH_CONNECTION']='127.0.0.1 1000 127.0.0.1 2222'\n`;
  const run=async(expected?:any)=>JSON.parse((await execute('python3',['-c',prefix+posixDeploymentScript(key,expected)])).stdout);
  const original=Buffer.from('# preserve this comment\r\n'+utils.generateKeyPairSync('ed25519').public+' old comment\r\n');await fs.writeFile(target,original,{mode:0o640});
  const review=await run();assert.equal(review.destination,target);assert.equal(review.alreadyInstalled,false);assert.deepEqual(await fs.readFile(target),original);
  assert.equal((await run(review)).installed,true);const content=await fs.readFile(target);assert(content.subarray(0,original.length).equals(original));assert.equal((await fs.stat(target)).mode&0o777,0o640);
  const repeat=await run();assert.equal(repeat.alreadyInstalled,true);assert.equal((await run(repeat)).alreadyInstalled,true);assert.deepEqual(await fs.readFile(target),content);
  await fs.appendFile(target,'# external change\n');await assert.rejects(run(repeat),/changed/);
  await fs.unlink(target);await fs.symlink(path.join(dir,'outside'),target);await assert.rejects(run(),/Unsafe/);
  assert.deepEqual((await fs.readdir(ssh)).filter(n=>n.startsWith('.remoteedit')),[]);
});

test('deployment leaves profiles untouched until explicit Use SSH Key, clears old credentials and never emits private material',async t=>{
  const {SshKeyToolsController}=loadWithVscode(()=>require('../panel/SshKeyToolsController')) as typeof import('../panel/SshKeyToolsController');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-key-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const key=await generateKey({type:'ed25519',location:path.join(dir,'key')});
  const harness=createConnectionManagerHarness([profile('target')]);
  await harness.context.secrets.store(secretKey('target','password'),'existing-password');
  await harness.context.secrets.store(secretKey('target','passphrase'),'unrelated-passphrase');
  const messages:any[]=[];let refreshed=0;
  const controller=new SshKeyToolsController(harness.manager,p=>messages.push(p),async()=>{refreshed++;});
  t.after(()=>controller.dispose());
  (controller as any).deployment={close:async()=>{},release:async()=>{},additionalDestinations:()=>[],prepare:async()=>({destination:'/home/test/.ssh/authorized_keys',platform:'posix',digest:createHash('sha256').update('').digest('hex'),alreadyInstalled:false,permissions:'verified'}),deploy:async()=>({installed:true,authentication:'unavailable'}),test:async()=> 'passed'};
  await controller.handle({action:'prepare',location:key.privatePath,targetId:'target'});
  await controller.handle({action:'deploy'});
  assert.equal((await harness.manager.getProfile('target'))?.authType,'password');assert.equal(refreshed,0);
  assert.equal(messages.at(-1).result.authentication,'passed');
  assert(!JSON.stringify(messages).includes('PRIVATE KEY'));assert(!JSON.stringify(messages).includes('existing-password'));assert(!JSON.stringify(messages).includes('unrelated-passphrase'));
  await controller.handle({action:'use'});
  const saved=await harness.manager.getProfile('target');assert.equal(saved?.authType,'privateKey');assert.equal(saved?.privateKeyPath,key.privatePath);assert.equal(refreshed,1);
  assert.equal(await harness.context.secrets.get(secretKey('target','passphrase')),undefined);assert.equal(await harness.context.secrets.get(secretKey('target','password')),undefined);
});

test('deployment access overrides reuse only explicitly selected secrets and never save the access draft', async t => {
  const { SshKeyToolsController } = loadWithVscode(() => require('../panel/SshKeyToolsController')) as typeof import('../panel/SshKeyToolsController');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 're-deploy-access-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const key = await generateKey({ type: 'ed25519', location: path.join(dir, 'key') });
  const harness = createConnectionManagerHarness([
    profile('own'), profile('master', { passwordSource: 'master' }),
    profile('key', { authType: 'privateKey', privateKeyPath: '/existing/key' })
  ]);
  await harness.manager.setMasterPassword('master-secret', 'master-secret');
  await harness.context.secrets.store(secretKey('own', 'password'), 'saved-secret');
  await harness.context.secrets.store(secretKey('key', 'passphrase'), 'saved-phrase');
  const writes = harness.writes.length;
  const messages: any[] = []; const captured: any[] = [];
  const controller = new SshKeyToolsController(harness.manager, p => messages.push(p), async () => { throw new Error('Unexpected refresh'); });
  t.after(() => controller.dispose());
  (controller as any).deployment = { close: async () => {}, prepare: async (options: any) => {
    captured.push(options); return { destination: '/home/user/.ssh/authorized_keys', platform: 'posix', permissions: 'verified' };
  }};
  await controller.handle({ action: 'open' });
  const metadata = messages.at(-1);
  assert.equal(metadata.masterPasswordConfigured, true);
  assert.equal(metadata.profiles.find((p: any) => p.id === 'own').hasSavedPassword, true);
  assert.equal(metadata.profiles.find((p: any) => p.id === 'key').hasSavedPassphrase, true);
  const prepare = async (targetId: string, access: any) => {
    await controller.handle({ action: 'prepare', targetId, location: key.privatePath, access });
    assert.equal(messages.at(-1).state, 'review', messages.at(-1).message);
    return captured.at(-1);
  };
  assert.equal((await prepare('own', { authType: 'password', passwordSource: 'saved' })).password, 'saved-secret');
  assert.equal((await prepare('own', { authType: 'password', passwordSource: 'master' })).password, 'master-secret');
  assert.equal((await prepare('master', { authType: 'password', passwordSource: 'connection', password: 'temporary' })).password, 'temporary');
  assert.equal((await prepare('key', { authType: 'privateKey', privateKeyPath: '/existing/key', passphraseSource: 'saved' })).passphrase, 'saved-phrase');
  assert.equal((await prepare('key', { authType: 'privateKey', privateKeyPath: '/other/key', passphraseSource: 'enter', passphrase: '' })).passphrase, undefined);
  assert.equal((await prepare('own', { authType: 'privateKey', privateKeyPath: '/temporary/key', passphraseSource: 'enter', passphrase: 'temporary-phrase' })).passphrase, 'temporary-phrase');
  assert.equal((await prepare('key', { authType: 'password', passwordSource: 'connection', password: 'temporary' })).authType, 'password');
  for (const [targetId, access] of [
    ['master', { authType: 'password', passwordSource: 'connection', password: '' }],
    ['key', { authType: 'privateKey', privateKeyPath: '/other/key', passphraseSource: 'saved' }]
  ] as const) {
    const count = captured.length;
    await controller.handle({ action: 'prepare', targetId, location: key.privatePath, access });
    assert.equal(messages.at(-1).state, 'error'); assert.equal(captured.length, count);
  }
  assert.equal(harness.writes.length, writes);
  for (const secret of ['master-secret', 'saved-secret', 'saved-phrase', 'temporary-phrase']) assert(!JSON.stringify(messages).includes(secret));
});
