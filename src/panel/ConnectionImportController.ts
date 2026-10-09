import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionImportService } from '../connectionImport/ConnectionImportService';
import {
  sourceNames,
  type SourceId
} from '../connectionImport/ConnectionImportTypes';
import { RemoteEditOutboundMessageType } from './PanelMessages';
export class ConnectionImportController {
  private readonly service: ConnectionImportService;
  private busy = false;
  private disposed = false;
  constructor(
    manager: ConnectionManager,
    private readonly post: (
      type: typeof RemoteEditOutboundMessageType.ConnectionImportState,
      payload: any
    ) => void,
    private readonly refresh: () => Promise<void>
  ) {
    this.service = new ConnectionImportService(manager);
  }
  dispose(): void {
    this.disposed = true;
    this.service.clear();
  }
  async handle(payload: any): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      switch (payload?.action) {
        case 'close':
          this.service.clear();
          return;
        case 'detect':
          this.post('connectionImportState', {
            stage: 'sources',
            sources: await this.service.detect(
              (vscode.workspace.workspaceFolders || [])
                .filter((f) => f.uri.scheme === 'file')
                .map((f) => f.uri.fsPath)
            )
          });
          break;
        case 'choose': {
          const id = payload.source as SourceId;
          if (!Object.hasOwn(sourceNames, id)) throw new Error();
          const filters: Partial<Record<SourceId, Record<string, string[]>>> = {
            filezilla: { 'FileZilla XML': ['xml'] },
            winscp: { 'WinSCP INI': ['ini'] },
            sshfs: { 'VS Code settings': ['json', 'jsonc', 'code-workspace'] },
            sftp: { 'SFTP config': ['json', 'jsonc'] }
          };
          const chosen = await vscode.window.showOpenDialog({
            title: `Import ${sourceNames[id]} Connections`,
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: filters[id]
          });
          if (!chosen) {
            this.post('connectionImportState', { cancelled: true });
            break;
          }
          this.post('connectionImportState', {
            stage: 'sources',
            sources: await this.service.load(
              id,
              chosen.map((u) => u.fsPath)
            )
          });
          break;
        }
        case 'review': {
          if (
            !Array.isArray(payload.sources) ||
            payload.sources.some((id: any) => !Object.hasOwn(sourceNames, id))
          )
            throw new Error();
          this.post('connectionImportState', {
            stage: 'review',
            candidates: await this.service.preview(payload.sources)
          });
          break;
        }
        case 'unlock': {
          const unlocked = this.service.unlock(
            payload.id,
            payload.password,
            payload.batch === true
          );
          this.post('connectionImportState', { unlocked, stillLocked: this.service.lockedCredentialIds() });
          break;
        }
        case 'skipUnlock': {
          // Skipping a batch group is only a UI decision; never mutate the
          // protected credential or discard candidates on the backend.
          this.post('connectionImportState', {
            skippedUnlockGroup: this.service.unlockGroupIds(payload.id)
          });
          break;
        }
        case 'apply': {
          const result = await this.service.apply(
            payload.decisions,
            payload.acknowledgeCredentialRisk === true
          );
          await this.refresh();
          this.post('connectionImportState', { stage: 'result', result });
          break;
        }
        default:
          throw new Error();
      }
    } catch (error) {
      // Import service messages are intentionally authored without credentials
      // or source-file content; never display arbitrary parser/OS error values.
      const detail = error instanceof Error ? error.message : '';
      const safe = /^(Cannot import |Confirm import without protected credentials|Select no more than|Invalid import selection|Review the selected sources|A replacement target changed|Unsupported connections cannot be imported|Unknown import source|Import session closed)/.test(detail);
      const fallback: Record<string, string> = {
        detect: 'Could not detect connection sources. Check access to the application configuration folders, then try again.',
        choose: 'Could not load the selected configuration files. Check file permissions and format, then try again.',
        review: 'Could not prepare the selected connections. Return to Sources and try again.',
        apply: 'Could not complete the import. Review the selected connections, Jump Hosts and replacement targets, then retry.',
        unlock: 'Could not unlock the protected credentials. Check the external Master Password and try again.'
      };
      this.post('connectionImportState', {
        error: safe ? detail : fallback[payload?.action] || 'Could not process this import request. Check the configuration and try again.'
      });
    } finally {
      this.busy = false;
    }
  }
}
