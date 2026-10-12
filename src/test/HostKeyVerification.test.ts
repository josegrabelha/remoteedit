import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TestContext } from 'node:test';
import { Client, Server, utils, type ConnectConfig } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { hostKeyTrust, hostKeyVerificationEnabled, initializeHostKeyTrust, installHostKeyVerification, sshConnectionTimeout, withHostKeyApproval, withHostKeyUi } from '../ssh/hostKeys/HostKeyRuntime';
import { HostKeyTrustService } from '../ssh/hostKeys/HostKeyTrustService';
import { HostKeySecurityError, identifyHostKey, parsePublicKey } from '../ssh/hostKeys/HostKeyVerifier';
import { KnownHosts, knownHostsFiles, matchesKnownHost, parseKnownHosts } from '../ssh/hostKeys/KnownHosts';
import { TrustedHostStore } from '../ssh/hostKeys/TrustedHostStore';
import type { SshJumpChain as SshJumpChainType } from '../ssh/SshJumpChain';
import type { SftpSyncSession as SftpSyncSessionType } from '../workspaceSync/connection/SftpSyncSession';
import type { WorkspaceSyncConnectionSnapshot } from '../workspaceSync/connection/WorkspaceSyncConnectionSnapshot';
import { createConnectionManagerHarness, loadWithVscode } from './helpers/ConnectionManagerHarness';
import { listenLoopback } from './helpers/LoopbackServer';
import { test, waitFor } from './helpers/TestHarness';

const { SshJumpChain } = loadWithVscode(() => require('../ssh/SshJumpChain')) as typeof import('../ssh/SshJumpChain');

// These integration tests exercise real SSH/SFTP connections, including
// expected host-key rejections and normal transport closes. ssh2-sftp-client's
// default global callbacks print those events unconditionally to stdout.
// Override only the library's *test instances*, retaining the real SSH/SFTP
// transport, production constructors and all functional assertions.
const sftpTransportEvents: Array<{ type: 'error' | 'end' | 'close'; error?: unknown }> = [];
class HostKeyTestSftpClient extends SftpClient {
  constructor(name?: string) {
    super(name, {
      error: (error: unknown) => { sftpTransportEvents.push({ type: 'error', error }); },
      end: () => { sftpTransportEvents.push({ type: 'end' }); },
      close: () => { sftpTransportEvents.push({ type: 'close' }); }
    });
  }
}

function loadWithTestSftpEvents<T>(load: () => T): T {
  const loader = require('node:module') as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === 'ssh2-sftp-client'
    ? HostKeyTestSftpClient : Reflect.apply(original, loader, [request, parent, isMain]);
  try { return loadWithVscode(load); }
  finally { loader._load = original; }
}

const { SftpSyncSession } = loadWithTestSftpEvents(() => require('../workspaceSync/connection/SftpSyncSession')) as typeof import('../workspaceSync/connection/SftpSyncSession');

function string(value: Buffer | string): Buffer { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return Buffer.concat([size, bytes]); }
function edKey(): Buffer { const pair = generateKeyPairSync('ed25519'); const jwk = pair.publicKey.export({ format: 'jwk' }); return Buffer.concat([string('ssh-ed25519'), string(Buffer.from(jwk.x!, 'base64url'))]); }
const raw = edKey(), changed = edKey();
const rsaPrivate = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
const rsa = utils.parseKey(rsaPrivate); if (rsa instanceof Error || Array.isArray(rsa)) throw new Error('Invalid test RSA key');
const rsaRaw = rsa.getPublicSSH();
const key = identifyHostKey(raw), other = identifyHostKey(changed);
const userFile = { filePath: '/user/.ssh/known_hosts', source: 'OpenSSH (User)' as const };
async function fixture(t?: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-hostkeys-'));
  const file = path.join(directory, 'known_hosts');
  const store = new TrustedHostStore(path.join(directory, 'trusted.json'));
  const known = new KnownHosts([{ filePath: file, source: 'OpenSSH (User)' }]);
  const log: string[] = [];
  const service = new HostKeyTrustService(store, known, message => log.push(message));
  let cleanupWork: Promise<void> | undefined;
  const cleanup = (): Promise<void> => cleanupWork ||= (async () => {
    service.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  })();
  t?.after(cleanup);
  return { directory, file, store, known, service, log, cleanup };
}

