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
  private readonly mappingWatchers: vscode.Disposable[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingChanges = new Map<string, WorkspaceLocalChange>();
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
    this.disposeWatchers();
    // A mapping can change Local Root while a debounced event from the old
    // root is still pending. Never let that stale relative path execute
    // against the new mapping context.
    this.clearScheduledChanges();
    this.mappings = mappings;
    this.diagnostics.debug('Local Watch', 'Filesystem watcher registrations refreshed.', {
      Mappings: mappings.length,
      WatchLocalMappings: mappings.filter(mapping => mapping.options.watchLocalChanges).length,
      UploadOnSaveMappings: mappings.filter(mapping => mapping.options.uploadOnSave).length
    });
    this.refreshSaveSubscription();
    for (const mapping of mappings) {
      if (!mapping.options.watchLocalChanges) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(mapping.localRoot, '**/*'));
      this.mappingWatchers.push(
        watcher,
        watcher.onDidCreate(uri => this.schedule(mapping, uri.fsPath, 'create', 'watcher')),
        watcher.onDidChange(uri => this.schedule(mapping, uri.fsPath, 'change', 'watcher')),
        watcher.onDidDelete(uri => this.schedule(mapping, uri.fsPath, 'delete', 'watcher'))
      );
    }
  }

  dispose(): void {
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
    if (!isWithinRoot(mapping.localRoot, absolutePath)) return;
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


  private clearScheduledChanges(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.pendingChanges.clear();
  }

  private disposeWatchers(): void {
    while (this.mappingWatchers.length) this.mappingWatchers.pop()?.dispose();
  }
}

function isWithinRoot(root: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
