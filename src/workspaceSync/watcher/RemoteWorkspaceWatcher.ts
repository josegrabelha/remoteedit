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
  private ticking = false;
  private disposed = false;
  private readonly lastErrors = new Map<string, string>();
  private readonly diagnostics: WorkspaceSyncDiagnostics;

  constructor(
    private readonly onPoll: (request: WorkspaceRemoteWatchPoll) => Promise<void>,
    private readonly output: vscode.OutputChannel,
    private readonly onError?: (request: WorkspaceRemoteWatchPoll, message: string) => void,
    private readonly intervalMs = DEFAULT_REMOTE_WATCH_INTERVAL_MS
  ) {
    this.diagnostics = createWorkspaceSyncDiagnostics(output);
  }

  refresh(mappings: WorkspaceSyncMapping[]): void {
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
    if (this.ticking) {
      this.diagnostics.debug('Remote Watch', 'Polling tick skipped because the previous tick is still running.');
      return;
    }
    const tickTimer = this.diagnostics.timer();
    this.ticking = true;
    try {
      // Process all watched targets sequentially. Different mappings may intentionally
      // share or overlap Local Roots, so concurrent Remote -> Local writes would
      // be unsafe and could hide a real cross-mapping/target conflict.
      for (const mapping of this.mappings) {
        if (!mapping.options.watchRemoteChanges || mapping.options.direction === 'localToRemote') continue;
        for (const target of mapping.targets) {
          if (!target.enabled) continue;
          const key = `${mapping.id}::${target.id}`;
          try {
            await this.onPoll({ mappingId: mapping.id, targetId: target.id });
            this.lastErrors.delete(key);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (this.lastErrors.get(key) === message) continue;
            this.lastErrors.set(key, message);
            this.output.appendLine(`[Workspace Sync] Remote Watch failed for ${mapping.name} / ${target.name}: ${message}`);
            this.onError?.({ mappingId: mapping.id, targetId: target.id }, message);
          }
        }
      }
    } finally {
      this.ticking = false;
      this.diagnostics.performance('Remote Watch', `Polling scheduler tick completed in ${tickTimer()} ms.`, { Mappings: this.mappings.length });
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