test('SHA-256 uses complete wire key and rejects invalid algorithms, encodings and certificates', () => {
  assert.match(key.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.deepEqual(parsePublicKey('ssh-ed25519', raw.toString('base64')), key);
  assert.throws(() => parsePublicKey('ssh-rsa', raw.toString('base64')), /algorithm/);
  assert.throws(() => parsePublicKey('ssh-ed25519', raw.toString('base64') + '?'), /encoding/);
  assert.throws(() => identifyHostKey(Buffer.concat([string('ssh-ed25519-cert-v01@openssh.com'), string('fake')])), /certificates/);
});

test('known_hosts matches aliases, wildcards, negation, IPv6, hashed hosts and custom ports', () => {
  const entries = parseKnownHosts(`*.example,!blocked.example ${key.publicKey}\r\n[2001:db8::1]:2222 ${key.publicKey}\n`, userFile);
  assert(matchesKnownHost(entries[0], 'DEV.EXAMPLE', 22)); assert(!matchesKnownHost(entries[0], 'blocked.example', 22));
  assert(!matchesKnownHost(entries[0], 'dev.example', 2222)); assert(matchesKnownHost(entries[1], '2001:db8::1', 2222));
  const salt = Buffer.alloc(20, 3), token = '[dev.example]:2222';
  const hash = createHmac('sha1', salt).update(token).digest('base64');
  const hashed = parseKnownHosts(`|1|${salt.toString('base64')}|${hash} ${key.publicKey}`, userFile)[0];
  assert.equal(hashed.host, 'Hashed host'); assert(matchesKnownHost(hashed, 'dev.example', 2222)); assert(!matchesKnownHost(hashed, 'dev.example', 22));
  const alias = parseKnownHosts(`dev.example,alias.example ${key.publicKey}`, userFile)[0]; assert(matchesKnownHost(alias, 'alias.example', 22));
});

test('known_hosts paths follow the extension host platform on Windows, Linux and macOS', () => {
  assert.deepEqual(knownHostsFiles('win32', 'C:\\Users\\Tester', 'D:\\ProgramData').map(file => file.filePath), ['C:\\Users\\Tester\\.ssh\\known_hosts', 'D:\\ProgramData\\ssh\\ssh_known_hosts']);
  for (const platform of ['linux', 'darwin'] as const) assert.deepEqual(knownHostsFiles(platform, '/home/tester').map(file => file.filePath), ['/home/tester/.ssh/known_hosts', '/etc/ssh/ssh_known_hosts']);
});

test('TOFU persists complete local identity, shares it after restart and blocks changed keys', async t => {
  const f = await fixture(t);
  try {
    let prompts = 0;
    await f.service.verify('DEV.EXAMPLE.', 22, raw, async () => { prompts++; return true; });
    const saved = await f.store.list(); assert.equal(saved[0].host, 'dev.example'); assert.equal(saved[0].publicKey, key.publicKey);
    const restarted = new HostKeyTrustService(new TrustedHostStore(path.join(f.directory, 'trusted.json')), f.known);
    await restarted.verify('dev.example', 22, raw); assert.equal(prompts, 1);
    await assert.rejects(restarted.verify('dev.example', 22, changed), /Changed or conflicting/);
    await restarted.verify('dev.example', 22, rsaRaw, async () => true); assert.equal((await f.store.list()).length, 2);
    await f.store.remove(saved[0].id);
    await assert.rejects(restarted.verify('dev.example', 22, raw), /Approval required/);
  } finally { await f.cleanup(); }
});

test('each OpenSSH source retains its veto; revoked and unsupported CA records block internal trust', async t => {
  const f = await fixture(t);
  try {
    await f.service.verify('host', 22, raw, async () => true);
    await fs.writeFile(f.file, `host ${identifyHostKey(changed).publicKey}\n`);
    await assert.rejects(f.service.verify('host', 22, raw), /OpenSSH \(User\)/);
    await fs.writeFile(f.file, `host ${key.publicKey}\nhost ${identifyHostKey(changed).publicKey}\n`);
    await f.service.verify('host', 22, raw);
    await fs.writeFile(f.file, `@revoked host ${key.publicKey}\n`);
    await assert.rejects(f.service.verify('host', 22, raw), /Revoked/);
    await fs.writeFile(f.file, `@cert-authority host ${key.publicKey}\n`);
    await assert.rejects(f.service.verify('host', 22, raw), /authority validation is unsupported/);
    const system = path.join(f.directory, 'system'); await fs.writeFile(system, `host ${key.publicKey}\n`);
    await fs.writeFile(f.file, `host ${identifyHostKey(changed).publicKey}\n`);
    const both = new HostKeyTrustService(f.store, new KnownHosts([{ filePath: f.file, source: 'OpenSSH (User)' }, { filePath: system, source: 'OpenSSH (System)' }]));
    await assert.rejects(both.verify('host', 22, raw), /OpenSSH \(User\)/);
  } finally { await f.cleanup(); }
});

test('OpenSSH validation is read-only and missing, unreadable, malformed and corrupt stores fail safely', async t => {
  const f = await fixture(t);
  try {
    await fs.writeFile(f.file, `host ${key.publicKey}\n`); const before = await fs.readFile(f.file);
    await f.service.verify('host', 22, raw); assert.equal((await f.store.list()).length, 0); assert.deepEqual(await fs.readFile(f.file), before);
    await fs.rm(f.file); await assert.rejects(f.service.verify('host', 22, raw), /Approval required/);
    await fs.mkdir(f.file); await assert.rejects(f.service.verify('host', 22, raw, async () => true), /Cannot read/);
    await fs.rm(f.file, { recursive: true }); await fs.writeFile(f.file, 'bad line'); await assert.rejects(f.service.verify('host', 22, raw, async () => true), /Unsupported/);
    await fs.rm(f.file); await fs.writeFile(path.join(f.directory, 'trusted.json'), '{bad'); await assert.rejects(f.service.verify('host', 22, raw, async () => true), /store is invalid/);
  } finally { await f.cleanup(); }
});

test('simultaneous modules share approval, isolate cancellation and reject concurrent different keys', async t => {
  const f = await fixture(t);
  try {
    let resolve!: (accepted: boolean) => void, started!: () => void, prompts = 0;
    const ready = new Promise<void>(r => { started = r; });
    const prompt = async () => { prompts++; started(); return new Promise<boolean>(r => { resolve = r; }); };
    const abort = new AbortController();
    const first = f.service.verify('host', 22, raw, prompt, abort.signal); const firstRejected = assert.rejects(first, /cancelled/);
    await ready;
    const second = f.service.verify('host', 22, raw, prompt);
    await assert.rejects(f.service.verify('host', 22, changed, prompt), /Different server keys/);
    abort.abort(); await firstRejected; resolve(true); await second;
    assert.equal(prompts, 1); assert.equal((await f.store.list()).length, 1);
  } finally { await f.cleanup(); }
});

test('cancelled approval and persistence failures never release a handshake or store trust', async t => {
  const f = await fixture(t);
  try {
    await assert.rejects(f.service.verify('host', 22, raw, async () => false), /cancelled or rejected/); assert.equal((await f.store.list()).length, 0);
    const abort = new AbortController();
    const cancelled = f.service.verify('host', 22, raw, async (_request, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })), abort.signal);
    const rejected = assert.rejects(cancelled, /cancelled/); await new Promise(resolve => setImmediate(resolve)); abort.abort(); await rejected;
    await new Promise(resolve => setImmediate(resolve)); assert.equal((await f.store.list()).length, 0);
    const blocked = path.join(f.directory, 'file'); await fs.writeFile(blocked, 'not a directory');
    const failing = new HostKeyTrustService(new TrustedHostStore(path.join(blocked, 'trusted.json')), new KnownHosts([]));
    await assert.rejects(failing.verify('host', 22, raw, async () => true), /Cannot read|persist/);
    const writeFail = new TrustedHostStore(path.join(f.directory, 'writefail.json'));
    writeFail.trust = async () => { throw new HostKeySecurityError('Storage failed'); };
    await assert.rejects(new HostKeyTrustService(writeFail, new KnownHosts([])).verify('host', 22, raw, async () => true), /Storage failed/);
  } finally { await f.cleanup(); }
});

test('store serializes writers from separate windows and rechecks conflicts after approval', async t => {
  const f = await fixture(t);
  try {
    const secondStore = new TrustedHostStore(path.join(f.directory, 'trusted.json'));
    await Promise.all([f.store.trust('one', 22, key), secondStore.trust('two', 22, key)]);
    assert.equal((await f.store.list()).length, 2);
    await assert.rejects(f.service.verify('third', 22, raw, async () => { await secondStore.trust('third', 22, identifyHostKey(changed)); return true; }), /Changed or conflicting/);
    await assert.rejects(f.service.verify('fourth', 22, raw, async () => { await fs.writeFile(f.file, `@revoked fourth ${key.publicKey}`); return true; }), /Revoked/);
  } finally { await f.cleanup(); }
});

async function sshServer(t?: TestContext) {
  let authRequests = 0;
  const clients = new Set<any>();
  const streams = new Set<net.Socket>();
  const server = new Server({ hostKeys: [rsaPrivate] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', context => { authRequests++; if (context.method === 'password') context.accept(); else context.reject(['password']); });
    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        const socket = net.connect(info.destPort, info.destIP); streams.add(socket);
        socket.on('connect', () => { const channel = accept(); socket.pipe(channel).pipe(socket); channel.on('error', () => socket.destroy()); channel.on('close', () => socket.destroy()); });
        socket.on('error', () => { try { reject(); } catch {} }); socket.on('close', () => streams.delete(socket));
      });
      client.on('session', accept => {
        const session = accept();
        session.on('exec', acceptExec => { const channel = acceptExec(); channel.write('Linux\n'); channel.exit(0); channel.end(); });
        session.on('sftp', acceptSftp => {
          const sftp = acceptSftp();
          sftp.on('REALPATH', (id: number) => sftp.name(id, [{ filename: '/', longname: '/', attrs: { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 } }]));
          const attrs = { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };
          sftp.on('STAT', (id: number) => sftp.attrs(id, attrs));
          sftp.on('LSTAT', (id: number) => sftp.attrs(id, attrs));
          sftp.on('OPENDIR', (id: number) => sftp.handle(id, Buffer.from('dir')));
          sftp.on('READDIR', (id: number) => sftp.status(id, 1));
          sftp.on('CLOSE', (id: number) => sftp.status(id, 0));
        });
      });
    });
  });
  server.on('error', () => {});
  const listener = await listenLoopback(net.createServer(socket => server.injectSocket(socket)));
  const close = async (): Promise<void> => {
    for (const socket of streams) socket.destroy();
    await listener.close();
  };
  t?.after(close);
  return { port: listener.port, openClients: () => clients.size, authRequests: () => authRequests, close };
}
async function runtimeFixture(acceptReplacements = false, t?: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-hostkey-runtime-'));
  const enabled = { globalValue: true, workspaceValue: false, defaultValue: true };
  const logs: string[] = [], warnings: string[] = [];
  const settings = { sshReadyTimeout: 30000 };
  let nativeHandler: ((message: string, action: string) => Promise<string | undefined>) | undefined;
  const vscode = { workspace: { getConfiguration: () => ({ inspect: () => enabled, get: (name: string) => name === 'sshReadyTimeout' ? settings.sshReadyTimeout : undefined }) }, env: {}, window: { showWarningMessage: async (message: string, _options: unknown, action: string) => { warnings.push(message); if (nativeHandler) return nativeHandler(message, action); return acceptReplacements ? action : 'Trust & Connect'; } } };
  const loader = require('module'), original = loader._load;
  const subscriptions: { dispose(): void }[] = [];
  loader._load = (request: string, ...args: any[]) => request === 'vscode' ? vscode : original.call(loader, request, ...args);
  try { initializeHostKeyTrust({ globalStorageUri: { fsPath: directory }, subscriptions } as any, { appendLine: (line: string) => logs.push(line) } as any); }
  finally { loader._load = original; }
  // Use an isolated known_hosts source rather than the test runner's account.
  hostKeyTrust().knownHosts.list = async () => [];
  let cleanupWork: Promise<void> | undefined;
  const cleanup = (): Promise<void> => cleanupWork ||= (async () => {
    subscriptions.forEach(item => item.dispose());
    await fs.rm(directory, { recursive: true, force: true });
  })();
  t?.after(cleanup);
  return { enabled, settings, logs, warnings, directory, setNativeHandler: (handler: typeof nativeHandler) => { nativeHandler = handler; }, cleanup, native: async <T>(work: () => Promise<T>) => {
    loader._load = (request: string, ...args: any[]) => request === 'vscode' ? vscode : original.call(loader, request, ...args);
    try { return await work(); } finally { loader._load = original; }
  } };
}
async function guardedConnect(port: number, background = true, readyTimeout = 3000) {
  return withHostKeyApproval(async () => {
    const client = new Client(); const config: ConnectConfig = { host: '127.0.0.1', port, username: 'test', password: 'test-password', readyTimeout };
    const failure = installHostKeyVerification(config, client, '127.0.0.1', port, undefined, { background });
    try { await new Promise<void>((resolve, reject) => { client.once('ready', resolve); client.once('error', reject); client.connect(config); }); }
    catch (error) { throw failure() || error; }
    finally { client.destroy(); }
  });
}

