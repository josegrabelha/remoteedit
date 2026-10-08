import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConnectionImportService } from '../connectionImport/ConnectionImportService';
import { renderConnectionImport } from '../panel/webview/scripts/ConnectionImport';
import { renderConnectionImportMarkup } from '../panel/webview/markup/ConnectionImportMarkup';

// Synthetic, non-production credential vectors kept in the tests that use them.
const FILEZILLA_LEGACY = {
  value: "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHwgISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+PzpQPQsu/s3wFbV1jxXmH5c=",
  publicKey: "Zqgg1TUDKuQxfzRmWRNuxsDN5K89Fef3Z5+dbA6K91AAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw=="
};
const FILEZILLA_AUTHENTICATED = {
  value: "A+OjuhLFwzYjfrtuROpdH/XHvn0o4L+xIrwdu3QyChxVvkKANLDv7Fc8ZGl8lPIp/X4yep62IVwACkBMbDDoM0j55T0iax53TPtdASye/KZVUH1wwpEvoXca2MsDKoqhh544F+ObxSEv6Yyw",
  publicKey: "AgbOwFvRFWittJfiFDzkBG+CHGOhy2Qf2NattSVJ83XgP7myxAhSzgN4/sWG8psIaTcQZ1tZC2Tucm1aZVzgxg=="
};
const WINSCP_PROTECTED = "A35D000102030405060708090A0B0C0D0E0F0D7A0FF9B0D3085C71DE131C81C1F7EBD0128FD591799A1B7FCE639DEE82B042153C975F1BF16AB34748E84E";

