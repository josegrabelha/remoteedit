import { buildWindowsPowerShellCommand, quotePowerShellLiteral } from '../../ssh/WindowsPowerShellUtils';
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

export function buildServerProcessKillCommand(pid: string, force: boolean, adapter?: string): string {
  const normalizedAdapter = String(adapter || '').trim().toLowerCase();
  if (normalizedAdapter === 'windows-process') {
    const safePid = String(pid || '').replace(/[^0-9]/g, '') || '0';
    const forceSwitch = force ? ' -Force' : '';
    return buildWindowsPowerShellCommand([
      `$remoteEditPid = ${safePid}`,
      '$existsBefore = [bool](Get-Process -Id $remoteEditPid -ErrorAction SilentlyContinue)',
      'Write-Output ("REMOTE_EDIT_PROCESS_EXISTS_BEFORE={0}" -f ($(if ($existsBefore) { "yes" } else { "no" })))',
      '$killRc = 0',
      'if ($existsBefore) {',
      `  try { Stop-Process -Id $remoteEditPid${forceSwitch} -ErrorAction Stop } catch { $killRc = 1; Write-Error $_.Exception.Message }`,
      '}',
      'Start-Sleep -Seconds 1',
      '$existsAfter = [bool](Get-Process -Id $remoteEditPid -ErrorAction SilentlyContinue)',
      'Write-Output ("REMOTE_EDIT_KILL_RC={0}" -f $killRc)',
      'Write-Output ("REMOTE_EDIT_PROCESS_EXISTS_AFTER={0}" -f ($(if ($existsAfter) { "yes" } else { "no" })))',
      'Write-Output ("REMOTE_EDIT_PROCESS_STILL_RUNNING={0}" -f ($(if ($existsAfter) { "yes" } else { "no" })))',
      'exit 0'
    ].join('\r\n'));
  }

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

  if (normalizedAdapter === 'windows-service') {
    const quotedServiceName = quotePowerShellLiteral(serviceName);
    return buildWindowsPowerShellCommand([
      `$name = ${quotedServiceName}`,
      '$service = Get-Service -Name $name -ErrorAction Stop',
      'Write-Output ("Name: {0}" -f $service.Name)',
      'Write-Output ("Display Name: {0}" -f $service.DisplayName)',
      'Write-Output ("Status: {0}" -f $service.Status)',
      'Write-Output ("Service Type: {0}" -f $service.ServiceType)',
      'Write-Output ("Can Stop: {0}" -f $service.CanStop)',
      'try {',
      `  $cim = Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f ($name -replace "'", "''")) -ErrorAction Stop`,
      '  if ($cim) {',
      '    Write-Output ("Start Mode: {0}" -f $cim.StartMode)',
      '    Write-Output ("Start Name: {0}" -f $cim.StartName)',
      '    Write-Output ("Path: {0}" -f $cim.PathName)',
      '    Write-Output ("Description: {0}" -f $cim.Description)',
      '  }',
      '} catch {}'
    ].join('\r\n'));
  }

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

  if (normalizedAdapter === 'windows-service') {
    const quotedServiceName = quotePowerShellLiteral(serviceName);
    const actionCommand = action === 'start'
      ? 'Start-Service -Name $name -ErrorAction Stop'
      : action === 'stop'
        ? 'Stop-Service -Name $name -ErrorAction Stop'
        : 'Restart-Service -Name $name -Force -ErrorAction Stop';
    return buildWindowsPowerShellCommand([
      `$name = ${quotedServiceName}`,
      actionCommand,
      'Start-Sleep -Milliseconds 500',
      '$service = Get-Service -Name $name -ErrorAction SilentlyContinue',
      'if ($service) { Write-Output ("Status: {0}" -f $service.Status) }'
    ].join('\r\n'));
  }

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
export function buildWindowsScheduledTaskDetailsCommand(taskName: string, taskPath: string): string {
  const quotedTaskName = quotePowerShellLiteral(taskName);
  const quotedTaskPath = quotePowerShellLiteral(taskPath || '\\');
  return buildWindowsPowerShellCommand([
    `$taskName = ${quotedTaskName}`,
    `$taskPath = ${quotedTaskPath}`,
    'if (-not $taskPath) { $taskPath = "\\" }',
    'try {',
    '  $task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop',
    '} catch {',
    '  $task = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $taskName -and ($_.TaskPath -eq $taskPath -or ($_.TaskPath + $_.TaskName) -eq $taskPath -or ($_.TaskPath + $_.TaskName) -eq ($taskPath + $taskName)) } | Select-Object -First 1',
    '}',
    'if (-not $task) {',
    '  Write-Error ("Scheduled task not found: {0}{1}" -f $taskPath, $taskName)',
    '  exit 1',
    '}',
    '$fullName = ($task.TaskPath + $task.TaskName)',
    'Write-Output ("Name: {0}" -f $task.TaskName)',
    'Write-Output ("Path: {0}" -f $task.TaskPath)',
    'Write-Output ("Full Name: {0}" -f $fullName)',
    'Write-Output ("State: {0}" -f $task.State)',
    'Write-Output ("Author: {0}" -f $task.Author)',
    'Write-Output ("Description: {0}" -f $task.Description)',
    'try {',
    '  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop',
    '  Write-Output ("Last Run Time: {0}" -f $info.LastRunTime)',
    '  Write-Output ("Next Run Time: {0}" -f $info.NextRunTime)',
    '  Write-Output ("Last Task Result: {0}" -f $info.LastTaskResult)',
    '  Write-Output ("Number of Missed Runs: {0}" -f $info.NumberOfMissedRuns)',
    '} catch {',
    '  Write-Output "Task Info: unavailable"',
    '}',
    'Write-Output ""',
    'Write-Output "Actions:"',
    'if ($task.Actions) {',
    '  foreach ($action in @($task.Actions)) {',
    '    $execute = try { [string]$action.Execute } catch { "" }',
    '    $arguments = try { [string]$action.Arguments } catch { "" }',
    '    $workingDirectory = try { [string]$action.WorkingDirectory } catch { "" }',
    '    $line = ("- {0}" -f ($(if ($execute) { $execute } else { $action.GetType().Name })))',
    '    if ($arguments) { $line += (" {0}" -f $arguments) }',
    '    if ($workingDirectory) { $line += (" (Start in: {0})" -f $workingDirectory) }',
    '    Write-Output $line',
    '  }',
    '} else {',
    '  Write-Output "- none"',
    '}',
    'Write-Output ""',
    'Write-Output "Triggers:"',
    'if ($task.Triggers) {',
    '  foreach ($trigger in @($task.Triggers)) {',
    '    $enabled = try { [string]$trigger.Enabled } catch { "" }',
    '    $startBoundary = try { [string]$trigger.StartBoundary } catch { "" }',
    '    $triggerType = $trigger.GetType().Name',
    '    $line = ("- {0}" -f $triggerType)',
    '    if ($enabled) { $line += (" Enabled={0}" -f $enabled) }',
    '    if ($startBoundary) { $line += (" Start={0}" -f $startBoundary) }',
    '    Write-Output $line',
    '  }',
    '} else {',
    '  Write-Output "- none"',
    '}',
    'Write-Output ""',
    'Write-Output "Settings:"',
    'try {',
    '  Write-Output ("Allow Start If On Batteries: {0}" -f $task.Settings.AllowStartIfOnBatteries)',
    '  Write-Output ("Disallow Start If On Batteries: {0}" -f $task.Settings.DisallowStartIfOnBatteries)',
    '  Write-Output ("Execution Time Limit: {0}" -f $task.Settings.ExecutionTimeLimit)',
    '  Write-Output ("Multiple Instances: {0}" -f $task.Settings.MultipleInstances)',
    '  Write-Output ("Run Only If Network Available: {0}" -f $task.Settings.RunOnlyIfNetworkAvailable)',
    '} catch {',
    '  Write-Output "Settings unavailable."',
    '}',
    'Write-Output ""',
    'Write-Output "XML:"',
    'try {',
    '  Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop',
    '} catch {',
    '  Write-Output "XML export unavailable."',
    '}'
  ].join('\r\n'));
}

