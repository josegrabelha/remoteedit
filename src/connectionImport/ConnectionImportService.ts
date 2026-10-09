import * as path from 'path';
import { normalizeProxyProfile, PROXY_PROFILES_KEY } from '../proxy/ProxyProfiles';
import { unlockFileZillaGroup, unlockWinScp } from './ConnectionImportCredentials';
import type {
  ConnectionManager,
  ConnectionProfile
} from '../connection/ConnectionManager';
import {
  sourceNames,
  type ImportCandidate,
  type ImportConnectionResult,
  type ImportDecision,
  type ImportSource,
  type SourceId
} from './ConnectionImportTypes';
import {
  detectPaths,
  readConfig,
  readRegistry,
  registryKeys
} from './ConnectionImportDetection';
import { validateCandidates } from './ConnectionImportValidation';
import {
  conflicts,
  publicProfile,
  sameEndpoint
} from './ConnectionImportConflicts';
import { parseOpenSsh } from './sources/OpenSshImportSource';
import { parseFileZilla } from './sources/FileZillaImportSource';
import { parseWinScp } from './sources/WinScpImportSource';
import { parsePutty } from './sources/PuttyImportSource';
import { parseSshFs } from './sources/SshFsImportSource';
import { parseVsCodeSftp } from './sources/VsCodeSftpImportSource';
const parsers = {
  openssh: parseOpenSsh,
  filezilla: parseFileZilla,
  winscp: parseWinScp,
  putty: parsePutty,
  sshfs: parseSshFs,
  sftp: parseVsCodeSftp
};
export class ConnectionImportService {
  private candidates: ImportCandidate[] = [];
  private sources: ImportSource[] = [];
  private reviewed = new Set<string>();
  private fingerprints = new Map<string, string>();
  constructor(
    private readonly manager: Pick<
      ConnectionManager,
      'listProfiles' | 'saveProfile' | 'listGroups' | 'createGroup'
    > & Partial<Pick<ConnectionManager, 'proxyProfiles'>>
  ) {}
  clear(): void {
    this.candidates = [];
    this.sources = [];
    this.reviewed.clear();
    this.fingerprints.clear();
  }
  async detect(workspacePaths: string[]): Promise<ImportSource[]> {
    this.clear();
    const paths = await detectPaths(workspacePaths);
    this.sources = (Object.keys(sourceNames) as SourceId[]).map((id) => ({
      id,
      name: sourceNames[id],
      paths: [],
      status: 'Not detected',
      count: 0
    }));
    for (const source of this.sources) {
      await this.load(source.id, paths[source.id], false);
      if (
        process.platform === 'win32' &&
        (source.id === 'winscp' || source.id === 'putty') &&
        !source.count
      ) {
        const entries: ImportCandidate[] = [];
        for (const key of registryKeys[source.id])
          try {
            entries.push(
              ...(await parsers[source.id](
                await readRegistry(source.id, key),
                key
              ))
            );
          } catch {}
        if (entries.length && this.sources.includes(source)) {
          this.candidates.push(...(await validateCandidates(entries)));
          source.count += entries.length;
          source.status = 'Detected';
          source.paths.push('Windows Registry');
          source.error = undefined;
        }
      }
    }
    return this.sources;
  }
  async load(
    id: SourceId,
    files: string[],
    manual = true
  ): Promise<ImportSource[]> {
    const source = this.sources.find((s) => s.id === id);
    if (!source) throw new Error('Unknown import source.');
    this.reviewed.clear();
    const loaded: ImportCandidate[] = [];
    let failures = 0;
    for (const file of files) {
      try {
        const content = await readConfig(file);
        if (id === 'filezilla') {
          let settings: string | undefined;
          try { settings = await readConfig(path.join(path.dirname(file),'filezilla.xml')); } catch { /* Export may contain settings itself. */ }
          loaded.push(...parseFileZilla(content,file,settings));
        } else loaded.push(...(await parsers[id](content, file)));
      } catch {
        failures++;
      }
    }
    const valid = await validateCandidates(loaded);
    if (!this.sources.includes(source))
      throw new Error('Import session closed.');
    this.candidates = this.candidates
      .filter((c) => c.source !== id)
      .concat(valid);
    source.paths = files;
    source.count = valid.length;
    source.status = valid.length
      ? manual
        ? 'Loaded manually'
        : 'Detected'
      : files.length
        ? 'No connections found'
        : 'Not detected';
    source.error = failures
      ? `${failures} file(s) could not be read or did not match this source format.`
      : undefined;
    return this.sources;
  }
  /** IDs belonging to the same protected credential group as a reviewed candidate. */
  unlockGroupIds(id: string): string[] {
    const anchor = this.candidates.find(
      (c) => c.id === id && this.reviewed.has(id)
    );
    if (anchor?.lockedProxyPassword && !anchor.lockedCredential) return this.candidates.filter(c=>this.reviewed.has(c.id)&&c.sourcePath===anchor.sourcePath&&c.lockedProxyPassword).map(c=>c.id);
    if (!anchor?.lockedCredential)
      throw new Error('Unavailable credential.');
    const lockedAnchor = anchor.lockedCredential;
    // FileZilla's complete public key (including its salt) identifies the
    // credential group. A single file can contain credentials from multiple
    // keys, and the same key may occur in several chosen files.
    return this.candidates.filter((candidate) => {
      const locked = candidate.lockedCredential;
      return (
        this.reviewed.has(candidate.id) &&
        candidate.source === anchor.source &&
        !!locked && locked.kind === lockedAnchor.kind &&
        (lockedAnchor.kind === 'filezilla'
          ? (!!lockedAnchor.publicKey && locked.publicKey === lockedAnchor.publicKey) ||
            candidate.id === id
          : candidate.sourcePath === anchor.sourcePath)
      );
    }).map((candidate) => candidate.id);
  }