async function harness(
  run: (
    service: ConnectionImportService,
    profiles: any[],
    saved: any[],
    file: string
  ) => Promise<void>
): Promise<void> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'remoteedit-import-flow-')
  );
  const profiles: any[] = [],
    saved: any[] = [];
  const manager: any = {
    listProfiles: async () => profiles,
    listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'g', name }),
    saveProfile: async (input: any) => {
      saved.push(input);
      const profile = { ...input, id: input.id || String(profiles.length + 1) };
      profiles.push(profile);
      return profile;
    }
  };
  const service = new ConnectionImportService(manager);
  try {
    await service.detect([]);
    const file = path.join(dir, 'sftp.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        name: 'Example',
        host: 'example.test',
        username: 'demo',
        password: 'never-show-this'
      })
    );
    await service.load('sftp', [file]);
    await run(service, profiles, saved, file);
  } finally {
    service.clear();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test('PuTTY Unix sessions can be loaded manually and reviewed together', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-putty-flow-'));
  const manager: any = {
    listProfiles: async () => [],
    listGroups: async () => [],
    createGroup: async (name: string) => ({ id: name, name }),
    saveProfile: async (input: any) => ({ ...input, id: 'saved' })
  };
  const service = new ConnectionImportService(manager);
  try {
    await service.detect([]);
    const files = ['First%20Server', 'Second'].map((name) => path.join(dir, name));
    await fs.writeFile(files[0], 'HostName=first.example.test\nPortNumber=2222\nUserName=deploy\nProtocol=ssh\n');
    await fs.writeFile(files[1], 'HostName=second.example.test\nPresent=1\nProtocol=ssh\n');
    const sources = await service.load('putty', files);
    assert.equal(sources.find((source) => source.id === 'putty')?.count, 2);
    const preview = await service.preview(['putty']);
    assert.deepEqual(preview.map((c) => c.profile.name), ['First Server', 'Second']);
    assert.deepEqual(preview.map((c) => c.status), ['Warning', 'Warning']);
  } finally {
    service.clear();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('preview is secret-free; import uses current APIs and rejects replay', async () =>
  harness(async (s, profiles, saved) => {
    const preview = await s.preview(['sftp']);
    assert.ok(!JSON.stringify(preview).includes('never-show-this'));
    assert.equal(saved.length, 0);
    const result = await s.apply([{ id: preview[0].id, action: 'new' }]);
    assert.equal(result.imported, 1);
    assert.equal(saved[0].password, 'never-show-this');
    await assert.rejects(() => s.apply([{ id: preview[0].id, action: 'new' }]));
  }));
test('conflicts offer explicit target comparison and changed replacements are rejected before writing', async () =>
  harness(async (s, profiles, saved) => {
    profiles.push({
      id: 'existing',
      name: 'Example',
      host: 'old.test',
      connectionType: 'sftp',
      port: 22,
      username: 'demo'
    });
    const p = await s.preview(['sftp']);
    assert.equal(p[0].status, 'Conflict');
    assert.equal(p[0].conflicts[0].profile.host, 'old.test');
    profiles[0].host = 'changed.test';
    await assert.rejects(() =>
      s.apply([{ id: p[0].id, action: 'replace', existingId: 'existing' }])
    );
    assert.equal(saved.length, 0);
  }));
test('Import as New creates a unique name; Skip has no side effects', async () =>
  harness(async (s, profiles, saved) => {
    profiles.push({
      id: 'existing',
      name: 'Example',
      host: 'example.test',
      connectionType: 'sftp',
      port: 22,
      username: 'demo'
    });
    const p = await s.preview(['sftp']);
    const result = await s.apply([{ id: p[0].id, action: 'new' }]);
    assert.equal(result.imported, 1);
    assert.equal(saved[0].name, 'Example (2)');
  }));
test('tampered decisions and duplicate replacements never reach saveProfile', async () =>
  harness(async (s, profiles, saved) => {
    const p = await s.preview(['sftp']);
    await assert.rejects(() =>
      s.apply([{ id: p[0].id, action: 'replace', existingId: 'arbitrary' }])
    );
    await assert.rejects(() =>
      s.apply([
        { id: p[0].id, action: 'new' },
        { id: p[0].id, action: 'new' }
      ])
    );
    await assert.rejects(() => s.apply([{ id: 'unreviewed', action: 'new' }]));
    assert.equal(saved.length, 0);
  }));
test('malformed file errors do not leak source credential values', async () =>
  harness(async (s, profiles, saved, file) => {
    await fs.writeFile(file, '{"password":"never-show-this", broken');
    const sources = await s.load('sftp', [file]);
    assert.ok(sources.find((x) => x.id === 'sftp')?.error);
    assert.ok(!JSON.stringify(sources).includes('never-show-this'));
    assert.equal((await s.preview(['sftp'])).length, 0);
  }));

test('unlocking protected credentials applies once per reviewed source file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-import-unlock-'));
  const profiles: any[] = [];
  const manager: any = {
    listProfiles: async () => profiles,
    listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'g', name }),
    saveProfile: async (input: any) => ({ ...input, id: input.id || 'saved' })
  };
  const service = new ConnectionImportService(manager);
  try {
    await service.detect([]);
    const protectedValue = WINSCP_PROTECTED;
    const file = path.join(dir, 'winscp.ini');
    await fs.writeFile(file, `[Sessions/One]\nHostName=one.test\nUserName=demo\nPassword=${protectedValue}\n\n[Sessions/Two]\nHostName=two.test\nUserName=demo\nPassword=${protectedValue}\n`);
    await service.load('winscp', [file]);
    const preview = await service.preview(['winscp']);
    assert.equal(preview.length, 2);
    assert.ok(preview.every((item) => item.canUnlock));
    const unlocked = service.unlock(preview[0].id, 'fixture-master');
    assert.equal(unlocked.length, 2);
    const refreshed = await service.preview(['winscp']);
    assert.ok(refreshed.every((item) => item.credentials === 'Password available'));
    assert.ok(refreshed.every((item) => !item.canUnlock));
  } finally {
    service.clear();
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('FileZilla unlock groups by public key, not connection or source file, and preserves other keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-fz-key-group-'));
  const manager: any = {
    listProfiles: async () => [],
    listGroups: async () => [],
    createGroup: async (name: string) => ({ id: name, name }),
    saveProfile: async (input: any) => ({ ...input, id: 'saved' })
  };
  const service = new ConnectionImportService(manager);
  const first = FILEZILLA_LEGACY;
  const second = FILEZILLA_AUTHENTICATED;
  const site = (name: string, host: string, vector: any) =>
    `<Server><Name>${name}</Name><Host>${host}</Host><Protocol>1</Protocol><Pass encoding="crypt" pubkey="${vector.publicKey}">${vector.value}</Pass></Server>`;
  try {
    await service.detect([]);
    const pathOne = path.join(dir, 'one.xml');
    const pathTwo = path.join(dir, 'two.xml');
    await fs.writeFile(pathOne, '<FileZilla3><Servers>' +
      site('Legacy One', 'one.example.test', first) +
      site('Modern Other Key', 'different-key.example.test', second) +
      '</Servers></FileZilla3>');
    await fs.writeFile(pathTwo, '<FileZilla3><Servers>' +
      site('Legacy Two', 'two.example.test', first) +
      '</Servers></FileZilla3>');
    await service.load('filezilla', [pathOne, pathTwo]);
    let preview = await service.preview(['filezilla']);
    assert.equal(preview.length, 3);
    assert.ok(preview.every((c) => c.canUnlock));
    const unlocked = service.unlock(preview.find((c) => c.profile.name === 'Legacy One')!.id, 'fixture-master');
    assert.equal(unlocked.length, 2);
    preview = await service.preview(['filezilla']);
    assert.equal(preview.filter((c) => c.canUnlock).length, 1);
    assert.equal(preview.find((c) => c.profile.name === 'Modern Other Key')!.canUnlock, true);
    assert.equal(preview.filter((c) => c.credentials === 'Password available').length, 2);
    assert.equal(service.unlock(preview.find((c) => c.profile.name === 'Modern Other Key')!.id, 'fixture-auth-master').length, 1);
    assert.ok((await service.preview(['filezilla'])).every((c) => !c.canUnlock));
  } finally {
    service.clear();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Connection Import webview uses Remote Edit custom controls instead of native dropdowns or title tooltips', () => {
  const script = renderConnectionImport();
  const markup = renderConnectionImportMarkup();
  assert.ok(!script.includes("createElement('select')"));
  assert.ok(script.includes('profile-dropdown-button'));
  assert.ok(script.includes('profile-dropdown-menu'));
  assert.ok(!script.includes("{value:'skip',label:'Skip'}"));
  assert.ok(script.includes("const actionOptions=[{value:'new',label:'Import as New'},{value:'replace',label:'Replace'}]"));
  assert.ok(script.includes("const currentAction=choice.action==='replace'||ciPreferredActions.get(c.id)==='replace'?'replace':'new'"));
  // Selecting a Review row only changes Details. Import selection belongs to the checkbox.
  assert.ok(script.includes("row.addEventListener('click',e=>{if(e.target.closest('button,input'))return;selectRow();});"));
  assert.ok(script.includes("box.addEventListener('change',()=>updateSelection(box.checked,false));"));
  assert.ok(script.includes("if(e.target!==row)return;if(e.key===' '||e.key==='Spacebar'||e.key==='Enter'){e.preventDefault();selectRow();}"));
  assert.ok(!script.includes('selectRow();if(c.status!==\'Unsupported\')updateSelection(!box.checked,false);'));
  assert.ok(script.includes("if(payload.candidates) {ciCandidates=payload.candidates;ciRenderReview();}"));
  assert.ok(!script.includes("if(payload.candidates) {ciCandidates=payload.candidates;ciChoices.clear();ciPreferredActions.clear();ciRenderReview();}"));
  assert.ok(!/\stitle=/.test(markup));
  assert.ok(script.includes("ciText('button','Unlock Credentials')"));
  assert.ok(!script.includes('Unlock Credentials...'));
  assert.ok(markup.includes('data-tooltip="Hold to Show Password"'));
});


