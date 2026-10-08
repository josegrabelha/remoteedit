import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionImportService } from '../connectionImport/ConnectionImportService';
import {
  sourceNames,
  type SourceId
} from '../connectionImport/ConnectionImportTypes';
import { RemoteEditOutboundMessageType } from './PanelMessages';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
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
    private readonly refresh: () => Promise<void>,
    private readonly output: vscode.OutputChannel
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
    const action = ['close', 'detect', 'choose', 'review', 'unlock', 'skipUnlock', 'apply'].includes(payload?.action)
      ? payload.action as string : 'unknown';
    const elapsed = createPerformanceTimer();
    let outcome = 'completed';
    appendDebugLog(this.output, 'ConnectionImport', 'Action started.', { Action: action });
    try {
      switch (payload?.action) {
        case 'close':
          this.service.clear();
          appendDebugLog(this.output, 'ConnectionImport', 'Import session cleared.');
          return;
        case 'detect': {
          const sources = await this.service.detect(
            (vscode.workspace.workspaceFolders || [])
              .filter((f) => f.uri.scheme === 'file')
              .map((f) => f.uri.fsPath)
          );
          this.post('connectionImportState', {
            stage: 'sources',
            sources
          });
          this.logSourceSummary(sources);
          break;
        }
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
            outcome = 'cancelled';
            this.post('connectionImportState', { cancelled: true });
            break;
          }
          const sources = await this.service.load(id, chosen.map((u) => u.fsPath));
          this.post('connectionImportState', {
            stage: 'sources',
            sources
          });
          const source = sources.find((item) => item.id === id);
          appendDebugLog(this.output, 'ConnectionImport', 'Manual source loading completed.', {
            Source: id, Files: chosen.length, Candidates: source?.count ?? 0,
            FileFailures: Boolean(source?.error)
          });
          break;
        }
        case 'review': {
          if (
            !Array.isArray(payload.sources) ||
            payload.sources.some((id: any) => !Object.hasOwn(sourceNames, id))
          )
            throw new Error();
          const candidates = await this.service.preview(payload.sources);
          this.post('connectionImportState', {
            stage: 'review',
            candidates
          });
          appendDebugLog(this.output, 'ConnectionImport', 'Review prepared.', {
            Sources: payload.sources.length, Candidates: candidates.length,
            Conflicts: candidates.filter((item) => item.status === 'Conflict').length,
            Unsupported: candidates.filter((item) => item.status === 'Unsupported').length,
            Warnings: candidates.filter((item) => item.status === 'Warning').length
          });
          break;
        }
        case 'unlock': {
          const unlocked = this.service.unlock(
            payload.id,
            payload.password,
            payload.batch === true
          );
          this.post('connectionImportState', { unlocked });
          appendDebugLog(this.output, 'ConnectionImport', 'Protected credentials unlocked.', {
            Connections: unlocked.length, Batch: payload.batch === true
          });
          break;
        }
        case 'skipUnlock': {
          // Skipping a batch group is only a UI decision; never mutate the
          // protected credential or discard candidates on the backend.
          const skippedUnlockGroup = this.service.unlockGroupIds(payload.id);
          this.post('connectionImportState', { skippedUnlockGroup });
          appendDebugLog(this.output, 'ConnectionImport', 'Credential unlock skipped.', {
            Connections: skippedUnlockGroup.length
          });
          break;
        }
        case 'apply': {
          appendDebugLog(this.output, 'ConnectionImport', 'Import requested.', {
            Selected: Array.isArray(payload.decisions) ? payload.decisions.length : 0,
            ImportAsNew: Array.isArray(payload.decisions) ? payload.decisions.filter((d: any) => d?.action === 'new').length : 0,
            Replace: Array.isArray(payload.decisions) ? payload.decisions.filter((d: any) => d?.action === 'replace').length : 0
          });
          const result = await this.service.apply(
            payload.decisions,
            payload.acknowledgeCredentialRisk === true
          );
          await this.refresh();
          this.post('connectionImportState', { stage: 'result', result });
          appendDebugLog(this.output, 'ConnectionImport', 'Import completed.', {
            Imported: result.imported, Skipped: result.skipped, Failed: result.failed,
            WithCredentials: result.credentials, WithWarnings: result.warnings
          });
          break;
        }
        default:
          throw new Error();
      }
    } catch (error) {
      outcome = 'failed';
      // Never log parser/OS errors, paths, profile names, or credential values.
      // Import errors can contain sensitive source data even when the UI uses
      // an intentionally authored, safe message.
      appendDebugLog(this.output, 'ConnectionImport', 'Action failed.', { Action: action });
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
      appendPerformanceLog(this.output, 'ConnectionImport', 'Action finished.', {
        Action: action, Outcome: outcome, Duration: `${elapsed()}ms`
      });
      this.busy = false;
    }
  }

  private logSourceSummary(sources: Awaited<ReturnType<ConnectionImportService['detect']>>): void {
    for (const source of sources) {
      appendDebugLog(this.output, 'ConnectionImport', 'Source detection completed.', {
        Source: source.id, Status: source.status, Files: source.paths.length,
        Candidates: source.count, FileFailures: Boolean(source.error)
      });
    }
  }
}
