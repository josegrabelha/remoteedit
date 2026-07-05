import * as vscode from 'vscode';
import { isWindowsRemotePlatform } from '../../remote/RemotePlatform';
import type { RemoteSessionManager } from '../../remote/RemoteSessionManager';
import { shellQuote } from '../../utils/shellUtils';
import type { OutputLogDetails } from '../../utils/outputLogger';
import { RemoteEditOutboundMessageType } from '../PanelMessages';
import type { ConfirmDialogOptions } from '../PanelTypes';
import { buildFallbackServerSystemInfo, buildServerDashboardSnapshot, buildServerDashboardSnapshotCommand, createUnavailableServerOverview, parseServerDashboardSnapshotOutput } from './ServerDashboardModel';
import { buildWindowsServerDashboardSnapshotCommand } from './WindowsServerDashboardSnapshotCommand';
import type { ServerDashboardProcessItem } from './ServerDashboardTypes';
import { buildServerProcessActionSnapshot, buildServerProcessKillCommand, buildServerServiceActionCommand, buildServerServiceDetailsCommand, buildWindowsScheduledTaskDetailsCommand, formatServerServiceActionLabel, normalizeServerCommandOutput, parseServerProcessKillOutput } from './ServerDashboardCommandUtils';

interface ServerManagementControllerOptions {
  sessions: RemoteSessionManager;
  virtualDocuments: Map<string, string>;
  getActiveConnectionId(): string | undefined;
  postMessage(type: RemoteEditOutboundMessageType, payload: any): void;
  postServerStatus(message: string, isError?: boolean, durationMs?: number): void;
  showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
  openEntries(payload: any): Promise<void>;
  openEntriesReadOnly(payload: any): Promise<void>;
  logWarn(message: string, details?: OutputLogDetails): void;
  logDebug(message: string, details?: OutputLogDetails): void;
}

export class ServerManagementController {
  constructor(private readonly options: ServerManagementControllerOptions) {}