test('batch unlock restores all FileZilla connections sharing a key without repeated consent', async () => {
  const vector = FILEZILLA_AUTHENTICATED;
  const saved: any[] = [];
  const manager: any = {
    listProfiles: async () => [], listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'group', name }),
    saveProfile: async (input: any) => { saved.push(input); return { ...input, id: 'saved-' + saved.length }; }
  };
  const service = new ConnectionImportService(manager);
  const make = (id: string) => ({
    id, source: 'filezilla', sourcePath: '/test/sitemanager.xml',
    profile: { name: id, host: id + '.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: ['Protected password requires external master password.'], ignored: [],
    credentialNote: 'Protected password requires external master password.',
    lockedCredential: { kind: 'filezilla', value: vector.value, publicKey: vector.publicKey }
  });
  (service as any).candidates = [make('a'), make('b')];
  const preview = await service.preview(['filezilla']);
  const decisions = preview.map((candidate) => ({ id: candidate.id, action: 'new' as const }));
  await assert.rejects(service.apply(decisions), /Confirm import/);
  assert.equal(saved.length, 0);
  assert.deepEqual(service.unlock(preview[0].id, 'fixture-auth-master').sort(), ['a', 'b']);
  const result = await service.apply(decisions);
  assert.equal(result.imported, 2);
  assert.equal(result.credentials, 2);
  assert.ok(saved.every((item) => item.password === 'fixture-authenticated-secret'));
});