test('real SSH handshake blocks unknown identities before authentication; native TOFU and shared silent verification work', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  try {
    assert.equal(hostKeyVerificationEnabled(), true); // Workspace false cannot override the global machine value.
    await assert.rejects(guardedConnect(server.port), /Approval required/); assert.equal(server.authRequests(), 0);
    await runtime.native(() => guardedConnect(server.port, false)); assert.equal(runtime.warnings.length, 1);
    await guardedConnect(server.port); assert.equal(runtime.warnings.length, 1);
    assert.equal((await hostKeyTrust().store.list()).length, 1);
    assert(runtime.logs.every(line => !line.includes('test-password')));
    runtime.enabled.globalValue = false;
    await guardedConnect(server.port); assert(server.authRequests() > 0);
  } finally { await server.close(); await runtime.cleanup(); }
});

function snapshot(port: number): WorkspaceSyncConnectionSnapshot {
  return { profileId: 'target', profileUpdatedAt: 0, connectionIdentity: 'test', name: 'Target', connectionType: 'sftp', host: '127.0.0.1', port, username: 'test', authType: 'password', password: 'test-password', startPath: '/', keepAlive: false, ftpsAllowSelfSignedCertificate: false, jumpChain: [] };
}
test('real Sync transport requires explicit Webview approval and verifies again during reconnect without a native prompt', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t); let session: SftpSyncSessionType | undefined;
  try {
    await assert.rejects(SftpSyncSession.connect(snapshot(server.port)), /Approval required/); assert.equal(server.authRequests(), 0);
    let prompts = 0;
    session = await withHostKeyUi({ prompt: async () => { prompts++; return true; }, confirmDisable: async () => false }, () => SftpSyncSession.connect(snapshot(server.port)));
    await session.reconnect(); assert.equal(prompts, 1); assert.equal(runtime.warnings.length, 0);
    const item = (await hostKeyTrust().store.list())[0]; await hostKeyTrust().store.remove(item.id);
    await assert.rejects(session.reconnect(), /Approval required/); assert.equal(session.isDisconnected, true);
    const count = server.authRequests(); await assert.rejects(session.reconnect(), /Approval required/); assert.equal(server.authRequests(), count);
  } finally { await session?.disconnect(); await server.close(); await runtime.cleanup(); }
});

test('real Jump chains and private Sync Jump chains verify each hop and final target through the origin Webview', async t => {
  const runtime = await runtimeFixture(false, t), jump = await sshServer(t), target = await sshServer(t); let session: SftpSyncSessionType | undefined, chain: SshJumpChainType | undefined;
  try {
    const requests: number[] = [];
    const ui = { prompt: async (request: { port: number }) => { requests.push(request.port); return true; }, confirmDisable: async () => false };
    const jumpOptions = { ...snapshot(jump.port), connectionType: 'sftp' as const, profileId: 'jump', name: 'Jump' };
    await withHostKeyUi(ui, () => withHostKeyApproval(async () => {
      chain = new SshJumpChain({ readyTimeout: 3000, keepAliveInterval: 0, keepAliveCountMax: 0 }, { promptPassphrase: async () => undefined });
      const finalClient = new Client();
      let failure: () => Error | undefined = () => undefined;
      try {
        const stream = await chain.open([jumpOptions], { kind: 'target', host: '127.0.0.1', port: target.port, name: 'Target' });
        const config: ConnectConfig = { sock: stream, username: 'test', password: 'test-password', readyTimeout: 3000 };
        failure = installHostKeyVerification(config, finalClient, '127.0.0.1', target.port);
        await new Promise<void>((resolve, reject) => { finalClient.once('ready', resolve); finalClient.once('error', reject); finalClient.connect(config); });
      } catch (error) { await chain.dispose(); throw failure() || error; }
      finally { finalClient.destroy(); }
    }));
    assert.deepEqual(requests, [jump.port, target.port]);
    await chain!.dispose(); chain = undefined;
    const syncSnapshot = { ...snapshot(target.port), jumpChain: [jumpOptions] };
    session = await SftpSyncSession.connect(syncSnapshot); assert.equal(requests.length, 2); await session.disconnect(); session = undefined;
    const trustedJump = (await hostKeyTrust().store.list()).find(item => item.port === jump.port)!;
    await hostKeyTrust().store.remove(trustedJump.id);
    const replacement = utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }));
    if (replacement instanceof Error || Array.isArray(replacement)) throw new Error('Invalid key');
    await hostKeyTrust().store.trust('127.0.0.1', jump.port, identifyHostKey(replacement.getPublicSSH()));
    const before = target.authRequests(); await assert.rejects(SftpSyncSession.connect(syncSnapshot), /Changed or conflicting/); assert.equal(target.authRequests(), before);
  } finally { await session?.disconnect(); await chain?.dispose(); await target.close(); await jump.close(); await runtime.cleanup(); }
});

test('settings backup excludes all host trust; restoring disabled verification requires origin UI approval before any mutation', async () => {
  const h = createConnectionManagerHarness();
  const backup = await h.manager.buildBackupFile({ includeSettings: true, includeConnections: true, includeFavorites: false, includeUsernames: false, includeCredentials: false });
  assert.equal(backup.settings!['ssh.hostKeyVerification'], true);
  assert(!JSON.stringify(backup).includes('trustedHosts')); assert(!JSON.stringify(backup).includes('known_hosts'));
  backup.settings!['ssh.hostKeyVerification'] = false;
  const before = JSON.stringify([...h.state]); let requests = 0;
  const options = { includeSettings: true, includeConnections: true, includeFavorites: false, includeUsernames: false, restoreCredentials: false, importMode: 'replace' as const };
  await assert.rejects(withHostKeyUi({ prompt: async () => false, confirmDisable: async () => { requests++; return false; } }, () => h.manager.importBackupFile(backup, options)), /restoration cancelled/);
  assert.equal(JSON.stringify([...h.state]), before); assert.equal(h.ui.configurationWrites.length, 0);
  await withHostKeyUi({ prompt: async () => false, confirmDisable: async () => { requests++; return true; } }, () => h.manager.importBackupFile(backup, options));
  assert.equal(requests, 2); assert(h.ui.configurationWrites.some(item => item.key === 'ssh.hostKeyVerification' && item.value === false));
});

