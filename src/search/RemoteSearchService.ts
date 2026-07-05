import * as vscode from 'vscode';
import type { RemoteSessionManager, RemoteEntry, RemoteCommandStreamingControl } from '../remote/RemoteSessionManager';
import { normalizeRemotePath } from '../ssh/SftpSessionManager';
import { createPerformanceTimer, appendDebugLog, appendPerformanceLog } from '../utils/outputLogger';
import { shellQuote } from '../utils/shellUtils';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';
import { normalizeRemotePathForPlatform, toRemoteCommandPath } from '../remote/RemotePathUtils';
import { buildWindowsSearchContentCommand, buildWindowsSearchFileCommand } from '../ssh/WindowsPowerShellUtils';

export type RemoteSearchStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
export type RemoteSearchProtocol = 'sftp' | 'ftp' | 'ftps' | string;

export interface RemoteSearchOptions {
  connectionId: string;
  connectionType: RemoteSearchProtocol;
  scopePath: string;
  includeSubdirectories: boolean;
  includeHiddenFiles: boolean;
  caseSensitive: boolean;
  fileName: string;
  searchInsideFiles: boolean;
  textToFind: string;
  useSudo: boolean;
}

export interface RemoteSearchResult {
  path: string;
  type?: 'file' | 'directory';
  line?: number;
  text?: string;
}

export interface RemoteSearchSnapshot {
  id: string;
  status: RemoteSearchStatus;
  connectionId: string;
  connectionType: RemoteSearchProtocol;
  options: RemoteSearchOptions;
  results: RemoteSearchResult[];
  totalResults: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface RemoteSearchResultMeta {
  connectionId: string;
  status: RemoteSearchStatus;
  searchId: string;
  totalResults: number;
}

export interface RemoteSearchEvents {
  onStarted(snapshot: RemoteSearchSnapshot): void;
  onResult(result: RemoteSearchResult, meta: RemoteSearchResultMeta): void;
  onFinished(snapshot: RemoteSearchSnapshot): void;
}

interface ActiveSearchRun {
  cancellationSource: vscode.CancellationTokenSource;
  control?: RemoteCommandStreamingControl;
}

const SOURCE = 'RemoteSearch';

export class RemoteSearchService {
  private readonly snapshots = new Map<string, RemoteSearchSnapshot>();
  private readonly activeRuns = new Map<string, ActiveSearchRun>();

  constructor(
    private readonly sessions: RemoteSessionManager,
    private readonly output: vscode.OutputChannel | undefined,
    private readonly events: RemoteSearchEvents
  ) {}

  getSnapshot(connectionId?: string, connectionType: RemoteSearchProtocol = 'sftp'): RemoteSearchSnapshot {
    const normalizedConnectionId = String(connectionId || '').trim();
    if (!normalizedConnectionId) {
      return this.createIdleSnapshot('', connectionType);
    }

    const existing = this.snapshots.get(normalizedConnectionId);
    if (existing) {
      return this.cloneSnapshot(existing);
    }

    return this.createIdleSnapshot(normalizedConnectionId, connectionType);
  }

  clear(connectionId?: string, connectionType: RemoteSearchProtocol = 'sftp'): RemoteSearchSnapshot {
    const normalizedConnectionId = String(connectionId || '').trim();
    if (!normalizedConnectionId) {
      return this.createIdleSnapshot('', connectionType);
    }

    const snapshot = this.snapshots.get(normalizedConnectionId) || this.createIdleSnapshot(normalizedConnectionId, connectionType);
    if (snapshot.status === 'running') {
      return this.cloneSnapshot(snapshot);
    }

    appendDebugLog(this.output, SOURCE, 'Search state cleared.', {
      connectionId: normalizedConnectionId,
      previousStatus: snapshot.status,
      previousResults: snapshot.totalResults
    });

    const next = this.createIdleSnapshot(normalizedConnectionId, connectionType);
    this.snapshots.set(normalizedConnectionId, next);
    return this.cloneSnapshot(next);
  }

