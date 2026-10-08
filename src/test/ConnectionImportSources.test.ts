import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseOpenSsh } from '../connectionImport/sources/OpenSshImportSource';
import { parseFileZilla } from '../connectionImport/sources/FileZillaImportSource';
import { parseWinScp } from '../connectionImport/sources/WinScpImportSource';
import { parsePutty } from '../connectionImport/sources/PuttyImportSource';
import { findPuttyUnixSessions } from '../connectionImport/ConnectionImportDetection';
import { parseSshFs } from '../connectionImport/sources/SshFsImportSource';
import { parseVsCodeSftp } from '../connectionImport/sources/VsCodeSftpImportSource';
import { validateCandidates } from '../connectionImport/ConnectionImportValidation';
const parsers = [
  parseOpenSsh,
  parseFileZilla,
  parseWinScp,
  parsePutty,
  parseSshFs,
  parseVsCodeSftp
];
const names = [
  'openssh',
  'filezilla',
  'winscp',
  'putty',
  'sshfs',
  'sftp'
];
// Minimal synthetic inputs for each supported external format.
const sourceSamples: Record<string, string> = {
  "filezilla": "<FileZilla3><Servers><Server><Name>Example</Name><Host>example.test</Host><Port>22</Port><User>demo</User><Protocol>1</Protocol></Server></Servers></FileZilla3>",
  "openssh": "Host Example\n HostName example.test\n User demo\n",
  "putty": "Windows Registry Editor Version 5.00\n[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Example]\n\"HostName\"=\"example.test\"\n\"UserName\"=\"demo\"\n\"Protocol\"=\"ssh\"\n\"PortNumber\"=dword:00000016\n",
  "sftp": "{\"name\":\"Example\",\"host\":\"example.test\",\"username\":\"demo\"}",
  "sshfs": "{\"sshfs.configs\":[{\"name\":\"Example\",\"host\":\"example.test\",\"username\":\"demo\"}]}",
  "winscp": "[Sessions/Example]\nHostName=example.test\nUserName=demo\nFSProtocol=0\n"
};
const fixture = (name: string): string => sourceSamples[name];

test('all six sources import independent minimal fixtures and reject malformed configurations', async () => {
  for (let i = 0; i < parsers.length; i++) {
    const result = await validateCandidates(
      await parsers[i](await fixture(names[i]), '/tmp/config')
    );
    assert.equal(result.length, 1, names[i]);
    assert.equal(result[0].profile.host, 'example.test', names[i]);
    assert.equal(result[0].unsupported, undefined, names[i]);
    let invalid;
    try {
      invalid = await parsers[i]('<broken> [[ malformed', '/tmp/config');
    } catch {
      invalid = [];
    }
    assert.equal(invalid.length, 0, names[i]);
  }
});
test('PuTTY importer accepts PuTTY registry sessions only', () => {
  const valid = sourceSamples.putty;
  assert.equal(parsePutty(valid, '/tmp/sessions.reg').length, 1);
  assert.throws(() => parsePutty(valid.replace('SimonTatham\\PuTTY', 'OtherVendor\\SSH'), '/tmp/sessions.reg'));
});
test('PuTTY Unix saved sessions map fields and decode encoded session names', async () => {
  const input = 'Present=1\nHostName=unix.example.test\nPortNumber=2202\nProtocol=ssh\nUserName=deploy\nPublicKeyFile=/tmp/id_ed25519\n';
  const [session] = parsePutty(input, '/home/test/.putty/sessions/Prod%20SSH');
  assert.equal(session.profile.name, 'Prod SSH');
  assert.equal(session.profile.host, 'unix.example.test');
  assert.equal(session.profile.port, '2202');
  assert.equal(session.profile.username, 'deploy');
  assert.equal(session.profile.authType, 'privateKey');
  assert.equal(session.profile.privateKeyPath, '/tmp/id_ed25519');
  assert.equal(session.source, 'putty');
  const [nonSsh] = parsePutty(input.replace('Protocol=ssh', 'Protocol=telnet'), '/tmp/Telnet');
  assert.match(nonSsh.unsupported || '', /Only SSH/);
  const [puttyKey] = await validateCandidates(parsePutty(
    input.replace('id_ed25519', 'legacy.ppk'), '/tmp/WithPPK'
  ));
  assert.match(puttyKey.unsupported || '', /Convert the PuTTY private key/);
  assert.throws(() => parsePutty('key=value\n', '/tmp/not-a-session'));
  assert.throws(() => parsePutty(input, '/tmp/Default%20Settings'));
});

