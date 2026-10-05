import { randomUUID } from 'crypto';
import { RemoteSearchService, type RemoteSearchOptions, type RemoteSearchResult } from '../search/RemoteSearchService';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type * as vscode from 'vscode';

export type SearchQuery = Pick<RemoteSearchOptions, 'fileName' | 'textToFind' | 'includeSubdirectories' | 'includeHiddenFiles' | 'caseSensitive' | 'searchInsideFiles' | 'useSudo'>;
export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  fileName: '*', textToFind: '', includeSubdirectories: true,
  includeHiddenFiles: false, caseSensitive: false, searchInsideFiles: false, useSudo: false
};
export function normalizeSearchQuery(value: Partial<SearchQuery> = {}): SearchQuery {
  return {
    fileName: typeof value.fileName === 'string' ? value.fileName : '*',
    textToFind: typeof value.textToFind === 'string' ? value.textToFind : '',
    includeSubdirectories: value.includeSubdirectories !== false,
    includeHiddenFiles: value.includeHiddenFiles === true,
    caseSensitive: value.caseSensitive === true,
    searchInsideFiles: value.searchInsideFiles === true,
    useSudo: value.useSudo === true
  };
}
export interface SearchTarget { connectionId: string; name: string; workingDirectory: string; }
export interface SearchExecution extends SearchTarget {
  batchId: string; commandId: string; status: 'Pending' | 'Running' | 'Finished' | 'Failed' | 'Stopped';
  startedAt?: number; finishedAt?: number; error?: string; results: RemoteSearchResult[];
}
const active = (item: SearchExecution) => item.status === 'Pending' || item.status === 'Running';

/** Owns a search run independently of the webview; only the existing engine executes searches. */
export class SearchBatch {
  readonly id = randomUUID();
  readonly executions: SearchExecution[];
  private readonly service: RemoteSearchService;
  private started = false;
  constructor(targets: SearchTarget[], readonly query: SearchQuery, private readonly sessions: RemoteSessionManager,
    output: vscode.OutputChannel | undefined, private readonly changed: (item: SearchExecution) => void,
    private readonly concurrency = 5, private readonly prepareTarget?: (target: SearchExecution) => Promise<void>,
    private readonly withTarget: (id: string, launch: () => Promise<{ completion: Promise<void> }>) => Promise<{ completion: Promise<void> }> = (_id, launch) => launch()) {
    this.executions = targets.map(target => ({ ...target, batchId: this.id, commandId: randomUUID(), status: 'Pending', results: [] }));
    this.service = new RemoteSearchService(sessions, output, {
      onStarted: () => undefined,
      onResult: (result, meta) => {
        const item = this.executions.find(item => item.connectionId === meta.connectionId);
        if (!item || item.status !== 'Running') return;
        item.results.push(result); this.changed(item);
      },
      onFinished: () => undefined
    });
  }
  stop(commandId?: string): void {
    for (const item of this.executions) {
      if ((!commandId || item.commandId === commandId) && active(item)) {
        item.status = 'Stopped'; item.finishedAt = Date.now();
        this.service.cancel(item.connectionId); this.changed(item);
      }
    }
  }
  connectionClosed(connectionId: string): void {
    const item = this.executions.find(item => item.connectionId === connectionId);
    if (!item || !active(item)) return;
    item.status = 'Failed'; item.error = 'Connection closed during search. Connect explicitly before retrying.';
    item.finishedAt = Date.now(); this.service.cancel(connectionId); this.changed(item);
  }
  async run(): Promise<void> {
    if (this.started) throw new Error('This search batch has already started.');
    this.started = true;
    let next = 0;
    const worker = async () => {
      while (next < this.executions.length) {
        const item = this.executions[next++];
        if (!active(item)) continue;
        item.startedAt = Date.now(); item.status = 'Running'; this.changed(item);
        try {
          const { completion } = await this.withTarget(item.connectionId, async () => {
            if (!active(item)) return { completion: Promise.resolve() };
            const connection = this.sessions.getConnection(item.connectionId);
            if (!connection) throw new Error('Target disconnected. Connect explicitly before searching.');
            await this.prepareTarget?.(item);
            if (!active(item)) return { completion: Promise.resolve() };
            return { completion: this.service.start({ ...this.query, connectionId: item.connectionId, connectionType: 'sftp',
              scopePath: item.workingDirectory || connection.startPath || '/', useSudo: this.query.useSudo }) };
          });
          await completion;
          if (item.status !== 'Running') continue;
          const snapshot = this.service.getSnapshot(item.connectionId);
          item.status = snapshot.status === 'failed' ? 'Failed' : snapshot.status === 'cancelled' ? 'Stopped' : 'Finished';
          item.error = snapshot.error;
        } catch (error) {
          if (item.status === 'Running') { item.status = 'Failed'; item.error = error instanceof Error ? error.message : String(error); }
        } finally { item.finishedAt ??= Date.now(); this.changed(item); }

      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, this.concurrency), this.executions.length) }, worker));
  }
}

export function formatSearchResults(results: RemoteSearchResult[]): string {
  if (!results.some(result => result.line !== undefined)) return results.map(result => result.path).join('\n');
  const groups = new Map<string, RemoteSearchResult[]>();
  for (const result of results) {
    const group = groups.get(result.path) || []; group.push(result); groups.set(result.path, group);
  }
  return [...groups].map(([path, matches]) => `${path} (${matches.length} ${matches.length === 1 ? 'match' : 'matches'})\n${matches.map(match => `  ${match.line || ''}: ${match.text || ''}`).join('\n')}`).join('\n\n');
}