test('separate Advanced View and Multi-Target SFTP managers share trust and preserve descriptive security failures', async t => {
  const { SftpSessionManager } = loadWithTestSftpEvents(() => require('../ssh/SftpSessionManager')) as typeof import('../ssh/SftpSessionManager');
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  const advanced = new SftpSessionManager(), multiTarget = new SftpSessionManager();
  try {
    const options = { ...snapshot(server.port), connectionId: 'advanced', jumpChain: [] };
    let prompts = 0;
    await withHostKeyUi({ prompt: async () => { prompts++; return true; }, confirmDisable: async () => false }, () => advanced.connect(options));
    await withHostKeyUi({ prompt: async () => { throw new Error('Trusted host must connect silently'); }, confirmDisable: async () => false }, () => multiTarget.connect({ ...options, connectionId: 'multi-target' }));
    assert.equal(prompts, 1);
    await advanced.disconnectAll(); await multiTarget.disconnectAll();
    const item = (await hostKeyTrust().store.list())[0]; await hostKeyTrust().store.remove(item.id);
    const other = utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }));
    if (other instanceof Error || Array.isArray(other)) throw new Error('Invalid key');
    await hostKeyTrust().store.trust('127.0.0.1', server.port, identifyHostKey(other.getPublicSSH()));
    const count = server.authRequests();
    await assert.rejects(withHostKeyUi({ prompt: async () => false, confirmDisable: async () => false }, () => advanced.connect(options)), /cancelled or rejected/); assert.equal(server.authRequests(), count);
    assert.equal(advanced.getConnection('advanced'), undefined);
  } finally { await advanced.disconnectAll(); await multiTarget.disconnectAll(); await server.close(); await runtime.cleanup(); }
});

test('real HTTP CONNECT route verifies the SSH destination and cannot bypass changed-key protection', async t => {
  const runtime = await runtimeFixture(false, t), target = await sshServer(t); let session: SftpSyncSessionType | undefined;
  const sockets = new Set<net.Socket>();
  const proxy = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => {
      const upstream = net.connect(target.port, '127.0.0.1'); sockets.add(upstream);
      upstream.on('error', () => socket.destroy()); upstream.on('close', () => sockets.delete(upstream));
      upstream.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream).pipe(socket); });
      socket.on('close', () => upstream.destroy());
    });
  });
  const proxyListener = await listenLoopback(proxy, t);
  try {
    const value = { ...snapshot(target.port), proxy: { id: 'http', name: 'Proxy', host: '127.0.0.1', port: (proxy.address() as net.AddressInfo).port, type: 'http' as const, authentication: 'none' as const } };
    let prompts = 0;
    session = await withHostKeyUi({ prompt: async request => { assert.equal(request.port, target.port); prompts++; return true; }, confirmDisable: async () => false }, () => SftpSyncSession.connect(value));
    assert.equal(prompts, 1); assert.equal((await hostKeyTrust().store.list())[0].port, target.port);
    await session.disconnect(); session = undefined;
    const trusted = (await hostKeyTrust().store.list())[0]; await hostKeyTrust().store.remove(trusted.id);
    const other = utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }));
    if (other instanceof Error || Array.isArray(other)) throw new Error('Invalid key');
    await hostKeyTrust().store.trust('127.0.0.1', target.port, identifyHostKey(other.getPublicSSH()));
    const count = target.authRequests(); await assert.rejects(SftpSyncSession.connect(value), /Changed or conflicting/); assert.equal(target.authRequests(), count);
  } finally { await session?.disconnect(); for (const socket of sockets) socket.destroy(); await proxyListener.close(); await target.close(); await runtime.cleanup(); }
});

test('cancelling a Webview host-key dialog settles only that request and ignores late confirmation', async () => {
  const { RemoteEditDialogManager } = require('../panel/DialogManager') as typeof import('../panel/DialogManager');
  const messages: { type: string; payload: any }[] = [];
  const dialogs = new RemoteEditDialogManager(() => true, (type, payload) => messages.push({ type, payload }));
  const abort = new AbortController();
  const first = dialogs.showConfirmDialog({ title: 'Trust SSH Server Identity?', message: key.fingerprint, confirmLabel: 'Trust & Connect' }, abort.signal);
  const firstId = messages[0].payload.requestId;
  const second = dialogs.showConfirmDialog({ title: 'Other Confirmation', message: 'Other action', confirmLabel: 'OK' });
  const secondId = messages[1].payload.requestId;
  abort.abort(); assert.equal(await first, false);
  assert(messages.some(message => message.type === 'closeConfirmDialog' && message.payload.requestId === firstId));
  dialogs.handleConfirmDialogResponse({ requestId: firstId, confirmed: true });
  dialogs.handleConfirmDialogResponse({ requestId: secondId, confirmed: true }); assert.equal(await second, true);
});

test('OpenSSH user deletion preserves every other byte, permissions and backup for LF/CRLF, hashed hosts and custom ports', async t => {
  for (const ending of ['\n', '\r\n']) {
    const f = await fixture(t);
    try {
      const salt = Buffer.alloc(20, 4), hash = createHmac('sha1', salt).update('[server]:2222').digest('base64');
      const hashed = `|1|${salt.toString('base64')}|${hash}`;
      const lines = ['# Keep this comment', `alias-a,alias-b ${key.publicKey} shared aliases`, `${hashed} ${key.publicKey} selected`, `[server]:2222 ${other.publicKey} another key`, `@revoked server ${key.publicKey}`, ''];
      const original = lines.join(ending);
      await fs.writeFile(f.file, original, { mode: 0o640 });
      const before = await fs.stat(f.file);
      const selected = (await f.known.list())[1];
      assert.equal(selected.removable, true);
      const backup = await f.known.remove(selected);
      assert.equal(await fs.readFile(backup, 'utf8'), original);
      assert.equal(await fs.readFile(f.file, 'utf8'), lines.filter((_, index) => index !== 2).join(ending));
      const after = await fs.stat(f.file);
      assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode); assert.equal(after.uid, before.uid); assert.equal(after.gid, before.gid);
      const remaining = await f.known.list();
      assert.equal(remaining[0].removable, false); assert.equal(remaining.at(-1)!.removable, false);
      assert(remaining.some(item => item.publicKey === other.publicKey));
      const customPort = remaining.find(item => item.port === 2222)!;
      await f.known.remove(customPort);
      assert(!(await f.known.list()).some(item => item.port === 2222));
    } finally { await f.cleanup(); }
  }
});

test('OpenSSH deletion refuses system/marked/shared records, stale selections, locks, read-only files and file links', async t => {
  const f = await fixture(t);
  try {
    const original = [`server ${key.publicKey}`, `alias-a,alias-b ${key.publicKey}`, `@revoked server ${key.publicKey}`, `@cert-authority server ${key.publicKey}`, `*.example.com ${key.publicKey}`].join('\n');
    await fs.writeFile(f.file, original);
    const entries = await f.known.list();
    for (const entry of entries.slice(1)) await assert.rejects(f.known.remove(entry), /cannot be removed safely/);
    const system = new KnownHosts([{ filePath: f.file, source: 'OpenSSH (System)' }]);
    const entry = (await system.list())[0]; await assert.rejects(system.remove({ ...entry, removable: true }), /cannot be removed safely/);
    await fs.appendFile(f.file, '\n# External edit');
    await assert.rejects(f.known.remove(entries[0]), /changed/);
    assert.equal(await fs.readFile(f.file, 'utf8'), original + '\n# External edit');
    const current = (await f.known.list())[0];
    await fs.writeFile(f.file + '.remoteedit.lock', '');
    await assert.rejects(f.known.remove(current), /busy/); await fs.rm(f.file + '.remoteedit.lock');
    await fs.chmod(f.file, 0o400); await assert.rejects(f.known.remove(current), /writable regular file/); await fs.chmod(f.file, 0o600);
    const link = path.join(f.directory, 'linked'); await fs.link(f.file, link);
    await assert.rejects(f.known.remove(current), /without links/); await fs.rm(link);
    await fs.rename(f.file, link); await fs.symlink(link, f.file);
    await assert.rejects(f.known.remove(current), /without links/);
    assert.equal(await fs.readFile(link, 'utf8'), original + '\n# External edit');
  } finally { await f.cleanup(); }
});

