import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as net from 'node:net';
import { openProxyTunnel, type ProxyConnection } from '../proxy/ProxyTransport';
import { setProxyDiagnostics, type ProxyDiagnostic } from '../proxy/ProxyDiagnostics';
import { parsePutty } from '../connectionImport/sources/PuttyImportSource';
import { parseSshFs } from '../connectionImport/sources/SshFsImportSource';
import { parseVsCodeSftp } from '../connectionImport/sources/VsCodeSftpImportSource';
import { resolveRouteProxy } from '../proxy/ProxyRoute';
import { createConnectionManagerHarness, profile } from './helpers/ConnectionManagerHarness';
import { buildWorkspaceSyncConnectionIdentity } from '../workspaceSync/connection/ConnectionIdentity';
import { parseWinScp } from '../connectionImport/sources/WinScpImportSource';
import { parseFileZilla } from '../connectionImport/sources/FileZillaImportSource';
import { importProxyCommand } from '../connectionImport/sources/ProxyImport';
import { candidate } from '../connectionImport/sources/ImportParsing';
const proxy: ProxyConnection = {id:'p',name:'Office',type:'socks5',host:'proxy.invalid',port:1080,authentication:'password',username:'user',password:'proxy-secret-unique'};
const exportOptions={includeSettings:false,includeConnections:true,includeFavorites:true,includeUsernames:true,includeCredentials:true,credentialPassword:'backup-secret'};
const importOptions={includeSettings:false,includeConnections:true,includeFavorites:true,includeUsernames:true,restoreCredentials:true,credentialPassword:'backup-secret',importMode:'merge' as const};

test('proxy profiles preserve secure credentials, shared references and explicit No Proxy',async()=>{
 const h=createConnectionManagerHarness();await h.manager.proxyProfiles.save(proxy);
 const p=await h.manager.saveProfile({...profile('target'),proxyProfileId:'p',password:'server-secret',rememberPassword:true});
 assert.equal((await h.manager.buildConnectOptions({id:p.id} as any)).proxy?.password,proxy.password);
 await assert.rejects(h.manager.proxyProfiles.delete('p',await h.manager.listProfiles()),/used by/);
 await h.manager.saveProfile({id:p.id,proxyProfileId:'',rememberPassword:true} as any);
 assert.equal((await h.manager.buildConnectOptions({id:p.id} as any)).proxy,undefined);
 assert(!JSON.stringify([...h.state]).includes(proxy.password!));
 await h.manager.proxyProfiles.delete('p',await h.manager.listProfiles());
 await assert.rejects(h.manager.resolveProxyProfile('p'),/unavailable/);
});

test('encrypted backup preserves proxy references and remaps credential conflicts without changing existing users',async()=>{
 const source=createConnectionManagerHarness();await source.manager.proxyProfiles.save(proxy);
 await source.manager.saveProfile({...profile('target'),proxyProfileId:'p'});
 const backup=await source.manager.buildBackupFile(exportOptions);assert(!JSON.stringify(backup).includes(proxy.password!));
 const destination=createConnectionManagerHarness([profile('existing',{proxyProfileId:'p'})]);
 await destination.manager.proxyProfiles.save({...proxy,password:'other-secret'});
 await destination.manager.importBackupFile(backup,importOptions);
 const imported=(await destination.manager.listProfiles()).find(p=>p.id!=='existing')!;
 assert.notEqual(imported.proxyProfileId,'p');assert.equal((await destination.manager.resolveProxyProfile('p'))?.password,'other-secret');
 assert.equal((await destination.manager.resolveProxyProfile(imported.proxyProfileId))?.password,proxy.password);
 const replacement=createConnectionManagerHarness();await replacement.manager.importBackupFile(backup,{...importOptions,importMode:'replace'});
 assert.equal((await replacement.manager.resolveProxyProfile('p'))?.password,proxy.password);
 const before=JSON.stringify([...destination.state]);await assert.rejects(destination.manager.importBackupFile(backup,{...importOptions,credentialPassword:'wrong'}));assert.equal(JSON.stringify([...destination.state]),before);
});

test('route conflicts fail closed and sync baseline identity tracks routes but excludes secrets',()=>{
 assert.equal(resolveRouteProxy(proxy,[{proxy}]),proxy);
 assert.throws(()=>resolveRouteProxy(proxy,[{proxy:{...proxy,id:'other'}}]),/Conflicting/);
 const input={connectionType:'sftp' as const,host:'target',port:22,username:'user'};
 assert.notEqual(buildWorkspaceSyncConnectionIdentity(input),buildWorkspaceSyncConnectionIdentity({...input,proxy}));
 assert.equal(buildWorkspaceSyncConnectionIdentity({...input,proxy}),buildWorkspaceSyncConnectionIdentity({...input,proxy:{...proxy,password:'changed'}}));
});

test('HTTP status, timeout, cancellation and fragmented greetings are handled without credentials in errors',async()=>{
 const events: ProxyDiagnostic[] = []; setProxyDiagnostics(event => events.push(event));
 const sockets=new Set<net.Socket>();let mode='reject';
 const server=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));s.once('data',()=>{
 if(mode==='reject')s.end('HTTP/1.1 407 Authentication Required\r\n\r\n');
 else if(mode==='ok'){s.write('HTTP/1.1 200 Con');setImmediate(()=>s.write('nection Established\r\n\r\nWELCOME'));}
 });});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const options={...proxy,type:'http' as const,host:'127.0.0.1',port:(server.address() as net.AddressInfo).port};
 try{
 await assert.rejects(openProxyTunnel(options,'target.invalid',22,1000),/407/);
 mode='ok';const tunnel=await openProxyTunnel(options,'target.invalid',22,1000);assert.equal(tunnel.read()?.toString(),'WELCOME');tunnel.destroy();
 mode='hang';await assert.rejects(openProxyTunnel(options,'target.invalid',22,20),/timed out/);
 const controller=new AbortController();const pending=openProxyTunnel(options,'target.invalid',22,1000,controller.signal);controller.abort();await assert.rejects(pending,/cancelled|Cannot connect/);
 assert(events.some(e=>e.status==='connected' && e.durationMs>=0));
 assert(events.some(e=>e.reason==='authentication'));
 assert(events.some(e=>e.reason==='timeout'));
 assert(events.some(e=>e.reason==='cancelled'));
 assert(!JSON.stringify(events).includes(proxy.password!));
 assert(!JSON.stringify(events).includes(proxy.username!));
 }finally{setProxyDiagnostics();for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}
});