  cancel(connectionId?: string): void {
    const normalizedConnectionId = String(connectionId || '').trim();
    if (!normalizedConnectionId) {
      return;
    }

    const snapshot = this.snapshots.get(normalizedConnectionId);
    const activeRun = this.activeRuns.get(normalizedConnectionId);
    if (!snapshot || snapshot.status !== 'running' || !activeRun) {
      return;
    }

    appendDebugLog(this.output, SOURCE, 'Search cancel requested.', {
      searchId: snapshot.id,
      connectionId: snapshot.connectionId,
      results: snapshot.totalResults
    });

    snapshot.status = 'cancelled';
    snapshot.finishedAt = Date.now();
    this.events.onFinished(this.cloneSnapshot(snapshot));

    activeRun.cancellationSource.cancel();
    activeRun.control?.stop();
  }

  async start(options: RemoteSearchOptions): Promise<void> {
    const normalizedOptions = this.normalizeOptions(options);
    this.validateOptions(normalizedOptions);

    const existingSnapshot = this.snapshots.get(normalizedOptions.connectionId);
    if (existingSnapshot?.status === 'running') {
      throw new Error('A search is already running for this connection. Cancel it before starting another search.');
    }

    const searchId = this.createSearchId();
    const timer = createPerformanceTimer();
    const cancellationSource = new vscode.CancellationTokenSource();
    this.activeRuns.set(normalizedOptions.connectionId, { cancellationSource });

    const runningSnapshot: RemoteSearchSnapshot = {
      id: searchId,
      status: 'running',
      connectionId: normalizedOptions.connectionId,
      connectionType: normalizedOptions.connectionType,
      options: normalizedOptions,
      results: [],
      totalResults: 0,
      startedAt: Date.now()
    };
    this.snapshots.set(normalizedOptions.connectionId, runningSnapshot);

    appendDebugLog(this.output, SOURCE, 'Search started.', {
      searchId,
      connectionId: normalizedOptions.connectionId,
      connectionType: normalizedOptions.connectionType,
      scopePath: normalizedOptions.scopePath,
      fileName: normalizedOptions.fileName,
      searchInsideFiles: normalizedOptions.searchInsideFiles,
      useSudo: normalizedOptions.useSudo
    });

    this.events.onStarted(this.cloneSnapshot(runningSnapshot));

    try {
      if (normalizedOptions.connectionType === 'sftp') {
        await this.runSftpSearch(normalizedOptions, cancellationSource.token);
      } else {
        await this.runFtpSearch(normalizedOptions, cancellationSource.token);
      }

      if (cancellationSource.token.isCancellationRequested) {
        this.finish(normalizedOptions.connectionId, 'cancelled');
      } else {
        this.finish(normalizedOptions.connectionId, 'completed');
      }
    } catch (error) {
      if (cancellationSource.token.isCancellationRequested) {
        this.finish(normalizedOptions.connectionId, 'cancelled');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const snapshot = this.getMutableSnapshot(normalizedOptions.connectionId, normalizedOptions.connectionType);
        snapshot.status = 'failed';
        snapshot.finishedAt = Date.now();
        snapshot.error = message || 'Search failed.';
        appendDebugLog(this.output, SOURCE, 'Search failed.', {
          searchId,
          connectionId: normalizedOptions.connectionId,
          results: snapshot.totalResults,
          error: snapshot.error
        });
        appendPerformanceLog(this.output, SOURCE, 'search failed', {
          searchId,
          connectionId: normalizedOptions.connectionId,
          results: snapshot.totalResults,
          total: `${timer()}ms`
        });
        this.events.onFinished(this.cloneSnapshot(snapshot));
      }
    } finally {
      const snapshot = this.getMutableSnapshot(normalizedOptions.connectionId, normalizedOptions.connectionType);
      appendPerformanceLog(this.output, SOURCE, 'search finished', {
        searchId,
        connectionId: normalizedOptions.connectionId,
        status: snapshot.status,
        results: snapshot.totalResults,
        total: `${timer()}ms`
      });
      cancellationSource.dispose();
      const activeRun = this.activeRuns.get(normalizedOptions.connectionId);
      if (activeRun?.cancellationSource === cancellationSource) {
        this.activeRuns.delete(normalizedOptions.connectionId);
      }
    }
  }