  async requestServerServiceDetails(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const serviceName = String(payload?.name || '').trim();
    const adapter = String(payload?.adapter || '').trim();

    if (!connectionId || !serviceName) {
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      await this.options.showConfirmDialog({
        title: 'Service Details',
        message: 'Service details are unavailable.',
        details: 'Server services require an active SSH/SFTP connection.',
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
      return;
    }

    const command = buildServerServiceDetailsCommand(adapter, serviceName);
    if (!command) {
      await this.options.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: `Adapter ${adapter || 'unknown'} does not support service details yet.`,
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
      return;
    }

    try {
      const result = await this.runServerManagementCommand(connectionId, command);
      const output = normalizeServerCommandOutput(result.stdout, result.stderr, result.code);
      await this.options.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: output || 'No details returned.',
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: message || 'Could not read service details.',
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
    }
  }

  async requestServerServiceAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const serviceName = String(payload?.name || '').trim();
    const adapter = String(payload?.adapter || '').trim();
    const action = String(payload?.action || '').trim().toLowerCase();

    if (!connectionId || !serviceName || !['start', 'stop', 'restart'].includes(action)) {
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.options.postServerStatus('Server services require an active SSH/SFTP connection.', true);
      return;
    }

    const command = buildServerServiceActionCommand(adapter, serviceName, action as 'start' | 'stop' | 'restart');
    if (!command) {
      await this.options.showConfirmDialog({
        title: 'Service action unavailable',
        message: serviceName,
        details: `Adapter ${adapter || 'unknown'} does not support ${action} yet.`,
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const label = formatServerServiceActionLabel(action);
    const confirmed = await this.options.showConfirmDialog({
      title: `${label} service?`,
      message: `${label} ${serviceName}?`,
      details: `Adapter: ${adapter || 'unknown'}\nService: ${serviceName}`,
      confirmLabel: label,
      cancelLabel: 'Cancel',
      danger: action === 'stop' || action === 'restart'
    });

    if (!confirmed) {
      return;
    }

    try {
      const result = await this.runServerManagementCommand(connectionId, command);
      if (result.code !== 0) {
        await this.options.showConfirmDialog({
          title: 'Service action failed',
          message: `${label} failed for ${serviceName}.`,
          details: normalizeServerCommandOutput(result.stdout, result.stderr, result.code),
          confirmLabel: 'OK',
          hideCancel: true
        });
        return;
      }

      await this.requestServerDashboard({ connectionId, requestId: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.showConfirmDialog({
        title: 'Service action failed',
        message: `${label} failed for ${serviceName}.`,
        details: message || 'Unknown error',
        confirmLabel: 'OK',
        hideCancel: true
      });
    }
  }

  async requestServerProcessDetails(payload: any): Promise<void> {
    const pid = String(payload?.pid || '').trim();
    if (!/^\d+$/.test(pid)) {
      return;
    }

    const details = [
      `PID: ${pid}`,
      `User: ${String(payload?.user || '—')}`,
      `CPU: ${String(payload?.cpu || '—')}`,
      `Memory: ${String(payload?.memory || '—')}`,
      `State: ${String(payload?.state || '—')}`,
      `Status: ${payload?.isZombie ? 'Zombie' : (payload?.state ? 'Normal' : 'Unknown')}`,
      `Command: ${String(payload?.command || '—')}`,
      `Args: ${String(payload?.args || '—')}`
    ].join('\n');

    await this.options.showConfirmDialog({
      title: 'Process Details',
      message: `PID ${pid}`,
      details,
      confirmLabel: 'OK',
      hideCancel: true,
      copyable: true
    });
  }

  async requestServerProcessAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const pid = String(payload?.pid || '').trim();
    const processSnapshot = buildServerProcessActionSnapshot(payload);

    if (!connectionId || !/^\d+$/.test(pid)) {
      return;
    }

    if (pid === '1') {
      await this.options.showConfirmDialog({
        title: 'Process action unavailable',
        message: 'PID 1 cannot be killed from Remote Edit.',
        details: 'Remote Edit blocks kill actions for PID 1 as a safety measure.',
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.options.postServerStatus('Process actions require an active SSH/SFTP connection.', true);
      return;
    }

    const confirmed = await this.options.showConfirmDialog({
      title: 'Kill process?',
      message: `Kill PID ${pid}?`,
      details: [
        `PID: ${pid}`,
        `User: ${processSnapshot.user}`,
        `Command: ${processSnapshot.command}`,
        '',
        processSnapshot.adapter === 'windows-process' ? 'This will stop the process on Windows.' : 'This will send SIGTERM to the process.'
      ].join('\n'),
      confirmLabel: 'Kill',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      return;
    }

    this.postServerProcessActionState(connectionId, pid, 'killing', processSnapshot);

    try {
      const termResult = await this.runServerManagementCommand(connectionId, buildServerProcessKillCommand(pid, false, processSnapshot.adapter));
      const termOutput = parseServerProcessKillOutput(termResult.stdout, termResult.stderr);

      if (!termOutput.stillRunning) {
        await this.finishServerProcessTerminated(connectionId, pid, processSnapshot);
        return;
      }

      if (termOutput.killRc !== 0) {
        this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
        await this.options.showConfirmDialog({
          title: 'Kill process failed',
          message: `Could not kill PID ${pid}.`,
          details: normalizeServerCommandOutput(termResult.stdout, termResult.stderr, termResult.code),
          confirmLabel: 'OK',
          hideCancel: true
        });
        await this.requestServerDashboard({ connectionId, requestId: '' });
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'still-running', processSnapshot);
      const forceConfirmed = await this.options.showConfirmDialog({
        title: 'Process is still running.',
        message: 'Force kill?',
        details: [
          `PID: ${pid}`,
          `User: ${processSnapshot.user}`,
          `Command: ${processSnapshot.command}`,
          '',
          processSnapshot.adapter === 'windows-process' ? 'This will force stop the process on Windows.' : 'This will send SIGKILL (kill -9). The process cannot clean up before exiting.'
        ].join('\n'),
        confirmLabel: 'Force Kill',
        cancelLabel: 'Cancel',
        danger: true
      });

      if (!forceConfirmed) {
        this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
        await this.requestServerDashboard({ connectionId, requestId: '' });
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'killing', processSnapshot);
      const forceResult = await this.runServerManagementCommand(connectionId, buildServerProcessKillCommand(pid, true, processSnapshot.adapter));
      const forceOutput = parseServerProcessKillOutput(forceResult.stdout, forceResult.stderr);

      if (!forceOutput.stillRunning) {
        await this.finishServerProcessTerminated(connectionId, pid, processSnapshot);
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
      await this.options.showConfirmDialog({
        title: 'Force kill failed',
        message: `PID ${pid} is still running or could not be killed.`,
        details: normalizeServerCommandOutput(forceResult.stdout, forceResult.stderr, forceResult.code),
        confirmLabel: 'OK',
        hideCancel: true
      });
      await this.requestServerDashboard({ connectionId, requestId: '' });
      return;
    } catch (error) {
      this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
      const message = error instanceof Error ? error.message : String(error);
      await this.options.showConfirmDialog({
        title: 'Kill process failed',
        message: `Could not kill PID ${pid}.`,
        details: message || 'Unknown error',
        confirmLabel: 'OK',
        hideCancel: true
      });
      await this.requestServerDashboard({ connectionId, requestId: '' });
    }
  }

  async requestServerScheduledJobAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const action = String(payload?.action || 'open').trim().toLowerCase();
    const sourceType = String(payload?.sourceType || '').trim();
    const name = String(payload?.name || '').trim();
    const source = String(payload?.source || '').trim();
    const path = String(payload?.path || '').trim();
    const user = String(payload?.user || '').trim();
    const copyValue = String(payload?.copyValue || path || source || name || user || '').trim();

    if (!connectionId) {
      return;
    }

    if (action === 'copy') {
      if (!copyValue) {
        return;
      }
      await vscode.env.clipboard.writeText(copyValue);
      return;
    }

    if (sourceType === 'windows-task') {
      await this.openWindowsScheduledTaskReadOnly(connectionId, name, source, path || copyValue);
      return;
    }

    if (sourceType === 'user') {
      if (action === 'edit') {
        await this.options.showConfirmDialog({
          title: 'Edit user crontab',
          message: 'Editing user crontabs is not enabled yet.',
          details: 'Remote Edit currently opens user crontabs read-only. Editing user crontabs needs a safer apply flow with validation and backup.',
          confirmLabel: 'OK',
          hideCancel: true
        });
        return;
      }

      await this.openUserCrontabReadOnly(connectionId, user || name || 'current');
      return;
    }

    if (!path || path === '/') {
      await this.options.showConfirmDialog({
        title: 'Cron job source unavailable',
        message: 'This cron job source cannot be opened.',
        details: copyValue || 'No remote path is available for this item.',
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const entry = {
      path,
      name: path.split('/').filter(Boolean).pop() || name || path,
      type: 'file',
      effectiveType: 'file'
    };

    if (action === 'edit') {
      await this.options.openEntries({ entries: [entry] });
    } else {
      await this.options.openEntriesReadOnly({ entries: [entry] });
    }
  }

  private async openWindowsScheduledTaskReadOnly(connectionId: string, taskName: string, taskPath: string, fullPath: string): Promise<void> {
    let finalName = String(taskName || '').trim();
    let normalizedTaskPath = String(taskPath || '').trim();
    const normalizedFullPath = String(fullPath || '').trim();

    if (!finalName && normalizedFullPath) {
      const lastSlash = Math.max(normalizedFullPath.lastIndexOf('\\'), normalizedFullPath.lastIndexOf('/'));
      if (lastSlash >= 0) {
        normalizedTaskPath = normalizedFullPath.slice(0, lastSlash + 1).replace(/\//g, '\\');
        finalName = normalizedFullPath.slice(lastSlash + 1).trim();
      }
    }

    if (!finalName) {
      await this.options.showConfirmDialog({
        title: 'Scheduled task unavailable',
        message: 'This scheduled task cannot be opened.',
        details: normalizedFullPath || 'No scheduled task name is available for this item.',
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
      return;
    }

    if (!normalizedTaskPath) {
      normalizedTaskPath = '\\';
    }
    normalizedTaskPath = normalizedTaskPath.replace(/\//g, '\\');
    if (!normalizedTaskPath.startsWith('\\')) {
      normalizedTaskPath = `\\${normalizedTaskPath}`;
    }
    if (!normalizedTaskPath.endsWith('\\')) {
      normalizedTaskPath += '\\';
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp' || !isWindowsRemotePlatform(connection.remotePlatform)) {
      await this.options.showConfirmDialog({
        title: 'Scheduled task unavailable',
        message: 'Scheduled task details require an active Windows SSH/SFTP connection.',
        details: normalizedFullPath || `${normalizedTaskPath}${finalName}`,
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
      return;
    }

    try {
      const command = buildWindowsScheduledTaskDetailsCommand(finalName, normalizedTaskPath);
      const result = await this.runServerManagementCommand(connectionId, command);
      const output = normalizeServerCommandOutput(result.stdout, result.stderr, result.code);
      const content = `${output || 'No scheduled task details returned.'}\n`;
      const safeName = `${normalizedTaskPath}${finalName}`.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'scheduled-task';
      const uri = vscode.Uri.from({
        scheme: 'remoteedit-virtual',
        authority: 'scheduled-tasks',
        path: `/${safeName}.txt`,
        query: `connectionId=${encodeURIComponent(connectionId)}&task=${encodeURIComponent(`${normalizedTaskPath}${finalName}`)}&ts=${Date.now()}`
      });

      this.options.virtualDocuments.set(uri.toString(), content);
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.showConfirmDialog({
        title: 'Scheduled task unavailable',
        message: 'This scheduled task cannot be opened.',
        details: message || normalizedFullPath || `${normalizedTaskPath}${finalName}`,
        confirmLabel: 'OK',
        hideCancel: true,
        copyable: true
      });
    }
  }

  private async openUserCrontabReadOnly(connectionId: string, user: string): Promise<void> {
    const normalizedUser = String(user || '').trim();
    if (!normalizedUser) {
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.options.postServerStatus('Cron job actions require an active SSH/SFTP connection.', true);
      return;
    }

    const currentUser = String(connection.username || '').trim();
    const isRootConnection = currentUser.toLowerCase() === 'root';
    const sudoEnabled = this.options.sessions.isSudoModeEnabled(connectionId) && !isRootConnection;
    const targetUser = shellQuote(normalizedUser);
    const usesCurrentUserCrontab = currentUser && normalizedUser === currentUser && !sudoEnabled;
    const command = usesCurrentUserCrontab
      ? 'crontab -l 2>&1'
      : `crontab -u ${targetUser} -l 2>/dev/null || crontab -l ${targetUser} 2>&1`;

    this.options.logDebug('Opening user crontab read-only.', {
      Connection: connectionId,
      RequestedUser: normalizedUser,
      ConnectedUser: currentUser || 'unknown',
      SudoMode: sudoEnabled,
      ExplicitUser: !usesCurrentUserCrontab
    });

    let output = '';
    const result = await this.runServerManagementCommand(connectionId, command);
    output = `${result.stdout || ''}${result.stderr ? `
${result.stderr}` : ''}`.trimEnd();

    if (result.code !== 0 && !output) {
      output = `Could not read crontab for ${normalizedUser}.`;
    }

    const content = `${output || '# No crontab content.'}
`;
    const safeUser = normalizedUser.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'user';
    const uri = vscode.Uri.from({
      scheme: 'remoteedit-virtual',
      authority: 'scheduled-jobs',
      path: `/${safeUser}.crontab`,
      query: `connectionId=${encodeURIComponent(connectionId)}&user=${encodeURIComponent(normalizedUser)}&ts=${Date.now()}`
    });

    this.options.virtualDocuments.set(uri.toString(), content);
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
  }

  private postServerProcessActionState(connectionId: string, pid: string, status: 'killing' | 'still-running' | 'terminated' | 'clear', process: ServerDashboardProcessItem): void {
    this.options.postMessage(RemoteEditOutboundMessageType.ServerProcessActionState, {
      connectionId,
      pid,
      status,
      process
    });
  }

  private async finishServerProcessTerminated(connectionId: string, pid: string, process: ServerDashboardProcessItem): Promise<void> {
    this.postServerProcessActionState(connectionId, pid, 'terminated', process);
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.postServerProcessActionState(connectionId, pid, 'clear', process);
    await this.requestServerDashboard({ connectionId, requestId: '' });
  }

  private async runServerManagementCommand(connectionId: string, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    const result = await this.options.sessions.runRemoteCommandStreaming(
      connectionId,
      '/',
      command,
      {
        onStdout: chunk => { stdout += chunk || ''; },
        onStderr: chunk => { stderr += chunk || ''; }
      }
    );

    return {
      code: typeof result.code === 'number' ? result.code : 0,
      stdout,
      stderr
    };
  }

  async requestServerDashboard(payload: any): Promise<void> {
    const requestedConnectionId = String(payload?.connectionId || '').trim();
    const connectionId = requestedConnectionId || this.options.getActiveConnectionId() || '';
    const requestId = String(payload?.requestId || '').trim();

    if (!connectionId) {
      this.options.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: createUnavailableServerOverview('No connection'),
        overviewDetails: {},
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        scheduledJobs: [],
        scheduledJobsAdapter: 'unknown',
        capabilities: [],
        error: 'No active connection.'
      });
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection) {
      this.options.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: createUnavailableServerOverview('Disconnected'),
        overviewDetails: {},
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: 'Connection is no longer active.'
      });
      return;
    }

    if (String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.options.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: createUnavailableServerOverview('Unsupported'),
        overviewDetails: {},
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: 'Server dashboard requires SSH/SFTP.'
      });
      return;
    }

    const isWindows = isWindowsRemotePlatform(connection.remotePlatform);
    const sudoEnabled = !isWindows && this.options.sessions.isSudoModeEnabled(connectionId);
    let output = '';
    try {
      const snapshotCommand = isWindows
        ? buildWindowsServerDashboardSnapshotCommand()
        : buildServerDashboardSnapshotCommand();
      await this.options.sessions.runRemoteCommandStreaming(
        connectionId,
        '/',
        snapshotCommand,
        {
          onStdout: chunk => { output += chunk || ''; },
          onStderr: () => undefined
        }
      );

      const fields = parseServerDashboardSnapshotOutput(output);
      this.options.postMessage(RemoteEditOutboundMessageType.ServerDashboard, buildServerDashboardSnapshot(connectionId, requestId, connection, fields, sudoEnabled));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: createUnavailableServerOverview('Unavailable'),
        overviewDetails: {},
        systemInfo: buildFallbackServerSystemInfo(connection, [], Date.now(), sudoEnabled),
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: message || 'Could not refresh the server dashboard.'
      });
      this.options.logWarn('Could not refresh server dashboard.', { Connection: connectionId, Details: message });
    }
  }
}