test('OpenSSH deletion refuses failed backups/external edits and restores its own partial write on failure', async t => {
  const f = await fixture(t);
  const api = require('node:fs/promises') as typeof fs;
  const open = api.open;
  try {
    const original = `server ${key.publicKey}\nother ${other.publicKey}\n`;
    await fs.writeFile(f.file, original);
    const selected = (await f.known.list())[0];
    api.open = (async (name: any, flags: any, mode: any) => {
      if (String(name).includes('.remoteedit-backup-')) throw new Error('Backup unavailable');
      return open(name, flags, mode);
    }) as typeof open;
    await assert.rejects(f.known.remove(selected), /No key was modified/);
    api.open = open; assert.equal(await fs.readFile(f.file, 'utf8'), original);
    api.open = (async (name: any, flags: any, mode: any) => {
      const handle = await open(name, flags, mode);
      if (name === f.file && flags === 'r+') {
        const write = handle.write.bind(handle); let calls = 0;
        handle.write = (async (buffer: Buffer, offset: number, length: number, position: number) => {
          calls++;
          if (calls === 2) throw new Error('Interrupted write');
          return write(buffer, offset, calls === 1 ? Math.min(4, length) : length, position);
        }) as typeof handle.write;
      }
      return handle;
    }) as typeof open;
    await assert.rejects(f.known.remove(selected), /original file backup/);
    api.open = open; assert.equal(await fs.readFile(f.file, 'utf8'), original);
    api.open = (async (name: any, flags: any, mode: any) => {
      const handle = await open(name, flags, mode);
      if (String(name).includes('.remoteedit-backup-')) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); await fs.appendFile(f.file, '# Concurrent client edit\n'); };
      }
      return handle;
    }) as typeof open;
    await assert.rejects(f.known.remove(selected), /changed during modification/);
    api.open = open; assert.equal(await fs.readFile(f.file, 'utf8'), original + '# Concurrent client edit\n');
    assert(!(await fs.readdir(f.directory)).some(name => name.endsWith('.remoteedit.lock')));
  } finally { api.open = open; await f.cleanup(); }
});

test('deleting an OpenSSH user key requires fresh approval and retains vetoes from other trust sources', async t => {
  const f = await fixture(t);
  try {
    await fs.writeFile(f.file, `server ${key.publicKey}\n`);
    let prompts = 0;
    await f.service.verify('server', 22, raw, async () => { prompts++; return true; });
    assert.equal(prompts, 0);
    await f.known.remove((await f.known.list())[0]);
    await f.service.verify('server', 22, raw, async () => { prompts++; return true; });
    assert.equal(prompts, 1);
    await fs.writeFile(f.file, `server ${key.publicKey}\nserver ${other.publicKey}\n`);
    await f.known.remove((await f.known.list())[0]);
    await assert.rejects(f.service.verify('server', 22, raw, async () => { prompts++; return true; }), /conflicting/);
    assert.equal(prompts, 2);
  } finally { await f.cleanup(); }
});

test('Review & Replace cancels safely at either confirmation, then persists one internal replacement', async t => {
  const f = await fixture(t);
  try {
    await f.store.trust('host', 2222, key);
    const original = await fs.readFile(path.join(f.directory, 'trusted.json'));
    for (const cancelPhase of ['changed', 'replace-confirm']) {
      const phases: string[] = [];
      await assert.rejects(f.service.verify('host', 2222, changed, async request => {
        phases.push(request.phase!); assert.equal(request.previous?.[0].fingerprint, key.fingerprint);
        assert.equal(request.fingerprint, other.fingerprint); return request.phase !== cancelPhase;
      }), /cancelled or rejected/);
      assert.deepEqual(phases, cancelPhase === 'changed' ? ['changed'] : ['changed', 'replace-confirm']);
      assert.deepEqual(await fs.readFile(path.join(f.directory, 'trusted.json')), original);
    }
    const phases: string[] = [];
    await f.service.verify('host', 2222, changed, async request => { phases.push(request.phase!); return true; });
    assert.deepEqual(phases, ['changed', 'replace-confirm']);
    const saved = await f.store.list(); assert.equal(saved.length, 1); assert.equal(saved[0].publicKey, other.publicKey);
    await new HostKeyTrustService(new TrustedHostStore(path.join(f.directory, 'trusted.json')), f.known).verify('host', 2222, changed);
    await assert.rejects(f.service.verify('host', 2222, raw), /Changed or conflicting/);
    assert(f.log.some(line => /replacement cancelled/.test(line))); assert(f.log.some(line => /Replaced Remote Edit/.test(line)));
  } finally { await f.cleanup(); }
});

test('OpenSSH user replacement preserves hashed tokens, comments, CRLF, other entries, mode and backup', async t => {
  const f = await fixture(t);
  try {
    const salt = Buffer.alloc(20, 5), token = '[host]:2222';
    const hashed = `|1|${salt.toString('base64')}|${createHmac('sha1', salt).update(token).digest('base64')}`;
    const original = `# comment\r\n  ${hashed}\t${key.publicKey}  keep comment\r\nother ${key.publicKey}\r\n@revoked host ${key.publicKey}\r\n`;
    await fs.writeFile(f.file, original, { mode: 0o640 }); const mode = (await fs.stat(f.file)).mode;
    await f.service.verify('host', 2222, changed, async request => { assert.equal(request.previous?.[0].source, 'OpenSSH (User)'); return true; });
    assert.equal(await fs.readFile(f.file, 'utf8'), original.replace(`\t${key.publicKey}`, `\t${other.publicKey}`));
    assert.equal((await fs.stat(f.file)).mode, mode); assert.equal((await f.store.list()).length, 0);
    const backups = (await fs.readdir(f.directory)).filter(name => name.includes('.remoteedit-backup-'));
    assert.equal(backups.length, 1); assert.equal(await fs.readFile(path.join(f.directory, backups[0]), 'utf8'), original);
    await f.service.verify('host', 2222, changed);
  } finally { await f.cleanup(); }
});

test('OpenSSH cancellation does not write a key or create a backup; unwritable files show a blocked notice', async t => {
  const f = await fixture(t);
  try {
    const original = `host ${key.publicKey}\n`; await fs.writeFile(f.file, original);
    for (const phase of ['changed', 'replace-confirm']) {
      await assert.rejects(f.service.verify('host', 22, changed, async request => request.phase !== phase), /cancelled/);
      assert.equal(await fs.readFile(f.file, 'utf8'), original);
      assert(!(await fs.readdir(f.directory)).some(name => name.includes('backup')));
    }
    await fs.chmod(f.file, 0o400);
    const notices: string[] = [];
    await assert.rejects(f.service.verify('host', 22, changed, async request => {
      assert.equal(request.phase, 'blocked'); notices.push(request.title!); return true;
    }), /not writable/);
    assert.deepEqual(notices, ['SSH Host Key Cannot Be Replaced']); assert.equal(await fs.readFile(f.file, 'utf8'), original);
  } finally { await f.cleanup(); }
});

test('system, revoked, shared patterns and multiple sources explain blocks and never offer replacement', async t => {
  const f = await fixture(t);
  try {
    const systemFile = path.join(f.directory, 'system'); await fs.writeFile(systemFile, `host ${key.publicKey}\n`);
    const system = new HostKeyTrustService(f.store, new KnownHosts([{ filePath: systemFile, source: 'OpenSSH (System)' }]));
    const notice = (title: string) => async (request: import('../ssh/hostKeys/HostKeyTrustService').HostKeyRequest) => {
      assert.equal(request.phase, 'blocked'); assert.equal(request.title, title); assert(request.reason); return true;
    };
    await assert.rejects(system.verify('host', 22, changed, notice('SSH Host Key Changed')), /managed by the system/);
    assert.equal(await fs.readFile(systemFile, 'utf8'), `host ${key.publicKey}\n`);
    await fs.writeFile(f.file, `@revoked host ${other.publicKey}\n`);
    await assert.rejects(f.service.verify('host', 22, changed, notice('SSH Host Key Revoked')), /Revoked/);
    // A different revoked key stays revoked; it does not prohibit a new identity.
    await fs.writeFile(f.file, `@revoked host ${key.publicKey}\n`);
    await f.service.verify('host', 22, changed, async request => { assert.equal(request.phase, undefined); return true; });
    await f.store.remove((await f.store.list())[0].id);
    await fs.writeFile(f.file, `host,alias ${key.publicKey}\n`);
    await assert.rejects(f.service.verify('host', 22, changed, notice('SSH Host Key Cannot Be Replaced')), /protected/);
    await fs.writeFile(f.file, `host ${key.publicKey}\n`); await f.store.trust('host', 22, key);
    await assert.rejects(f.service.verify('host', 22, changed, notice('SSH Host Key Conflict')), /Multiple trusted records/);
    assert.equal((await f.store.list())[0].publicKey, key.publicKey); assert.equal(await fs.readFile(f.file, 'utf8'), `host ${key.publicKey}\n`);
  } finally { await f.cleanup(); }
});