test('unlocked WinSCP source file is imported together, while locked credentials require explicit consent', async () => {
  const value = WINSCP_PROTECTED;
  const saved: any[] = [];
  const manager: any = {
    listProfiles: async () => [], listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'group', name }),
    saveProfile: async (input: any) => { saved.push(input); return { ...input, id: String(saved.length) }; }
  };
  const service = new ConnectionImportService(manager);
  const make = (id: string) => ({
    id, source: 'winscp', sourcePath: '/test/WinSCP.ini',
    profile: { name: id, host: id + '.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: [], ignored: [], lockedCredential: { kind: 'winscp', value }
  });
  (service as any).candidates = [make('one'), make('two')];
  const preview = await service.preview(['winscp']);
  const decisions = preview.map((candidate) => ({ id: candidate.id, action: 'new' as const }));
  await assert.rejects(service.apply(decisions), /Confirm import/);
  assert.deepEqual(service.unlock('one', 'fixture-master').sort(), ['one', 'two']);
  assert.equal((await service.apply(decisions)).credentials, 2);
  assert.ok(saved.every((item) => item.password === 'fixture-secret'));
});

test('import without unlocked credentials requires single explicit consent and never saves ciphertext', async () => {
  const saved: any[] = [];
  const manager: any = {
    listProfiles: async () => [], listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'group', name }),
    saveProfile: async (input: any) => { saved.push(input); return { ...input, id: 'saved' }; }
  };
  const service = new ConnectionImportService(manager);
  (service as any).candidates = [{
    id: 'locked', source: 'winscp', sourcePath: '/test/WinSCP.ini',
    profile: { name: 'Locked', host: 'locked.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: [], ignored: [], lockedCredential: { kind: 'winscp', value: 'A35D1234' }
  }];
  await service.preview(['winscp']);
  await assert.rejects(service.apply([{ id: 'locked', action: 'new' }]), /Confirm import/);
  assert.equal(saved.length, 0);
  const result = await service.apply([{ id: 'locked', action: 'new' }], true);
  assert.equal(result.imported, 1);
  assert.equal(result.credentials, 0);
  assert.equal(saved[0].password, undefined);
  assert.equal(saved[0].rememberPassword, false);
});

