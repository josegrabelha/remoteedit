import { buildWindowsPowerShellCommand } from '../../ssh/WindowsPowerShellUtils';

export function buildWindowsServerDashboardSnapshotCommand(): string {
  return buildWindowsPowerShellCommand(String.raw`
function Clean-RemoteEditValue {
  param([object]$Value)
  if ($null -eq $Value) { return '' }
  return ([string]$Value) -replace '[\r\n\t]+', ' '
}

function Clean-RemoteEditPart {
  param([object]$Value)
  return (Clean-RemoteEditValue $Value) -replace '\|', '/'
}

function Join-RemoteEditParts {
  param([object[]]$Parts)
  return (($Parts | ForEach-Object { Clean-RemoteEditPart $_ }) -join '|')
}

function Emit-RemoteEditField {
  param([string]$Key, [object]$Value)
  Write-Output ("{0}={1}" -f $Key, (Clean-RemoteEditValue $Value))
}

function To-RemoteEditMb {
  param([object]$Bytes)
  $number = 0.0
  if ([double]::TryParse([string]$Bytes, [ref]$number) -and $number -gt 0) {
    return [math]::Round($number / 1MB, 0)
  }
  return 0
}

function To-RemoteEditKb {
  param([object]$Bytes)
  $number = 0.0
  if ([double]::TryParse([string]$Bytes, [ref]$number) -and $number -gt 0) {
    return [math]::Round($number / 1KB, 0)
  }
  return 0
}

function Format-RemoteEditBytes {
  param([object]$Bytes)
  $number = 0.0
  if (-not [double]::TryParse([string]$Bytes, [ref]$number) -or $number -lt 0) { return '0 B' }
  if ($number -ge 1GB) { return ('{0:N1} GB' -f ($number / 1GB)) }
  if ($number -ge 1MB) { return ('{0:N1} MB' -f ($number / 1MB)) }
  if ($number -ge 1KB) { return ('{0:N1} KB' -f ($number / 1KB)) }
  return ('{0:N0} B' -f $number)
}

function Format-RemoteEditPercent {
  param([double]$Value)
  if ($Value -lt 0) { return '0%' }
  if ($Value -gt 100) { return '100%' }
  return ('{0:N0}%' -f $Value)
}

try { $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue } catch { $os = $null }
try { $computer = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue } catch { $computer = $null }
try { $processor = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1 } catch { $processor = $null }

$hostname = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { [System.Net.Dns]::GetHostName() }
$currentIdentity = try { [System.Security.Principal.WindowsIdentity]::GetCurrent().Name } catch { whoami.exe 2>$null }
$homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { '' }
$serverTime = Get-Date -Format o
$arch = if ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() }
$caption = if ($os -and $os.Caption) { $os.Caption } else { 'Windows' }
$version = if ($os -and $os.Version) { $os.Version } else { [System.Environment]::OSVersion.VersionString }
$build = if ($os -and $os.BuildNumber) { $os.BuildNumber } else { '' }

Emit-RemoteEditField 'OS' 'Windows'
Emit-RemoteEditField 'OS_VERSION' ($caption + ($(if ($version) { ' ' + $version } else { '' })) + ($(if ($build) { ' build ' + $build } else { '' })))
Emit-RemoteEditField 'KERNEL' ([System.Environment]::OSVersion.VersionString)
Emit-RemoteEditField 'HOSTNAME' $hostname
Emit-RemoteEditField 'USER' $currentIdentity
Emit-RemoteEditField 'ID' $currentIdentity
Emit-RemoteEditField 'HOME' $homePath
Emit-RemoteEditField 'SHELL' 'PowerShell'
Emit-RemoteEditField 'ARCH' $arch
Emit-RemoteEditField 'SERVER_TIME' $serverTime
Emit-RemoteEditField 'CAPABILITIES' 'powershell,services,processes,scheduledtasks,disk,memory,listeners,sessions'

try {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -and $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 5 -ExpandProperty IPAddress
  Emit-RemoteEditField 'NETWORK_ADDRESSES' (($addresses | ForEach-Object { 'IPv4: ' + $_ }) -join ',')
} catch {
  Emit-RemoteEditField 'NETWORK_ADDRESSES' ''
}

if ($os -and $os.LastBootUpTime) {
  $uptimeSeconds = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds
  Emit-RemoteEditField 'UPTIME_SECONDS' $uptimeSeconds
  Emit-RemoteEditField 'UPTIME' ('up ' + $uptimeSeconds + ' seconds')
}

if ($os) {
  $totalMemoryMb = [math]::Round(([double]$os.TotalVisibleMemorySize) / 1024, 0)
  $freeMemoryMb = [math]::Round(([double]$os.FreePhysicalMemory) / 1024, 0)
  $usedMemoryMb = [math]::Max(0, $totalMemoryMb - $freeMemoryMb)
  Emit-RemoteEditField 'MEMORY' (Join-RemoteEditParts @($totalMemoryMb, $usedMemoryMb, $freeMemoryMb, $freeMemoryMb, 0))
  Emit-RemoteEditField 'MEMORY_DETAIL' (Join-RemoteEditParts @($totalMemoryMb, $usedMemoryMb, $freeMemoryMb, $freeMemoryMb, 0))
}

try {
  $pageFiles = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
  $swapTotalMb = [int](($pageFiles | Measure-Object -Property AllocatedBaseSize -Sum).Sum)
  $swapUsedMb = [int](($pageFiles | Measure-Object -Property CurrentUsage -Sum).Sum)
  $swapFreeMb = [math]::Max(0, $swapTotalMb - $swapUsedMb)
  Emit-RemoteEditField 'SWAP' (Join-RemoteEditParts @($swapTotalMb, $swapUsedMb, $swapFreeMb))
  Emit-RemoteEditField 'SWAP_DETAIL' (Join-RemoteEditParts @($swapTotalMb, $swapUsedMb, $swapFreeMb))
} catch {
  Emit-RemoteEditField 'SWAP' '0|0|0'
  Emit-RemoteEditField 'SWAP_DETAIL' '0|0|0'
}

try {
  $fixedDisks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Sort-Object DeviceID
  $diskIndex = 0
  $rootDisk = $null
  $systemDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
  foreach ($disk in $fixedDisks) {
    if (-not $disk.Size) { continue }
    $totalKb = To-RemoteEditKb $disk.Size
    $freeKb = To-RemoteEditKb $disk.FreeSpace
    $usedKb = [math]::Max(0, $totalKb - $freeKb)
    $percent = if ($totalKb -gt 0) { Format-RemoteEditPercent (($usedKb / $totalKb) * 100) } else { '0%' }
    $label = if ($disk.VolumeName) { $disk.DeviceID + ' ' + $disk.VolumeName } else { $disk.DeviceID }
    Emit-RemoteEditField ("DISK_FS_{0}" -f $diskIndex) (Join-RemoteEditParts @($label, $disk.DeviceID, $totalKb, $usedKb, $freeKb, $percent))
    if (($disk.DeviceID -eq $systemDrive) -or (-not $rootDisk)) { $rootDisk = @{ TotalKb = $totalKb; UsedKb = $usedKb; FreeKb = $freeKb; Percent = $percent } }
    $diskIndex++
  }
  if ($rootDisk) {
    Emit-RemoteEditField 'DISK_ROOT' (Join-RemoteEditParts @($rootDisk.TotalKb, $rootDisk.UsedKb, $rootDisk.FreeKb, $rootDisk.Percent))
  }
} catch {
  Emit-RemoteEditField 'DISK_ROOT' ''
}

try {
  $services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Sort-Object State, Name | Select-Object -First 160
  $serviceIndex = 0
  foreach ($service in $services) {
    $serviceState = if ($service.State) { $service.State } elseif ($service.Started -eq $true) { 'Running' } elseif ($service.Started -eq $false) { 'Stopped' } else { 'Unknown' }
    Emit-RemoteEditField ("SERVICE_{0}" -f $serviceIndex) (Join-RemoteEditParts @('windows-service', $service.Name, $serviceState, $service.DisplayName))
    $serviceIndex++
  }
} catch {
  try {
    $services = Get-Service -ErrorAction SilentlyContinue | Sort-Object Status, Name | Select-Object -First 160
    $serviceIndex = 0
    foreach ($service in $services) {
      $serviceState = if ($service.Status -eq 4) { 'Running' } elseif ($service.Status -eq 1) { 'Stopped' } else { $service.Status }
      Emit-RemoteEditField ("SERVICE_{0}" -f $serviceIndex) (Join-RemoteEditParts @('windows-service', $service.Name, $serviceState, $service.DisplayName))
      $serviceIndex++
    }
  } catch {}
}

try {
  $totalMemoryBytes = if ($computer -and $computer.TotalPhysicalMemory) { [double]$computer.TotalPhysicalMemory } elseif ($os -and $os.TotalVisibleMemorySize) { [double]$os.TotalVisibleMemorySize * 1KB } else { 0 }
  $processes = Get-Process -ErrorAction SilentlyContinue | Sort-Object Id | Select-Object -First 160
  $processIndex = 0
  foreach ($process in $processes) {
    $cpuLabel = if ($null -ne $process.CPU) { ('{0:N1}s' -f [double]$process.CPU) } else { '—' }
    $memoryLabel = Format-RemoteEditBytes $process.WorkingSet64
    $stateLabel = if ($process.Responding -eq $false) { 'NotResponding' } else { 'Running' }
    $commandLabel = if ($process.ProcessName) { $process.ProcessName } else { $process.Name }
    $argsLabel = if ($process.Path) { $process.Path } else { $commandLabel }
    Emit-RemoteEditField ("PROCESS_{0}" -f $processIndex) (Join-RemoteEditParts @('windows-process', $process.Id, '—', $stateLabel, $cpuLabel, $memoryLabel, $commandLabel, $argsLabel))
    $processIndex++
  }
} catch {}

try {
  $tcpListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
  $udpListeners = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue)
  $listenerIndex = 0
  foreach ($listener in ($tcpListeners | Select-Object -First 160)) {
    Emit-RemoteEditField ("LISTENER_DETAIL_{0}" -f $listenerIndex) (Join-RemoteEditParts @('tcp', $listener.LocalAddress, $listener.LocalPort, 'LISTEN'))
    $listenerIndex++
  }
  foreach ($listener in ($udpListeners | Select-Object -First 80)) {
    Emit-RemoteEditField ("LISTENER_DETAIL_{0}" -f $listenerIndex) (Join-RemoteEditParts @('udp', $listener.LocalAddress, $listener.LocalPort, '—'))
    $listenerIndex++
  }
  Emit-RemoteEditField 'LISTENERS' (Join-RemoteEditParts @(($tcpListeners.Count + $udpListeners.Count), $tcpListeners.Count, $udpListeners.Count))
} catch {
  Emit-RemoteEditField 'LISTENERS' ''
}

try {
  $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Sort-Object TaskPath, TaskName | Select-Object -First 120
  $taskIndex = 0
  foreach ($task in $tasks) {
    $taskSource = ($task.TaskPath + $task.TaskName)
    Emit-RemoteEditField ("SCHEDULED_{0}" -f $taskIndex) (Join-RemoteEditParts @('windows-task', $task.TaskName, $task.State, 'Scheduled Task', $task.TaskPath, $taskSource, '', 'yes', 'no', $taskSource))
    $taskIndex++
  }
} catch {}

try {
  Emit-RemoteEditField 'SESSIONS' (Join-RemoteEditParts @(1, $currentIdentity))
  Emit-RemoteEditField 'SESSION_DETAIL_0' (Join-RemoteEditParts @($currentIdentity, 'ssh', 'remote', 'current'))
} catch {}
`);
}