test('replacement detects records and new source conflicts changed while either confirmation is open', async t => {
  const f = await fixture(t);
  try {
    await f.store.trust('host', 22, key);
    const phases: string[] = [];
    await assert.rejects(f.service.verify('host', 22, changed, async request => {
      phases.push(request.phase!);
      if (request.phase === 'replace-confirm') await fs.writeFile(f.file, `host ${key.publicKey}\n`);
      return true;
    }), /Multiple trusted records/);
    assert.deepEqual(phases, ['changed', 'replace-confirm', 'blocked']);
    assert.equal((await f.store.list())[0].publicKey, key.publicKey);
    await fs.rm(f.file);
    await assert.rejects(f.service.verify('host', 22, changed, async request => {
      if (request.phase === 'changed') { const old = (await f.store.list())[0]; await f.store.remove(old.id); await f.store.trust('host', 22, key); }
      return true;
    }), /changed during review/);
    assert.equal((await f.store.list())[0].publicKey, key.publicKey);
  } finally { await f.cleanup(); }
});

test('replacement coalesces simultaneous decisions and background requests never join an approval', async t => {
  const f = await fixture(t);
  try {
    await f.store.trust('host', 22, key);
    let ready!: () => void, accept!: (value: boolean) => void;
    const started = new Promise<void>(resolve => { ready = resolve; }); const phases: string[] = [];
    const prompt: import('../ssh/hostKeys/HostKeyTrustService').HostKeyPrompt = async request => {
      phases.push(request.phase!);
      if (request.phase === 'changed') { ready(); return new Promise(resolve => { accept = resolve; }); }
      return true;
    };
    const first = f.service.verify('host', 22, changed, prompt); await started;
    const second = f.service.verify('host', 22, changed, prompt);
    // A single setImmediate does not guarantee that the second verifier has
    // finished its asynchronous store checks under full file-level parallelism.
    // Wait until both callers are actually subscribed to the same decision.
    const pending = f.service as unknown as { pending: Map<string, { waiters: Set<symbol> }> };
    await waitFor(() => pending.pending.size === 1 && [...pending.pending.values()][0].waiters.size === 2,
      'both host-key verifications to share one pending approval');
    await assert.rejects(f.service.verify('host', 22, changed), /Connect interactively/);
    accept(true); await Promise.all([first, second]);
    assert.deepEqual(phases, ['changed', 'replace-confirm']); assert.equal((await f.store.list())[0].publicKey, other.publicKey);
  } finally { await f.cleanup(); }
});

test('OpenSSH replacement rolls back an interrupted write and rejects a stale file digest', async t => {
  const f = await fixture(t); const api = require('node:fs/promises') as typeof fs; const open = api.open;
  try {
    const original = `host ${key.publicKey}\n# retained\n`; await fs.writeFile(f.file, original);
    const entry = (await f.known.list())[0];
    api.open = (async (name: any, flags: any, mode: any) => {
      const handle = await open(name, flags, mode);
      if (name === f.file && flags === 'r+') {
        const write = handle.write.bind(handle); let calls = 0;
        handle.write = (async (buffer: Buffer, offset: number, length: number, position: number) => {
          if (++calls === 2) throw new Error('Interrupted replacement');
          return write(buffer, offset, calls === 1 ? 8 : length, position);
        }) as typeof handle.write;
      }
      return handle;
    }) as typeof open;
    await assert.rejects(f.known.replace(entry, other), /original file backup/); api.open = open;
    assert.equal(await fs.readFile(f.file, 'utf8'), original);
    await fs.appendFile(f.file, '# external edit\n');
    await assert.rejects(f.known.replace(entry, other), /file changed/);
    assert.equal(await fs.readFile(f.file, 'utf8'), original + '# external edit\n');
  } finally { api.open = open; await f.cleanup(); }
});

test('Native Sidebar uses two native confirmations before the real SSH handshake accepts a changed key', async t => {
  const runtime = await runtimeFixture(true, t), server = await sshServer(t);
  try {
    const wrong = utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }));
    if (wrong instanceof Error || Array.isArray(wrong)) throw new Error('Invalid key');
    await hostKeyTrust().store.trust('127.0.0.1', server.port, identifyHostKey(wrong.getPublicSSH()));
    const count = server.authRequests();
    await assert.rejects(guardedConnect(server.port), /Connect interactively/); assert.equal(server.authRequests(), count);
    await runtime.native(() => guardedConnect(server.port, false));
    assert.deepEqual(runtime.warnings, ['SSH Host Key Changed', 'Replace Trusted SSH Host Key?']);
    assert.equal((await hostKeyTrust().store.list())[0].publicKey, identifyHostKey(rsaRaw).publicKey);
    await runtime.native(() => guardedConnect(server.port, false)); assert.equal(runtime.warnings.length, 2);
  } finally { await server.close(); await runtime.cleanup(); }
});

test('Advanced View, Multi-Target and Workspace Sync interactive transports persist replacement before authenticating', async t => {
  const { SftpSessionManager } = loadWithTestSftpEvents(() => require('../ssh/SftpSessionManager')) as typeof import('../ssh/SftpSessionManager');
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  const advanced = new SftpSessionManager(), multi = new SftpSessionManager(); let sync: SftpSyncSessionType | undefined;
  try {
    const wrong = utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }));
    if (wrong instanceof Error || Array.isArray(wrong)) throw new Error('Invalid key');
    for (const origin of ['RE', 'MT', 'WS']) {
      for (const entry of await hostKeyTrust().store.list()) await hostKeyTrust().store.remove(entry.id);
      await hostKeyTrust().store.trust('127.0.0.1', server.port, identifyHostKey(wrong.getPublicSSH()));
      const before = server.authRequests(), phases: string[] = [];
      const ui = { prompt: async (request: import('../ssh/hostKeys/HostKeyTrustService').HostKeyRequest) => {
        assert.equal(server.authRequests(), before); phases.push(request.phase!); return true;
      }, confirmDisable: async () => false };
      await withHostKeyUi(ui, async () => {
        if (origin === 'WS') sync = await SftpSyncSession.connect(snapshot(server.port));
        else await (origin === 'RE' ? advanced : multi).connect({ ...snapshot(server.port), connectionId: origin, jumpChain: [] });
      });
      assert.deepEqual(phases, ['changed', 'replace-confirm']);
      assert.equal((await hostKeyTrust().store.list())[0].publicKey, identifyHostKey(rsaRaw).publicKey);
      assert.equal(runtime.warnings.length, 0);
      await advanced.disconnectAll(); await multi.disconnectAll(); await sync?.disconnect(); sync = undefined;
    }
  } finally { await advanced.disconnectAll(); await multi.disconnectAll(); await sync?.disconnect(); await server.close(); await runtime.cleanup(); }
});

test('cancelled replacement waiting for a store lock cannot persist after the connection is cancelled', async t => {
  const f = await fixture(t); const abort = new AbortController();
  try {
    await f.store.trust('host', 22, key);
    const lock = path.join(f.directory, 'trusted.json.lock'); await fs.writeFile(lock, 'other window');
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const replace = f.store.replace.bind(f.store);
    let mutation!: Promise<void>;
    f.store.replace = (...args) => { mutation = replace(...args); started(); return mutation; };
    const work = f.service.verify('host', 22, changed, async () => true, abort.signal);
    const rejection = assert.rejects(work, /cancelled/); await ready; abort.abort(); await rejection;
    await fs.rm(lock); await assert.rejects(mutation, /cancelled/);
    assert.equal((await f.store.list())[0].publicKey, key.publicKey);
  } finally { await f.cleanup(); }
});