test('Replace with missing imported credentials cannot clear a saved secret without confirmation', async () => {
  const saved: any[] = [];
  const manager: any = {
    listProfiles: async () => [{ id: 'existing', name: 'Legacy', host: 'old.test', connectionType: 'sftp', port: 22, username: 'demo', hasSavedPassword: true }],
    listGroups: async () => [], createGroup: async (name: string) => ({ id: 'group', name }),
    saveProfile: async (input: any) => { saved.push(input); return { ...input, id: 'existing' }; }
  };
  const service = new ConnectionImportService(manager);
  (service as any).candidates = [{
    id: 'candidate', source: 'openssh', sourcePath: '/test/config',
    profile: { name: 'Legacy', host: 'new.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: [], ignored: []
  }];
  await service.preview(['openssh']);
  const decisions = [{ id: 'candidate', action: 'replace' as const, existingId: 'existing' }];
  await assert.rejects(service.apply(decisions), /Confirm import/);
  assert.equal(saved.length, 0);
  const result = await service.apply(decisions, true);
  assert.equal(result.imported, 1);
  assert.equal(saved[0].rememberPassword, false);
});

test('batch password reuse stays within the same application and leaves incompatible groups locked', async () => {
  const value = WINSCP_PROTECTED;
  const fileZilla = FILEZILLA_AUTHENTICATED;
  const manager: any = {
    listProfiles: async () => [], listGroups: async () => [],
    createGroup: async (name: string) => ({ id: 'group', name }),
    saveProfile: async (input: any) => ({ ...input, id: 'saved' })
  };
  const s = new ConnectionImportService(manager);
  const input = (id: string, source: 'winscp' | 'filezilla', sourcePath: string, lockedCredential: any) => ({
    id, source, sourcePath,
    profile: { name: id, host: id + '.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: [], ignored: [], lockedCredential
  });
  (s as any).candidates = [
    input('a', 'winscp', '/config/one.ini', { kind: 'winscp', value }),
    input('b', 'winscp', '/config/two.ini', { kind: 'winscp', value }),
    input('fz', 'filezilla', '/config/filezilla.xml', { kind: 'filezilla', value: fileZilla.value, publicKey: fileZilla.publicKey })
  ];
  await s.preview(['winscp', 'filezilla']);
  assert.deepEqual(s.unlock('a', 'fixture-master', true).sort(), ['a', 'b']);
  assert.equal((s as any).candidates.find((c: any) => c.id === 'fz').lockedCredential.kind, 'filezilla');
  assert.deepEqual(s.unlock('fz', 'fixture-auth-master'), ['fz']);
});

test('Skip advances by credential group without changing saved credentials or import selections', async () => {
  const s = new ConnectionImportService({ listProfiles: async () => [] } as any);
  const make = (id: string, source: 'filezilla' | 'winscp', sourcePath: string, lockedCredential: any) => ({
    id, source, sourcePath,
    profile: { name: id, host: id + '.test', port: 22, connectionType: 'sftp', username: 'demo', authType: 'password' },
    warnings: [], ignored: [], lockedCredential
  });
  (s as any).candidates = [
    make('fz-a', 'filezilla', '/one.xml', { kind: 'filezilla', value: FILEZILLA_AUTHENTICATED.value, publicKey: FILEZILLA_AUTHENTICATED.publicKey }),
    make('fz-b', 'filezilla', '/two.xml', { kind: 'filezilla', value: FILEZILLA_AUTHENTICATED.value, publicKey: FILEZILLA_AUTHENTICATED.publicKey }),
    make('fz-other', 'filezilla', '/one.xml', { kind: 'filezilla', value: FILEZILLA_LEGACY.value, publicKey: FILEZILLA_LEGACY.publicKey }),
    make('winscp-a', 'winscp', '/one.ini', { kind: 'winscp', value: WINSCP_PROTECTED }),
    make('winscp-b', 'winscp', '/one.ini', { kind: 'winscp', value: WINSCP_PROTECTED }),
    make('winscp-other', 'winscp', '/two.ini', { kind: 'winscp', value: WINSCP_PROTECTED })
  ];
  await s.preview(['filezilla', 'winscp']);
  assert.deepEqual(s.unlockGroupIds('fz-a').sort(), ['fz-a', 'fz-b']);
  assert.deepEqual(s.unlockGroupIds('fz-other'), ['fz-other']);
  assert.deepEqual(s.unlockGroupIds('winscp-a').sort(), ['winscp-a', 'winscp-b']);
  assert.deepEqual(s.unlockGroupIds('winscp-other'), ['winscp-other']);
  assert.ok((s as any).candidates.every((candidate: any) => candidate.lockedCredential));
  assert.throws(() => s.unlockGroupIds('invalid'));

  const markup = renderConnectionImportMarkup();
  const script = renderConnectionImport();
  assert.match(markup, /connectionImportUnlockSkipAll[^>]*hidden>Skip All<\/button>/);
  assert.ok(script.includes("ci('UnlockSkipAll').hidden=!batch"));
  assert.ok(script.includes("ciBatchSkippedGroups.has(c.id)"));
  assert.ok(script.includes("ciSend({action:'skipUnlock',id:ciUnlockId})"));
  assert.ok(!script.includes('Skip Remaining'));
});

test('two-hop imports enforce dependencies and report each outcome without exposing secrets', async () => {
  const saved: any[] = [];
  const manager: any = {
    listProfiles: async () => [],
    listGroups: async () => [],
    createGroup: async (name: string) => ({ id: name, name }),
    saveProfile: async (profile: any) => {
      if (profile.name === 'broken') throw new Error('private-error-detail');
      const value = { ...profile, id: profile.name };
      saved.push(value);
      return value;
    }
  };
  const service = new ConnectionImportService(manager);
  const make = (name: string, jumpAlias?: string) => ({
    id: name, source: 'openssh', sourcePath: '/test/config', alias: name, jumpAlias,
    profile: { name, host: name + '.test', port: 22, connectionType: 'sftp', username: 'demo' },
    warnings: [], ignored: []
  });
  (service as any).candidates = [
    make('jump1'), make('jump2', 'jump1'), make('main', 'jump2'),
    make('skipped'), make('broken')
  ];
  const review = await service.preview(['openssh']);
  assert.equal(review.find((item) => item.id === 'main')?.jumpCandidateId, 'jump2');
  assert.equal(review.find((item) => item.id === 'jump2')?.jumpCandidateId, 'jump1');
  await assert.rejects(
    service.apply([{ id: 'main', action: 'new' }]),
    /required Jump Host "jump2" is not selected/
  );
  assert.equal(saved.length, 0);

  const result = await service.apply([
    { id: 'jump1', action: 'new' }, { id: 'jump2', action: 'new' },
    { id: 'main', action: 'new' }, { id: 'skipped', action: 'skip' },
    { id: 'broken', action: 'new' }
  ]);
  assert.equal(result.imported, 3);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.entries.length, 5);
  assert.equal(result.entries.find((item) => item.id === 'broken')?.status, 'Failed');
  assert.equal(result.entries.find((item) => item.id === 'skipped')?.status, 'Skipped');
  assert.equal(saved.find((item) => item.id === 'jump2')?.jumpProfileId, 'jump1');
  assert.equal(saved.find((item) => item.id === 'main')?.jumpProfileId, 'jump2');
  assert.ok(!JSON.stringify(result).includes('private-error-detail'));
});
