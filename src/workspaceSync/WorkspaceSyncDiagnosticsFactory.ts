import type * as vscode from 'vscode';
import {
  appendDebugLog,
  appendPerformanceLog,
  createPerformanceTimer
} from '../utils/outputLogger';
import {
  sanitizeWorkspaceSyncDiagnosticDetails,
  type WorkspaceSyncDiagnostics
} from './WorkspaceSyncDiagnostics';

/**
 * VS Code-backed diagnostics factory.
 *
 * This module is intentionally separate from WorkspaceSyncDiagnostics so the
 * FTP/SFTP protocol sessions can be imported by pure Node tests without
 * loading the VS Code runtime through outputLogger/settingsUtils.
 */
export function createWorkspaceSyncDiagnostics(output: vscode.OutputChannel | undefined): WorkspaceSyncDiagnostics {
  return {
    debug(source, message, details) {
      appendDebugLog(output, diagnosticSource(source), message, sanitizeWorkspaceSyncDiagnosticDetails(details));
    },
    performance(source, message, details) {
      appendPerformanceLog(output, diagnosticSource(source), message, sanitizeWorkspaceSyncDiagnosticDetails(details));
    },
    timer: createPerformanceTimer
  };
}

function diagnosticSource(source: string): string {
  const suffix = String(source || '').trim();
  return suffix ? `Workspace Sync ${suffix}` : 'Workspace Sync';
}