  private finish(connectionId: string, status: 'completed' | 'cancelled'): void {
    const snapshot = this.getMutableSnapshot(connectionId);
    if (snapshot.status === 'cancelled' && status === 'completed') {
      return;
    }
    if (snapshot.status === status && snapshot.finishedAt) {
      return;
    }
    snapshot.status = status;
    snapshot.finishedAt = Date.now();
    appendDebugLog(this.output, SOURCE, `Search ${status}.`, {
      searchId: snapshot.id,
      connectionId: snapshot.connectionId,
      results: snapshot.totalResults
    });
    this.events.onFinished(this.cloneSnapshot(snapshot));
  }

  private async runSftpSearch(options: RemoteSearchOptions, token: vscode.CancellationToken): Promise<void> {
    const connection = this.sessions.getConnection(options.connectionId);
    if (isWindowsRemotePlatform(connection?.remotePlatform)) {
      await this.runWindowsSftpSearch(options, token);
      return;
    }

    const command = options.searchInsideFiles
      ? this.buildSftpContentSearchCommand(options)
      : this.buildSftpFileSearchCommand(options);

    let stdoutBuffer = '';
    const flushStdoutLines = (final = false) => {
      const parts = stdoutBuffer.split('\n');
      stdoutBuffer = final ? '' : (parts.pop() || '');
      const lines = final ? parts.filter(line => line.length > 0) : parts;
      for (const line of lines) {
        if (token.isCancellationRequested || this.getMutableSnapshot(options.connectionId, options.connectionType).status !== 'running') break;
        this.consumeSftpLine(options.connectionId, line, options.searchInsideFiles);
      }
    };

    const result = await this.sessions.runRemoteCommandStreaming(
      options.connectionId,
      options.scopePath,
      command,
      {
        onControl: control => {
          const activeRun = this.activeRuns.get(options.connectionId);
          if (activeRun) {
            activeRun.control = control;
          }
        },
        onStdout: chunk => {
          if (token.isCancellationRequested || this.getMutableSnapshot(options.connectionId, options.connectionType).status !== 'running') return;
          stdoutBuffer += chunk;
          flushStdoutLines(false);
        },
        onStderr: chunk => {
          const text = String(chunk || '').trim();
          if (text) {
            appendDebugLog(this.output, SOURCE, 'Search stderr.', {
              searchId: this.getMutableSnapshot(options.connectionId, options.connectionType).id,
              connectionId: options.connectionId,
              text: text.slice(0, 500)
            });
          }
        }
      },
      token
    );

    if (!token.isCancellationRequested && this.getMutableSnapshot(options.connectionId, options.connectionType).status === 'running') {
      flushStdoutLines(true);
    }

    if (!token.isCancellationRequested && this.getMutableSnapshot(options.connectionId, options.connectionType).status === 'running' && result.code !== 0 && result.code !== 1) {
      throw new Error(`Search command failed with exit code ${result.code}.`);
    }
  }