test('PuTTY Unix discovery finds regular session files, not directories or symlinks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-putty-'));
  try {
    const sessions = path.join(dir, 'sessions');
    await fs.mkdir(sessions);
    await fs.writeFile(path.join(sessions, 'Prod%20SSH'), 'HostName=example.test\nProtocol=ssh\n');
    await fs.writeFile(path.join(sessions, 'Default%20Settings'), 'Present=1\n');
    await fs.mkdir(path.join(sessions, 'nested'));
    if (process.platform !== 'win32')
      await fs.symlink(path.join(sessions, 'Prod%20SSH'), path.join(sessions, 'link'));
    const paths = await findPuttyUnixSessions(sessions);
    assert.deepEqual(paths, [path.join(sessions, 'Prod%20SSH')]);
    assert.deepEqual(await findPuttyUnixSessions(path.join(dir, 'missing')), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('OpenSSH preserves first-value rules, exclusions, aliases and jump chains', async () => {
  const text =
    'Host target\n HostName internal.test\n User deploy\n ProxyJump user@gateway:2222,bastion\nHost gateway\n HostName gateway.test\nHost bastion\n HostName bastion.test\nHost * !bastion\n Port 2022\n User fallback';
  const c = await parseOpenSsh(text, '/tmp/config');
  assert.equal(c[0].profile.username, 'deploy');
  assert.equal(c[0].profile.port, '2022');
  assert.equal(c[2].profile.port, 22);
  assert.equal(c[3].profile.host, 'gateway.test');
  assert.equal(c[3].profile.port, '2222');
  assert.equal(c[4].jumpAlias, c[3].alias);
  assert.equal(c[0].jumpAlias, c[4].alias);
  const cyclic = await parseOpenSsh(
    'Host a\n ProxyJump b\nHost b\n ProxyJump a',
    '/tmp/config'
  );
  assert.ok(cyclic.every((c) => c.unsupported));
});
test('OpenSSH expands Include and rejects recursion, while conditional Match stays visible without invalidating unrelated hosts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-import-'));
  try {
    const included = path.join(dir, 'part');
    await fs.writeFile(included, 'Host included\n HostName included.test');
    const c = await parseOpenSsh(
      `Include "${included}"`,
      path.join(dir, 'config')
    );
    assert.equal(c[0].profile.host, 'included.test');
    await fs.writeFile(included, `Include "${included}"`);
    await assert.rejects(() =>
      parseOpenSsh(`Include "${included}"`, path.join(dir, 'config'))
    );
    const conditional = await parseOpenSsh(
      'Host example\n HostName example.test\nHost other\n HostName other.test\nMatch host other\n User special',
      '/tmp/config'
    );
    assert.equal(conditional[0].unsupported, undefined);
    assert.equal(conditional[0].warnings.length, 0);
    assert.ok(conditional[1].warnings.some((w) => w.includes('Match')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('FileZilla imports groups, explicit TLS and encoded credentials without accepting unsafe XML', () => {
  const c = parseFileZilla(
    '<FileZilla3><Servers><Folder>Production<Server><Name>Web</Name><Host>example.test</Host><Protocol>4</Protocol><Pass encoding="base64">c2VjcmV0</Pass><RemoteDir>1 0 3 var 3 www</RemoteDir></Server></Folder></Servers></FileZilla3>',
    '/tmp/fz'
  )[0];
  assert.equal(c.group, 'Production');
  assert.equal(c.profile.password, 'secret');
  assert.equal(c.profile.connectionType, 'ftps');
  assert.equal(c.profile.startPath, '/var/www');
  assert.throws(() =>
    parseFileZilla(
      '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///tmp/secret">]><FileZilla3>&e;</FileZilla3>',
      '/tmp/fz'
    )
  );
});
test('JSONC SFTP profiles inherit fields and SSH FS settings resolve label, group, extend and hop', async () => {
  const c = parseVsCodeSftp(
    '{ // comment\n "host":"example.test","username":"base","profiles":{"stage":{"port":2222},"prod":{"host":"prod.test"}},}',
    '/tmp/sftp'
  );
  assert.equal(c.length, 2);
  assert.equal(c[0].profile.username, 'base');
  assert.equal(c[0].profile.port, 2222);
  assert.equal(c[1].profile.host, 'prod.test');
  await assert.rejects(() =>
    parseSshFs('{"host":"wrong-schema.test"}', '/tmp/settings')
  );
  const sshfs = await parseSshFs(
    '{"sshfs.configs":[{"name":"base","host":"base.test","username":"demo"},{"name":"jump","host":"jump.test","username":"jump"},{"name":"child","label":"Child Label","group":"Production","extend":"base","host":"child.test","hop":"jump"}]}',
    '/tmp/settings'
  );
  const child = sshfs.find((item) => item.alias === 'child')!;
  assert.equal(child.profile.name, 'Child Label');
  assert.equal(child.profile.username, 'demo');
  assert.equal(child.group, 'Production');
  assert.equal(child.jumpAlias, 'jump');
  assert.equal(child.unsupported, undefined);
});

test('SSH FS reads configs referenced through sshfs.configpaths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-sshfs-'));
  try {
    const extra = path.join(dir, 'extra.json');
    await fs.writeFile(extra, JSON.stringify([{ name: 'external', host: 'external.test', username: 'demo' }]));
    const parsed = await parseSshFs(JSON.stringify({ 'sshfs.configpaths': ['./extra.json'], 'sshfs.configs': [] }), path.join(dir, 'settings.json'));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].profile.host, 'external.test');
    assert.equal(parsed[0].sourcePath, extra);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unsupported protocols, unresolved values, missing keys and invalid ports stay visible but cannot be silently normalized', async () => {
  const c = parseVsCodeSftp(
    '[{"host":"example.test","protocol":"webdav"},{"host":"example.test","port":0},{"host":"${host}"},{"host":"example.test","privateKeyPath":"missing-key"}]',
    '/tmp/config'
  );
  await validateCandidates(c);
  assert.ok(c.slice(0, 3).every((c) => c.unsupported));
  assert.ok(c[3].warnings.some((w) => w.includes('not found')));
});
