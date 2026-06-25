import { shellQuote } from '../../utils/shellUtils';
import { isServerKernelThreadProcess, type ServerDashboardProcessItem } from './ServerDashboardModel';

export function buildServerProcessActionSnapshot(payload: any): ServerDashboardProcessItem {
  const pid = String(payload?.pid || '').trim();
  return {
    id: `process-${pid || 'unknown'}`,
    pid,
    user: String(payload?.user || '—'),
    cpu: String(payload?.cpu || '—'),
    memory: String(payload?.memory || '—'),
    state: String(payload?.state || '').trim() || undefined,
    isZombie: Boolean(payload?.isZombie),
    command: String(payload?.command || '—'),
    args: String(payload?.args || payload?.command || '—'),
    adapter: String(payload?.adapter || 'ps'),
    canKill: /^\d+$/.test(pid) && pid !== '1' && !isServerKernelThreadProcess(payload?.command, payload?.args)
  };
}

export function buildServerProcessKillCommand(pid: string, force: boolean): string {
  const signal = force ? '-9 ' : '';
  return [
    `__remote_edit_pid=${pid}`,
    'remote_edit_process_exists() {',
    '  ps -p "$1" -o pid= >/dev/null 2>&1 && return 0',
    '  ps -ef 2>/dev/null | awk -v p="$1" \'NR > 1 && $2 == p { found = 1 } END { exit(found ? 0 : 1) }\'',
    '}',
    'if remote_edit_process_exists "$__remote_edit_pid"; then',
    '  printf "REMOTE_EDIT_PROCESS_EXISTS_BEFORE=yes\\n"',
    'else',
    '  printf "REMOTE_EDIT_PROCESS_EXISTS_BEFORE=no\\n"',
    'fi',
    `kill ${signal}"$__remote_edit_pid"`,
    '__remote_edit_kill_rc=$?',
    'sleep 1',
    'printf "REMOTE_EDIT_KILL_RC=%s\\n" "$__remote_edit_kill_rc"',
    'if remote_edit_process_exists "$__remote_edit_pid"; then',
    '  printf "REMOTE_EDIT_PROCESS_EXISTS_AFTER=yes\\n"',
    '  printf "REMOTE_EDIT_PROCESS_STILL_RUNNING=yes\\n"',
    'else',
    '  printf "REMOTE_EDIT_PROCESS_EXISTS_AFTER=no\\n"',
    '  printf "REMOTE_EDIT_PROCESS_STILL_RUNNING=no\\n"',
    'fi',
    'exit 0'
  ].join('\n');
}

export function parseServerProcessKillOutput(stdout: string, stderr: string): { killRc: number; stillRunning: boolean; existsBefore: boolean; existsAfter: boolean } {
  const text = `${stdout || ''}\n${stderr || ''}`;
  const rcMatch = /REMOTE_EDIT_KILL_RC=(\d+)/.exec(text);
  const runningMatch = /REMOTE_EDIT_PROCESS_STILL_RUNNING=(yes|no)/.exec(text);
  const beforeMatch = /REMOTE_EDIT_PROCESS_EXISTS_BEFORE=(yes|no)/.exec(text);
  const afterMatch = /REMOTE_EDIT_PROCESS_EXISTS_AFTER=(yes|no)/.exec(text);
  return {
    killRc: rcMatch ? Number(rcMatch[1]) : 1,
    stillRunning: runningMatch ? runningMatch[1] === 'yes' : false,
    existsBefore: beforeMatch ? beforeMatch[1] === 'yes' : true,
    existsAfter: afterMatch ? afterMatch[1] === 'yes' : runningMatch ? runningMatch[1] === 'yes' : false
  };
}

export function buildServerServiceDetailsCommand(adapter: string, serviceName: string): string {
  const normalizedAdapter = String(adapter || '').trim().toLowerCase();
  const quotedName = shellQuote(serviceName);

  if (normalizedAdapter === 'linux-systemd') {
    return `systemctl status --no-pager --full ${quotedName} 2>&1 || true`;
  }

  if (normalizedAdapter === 'aix-src') {
    return `lssrc -s ${quotedName} 2>&1 || true`;
  }

  if (normalizedAdapter === 'linux-sysv') {
    return `if command -v service >/dev/null 2>&1; then service ${quotedName} status; elif [ -x /etc/init.d/${quotedName} ]; then /etc/init.d/${quotedName} status; else echo 'Service command not found.'; exit 127; fi 2>&1 || true`;
  }

  return '';
}

export function buildServerServiceActionCommand(adapter: string, serviceName: string, action: 'start' | 'stop' | 'restart'): string {
  const normalizedAdapter = String(adapter || '').trim().toLowerCase();
  const quotedName = shellQuote(serviceName);

  if (normalizedAdapter === 'linux-systemd') {
    return `systemctl ${action} ${quotedName}`;
  }

  if (normalizedAdapter === 'linux-sysv') {
    return `if command -v service >/dev/null 2>&1; then service ${quotedName} ${action}; elif [ -x /etc/init.d/${quotedName} ]; then /etc/init.d/${quotedName} ${action}; else echo 'Service command not found.'; exit 127; fi`;
  }

  if (normalizedAdapter === 'aix-src') {
    if (action === 'start') {
      return `startsrc -s ${quotedName}`;
    }
    if (action === 'stop') {
      return `stopsrc -s ${quotedName}`;
    }
    return [
      `stopsrc -s ${quotedName}`,
      '__remote_edit_stop_status=$?',
      'sleep 1',
      `startsrc -s ${quotedName}`,
      '__remote_edit_start_status=$?',
      'if [ "$__remote_edit_stop_status" -ne 0 ] || [ "$__remote_edit_start_status" -ne 0 ]; then exit 1; fi',
      'exit 0'
    ].join('\n');
  }

  return '';
}

export function formatServerServiceActionLabel(action: string): string {
  switch (action) {
    case 'start': return 'Start';
    case 'stop': return 'Stop';
    case 'restart': return 'Restart';
    default: return 'Run';
  }
}

export function normalizeServerCommandOutput(stdout: string, stderr: string, code: number): string {
  const output = [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n\n').trim();
  const exitLine = code === 0 ? '' : `Exit code: ${code}`;
  return [output, exitLine].filter(Boolean).join('\n\n').trim();
}