  private async runWindowsSftpSearch(options: RemoteSearchOptions, token: vscode.CancellationToken): Promise<void> {
    const commandOptions = {
      scopePath: toRemoteCommandPath(options.scopePath, 'windows'),
      patterns: this.splitPatterns(options.fileName || '*'),
      includeSubdirectories: options.includeSubdirectories,
      includeHiddenFiles: options.includeHiddenFiles,
      caseSensitive: options.caseSensitive,
      textToFind: options.textToFind
    };
    const command = options.searchInsideFiles
      ? buildWindowsSearchContentCommand(commandOptions)
      : buildWindowsSearchFileCommand(commandOptions);

    let stdoutBuffer = '';
    const flushStdoutLines = (final = false) => {
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = final ? '' : (parts.pop() || '');
      const lines = final ? parts.filter(line => line.length > 0) : parts;
      for (const line of lines) {
        if (token.isCancellationRequested || this.getMutableSnapshot(options.connectionId, options.connectionType).status !== 'running') break;
        this.consumeWindowsSftpLine(options.connectionId, line, options.searchInsideFiles);
      }
    };

    const result = await this.sessions.runRemoteCommandStreaming(
      options.connectionId,
      options.scopePath,
      command,
      {
        onControl: control => {
          const activeRun = this.activeRuns.get(options.connectionId);
          if (activeRun) {
            activeRun.control = control;
          }
        },
        onStdout: chunk => {
          if (token.isCancellationRequested || this.getMutableSnapshot(options.connectionId, options.connectionType).status !== 'running') return;
          stdoutBuffer += chunk;
          flushStdoutLines(false);
        },
        onStderr: chunk => {
          const text = String(chunk || '').trim();
          if (text) {
            appendDebugLog(this.output, SOURCE, 'Windows search stderr.', {
              searchId: this.getMutableSnapshot(options.connectionId, options.connectionType).id,
              connectionId: options.connectionId,
              text: text.slice(0, 500)
            });
          }
        }
      },
      token
    );

    if (!token.isCancellationRequested && this.getMutableSnapshot(options.connectionId, options.connectionType).status === 'running') {
      flushStdoutLines(true);
    }

    if (!token.isCancellationRequested && this.getMutableSnapshot(options.connectionId, options.connectionType).status === 'running' && result.code !== 0 && result.code !== 1) {
      throw new Error(`Windows search command failed with exit code ${result.code}.`);
    }
  }

  private buildSftpFileSearchCommand(options: RemoteSearchOptions): string {
    return [
      'find',
      shellQuote(options.scopePath),
      this.buildPortableFindScopeClause(options),
      `! -path ${shellQuote(options.scopePath)}`,
      this.buildNameFindClause(options),
      '\\( -type f -exec printf',
      shellQuote('F\\t%s\\n'),
      '{} \\;',
      '-o -type d -exec printf',
      shellQuote('D\\t%s\\n'),
      '{} \\; \\)'
    ].filter(Boolean).join(' ');
  }

  private buildSftpContentSearchCommand(options: RemoteSearchOptions): string {
    const grepFlags = ['-n', '-F'];
    if (!options.caseSensitive) {
      grepFlags.push('-i');
    }

    return [
      'find',
      shellQuote(options.scopePath),
      this.buildPortableFindScopeClause(options),
      '-type f',
      this.buildNameFindClause(options),
      '-exec grep',
      grepFlags.join(' '),
      shellQuote(options.textToFind),
      '/dev/null',
      '{} \\;'
    ].filter(Boolean).join(' ');
  }

  private buildPortableFindScopeClause(options: RemoteSearchOptions): string {
    const clauses: string[] = [];

    if (!options.includeSubdirectories) {
      clauses.push(`\\( ! -path ${shellQuote(options.scopePath)} -type d -prune \\) -o`);
    }

    if (!options.includeHiddenFiles) {
      clauses.push(`\\( ! -path ${shellQuote(options.scopePath)} -name ${shellQuote('.*')} -prune \\) -o`);
    }

    return clauses.join(' ');
  }

  private buildNameFindClause(options: RemoteSearchOptions): string {
    const patterns = this.splitPatterns(options.fileName || '*')
      .map(pattern => options.caseSensitive ? pattern : this.toPortableCaseInsensitiveFindPattern(pattern));
    const clauses = patterns.map(pattern => `-name ${shellQuote(pattern)}`);

    if (clauses.length === 1) {
      return clauses[0];
    }

    return `\\( ${clauses.join(' -o ')} \\)`;
  }