test('import maps supported proxy formats and rejects arbitrary ProxyCommand without executing it',()=>{
 const winscp=parseWinScp('[Sessions\\Test]\nHostName=target\nProxyMethod=2\nProxyHost=proxy\nProxyPort=1080\nProxyUsername=user\nProxyPasswordPlain=secret','winscp.ini')[0];
 assert.equal(winscp.proxy?.type,'socks5');assert.equal(winscp.proxy?.password,'secret');assert.equal(winscp.unsupported,undefined);
 const fz=parseFileZilla('<FileZilla3><Servers><Server><Name>Test</Name><Host>target</Host><Protocol>1</Protocol></Server></Servers></FileZilla3>','sites.xml','<FileZilla3><Settings><Setting name="Proxy type">1</Setting><Setting name="Proxy host">proxy</Setting><Setting name="Proxy port">8080</Setting></Settings></FileZilla3>')[0];assert.equal(fz.proxy?.type,'http');
 const ssh=candidate('openssh','config','Test','target');importProxyCommand(ssh,'nc -X 5 -x proxy:1080 %h %p');assert.equal(ssh.proxy?.type,'socks5');
 importProxyCommand(ssh,'sh -c "nc proxy 1080"');assert.match(ssh.unsupported!,/Unsupported/);
});


test('proxy-only backup enables restore and includes proxy usernames in its summary', async () => {
 const source=createConnectionManagerHarness(); await source.manager.proxyProfiles.save(proxy);
 const backup=await source.manager.buildBackupFile(exportOptions);
 const summary=source.manager.summarizeBackupFile(backup);
 assert.equal(summary.supportedConnectionCount,0); assert.equal(summary.proxyProfileCount,1); assert.equal(summary.usernamesIncluded,true);
 for (const importMode of ['merge','replace'] as const) {
  const destination=createConnectionManagerHarness();
  await destination.manager.importBackupFile(backup,{...importOptions,importMode});
  assert.equal((await destination.manager.resolveProxyProfile('p'))?.password,proxy.password);
  assert.deepEqual(await destination.manager.listProfiles(),[]);
 }
 const destination=createConnectionManagerHarness();
 await destination.manager.importBackupFile(backup,{...importOptions,includeUsernames:false,restoreCredentials:false});
 assert.equal((await destination.manager.proxyProfiles.list())[0].username,'');
 await assert.rejects(destination.manager.resolveProxyProfile('p'),/username/);
});

test('PuTTY, SSH FS and VS Code SFTP import proxies with warnings for unavailable credentials', async () => {
 const putty=parsePutty('HostName=target\nProtocol=ssh\nProxyMethod=2\nProxyHost=proxy\nProxyPort=1080\nProxyUsername=user','session')[0];
 const value={name:'Test',host:'target',proxy:{type:'socks5',host:'proxy',port:1080,username:'user'}};
 const sshfs=(await parseSshFs(JSON.stringify([value]),'sshfs.json'))[0];
 const sftp=parseVsCodeSftp(JSON.stringify(value),'sftp.json')[0];
 for(const item of [putty,sshfs,sftp]) {
  assert.equal(item.proxy?.type,'socks5'); assert.equal(item.proxy?.authentication,'password');
  assert.equal(item.proxy?.password,undefined); assert.equal(item.unsupported,undefined);
  assert(item.warnings.some(w=>/Proxy password is unavailable/.test(w)));
 }
});


test('proxy lists sort naturally without changing stored order, IDs or connection selection', async () => {
 const h=createConnectionManagerHarness([profile('target',{proxyProfileId:'p10'})]);
 const profiles=[
  {...proxy,id:'p10',name:'proxy 10',authentication:'none' as const},
  {...proxy,id:'z',name:'Zulu',authentication:'none' as const},
  {...proxy,id:'p2',name:'Proxy 2',authentication:'none' as const},
  {...proxy,id:'a',name:'alpha',authentication:'none' as const}
 ];
 h.state.set('remoteedit.proxyProfiles',profiles);
 const stored=JSON.stringify(h.state.get('remoteedit.proxyProfiles'));
 assert.deepEqual((await h.manager.proxyProfiles.list()).map(p=>p.id),['a','p2','p10','z']);
 assert.equal(JSON.stringify(h.state.get('remoteedit.proxyProfiles')),stored);
 await h.manager.proxyProfiles.save({...profiles[1],name:'Beta'});
 assert.deepEqual((await h.manager.proxyProfiles.list()).map(p=>p.id),['a','z','p2','p10']);
 assert.equal((await h.manager.getProfile('target'))?.proxyProfileId,'p10');
 await h.manager.proxyProfiles.delete('p2',await h.manager.listProfiles());
 assert.deepEqual((await h.manager.proxyProfiles.list()).map(p=>p.id),['a','z','p10']);
 assert.equal((await h.manager.resolveProxyProfile('p10'))?.id,'p10');
});
