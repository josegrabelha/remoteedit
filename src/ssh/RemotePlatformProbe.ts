import type SftpClient from 'ssh2-sftp-client';
import type { RemotePlatform, RemoteShell } from '../remote/RemotePlatform';
import { appendDebugLog } from '../utils/outputLogger';
import type * as vscode from 'vscode';

export interface RemotePlatformProbeResult {
  platform: RemotePlatform;
  shell: RemoteShell;
  details?: string;
}

interface ProbeCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function detectRemotePlatform(client: SftpClient, output?: vscode.OutputChannel): Promise<RemotePlatformProbeResult> {
  try {
    const uname = await runProbeCommand(client, 'uname -s', 5000);
    const unameText = `${uname.stdout}\n${uname.stderr}`.trim();

    if (uname.code === 0 && /^(Linux|AIX|Darwin|FreeBSD|OpenBSD|NetBSD|SunOS|HP-UX)\b/i.test(uname.stdout.trim())) {
      const result: RemotePlatformProbeResult = { platform: 'posix', shell: 'sh', details: uname.stdout.trim() };
      appendDebugLog(output, 'SFTP', 'Remote platform detected.', { platform: result.platform, shell: result.shell, details: result.details || '' });
      return result;
    }

    if (/not recognized|is not recognized|not found|no such file|not internal or external/i.test(unameText)) {
      // Expected on Windows when the default shell cannot resolve uname.
    }
  } catch {
    // Fall through to Windows probing.
  }

  try {
    const windows = await runProbeCommand(client, 'cmd.exe /c ver', 5000);
    const windowsText = `${windows.stdout}\n${windows.stderr}`.trim();

    if (/Microsoft Windows/i.test(windowsText)) {
      const shell = await detectWindowsShell(client);
      const result: RemotePlatformProbeResult = { platform: 'windows', shell, details: firstLine(windowsText) };
      appendDebugLog(output, 'SFTP', 'Remote platform detected.', { platform: result.platform, shell: result.shell, details: result.details || '' });
      return result;
    }
  } catch {
    // Unknown is intentionally treated as POSIX-compatible by callers.
  }

  const result: RemotePlatformProbeResult = { platform: 'unknown', shell: 'unknown' };
  appendDebugLog(output, 'SFTP', 'Remote platform detection inconclusive; using POSIX-compatible behavior.', { platform: result.platform, shell: result.shell });
  return result;
}

async function detectWindowsShell(client: SftpClient): Promise<RemoteShell> {
  try {
    const result = await runProbeCommand(client, 'powershell.exe -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"', 5000);
    if (result.code === 0 && result.stdout.trim()) {
      return 'powershell';
    }
  } catch {
    // Ignore shell detection failure.
  }

  return 'cmd';
}

function firstLine(value: string): string {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
}

function runProbeCommand(client: SftpClient, command: string, timeoutMs: number): Promise<ProbeCommandResult> {
  const sshClient = (client as any).client;

  if (!sshClient || typeof sshClient.exec !== 'function') {
    return Promise.resolve({ stdout: '', stderr: '', code: 255 });
  }

  return new Promise<ProbeCommandResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let streamRef: any;

    const timer = setTimeout(() => {
      try {
        streamRef?.close?.();
      } catch {
        // Ignore probe timeout cleanup errors.
      }
      settle(() => reject(new Error('Remote platform probe timed out.')));
    }, timeoutMs);

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };

    try {
      sshClient.exec(command, (error: Error | undefined, stream: any) => {
        if (error) {
          settle(() => reject(error));
          return;
        }

        streamRef = stream;
        stream?.on?.('data', (chunk: Buffer | string) => {
          stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        });
        stream?.stderr?.on?.('data', (chunk: Buffer | string) => {
          stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        });
        stream?.on?.('close', (code: number | undefined) => {
          settle(() => resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 }));
        });
        stream?.on?.('error', (streamError: Error) => {
          settle(() => reject(streamError));
        });
        stream?.end?.();
      });
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