test('a replacement removed concurrently before final validation cannot release the handshake', async t => {
  const f = await fixture(t);
  try {
    await f.store.trust('host', 22, key); const replace = f.store.replace.bind(f.store);
    f.store.replace = async (...args) => { await replace(...args); await f.store.remove((await f.store.list())[0].id); };
    const phases: string[] = [];
    await assert.rejects(f.service.verify('host', 22, changed, async request => { phases.push(request.phase!); return true; }), /removed during replacement/);
    assert.deepEqual(phases, ['changed', 'replace-confirm', 'blocked']);
  } finally { await f.cleanup(); }
});

const { SshHostKeyDialogController } = loadWithVscode(() => require('../webview/SshHostKeyDialogController')) as typeof import('../webview/SshHostKeyDialogController');

test('shared SSH dialog serializes prompts, preserves blocked content, and aborts pending requests', async () => {
  const messages: any[] = [];
  const dialog = new SshHostKeyDialogController(() => true, message => messages.push(message));
  const firstSignal = new AbortController(), secondSignal = new AbortController();
  const first = dialog.prompt({ ...key, host: 'lab', port: 22, phase: 'changed' }, firstSignal.signal);
  const second = dialog.prompt({ ...key, host: 'lab2', port: 22, phase: 'blocked', title: 'SSH Host Key Revoked' }, secondSignal.signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'showSshHostKeyDialog');
  assert.equal(messages[0].payload.title, 'SSH Host Key Changed');
  await dialog.handle({ type: 'sshHostKeyDialogResponse', payload: { requestId: 'stale', confirmed: true } });
  firstSignal.abort();
  assert.equal(await first, false);
  await new Promise(resolve => setImmediate(resolve));
  const blocked = messages.find(message => message.payload.title === 'SSH Host Key Revoked');
  assert.equal(blocked.payload.hideCancel, true);
  assert.equal(blocked.payload.confirmLabel, 'Close');
  dialog.cancelPending();
  assert.equal(await second, false);
});

test('closing shared SSH dialogs cancels queued requests without opening them in a reopened view', async () => {
  const messages: any[] = [];
  const dialog = new SshHostKeyDialogController(() => true, message => messages.push(message));
  const request = { ...key, host: 'lab', port: 22 };
  const first = dialog.prompt(request, new AbortController().signal);
  const queued = dialog.prompt(request, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  dialog.cancelPending();
  assert.equal(await first, false);
  assert.equal(await queued, false);
  assert.equal(messages.filter(message => message.type === 'showSshHostKeyDialog').length, 1);
  const reopened = dialog.prompt(request, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  const latest = messages.at(-1);
  await dialog.handle({ type: 'sshHostKeyDialogResponse', payload: { requestId: latest.payload.requestId, confirmed: true } });
  assert.equal(await reopened, true);
});

test('aborting a queued SSH prompt releases its connection without dismissing the active dialog', async () => {
  const messages: any[] = [];
  const dialog = new SshHostKeyDialogController(() => true, message => messages.push(message));
  const first = dialog.prompt({ ...key, host: 'lab', port: 22 }, new AbortController().signal);
  const queuedSignal = new AbortController();
  const queued = dialog.prompt({ ...key, host: 'lab2', port: 22 }, queuedSignal.signal);
  await new Promise(resolve => setImmediate(resolve));
  queuedSignal.abort();
  assert.equal(await queued, false);
  assert.equal(messages.length, 1);
  dialog.cancelPending();
  assert.equal(await first, false);
});

test('human approval has a fixed ten minute deadline and late TOFU replies cannot create trust', async t => {
  const f = await fixture(t);
  let accept!: (value: boolean) => void, shown!: () => void;
  const visible = new Promise<void>(resolve => { shown = resolve; });
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const work = f.service.verify('deadline', 22, raw, async () => { shown(); return new Promise<boolean>(resolve => { accept = resolve; }); });
    const rejected = assert.rejects(work, /expired after 10 minutes/);
    await visible;
    t.mock.timers.tick(5 * 60 * 1000);
    assert.equal((await f.store.list()).length, 0);
    t.mock.timers.tick(5 * 60 * 1000);
    await rejected;
    accept(true); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.store.list()).length, 0);
  } finally { t.mock.timers.reset(); await f.cleanup(); }
});

test('Review & Replace shares one deadline across both confirmations', async t => {
  const f = await fixture(t);
  let first!: (value: boolean) => void, secondShown!: () => void;
  const second = new Promise<void>(resolve => { secondShown = resolve; });
  let firstShown!: () => void;
  const visible = new Promise<void>(resolve => { firstShown = resolve; });
  try {
    await f.store.trust('deadline', 22, key);
    const before = await fs.readFile(path.join(f.directory, 'trusted.json'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const work = f.service.verify('deadline', 22, changed, async request => {
      if (request.phase === 'changed') { firstShown(); return new Promise<boolean>(resolve => { first = resolve; }); }
      secondShown(); return new Promise<boolean>(() => {});
    });
    const rejected = assert.rejects(work, /expired after 10 minutes/);
    await visible; t.mock.timers.tick(6 * 60 * 1000); first(true); await second;
    t.mock.timers.tick(4 * 60 * 1000); await rejected;
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'trusted.json')), before);
  } finally { t.mock.timers.reset(); await f.cleanup(); }
});

test('queued approval starts its deadline only when actually presented', async t => {
  const f = await fixture(t);
  let present!: () => void, queued!: () => void;
  const waiting = new Promise<void>(resolve => { queued = resolve; });
  const prompt: import('../ssh/hostKeys/HostKeyTrustService').HostKeyPrompt = Object.assign(async (request: import('../ssh/hostKeys/HostKeyTrustService').HostKeyRequest) => {
    present = request.onPresented!; queued(); return new Promise<boolean>(() => {});
  }, { managesPresentation: true });
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let settled = false;
    const work = f.service.verify('queued', 22, raw, prompt).finally(() => { settled = true; });
    const rejected = assert.rejects(work, /expired after 10 minutes/);
    await waiting; t.mock.timers.tick(20 * 60 * 1000);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    present(); t.mock.timers.tick(10 * 60 * 1000); await rejected;
    assert.equal((await f.store.list()).length, 0);
  } finally { t.mock.timers.reset(); await f.cleanup(); }
});

test('probe and deferred review cannot persist until the resumed handshake commits', async t => {
  const f = await fixture(t);
  try {
    let prompts = 0;
    const prompt = async () => { prompts++; return true; };
    const { HostKeyApprovalRequired } = await import('../ssh/hostKeys/HostKeyTrustService');
    let challenge!: import('../ssh/hostKeys/HostKeyTrustService').HostKeyApprovalRequired;
    try { await f.service.evaluate('staged', 22, raw, prompt, undefined, undefined, 'probe'); }
    catch (error) { assert(error instanceof HostKeyApprovalRequired); challenge = error; }
    assert.equal(prompts, 0); assert.equal((await f.store.list()).length, 0);
    const commit = await challenge.approve(new AbortController().signal);
    assert.equal(prompts, 1); assert.equal((await f.store.list()).length, 0);
    await commit(); assert.equal((await f.store.list())[0].publicKey, key.publicKey);
    const replace = await f.service.evaluate('staged', 22, changed, prompt, undefined, undefined, 'defer');
    assert.equal((await f.store.list())[0].publicKey, key.publicKey);
    await fs.writeFile(f.file, `@revoked staged ${other.publicKey}\n`);
    await assert.rejects(replace!(), /Revoked/);
    assert.equal((await f.store.list())[0].publicKey, key.publicKey);
  } finally { await f.cleanup(); }
});

test('all interactive transports close the probe before review and authenticate only after a fresh handshake', async t => {
  const { SftpSessionManager } = loadWithTestSftpEvents(() => require('../ssh/SftpSessionManager')) as typeof import('../ssh/SftpSessionManager');
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  const manager = new SftpSessionManager(); let sync: SftpSyncSessionType | undefined;
  try {
    for (const origin of ['RE', 'MT', 'WS', 'raw SSH']) {
      for (const item of await hostKeyTrust().store.list()) await hostKeyTrust().store.remove(item.id);
      const count = server.authRequests();
      await withHostKeyUi({ prompt: async () => {
        // Let the server observe the closed TCP socket before examining resource counts.
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(server.openClients(), 0); assert.equal(server.authRequests(), count);
        assert.equal((await hostKeyTrust().store.list()).length, 0);
        return true;
      }, confirmDisable: async () => false }, async () => {
        if (origin === 'WS') sync = await SftpSyncSession.connect(snapshot(server.port));
        else if (origin === 'raw SSH') await guardedConnect(server.port, false);
        else await manager.connect({ ...snapshot(server.port), connectionId: origin, jumpChain: [] });
      });
      assert(server.authRequests() > count);
      await manager.disconnectAll(); await sync?.disconnect(); sync = undefined;
    }
  } finally { await manager.disconnectAll(); await sync?.disconnect(); await server.close(); await runtime.cleanup(); }
});