  private toPortableCaseInsensitiveFindPattern(pattern: string): string {
    return String(pattern || '*').replace(/[A-Za-z]/g, value => {
      const lower = value.toLowerCase();
      const upper = value.toUpperCase();
      return lower === upper ? value : `[${lower}${upper}]`;
    });
  }

  private consumeSftpLine(connectionId: string, line: string, contentSearch: boolean): void {
    if (!line) {
      return;
    }

    if (!contentSearch) {
      const typedMatch = line.match(/^([FD])\t(.*)$/);
      if (typedMatch) {
        this.addResult(connectionId, {
          path: normalizeRemotePath(typedMatch[2]),
          type: typedMatch[1] === 'D' ? 'directory' : 'file'
        });
        return;
      }

      this.addResult(connectionId, { path: normalizeRemotePath(line), type: 'file' });
      return;
    }

    const match = line.match(/^(.*?):(\d+):(.*)$/);
    if (!match) {
      return;
    }

    this.addResult(connectionId, {
      path: normalizeRemotePath(match[1]),
      type: 'file',
      line: Number(match[2]),
      text: match[3]
    });
  }

  private consumeWindowsSftpLine(connectionId: string, line: string, contentSearch: boolean): void {
    if (!line) {
      return;
    }

    if (!contentSearch) {
      const typedMatch = line.match(/^([FD])\t(.*)$/);
      if (!typedMatch) {
        return;
      }

      this.addResult(connectionId, {
        path: normalizeRemotePathForPlatform(typedMatch[2], 'windows'),
        type: typedMatch[1] === 'D' ? 'directory' : 'file'
      });
      return;
    }

    const parts = line.split('\t');
    if (parts.length < 3) {
      return;
    }

    this.addResult(connectionId, {
      path: normalizeRemotePathForPlatform(parts[0], 'windows'),
      type: 'file',
      line: Number(parts[1]),
      text: parts.slice(2).join('\t')
    });
  }

  private async runFtpSearch(options: RemoteSearchOptions, token: vscode.CancellationToken): Promise<void> {
    const patterns = this.splitPatterns(options.fileName || '*');
    await this.walkFtpDirectory(options.connectionId, options.scopePath, options.includeSubdirectories, options.includeHiddenFiles, patterns, options.caseSensitive, token);
  }

  private async walkFtpDirectory(
    connectionId: string,
    directoryPath: string,
    recursive: boolean,
    includeHiddenFiles: boolean,
    patterns: string[],
    caseSensitive: boolean,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      return;
    }

    const entries = await this.sessions.listDirectory(connectionId, directoryPath, { forceRefresh: true });

    for (const entry of entries) {
      if (token.isCancellationRequested) {
        return;
      }

      if (entry.name === '.' || entry.name === '..') {
        continue;
      }

      if (!includeHiddenFiles && this.isHiddenEntry(entry)) {
        continue;
      }

      const effectiveType = entry.effectiveType || entry.type;
      if ((effectiveType === 'file' || effectiveType === 'directory') && this.matchesAnyPattern(entry.name, patterns, caseSensitive)) {
        this.addResult(connectionId, {
          path: normalizeRemotePath(entry.path),
          type: effectiveType === 'directory' ? 'directory' : 'file'
        });
      }

      if (recursive && effectiveType === 'directory') {
        await this.walkFtpDirectory(connectionId, entry.path, recursive, includeHiddenFiles, patterns, caseSensitive, token);
      }
    }
  }

