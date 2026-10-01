import * as vscode from 'vscode';
import type { WorkspaceSyncMapping } from '../types';
import type { WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';
import { createWorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnosticsFactory';

export interface WorkspaceRemoteWatchPoll {
  mappingId: string;
  targetId: string;
}

const DEFAULT_REMOTE_WATCH_INTERVAL_MS = 5000;

/**
 * Schedules Remote Watch polling without owning protocol sessions. The
 * controller remains responsible for deciding whether a target is connected,
 * scanning it, resolving conflicts, and applying safe Remote -> Local changes.
 */
export class RemoteWorkspaceWatcher implements vscode.Disposable {
  private mappings: WorkspaceSyncMapping[] = [];
  private timer: NodeJS.Timeout | undefined;
  private readonly polling = new Set<string>();
  private disposed = false;
  private readonly lastErrors = new Map<string, string>();
  private readonly diagnostics: WorkspaceSyncDiagnostics;

  constructor(
    private readonly onPoll: (request: WorkspaceRemoteWatchPoll) => Promise<void>,
    private readonly output: vscode.OutputChannel,
    private readonly onError?: (request: WorkspaceRemoteWatchPoll, message: string) => boolean | void,
    private readonly intervalMs = DEFAULT_REMOTE_WATCH_INTERVAL_MS
  ) {
    this.diagnostics = createWorkspaceSyncDiagnostics(output);
  }

  refresh(mappings: WorkspaceSyncMapping[]): void {
    if (this.disposed) return;
    this.mappings = mappings;
    const enabled = mappings.some(mapping =>
      mapping.options.watchRemoteChanges
      && mapping.options.direction !== 'localToRemote'
      && mapping.targets.some(target => target.enabled)
    );

    if (!enabled) {
      this.diagnostics.debug('Remote Watch', 'Polling scheduler disabled.', { Mappings: mappings.length });
      this.stopTimer();
      this.lastErrors.clear();
      return;
    }
    if (!this.timer) {
      this.diagnostics.debug('Remote Watch', 'Polling scheduler enabled.', { Mappings: mappings.length, IntervalMs: this.intervalMs });
      this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.mappings = [];
    this.lastErrors.clear();
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    const polls: Promise<void>[] = [];
    for (const mapping of this.mappings) {
      if (!mapping.options.watchRemoteChanges || mapping.options.direction === 'localToRemote') continue;
      for (const target of mapping.targets) {
        if (this.disposed) return;
        if (!target.enabled) continue;
        const key = `${mapping.id}::${target.id}`;
        // One outstanding poll per target, including time in its operation
        // queue. A slow target must not hold the scheduler for every mapping.
        // The controller's endpoint/path locks still protect shared roots.
        if (this.polling.has(key)) continue;
        this.polling.add(key);
        polls.push(this.poll(mapping, target, key));
      }
    }
    await Promise.all(polls);
  }

  private async poll(mapping: WorkspaceSyncMapping, target: WorkspaceSyncMapping['targets'][number], key: string): Promise<void> {
    const timer = this.diagnostics.timer();
    try {
      await this.onPoll({ mappingId: mapping.id, targetId: target.id });
      this.lastErrors.delete(key);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      if (this.lastErrors.get(key) === message) return;
      this.lastErrors.set(key, message);
      const handled = this.onError?.({ mappingId: mapping.id, targetId: target.id }, message) === true;
      if (!handled) this.output.appendLine(`[Workspace Sync] Remote Watch failed for ${mapping.name} / ${target.name}: ${message}`);
    } finally {
      this.polling.delete(key);
      this.diagnostics.performance('Remote Watch', `Target poll completed in ${timer()} ms.`, { Mapping: mapping.name, Target: target.name });
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