test('a server key changed again during approval is blocked without saving the approved key', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  let presentations = 0, attempts = 0;
  try {
    await assert.rejects(withHostKeyUi({ prompt: async request => { presentations++; return request.phase !== 'blocked'; }, confirmDisable: async () => false }, () => withHostKeyApproval(async () => {
      const client = new Client();
      const config: ConnectConfig = { host: '127.0.0.1', port: server.port, username: 'test', password: 'test-password', readyTimeout: 3000 };
      const failure = installHostKeyVerification(config, client, '127.0.0.1', server.port);
      attempts++;
      if (attempts === 2) {
        // Simulate the second handshake presenting a different full public key.
        const verifier = config.hostVerifier as (bytes: Buffer, callback: (accepted: boolean) => void) => void;
        await new Promise<void>(resolve => verifier(changed, accepted => { assert.equal(accepted, false); resolve(); }));
        client.destroy(); throw failure();
      }
      try { await new Promise<void>((resolve, reject) => { client.once('ready', resolve); client.once('error', reject); client.connect(config); }); }
      catch (error) { throw failure() || error; }
      finally { client.destroy(); }
    })), /identity changed after approval/);
    assert.equal(attempts, 2); assert.equal(presentations, 2);
    assert.equal(server.authRequests(), 0); assert.equal((await hostKeyTrust().store.list()).length, 0);
  } finally { await server.close(); await runtime.cleanup(); }
});

test('disconnect during detached approval releases the manager and cannot store a late reply', async t => {
  const { SftpSessionManager } = loadWithTestSftpEvents(() => require('../ssh/SftpSessionManager')) as typeof import('../ssh/SftpSessionManager');
  const runtime = await runtimeFixture(false, t), server = await sshServer(t), manager = new SftpSessionManager();
  let shown!: () => void, accept!: (value: boolean) => void;
  const visible = new Promise<void>(resolve => { shown = resolve; });
  try {
    const work = withHostKeyUi({ prompt: async () => { shown(); return new Promise<boolean>(resolve => { accept = resolve; }); }, confirmDisable: async () => false }, () => manager.connect({ ...snapshot(server.port), connectionId: 'cancel-wait', jumpChain: [] }));
    const rejected = assert.rejects(work, /cancelled/); await visible;
    await manager.disconnect('cancel-wait'); await rejected; accept(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await hostKeyTrust().store.list()).length, 0); assert.equal(manager.getConnection('cancel-wait'), undefined);
  } finally { await manager.disconnectAll(); await server.close(); await runtime.cleanup(); }
});

test('a native response slower than the SSH handshake timeout reconnects with no open probe', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  runtime.setNativeHandler(async (_message, action) => {
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(server.openClients(), 0); assert.equal(server.authRequests(), 0);
    return action;
  });
  try {
    await runtime.native(() => guardedConnect(server.port, false, 1000));
    assert(server.authRequests() > 0);
  } finally { await server.close(); await runtime.cleanup(); }
});

test('expired shared Webview approval closes its modal and ignores a late response', async t => {
  const { SftpSessionManager } = loadWithTestSftpEvents(() => require('../ssh/SftpSessionManager')) as typeof import('../ssh/SftpSessionManager');
  const runtime = await runtimeFixture(false, t), server = await sshServer(t), manager = new SftpSessionManager();
  const messages: any[] = [];
  const dialog = new SshHostKeyDialogController(() => true, message => messages.push(message));
  const original = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => original(callback, delay === 600000 ? 30 : delay, ...args));
  const prompt = Object.assign((request: import('../ssh/hostKeys/HostKeyTrustService').HostKeyRequest, signal: AbortSignal) => dialog.prompt(request, signal), { managesPresentation: true });
  try {
    await assert.rejects(withHostKeyUi({ prompt, confirmDisable: async () => false }, () => manager.connect({ ...snapshot(server.port), connectionId: 'expire', jumpChain: [] })), /expired after 10 minutes/);
    const shown = messages.find(message => message.type === 'showSshHostKeyDialog');
    assert(shown); assert(messages.some(message => message.type === 'closeSshHostKeyDialog' && message.payload.requestId === shown.payload.requestId));
    await dialog.handle({ type: 'sshHostKeyDialogResponse', payload: { requestId: shown.payload.requestId, confirmed: true } });
    assert.equal((await hostKeyTrust().store.list()).length, 0); assert.equal(server.authRequests(), 0);
  } finally { t.mock.restoreAll(); dialog.cancelPending(); await manager.disconnectAll(); await server.close(); await runtime.cleanup(); }
});

test('native Sidebar expires the operation, ignores its stale dialog reply, and allows a new verification', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  let accept!: (value: string) => void;
  const original = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => original(callback, delay === 600000 ? 30 : delay, ...args));
  runtime.setNativeHandler(async () => new Promise<string>(resolve => { accept = resolve; }));
  try {
    await runtime.native(() => assert.rejects(guardedConnect(server.port, false), /expired after 10 minutes/));
    assert.equal(runtime.warnings.length, 1); assert.equal(server.authRequests(), 0);
    accept('Trust & Connect'); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await hostKeyTrust().store.list()).length, 0);
    runtime.setNativeHandler(undefined);
    await runtime.native(() => guardedConnect(server.port, false));
    assert.equal(runtime.warnings.length, 2); assert(server.authRequests() > 0);
  } finally { t.mock.restoreAll(); await server.close(); await runtime.cleanup(); }
});

test('configured SSH timeout above ten minutes is preserved in Sync target and jump handshakes', async t => {
  const runtime = await runtimeFixture(false, t), jump = await sshServer(t), target = await sshServer(t);
  let sync: SftpSyncSessionType | undefined;
  runtime.settings.sshReadyTimeout = 900000;
  const configs: ConnectConfig[] = [], original = Client.prototype.connect;
  t.mock.method(Client.prototype, 'connect', function(this: Client, config: ConnectConfig) {
    configs.push(config); return original.call(this, config);
  });
  try {
    assert.equal(sshConnectionTimeout(), 900000);
    sync = await withHostKeyUi({ prompt: async () => true, confirmDisable: async () => false }, () => SftpSyncSession.connect({ ...snapshot(target.port), jumpChain: [{ ...snapshot(jump.port), name: 'Jump' }] }));
    assert(configs.length >= 4);
    assert(configs.every(config => config.readyTimeout === 900000));
  } finally { t.mock.restoreAll(); await sync?.disconnect(); await target.close(); await jump.close(); await runtime.cleanup(); }
});

test('turning off the server during approval cannot persist trust or silently reconnect', async t => {
  const runtime = await runtimeFixture(false, t), server = await sshServer(t);
  let closed = false;
  try {
    await assert.rejects(withHostKeyUi({ prompt: async () => { await server.close(); closed = true; return true; }, confirmDisable: async () => false }, () => guardedConnect(server.port, false)), /ECONNREFUSED|refused/);
    assert.equal((await hostKeyTrust().store.list()).length, 0);
  } finally { if (!closed) await server.close(); await runtime.cleanup(); }
});

test('an unresponsive SSH server still fails at the network handshake timeout', async t => {
  const runtime = await runtimeFixture(false, t);
  const sockets = new Set<net.Socket>();
  const silent = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const listener = await listenLoopback(silent, t);
  try {
    const port = (silent.address() as net.AddressInfo).port;
    await assert.rejects(guardedConnect(port, false, 100), /timed out|timeout/i);
    assert.equal(runtime.warnings.length, 0); assert.equal((await hostKeyTrust().store.list()).length, 0);
  } finally { for (const socket of sockets) socket.destroy(); await listener.close(); await runtime.cleanup(); }
});