  private addResult(connectionId: string, result: RemoteSearchResult): void {
    const snapshot = this.getMutableSnapshot(connectionId);
    if (snapshot.status !== 'running') {
      return;
    }
    snapshot.totalResults += 1;
    snapshot.results.push(result);
    this.events.onResult(result, {
      connectionId: snapshot.connectionId,
      status: snapshot.status,
      searchId: snapshot.id,
      totalResults: snapshot.totalResults
    });
  }

  private isHiddenEntry(entry: RemoteEntry): boolean {
    return String(entry.name || '').startsWith('.') || String(entry.path || '').split('/').some(part => part.startsWith('.') && part.length > 1);
  }

  private splitPatterns(value: string): string[] {
    const patterns = String(value || '*')
      .split(',')
      .map(pattern => pattern.trim())
      .filter(Boolean);

    return patterns.length ? patterns : ['*'];
  }

  private matchesAnyPattern(name: string, patterns: string[], caseSensitive: boolean): boolean {
    return patterns.some(pattern => this.wildcardToRegExp(pattern, caseSensitive).test(name));
  }

  private wildcardToRegExp(pattern: string, caseSensitive: boolean): RegExp {
    const escaped = String(pattern || '*')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, caseSensitive ? '' : 'i');
  }

  private normalizeOptions(options: RemoteSearchOptions): RemoteSearchOptions {
    const connectionId = String(options.connectionId || '').trim();
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;
    return {
      connectionId,
      connectionType: String(options.connectionType || 'sftp').toLowerCase(),
      scopePath: normalizeRemotePathForPlatform(options.scopePath || '/', connection?.remotePlatform || 'posix'),
      includeSubdirectories: Boolean(options.includeSubdirectories),
      includeHiddenFiles: Boolean(options.includeHiddenFiles),
      caseSensitive: Boolean(options.caseSensitive),
      fileName: String(options.fileName || '').trim() || '*',
      searchInsideFiles: Boolean(options.searchInsideFiles),
      textToFind: String(options.textToFind || ''),
      useSudo: Boolean(options.useSudo) && !isWindowsRemotePlatform(connection?.remotePlatform)
    };
  }

  private validateOptions(options: RemoteSearchOptions): void {
    if (!options.connectionId || !this.sessions.hasConnection(options.connectionId)) {
      throw new Error('Connect to a host before searching.');
    }

    if (options.connectionType !== 'sftp' && options.searchInsideFiles) {
      throw new Error('Content search requires an SSH/SFTP connection.');
    }

    if (options.connectionType !== 'sftp' && options.useSudo) {
      throw new Error('Sudo search requires an SSH/SFTP connection.');
    }

    if (options.searchInsideFiles && !options.textToFind) {
      throw new Error('Enter text to find.');
    }
  }

  private getMutableSnapshot(connectionId: string, connectionType: RemoteSearchProtocol = 'sftp'): RemoteSearchSnapshot {
    const normalizedConnectionId = String(connectionId || '').trim();
    const existing = this.snapshots.get(normalizedConnectionId);
    if (existing) {
      return existing;
    }

    const snapshot = this.createIdleSnapshot(normalizedConnectionId, connectionType);
    this.snapshots.set(normalizedConnectionId, snapshot);
    return snapshot;
  }

  private createIdleSnapshot(connectionId = '', connectionType: RemoteSearchProtocol = 'sftp'): RemoteSearchSnapshot {
    return {
      id: '',
      status: 'idle',
      connectionId,
      connectionType,
      options: {
        connectionId,
        connectionType,
        scopePath: '/',
        includeSubdirectories: true,
        includeHiddenFiles: false,
        caseSensitive: false,
        fileName: '*',
        searchInsideFiles: false,
        textToFind: '',
        useSudo: false
      },
      results: [],
      totalResults: 0
    };
  }

  private cloneSnapshot(snapshot: RemoteSearchSnapshot): RemoteSearchSnapshot {
    return {
      ...snapshot,
      options: { ...snapshot.options },
      results: snapshot.results.map(result => ({ ...result }))
    };
  }

  private createSearchId(): string {
    return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
