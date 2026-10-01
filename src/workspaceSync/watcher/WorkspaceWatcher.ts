import * as path from 'path';
import * as vscode from 'vscode';
import type { WorkspaceSyncMapping } from '../types';
import { mergeLocalChangeSource, type WorkspaceLocalChangeSource } from './WatcherCoalescing';
import { canonicalRelativePath, normalizeRelativePath } from '../snapshot/SyncSnapshot';
import type { WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';
import { createWorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnosticsFactory';

export type WorkspaceLocalChangeKind = 'create' | 'change' | 'delete';

export interface WorkspaceLocalChange {
  mappingId: string;
  /** Canonical NFC path used as the logical Workspace Sync identity. */
  relativePath: string;
  /** Exact Local filesystem spelling used for I/O. */
  physicalRelativePath: string;
  absolutePath: string;
  kind: WorkspaceLocalChangeKind;
  source: WorkspaceLocalChangeSource;
}

export class WorkspaceWatcher implements vscode.Disposable {
  private readonly mappingWatchers = new Map<string, { root: string; subscriptions: vscode.Disposable[] }>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingChanges = new Map<string, WorkspaceLocalChange>();
  private disposed = false;
  private mappings: WorkspaceSyncMapping[] = [];
  private saveSubscription: vscode.Disposable | undefined;
  private readonly diagnostics: WorkspaceSyncDiagnostics;

  constructor(
    private readonly onChange: (change: WorkspaceLocalChange) => Promise<void>,
    private readonly output: vscode.OutputChannel
  ) {
    this.diagnostics = createWorkspaceSyncDiagnostics(output);
  }

  refresh(mappings: WorkspaceSyncMapping[]): void {
    if (this.disposed) return;
    // Preserve live subscriptions and pending debounce events for unchanged
    // mappings. Opening a different mapping must not discard filesystem changes.
    const desired = new Map(mappings
      .filter(mapping => mapping.options.watchLocalChanges)
      .map(mapping => [mapping.id, mapping]));
    for (const [mappingId, registration] of this.mappingWatchers) {
      const mapping = desired.get(mappingId);
      if (mapping && mapping.localRoot === registration.root) continue;
      registration.subscriptions.forEach(item => item.dispose());
      this.mappingWatchers.delete(mappingId);
      this.clearScheduledChanges(mappingId);
    }
    this.mappings = mappings;
    this.refreshSaveSubscription();
    for (const mapping of desired.values()) {
      if (this.mappingWatchers.has(mapping.id)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(mapping.localRoot, '**/*'));
      this.mappingWatchers.set(mapping.id, {
        root: mapping.localRoot,
        subscriptions: [
          watcher,
          watcher.onDidCreate(uri => this.schedule(mapping, uri.fsPath, 'create', 'watcher')),
          watcher.onDidChange(uri => this.schedule(mapping, uri.fsPath, 'change', 'watcher')),
          watcher.onDidDelete(uri => this.schedule(mapping, uri.fsPath, 'delete', 'watcher'))
        ]
      });
    }
    this.diagnostics.debug('Local Watch', 'Filesystem watcher registrations refreshed.', {
      Mappings: mappings.length,
      WatchLocalMappings: desired.size,
      UploadOnSaveMappings: mappings.filter(mapping => mapping.options.uploadOnSave).length
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mappings = [];
    this.disposeWatchers();
    this.saveSubscription?.dispose();
    this.saveSubscription = undefined;
    this.clearScheduledChanges();
  }


  private refreshSaveSubscription(): void {
    const enabled = this.mappings.some(mapping => mapping.options.uploadOnSave);
    if (!enabled) {
      this.saveSubscription?.dispose();
      this.saveSubscription = undefined;
      return;
    }
    if (this.saveSubscription) return;
    this.saveSubscription = vscode.workspace.onDidSaveTextDocument(document => {
      for (const mapping of this.mappings) {
        if (!mapping.options.uploadOnSave || !isWithinRoot(mapping.localRoot, document.uri.fsPath)) continue;
        this.schedule(mapping, document.uri.fsPath, 'change', 'save');
      }
    });
  }

  private schedule(
    mapping: WorkspaceSyncMapping,
    absolutePath: string,
    kind: WorkspaceLocalChangeKind,
    source: Exclude<WorkspaceLocalChangeSource, 'both'>
  ): void {
    if (this.disposed || !isWithinRoot(mapping.localRoot, absolutePath)) return;
    if (/\.remoteedit-[^/\\]+\.tmp$/i.test(absolutePath)) return;

    const physicalRelativePath = normalizeRelativePath(path.relative(mapping.localRoot, absolutePath));
    if (!physicalRelativePath || physicalRelativePath.startsWith('../')) return;
    const relativePath = canonicalRelativePath(physicalRelativePath);
    const key = `${mapping.id}:${relativePath}`;
    const previous = this.debounceTimers.get(key);
    if (previous) clearTimeout(previous);
    const existing = this.pendingChanges.get(key);
    const merged: WorkspaceLocalChange = {
      mappingId: mapping.id,
      relativePath,
      physicalRelativePath,
      absolutePath,
      kind,
      source: mergeLocalChangeSource(existing?.source, source)
    };
    this.diagnostics.debug('Local Watch', existing ? 'Coalesced local filesystem event.' : 'Scheduled local filesystem event.', {
      Mapping: mapping.name,
      Path: relativePath,
      Kind: kind,
      Source: merged.source
    });
    this.pendingChanges.set(key, merged);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const change = this.pendingChanges.get(key);
      this.pendingChanges.delete(key);
      if (!change) return;
      this.diagnostics.debug('Local Watch', 'Debounced local filesystem event released.', { Mapping: mapping.name, Path: change.relativePath, Kind: change.kind, Source: change.source });
      void this.onChange(change).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[Workspace Sync] Automatic sync failed for ${relativePath}: ${message}`);
      });
    }, 300);
    this.debounceTimers.set(key, timer);
  }


  private clearScheduledChanges(mappingId?: string): void {
    for (const [key, timer] of this.debounceTimers) {
      if (mappingId && !key.startsWith(`${mappingId}:`)) continue;
      clearTimeout(timer);
      this.debounceTimers.delete(key);
      this.pendingChanges.delete(key);
    }
  }

  private disposeWatchers(): void {
    for (const registration of this.mappingWatchers.values()) {
      registration.subscriptions.forEach(item => item.dispose());
    }
    this.mappingWatchers.clear();
  }

}

function isWithinRoot(root: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