  lockedCredentialIds(): string[] {
    return this.candidates.filter(c => this.reviewed.has(c.id) && (c.lockedCredential || c.lockedProxyPassword)).map(c => c.id);
  }

  unlock(id: string, password: string, tryCompatibleGroups = false): string[] {
    if (typeof password !== 'string' || !password || password.length > 4096) throw new Error('Unavailable credential.');
    const anchor = this.candidates.find(
      (c) => c.id === id && this.reviewed.has(id)
    );
    if (anchor?.lockedProxyPassword && !anchor.lockedCredential) {
      const value=unlockWinScp(anchor.lockedProxyPassword,password);
      const ids: string[]=[];
      for(const c of this.candidates.filter(c=>this.reviewed.has(c.id)&&c.sourcePath===anchor.sourcePath&&c.lockedProxyPassword&&c.proxy)) {
        try { c.proxy!.password=c===anchor?value:unlockWinScp(c.lockedProxyPassword!,password); c.lockedProxyPassword=undefined; c.warnings=c.warnings.filter(w=>w!=='Proxy password is unavailable; configure it after importing.'); ids.push(c.id); } catch { /* Other credentials may use another master password. */ }
      }
      return ids;
    }
    if (
      !anchor?.lockedCredential ||
      typeof password !== 'string' ||
      !password ||
      password.length > 4096
    )
      throw new Error('Unavailable credential.');
    const lockedAnchor = anchor.lockedCredential;
    const groupIds = new Set(this.unlockGroupIds(id));
    const targets = this.candidates.filter((candidate) => groupIds.has(candidate.id));
    const unlocked: { candidate: ImportCandidate; value: string }[] = [];
    if (lockedAnchor.kind === 'filezilla') {
      const values = unlockFileZillaGroup(
        targets.map((candidate) => candidate.lockedCredential!.value),
        lockedAnchor.publicKey || '',
        password
      );
      if (values[targets.findIndex((candidate) => candidate.id === id)] === undefined)
        throw new Error('Unable to unlock credentials.');
      for (let index = 0; index < targets.length; index++) {
        if (values[index] !== undefined)
          unlocked.push({ candidate: targets[index], value: values[index]! });
      }
    } else {
      // Preserve WinSCP's source-file grouping semantics.
      let anchorUnlocked = false;
      for (const candidate of targets) {
        try {
          const value = unlockWinScp(candidate.lockedCredential!.value, password);
          unlocked.push({ candidate, value });
          if (candidate.id === id) anchorUnlocked = true;
        } catch {
          if (candidate.id === id) throw new Error('Unable to unlock credentials.');
        }
      }
      if (!anchorUnlocked) throw new Error('Unable to unlock credentials.');
    }

    for (const item of unlocked) {
      if (item.candidate.lockedProxyPassword && item.candidate.proxy) {
        try { item.candidate.proxy.password=unlockWinScp(item.candidate.lockedProxyPassword,password); item.candidate.lockedProxyPassword=undefined; } catch { /* Keep available for a later unlock. */ }
      }
      item.candidate.profile.password = item.value;
      item.candidate.profile.rememberPassword = true;
      item.candidate.warnings = item.candidate.warnings.filter(
        (w) => w !== item.candidate.credentialNote
      );
      item.candidate.credentialNote = undefined;
      item.candidate.lockedCredential = undefined;
    }
    const unlockedIds = unlocked.map((item) => item.candidate.id);
    if (tryCompatibleGroups) {
      // A batch password is tried only against other groups of the SAME app.
      // Ignore failures so a different master password never blocks a valid
      // group; never retain the entered password after this call.
      const attempted = new Set(unlockedIds);
      let groupsTried = 0;
      for (const other of this.candidates) {
        if (groupsTried >= 32) break;
        if (
          attempted.has(other.id) ||
          !this.reviewed.has(other.id) ||
          !other.lockedCredential ||
          other.source !== anchor.source ||
          other.lockedCredential.kind !== lockedAnchor.kind
        ) continue;
        groupsTried++;
        try {
          const additional = this.unlock(other.id, password);
          for (const additionalId of additional) {
            attempted.add(additionalId);
            unlockedIds.push(additionalId);
          }
        } catch {
          // This group may be protected by a different password.
        }
      }
    }
    return unlockedIds;
  }
  async preview(ids: SourceId[]): Promise<any[]> {
    const existing = await this.manager.listProfiles();
    const proxies = await this.manager.proxyProfiles?.list() || [];
    const publicProxy = (id?: string) => { const p=proxies.find(p=>p.id===id); return p ? {proxyType:p.type,proxyHost:p.host,proxyPort:p.port,proxyAuthentication:p.authentication,proxyUsername:p.username || ''} : {}; };
    this.fingerprints = new Map(existing.map((p) => [p.id, JSON.stringify(p)]));
    const selected = this.candidates.filter((c) => ids.includes(c.source));
    if (selected.length > 2000)
      throw new Error('Select no more than 2,000 connections.');
    this.reviewed = new Set(selected.map((c) => c.id));
    return selected.map((c, index) => {
      const matches = conflicts(c.profile, existing);
      const duplicates = selected
        .slice(0, index)
        .filter(
          (other) =>
            other.profile.name === c.profile.name ||
            sameEndpoint(other.profile, c.profile)
        );
      return {
        id: c.id,
        source: sourceNames[c.source],
        sourcePath: c.sourcePath,
        profile: {...publicProfile(c.profile), ...(c.proxy ? {proxyType:c.proxy.type,proxyHost:c.proxy.host,proxyPort:c.proxy.port,proxyAuthentication:c.proxy.authentication,proxyUsername:c.proxy.username || ''} : {})},
        group: c.group || '',
        warnings: c.warnings,
        ignored: c.ignored,
        status: c.unsupported
          ? 'Unsupported'
          : matches.length || duplicates.length
            ? 'Conflict'
            : c.warnings.length
              ? 'Warning'
              : 'Ready',
        reason: c.unsupported || '',
        credentials: c.profile.password
          ? 'Password available'
          : c.profile.passphrase
            ? 'Passphrase available'
            : c.profile.privateKeyPath
              ? 'Private key path'
              : 'Not available',
        canUnlock: !!(c.lockedCredential || c.lockedProxyPassword),
        jump: c.jumpAlias || '',
        jumpCandidateId: c.jumpAlias
          ? selected.find((other) => other.source === c.source && other.alias === c.jumpAlias)?.id || ''
          : '',
        conflicts: matches.map((p) => ({
          id: p.id,
          profile: {...publicProfile(p),...publicProxy(p.proxyProfileId)},
          credentials:
            p.hasSavedPassword || p.hasSavedPassphrase || p.passwordSource === 'master'
              ? 'Saved credentials'
              : 'No saved credentials'
        })),
        duplicate: duplicates.length
          ? 'Another selected source contains this connection. Choose Skip or Import as New.'
          : ''
      };
    });
  }
  async apply(
    decisions: ImportDecision[],
    acknowledgeCredentialRisk = false
  ): Promise<{
    imported: number;
    skipped: number;
    failed: number;
    credentials: number;
    warnings: number;
    errors: string[];
    entries: ImportConnectionResult[];
  }> {
    const result = {
      imported: 0,
      skipped: 0,
      failed: 0,
      credentials: 0,
      warnings: 0,
      errors: [] as string[],
      entries: [] as ImportConnectionResult[]
    };
    if (!Array.isArray(decisions) || decisions.length > 2000)
      throw new Error('Invalid import selection.');
    const seen = new Set<string>(),
      replaceIds = new Set<string>();
    const existing = await this.manager.listProfiles();
    const selected = decisions.map((d) => {
      const c = this.candidates.find((c) => c.id === d.id);
      if (
        !c ||
        !this.reviewed.has(d.id) ||
        seen.has(d.id) ||
        !['new', 'replace', 'skip'].includes(d.action)
      )
        throw new Error('Review the selected sources again.');
      seen.add(d.id);
      if (d.action !== 'skip' && c.unsupported)
        throw new Error(`Cannot import "${c.profile.name}": ${c.unsupported}`);
      if (d.action === 'replace') {
        const target = existing.find((p) => p.id === d.existingId);
        if (
          !target ||
          !conflicts(c.profile, existing).some((p) => p.id === target.id) ||
          this.fingerprints.get(target.id) !== JSON.stringify(target) ||
          replaceIds.has(target.id)
        )
          throw new Error(
            'A replacement target changed or is selected more than once. Review again.'
          );
        replaceIds.add(target.id);
      }
      return { d, c };
    });
    // Require explicit consent whenever a selected import leaves protected
    // credentials locked, or Replace will clear an existing saved secret.
    // The webview confirms these risks once for the whole operation.
    const hasCredentialRisk = selected.some(({ d, c }) => {
      if (d.action === 'skip') return false;
      if (c.lockedCredential) return true;
      if (d.action !== 'replace') return false;
      const previous = existing.find((p) => p.id === d.existingId);
      return Boolean(
        (previous?.hasSavedPassword || previous?.hasSavedPassphrase || previous?.passwordSource === 'master') &&
        !(c.profile.password || c.profile.passphrase)
      );
    });
    if (hasCredentialRisk && !acknowledgeCredentialRisk)
      throw new Error('Confirm import without protected credentials first.');
    for (const item of selected) {
      if (item.d.action === 'skip') continue;
      let current = item.c;
      const chain = new Set<string>();
      while (current.jumpAlias) {
        const dependency = selected.find(
          (s) =>
            s.c.source === current.source &&
            s.c.alias === current.jumpAlias &&
            s.d.action !== 'skip'
        );
        if (!dependency)
          throw new Error(`Cannot import "${item.c.profile.name}": required Jump Host "${current.jumpAlias}" is not selected. Select it in Review.`);
        if (chain.has(dependency.c.id))
          throw new Error(`Cannot import "${item.c.profile.name}": a cyclic Jump Host dependency was detected.`);
        chain.add(dependency.c.id);
        current = dependency.c;
      }
    }
    this.reviewed.clear(); // The same reviewed operation cannot be replayed.
    const groups = await this.manager.listGroups();
    const usedNames = new Set(existing.map((p) => p.name.toLowerCase()));
    const saved = new Map<string, ConnectionProfile>();
    const visiting = new Set<string>();
    const done = new Set<string>();
    const entry = (item: (typeof selected)[number], status: ImportConnectionResult['status'], reason: string, savedName?: string): void => {
      const { c, d } = item;
      result.entries.push({
        id: c.id,
        source: sourceNames[c.source],
        name: String(c.profile.name || c.profile.host),
        savedName,
        action: d.action === 'replace' ? 'Replace' : d.action === 'skip' ? 'Skip' : 'Import as New',
        status,
        reason,
        credentials: d.action === 'skip' ? 'Not imported'
          : c.profile.password || c.profile.passphrase ? 'Imported'
          : c.lockedCredential ? 'Protected — not unlocked'
          : c.profile.privateKeyPath ? 'Private key path (no secret imported)'
          : 'Not available',
        warnings: [...c.warnings],
        jump: c.jumpAlias ? selected.find((s) => s.c.source === c.source && s.c.alias === c.jumpAlias)?.c.profile.name || c.jumpAlias : undefined
      });
    };
    const save = async (
      item: (typeof selected)[number]
    ): Promise<ConnectionProfile | undefined> => {
      const { c, d } = item;
      if (done.has(c.id)) return saved.get(c.id);
      if (d.action === 'skip') {
        done.add(c.id);
        result.skipped++;
        entry(item, 'Skipped', c.unsupported ? `Unsupported configuration: ${c.unsupported}` : 'Not selected for import.');
        return undefined;
      }
      if (visiting.has(c.id)) throw new Error('Cyclic jump dependency.');
      visiting.add(c.id);
      try {
        let jumpProfileId = '';
        if (c.jumpAlias) {
          const dependency = selected.find(
            (s) =>
              s.c.source === c.source &&
              s.c.alias === c.jumpAlias &&
              s.d.action !== 'skip'
          );
          if (!dependency)
            throw new Error(`Required Jump Host "${c.jumpAlias}" was not selected.`);
          const jump = await save(dependency);
          if (!jump) throw new Error(`Required Jump Host "${dependency.c.profile.name}" could not be imported.`);
          jumpProfileId = jump.id;
        }
        let name = String(c.profile.name || c.profile.host),
          groupId: string | undefined;
        if (d.action === 'new') {
          const base = name;
          let n = 2;
          while (usedNames.has(name.toLowerCase())) name = `${base} (${n++})`;
        }
        if (c.group) {
          let group = groups.find((g) => g.name === c.group);
          if (!group) {
            group = await this.manager.createGroup(c.group);
            groups.push(group);
          }
          groupId = group.id;
        }
        let proxyProfileId = '';
        if (c.proxy) {
          const store = this.manager.proxyProfiles;
          if (!store) throw new Error('Proxy import is unavailable.');
          const known = await store.list();
          let proxy = known.find(p => p.type === c.proxy!.type && p.host.toLowerCase() === c.proxy!.host.toLowerCase() && p.port === c.proxy!.port && p.authentication === c.proxy!.authentication && p.username === c.proxy!.username);
          if (proxy && c.proxy.password) {
            let resolved; try { resolved=await store.resolve(proxy.id); } catch { /* Missing credentials are not a match. */ }
            if (resolved?.password !== c.proxy.password) proxy=undefined;
          }
          if (!proxy) {
            let proxyName=c.proxy.name, suffix=2;
            while(known.some(p=>p.name.toLowerCase()===proxyName.toLowerCase())) proxyName=c.proxy.name+' ('+suffix+++')';
            proxy=await store.importProfile({...c.proxy,id:'',name:proxyName});
          }
          proxyProfileId=proxy.id;
        }
        const p = await this.manager.saveProfile({
          ...c.profile,
          id: d.action === 'replace' ? d.existingId : undefined,
          name,
          groupId,
          proxyProfileId,
          jumpProfileId,
          // Existing secrets must not silently be reused against an imported endpoint.
          rememberPassword: !!c.profile.password,
          rememberPassphrase: !!c.profile.passphrase,
          passwordSource: 'connection'
        });
        saved.set(c.id, p);
        usedNames.add(name.toLowerCase());
        result.imported++;
        if (c.profile.password || c.profile.passphrase) result.credentials++;
        if (c.warnings.length) result.warnings++;
        entry(item, 'Imported', d.action === 'replace' ? 'Existing connection replaced.' : 'New connection created.', p.name);
        return p;
      } catch (error) {
        result.failed++;
        const reason = error instanceof Error && /^Required Jump Host /.test(error.message)
          ? error.message
          : 'Could not save this connection. Check its connection settings and try again.';
        entry(item, 'Failed', reason);
        result.errors.push(`"${c.profile.name}": ${reason}`);
        return undefined;
      } finally {
        done.add(c.id);
        visiting.delete(c.id);
      }
    };
    for (const item of selected) await save(item);
    this.candidates = [];
    this.fingerprints.clear();
    return result;
  }
}
