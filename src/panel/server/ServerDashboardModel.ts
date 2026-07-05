import { formatBytes } from '../../utils/progressUtils';
export * from './ServerDashboardTypes';
import type { ServerDashboardDiskDetail, ServerDashboardIoWaitDetail, ServerDashboardListenerDetail, ServerDashboardLoadDetail, ServerDashboardMemoryDetail, ServerDashboardOverviewDetails, ServerDashboardOverviewItem, ServerDashboardProcessItem, ServerDashboardScheduledJobItem, ServerDashboardServiceItem, ServerDashboardSessionDetail, ServerDashboardSnapshot, ServerDashboardSwapDetail, ServerDashboardSystemInfoItem, ServerDashboardUptimeDetail } from './ServerDashboardTypes';

export { buildServerDashboardSnapshotCommand } from './ServerDashboardSnapshotCommand';
export function parseServerDashboardSnapshotOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const index = rawLine.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = rawLine.slice(0, index).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) {
      continue;
    }

    result[key] = rawLine.slice(index + 1).trim();
  }

  return result;
}

export function buildServerDashboardSnapshot(connectionId: string, requestId: string, connection: any, fields: Record<string, string>, sudoEnabled: boolean): ServerDashboardSnapshot {
  const refreshedAt = Date.now();
  const capabilities = parseServerCapabilities(fields.CAPABILITIES);
  const adapter = detectServerAdapter(fields, capabilities);
  const isWindows = String(fields.OS || '').trim().toLowerCase() === 'windows';
  const identity = isWindows
    ? { user: normalizeServerInfoValue(fields.USER || fields.ID || connection?.username), group: '—' }
    : parseServerIdentity(fields.ID, String(connection?.username || fields.USER || '').trim());
  const services = parseServerDashboardServices(fields, adapter);
  const processes = parseServerDashboardProcesses(fields);
  const scheduledJobs = parseServerDashboardScheduledJobs(fields);

  return {
    connectionId,
    requestId,
    refreshedAt,
    overview: [
      formatServerUptime(fields.UPTIME_SECONDS, fields.UPTIME),
      formatServerLoad(fields.UPTIME),
      formatServerMemory(fields.MEMORY),
      formatServerDisk(fields.DISK_ROOT),
      formatServerSessions(fields.SESSIONS),
      formatServerListeners(fields.LISTENERS),
      formatServerSwap(fields.SWAP),
      formatServerIoWait(fields.IO_WAIT)
    ],
    overviewDetails: buildServerOverviewDetails(fields),
    systemInfo: [
      { label: 'OS', value: normalizeServerInfoValue(fields.OS) },
      { label: 'OS Version', value: normalizeServerInfoValue(fields.OS_VERSION || fields.KERNEL) },
      { label: 'Adapter', value: adapter },
      { label: 'Hostname', value: normalizeServerInfoValue(fields.HOSTNAME || connection?.host) },
      { label: 'IP Addresses', value: formatServerNetworkAddresses(fields.NETWORK_ADDRESSES) },
      { label: 'User', value: identity.user },
      { label: 'Group', value: identity.group },
      { label: 'Home', value: normalizeServerInfoValue(fields.HOME) },
      { label: 'Shell', value: normalizeServerInfoValue(fields.SHELL) },
      { label: 'Architecture', value: normalizeServerInfoValue(fields.ARCH) },
      { label: 'Protocol', value: 'SSH/SFTP' },
      { label: 'Sudo', value: formatServerSudoStatus(connection, sudoEnabled) },
      { label: 'Server Time', value: formatServerTime(fields.SERVER_TIME) },
      { label: 'Last refresh', value: formatServerRefreshTime(refreshedAt) }
    ],
    services,
    serviceAdapter: services[0]?.adapter || (isWindows ? 'windows-service' : adapter),
    processes,
    processAdapter: processes[0]?.adapter || (isWindows ? 'windows-process' : (capabilities.includes('ps') ? 'ps' : 'unknown')),
    scheduledJobs,
    scheduledJobsAdapter: isWindows ? 'windows-scheduled-task' : (scheduledJobs.length ? 'cron' : (capabilities.includes('crontab') ? 'cron' : 'unknown')),
    capabilities
  };
}

export function buildFallbackServerSystemInfo(connection: any, capabilities: string[], refreshedAt: number, sudoEnabled: boolean): ServerDashboardSystemInfoItem[] {
  const identity = parseServerIdentity('', String(connection?.username || '').trim());
  return [
    { label: 'OS', value: '—' },
    { label: 'OS Version', value: '—' },
    { label: 'Adapter', value: 'unknown' },
    { label: 'Hostname', value: normalizeServerInfoValue(connection?.host) },
    { label: 'IP Addresses', value: 'Unknown' },
    { label: 'User', value: identity.user },
    { label: 'Group', value: identity.group },
    { label: 'Home', value: '—' },
    { label: 'Shell', value: '—' },
    { label: 'Architecture', value: '—' },
    { label: 'Protocol', value: 'SSH/SFTP' },
    { label: 'Sudo', value: formatServerSudoStatus(connection, sudoEnabled) },
    { label: 'Server Time', value: '—' },
    { label: 'Last refresh', value: formatServerRefreshTime(refreshedAt) }
  ];
}

export function createUnavailableServerOverview(reason: string): ServerDashboardOverviewItem[] {
  return ['Uptime', 'Load', 'Memory', 'Disk', 'Sessions', 'Listeners', 'Swap', 'IO Wait'].map(label => ({ label, value: '—', help: reason }));
}

export function formatServerNetworkAddresses(value: string | undefined): string {
  const seen = new Set<string>();
  const items = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => {
      const address = item.includes(': ') ? item.slice(item.lastIndexOf(': ') + 2).trim() : item;
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) || address === '127.0.0.1') {
        return false;
      }
      const parts = address.split('.').map(part => Number(part));
      if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
      }
      if (seen.has(address)) {
        return false;
      }
      seen.add(address);
      return true;
    })
    .slice(0, 5);
  return items.length ? items.join(', ') : 'Unknown';
}

export function normalizeServerInfoValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '—';
}

export function parseServerCapabilities(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function parseServerDashboardServices(fields: Record<string, string>, adapter: string): ServerDashboardServiceItem[] {
  const services: ServerDashboardServiceItem[] = [];

  Object.keys(fields)
    .filter(key => /^SERVICE_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .forEach((key, index) => {
      const parts = String(fields[key] || '').split('|');
      const serviceAdapter = String(parts[0] || adapter || '').trim() || adapter || 'unknown';
      const name = String(parts[1] || '').trim();
      const rawStatus = String(parts[2] || '').trim();
      const description = String(parts.slice(3).join('|') || '').trim();

      if (!name) {
        return;
      }

      const status = normalizeServerServiceStatus(serviceAdapter, rawStatus);
      services.push({
        id: createServerServiceId(serviceAdapter, name, index),
        name,
        displayName: name,
        status,
        statusLabel: formatServerServiceStatusLabel(status),
        rawStatus: rawStatus || 'unknown',
        description,
        adapter: serviceAdapter,
        canStart: status === 'stopped' || status === 'failed',
        canStop: status === 'running',
        canRestart: status === 'running' || status === 'failed'
      });
    });

  return services.sort((left, right) => {
    const statusOrder = (status: ServerDashboardServiceItem['status']) => {
      switch (status) {
        case 'failed': return 0;
        case 'running': return 1;
        case 'stopped': return 2;
        default: return 3;
      }
    };
    const statusDelta = statusOrder(left.status) - statusOrder(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  });
}

export function parseServerDashboardScheduledJobs(fields: Record<string, string>): ServerDashboardScheduledJobItem[] {
  const items: ServerDashboardScheduledJobItem[] = [];
  const seen = new Set<string>();

  Object.keys(fields)
    .filter(key => /^SCHEDULED_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .forEach((key, index) => {
      const parts = String(fields[key] || '').split('|');
      const sourceType = String(parts[0] || '').trim() || 'unknown';
      const name = String(parts[1] || '').trim();
      const countLabel = String(parts[2] || '').trim() || '—';
      const typeLabel = String(parts[3] || '').trim() || sourceType;
      const source = String(parts[4] || name || '').trim();
      const path = String(parts[5] || '').trim();
      const user = String(parts[6] || '').trim();
      const canOpen = String(parts[7] || '').trim().toLowerCase() === 'yes';
      const canEdit = String(parts[8] || '').trim().toLowerCase() === 'yes';
      const copyValue = String(parts.slice(9).join('|') || path || source || name).trim();

      if (!name && !source) {
        return;
      }

      const identity = `${sourceType}|${path}|${user}|${name}`;
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);

      items.push({
        id: createServerScheduledJobId(sourceType, path || source || name, user, index),
        name: name || source || user || 'Scheduled item',
        countLabel,
        typeLabel,
        source: source || path || name,
        sourceType,
        user,
        path,
        canOpen,
        canEdit,
        copyValue: copyValue || source || path || name
      });
    });

  return items.sort((left, right) => {
    const order = (item: ServerDashboardScheduledJobItem): number => {
      if (item.sourceType === 'user') return 0;
      if (item.sourceType === 'file') return 1;
      if (item.sourceType === 'cron-d') return 2;
      if (item.sourceType === 'periodic') return 3;
      return 4;
    };
    const orderDiff = order(left) - order(right);
    if (orderDiff !== 0) return orderDiff;
    return left.name.localeCompare(right.name);
  });
}

export function createServerScheduledJobId(sourceType: string, source: string, user: string, index: number): string {
  const raw = `${sourceType}-${user || ''}-${source || ''}-${index}`;
  return raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 140) || `scheduled-${index}`;
}

export function parseServerDashboardProcesses(fields: Record<string, string>): ServerDashboardProcessItem[] {
  const processes: ServerDashboardProcessItem[] = [];

  Object.keys(fields)
    .filter(key => /^PROCESS_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .forEach((key, index) => {
      const parts = String(fields[key] || '').split('|');
      const adapter = String(parts[0] || 'ps').trim() || 'ps';
      const pid = String(parts[1] || '').trim();
      const user = String(parts[2] || '').trim() || '—';
      const state = String(parts[3] || '').trim();
      const isZombie = /z/i.test(state);
      const cpu = formatServerProcessMetric(parts[4]);
      const memory = formatServerProcessMetric(parts[5]);
      const command = String(parts[6] || '').trim();
      const args = String(parts.slice(7).join('|') || command || '').trim();

      if (!/^\d+$/.test(pid)) {
        return;
      }

      processes.push({
        id: createServerProcessId(adapter, pid, index),
        pid,
        user,
        state: state || undefined,
        isZombie,
        cpu,
        memory,
        command: command || args || '—',
        args: args || command || '—',
        adapter,
        canKill: pid !== '1' && !isServerKernelThreadProcess(command, args)
      });
    });

  return processes.sort((left, right) => Number(left.pid) - Number(right.pid));
}

export function isServerKernelThreadProcess(command: unknown, args: unknown): boolean {
  const commandText = String(command ?? '').trim();
  const argsText = String(args ?? '').trim();
  const isBracketOnly = (value: string): boolean => /^\[[^\]]+\]$/.test(value);
  return isBracketOnly(commandText) || isBracketOnly(argsText);
}

export function formatServerProcessMetric(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '—';
  }
  if (text === '—' || text.endsWith('%') || /(?:bytes?|[KMGT]B|ms|s)$/i.test(text)) {
    return text;
  }
  return `${text}%`;
}

export function createServerProcessId(adapter: string, pid: string, index: number): string {
  const safeAdapter = String(adapter || 'process').replace(/[^A-Za-z0-9._-]/g, '-');
  const safePid = String(pid || 'pid').replace(/[^0-9]/g, '') || 'pid';
  return `${safeAdapter}-${safePid}-${index}`;
}

export function createServerServiceId(adapter: string, name: string, index: number): string {
  const safeAdapter = String(adapter || 'service').replace(/[^A-Za-z0-9._-]/g, '-');
  const safeName = String(name || 'item').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96) || 'item';
  return `${safeAdapter}-${safeName}-${index}`;
}

export function normalizeServerServiceStatus(adapter: string, rawStatus: string): ServerDashboardServiceItem['status'] {
  const text = String(rawStatus || '').trim().toLowerCase();
  const normalizedAdapter = String(adapter || '').trim().toLowerCase();

  if (normalizedAdapter === 'aix-src') {
    if (/\bactive\b/.test(text)) return 'running';
    if (/\binoperative\b/.test(text)) return 'stopped';
    return 'unknown';
  }

  if (normalizedAdapter === 'windows-service') {
    if (/^(?:4|true|started|running)$/i.test(text) || /\brunning\b|\bstart(?:ed| pending)\b|\bcontinue pending\b/.test(text)) return 'running';
    if (/^(?:1|false|stopped)$/i.test(text) || /\bstopped\b|\bstop pending\b|\bpaused\b|\bpause pending\b/.test(text)) return 'stopped';
  }

  if (/\bfailed\b|\berror\b/.test(text)) return 'failed';
  if (/\bactive\b|\brunning\b/.test(text)) return 'running';
  if (/\binactive\b|\bstopped\b|\bdead\b|\bexited\b/.test(text)) return 'stopped';
  return 'unknown';
}

export function formatServerServiceStatusLabel(status: ServerDashboardServiceItem['status']): string {
  switch (status) {
    case 'running': return 'Running';
    case 'stopped': return 'Stopped';
    case 'failed': return 'Failed';
    default: return 'Unknown';
  }
}

export function detectServerAdapter(fields: Record<string, string>, capabilities: string[]): string {
  const osName = String(fields.OS || '').trim().toLowerCase();
  const capabilitySet = new Set(capabilities.map(item => item.toLowerCase()));

  if (osName === 'windows') {
    return 'windows';
  }

  if (osName === 'linux') {
    if (fields.HAS_SYSTEMD === 'yes' || capabilitySet.has('systemctl')) {
      return 'linux-systemd';
    }
    if (capabilitySet.has('service')) {
      return 'linux-sysv';
    }
    return 'generic-unix';
  }

  if (osName === 'aix') {
    return capabilitySet.has('lssrc') ? 'aix-src' : 'generic-unix';
  }

  return osName ? 'generic-unix' : 'unknown';
}

export function formatServerSudoStatus(connection: any, sudoEnabled: boolean): string {
  if (String(connection?.remotePlatform || '').trim().toLowerCase() === 'windows') {
    return 'Unavailable on Windows';
  }

  const username = String(connection?.username || '').trim();
  if (username.toLowerCase() === 'root') {
    return 'Root user';
  }
  return sudoEnabled ? 'Enabled' : 'Disabled';
}

export function parseServerIdentity(idOutput: string | undefined, fallbackUserName?: string): { user: string; group: string } {
  const text = String(idOutput || '').trim();
  const uidMatch = /uid=(\d+)(?:\(([^)]+)\))?/i.exec(text);
  const gidMatch = /gid=(\d+)(?:\(([^)]+)\))?/i.exec(text);

  const uid = uidMatch?.[1] || '';
  const uidName = uidMatch?.[2] || String(fallbackUserName || '').trim();
  const gid = gidMatch?.[1] || '';
  const gidName = gidMatch?.[2] || '';

  return {
    user: formatServerIdentityValue(uidName, uid),
    group: formatServerIdentityValue(gidName, gid)
  };
}

export function formatServerIdentityValue(name: string | undefined, id: string | undefined): string {
  const normalizedName = String(name || '').trim();
  const normalizedId = String(id || '').trim();

  if (normalizedName && normalizedId) {
    return `${normalizedName} (${normalizedId})`;
  }
  if (normalizedName) {
    return normalizedName;
  }
  if (normalizedId) {
    return normalizedId;
  }
  return '—';
}

export function formatServerCapabilities(capabilities: string[]): string {
  const capabilitySet = new Set((capabilities || []).map(item => String(item || '').trim().toLowerCase()).filter(Boolean));
  const features: string[] = [];

  if (capabilitySet.has('powershell')) {
    features.push('PowerShell');
  }
  if (capabilitySet.has('systemctl') || capabilitySet.has('service') || capabilitySet.has('lssrc') || capabilitySet.has('services')) {
    features.push('Services');
  }
  if (capabilitySet.has('journalctl')) {
    features.push('Logs');
  }
  if (capabilitySet.has('crontab')) {
    features.push('Cron');
  }
  if (capabilitySet.has('scheduledtasks')) {
    features.push('Scheduled Tasks');
  }
  if (capabilitySet.has('ps')) {
    features.push('Processes');
  }
  if (capabilitySet.has('df')) {
    features.push('Disk');
  }
  if (capabilitySet.has('free') || capabilitySet.has('svmon')) {
    features.push('Memory');
  }

  return features.length ? features.join(', ') : '—';
}


export function buildServerOverviewDetails(fields: Record<string, string>): ServerDashboardOverviewDetails {
  return {
    uptime: parseServerUptimeDetails(fields.UPTIME_SECONDS, fields.UPTIME),
    load: parseServerLoadDetails(fields.UPTIME),
    memory: parseServerMemoryDetails(fields.MEMORY_DETAIL || fields.MEMORY),
    disk: parseServerDiskDetails(fields),
    sessions: parseServerSessionDetails(fields),
    listeners: parseServerListenerDetails(fields),
    swap: parseServerSwapDetails(fields.SWAP_DETAIL || fields.SWAP),
    ioWait: parseServerIoWaitDetails(fields.IO_WAIT_DETAIL || fields.IO_WAIT)
  };
}

export function parseServerUptimeDetails(secondsText: string | undefined, rawUptime: string | undefined): ServerDashboardUptimeDetail | undefined {
  const seconds = Number(String(secondsText || '').trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return { uptime: formatServerDuration(seconds) };
  }

  const formatted = formatServerUptime(undefined, rawUptime).value;
  return formatted && formatted !== '—' ? { uptime: formatted } : undefined;
}

export function parseServerLoadDetails(rawUptime: string | undefined): ServerDashboardLoadDetail | undefined {
  const raw = String(rawUptime || '').trim();
  const match = /load averages?:\s*([0-9.,]+)[, ]+([0-9.,]+)[, ]+([0-9.,]+)/i.exec(raw);
  if (!match) {
    return undefined;
  }

  return {
    oneMinute: formatServerLoadNumber(match[1]) || '—',
    fiveMinutes: formatServerLoadNumber(match[2]) || '—',
    fifteenMinutes: formatServerLoadNumber(match[3]) || '—'
  };
}

export function parseServerMemoryDetails(memoryText: string | undefined): ServerDashboardMemoryDetail | undefined {
  const parts = String(memoryText || '').split('|');
  const totalMb = Number(parts[0]);
  const usedMb = Number(parts[1]);
  const freeMb = Number(parts[2]);
  const availableMb = Number(parts[3]);
  const buffersCacheMb = Number(parts[4]);

  if (!Number.isFinite(totalMb) || totalMb <= 0 || !Number.isFinite(usedMb)) {
    return undefined;
  }

  const percent = Math.max(0, Math.min(100, Math.round((usedMb / totalMb) * 100)));
  return {
    total: formatBytes(totalMb * 1024 * 1024),
    used: formatBytes(usedMb * 1024 * 1024),
    free: Number.isFinite(freeMb) ? formatBytes(freeMb * 1024 * 1024) : '—',
    available: Number.isFinite(availableMb) ? formatBytes(availableMb * 1024 * 1024) : '—',
    buffersCache: Number.isFinite(buffersCacheMb) ? formatBytes(buffersCacheMb * 1024 * 1024) : '—',
    percent: `${percent}%`
  };
}

export function parseServerSwapDetails(swapText: string | undefined): ServerDashboardSwapDetail | undefined {
  const parts = String(swapText || '').split('|');
  const totalMb = Number(parts[0]);
  const usedMb = Number(parts[1]);
  const freeMb = Number(parts[2]);

  if (!Number.isFinite(totalMb)) {
    return undefined;
  }

  if (totalMb <= 0) {
    return {
      total: '0 B',
      used: '0 B',
      free: '0 B',
      percent: '0%',
      configured: false
    };
  }

  const safeUsedMb = Number.isFinite(usedMb) ? usedMb : 0;
  const safeFreeMb = Number.isFinite(freeMb) ? freeMb : Math.max(0, totalMb - safeUsedMb);
  const percent = Math.max(0, Math.min(100, Math.round((safeUsedMb / totalMb) * 100)));
  return {
    total: formatBytes(totalMb * 1024 * 1024),
    used: formatBytes(safeUsedMb * 1024 * 1024),
    free: formatBytes(safeFreeMb * 1024 * 1024),
    percent: `${percent}%`,
    configured: true
  };
}

export function parseServerIoWaitDetails(ioWaitText: string | undefined): ServerDashboardIoWaitDetail | undefined {
  const parts = String(ioWaitText || '').split('|');
  const wait = formatServerPercent(parts[0]);
  if (!wait) {
    return undefined;
  }

  return {
    wait,
    user: formatServerPercent(parts[1]) || '—',
    system: formatServerPercent(parts[2]) || '—',
    idle: formatServerPercent(parts[3]) || '—'
  };
}

export function formatServerPercent(value: string | undefined): string {
  const number = Number(String(value || '').trim().replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) {
    return '';
  }

  const normalized = number % 1 === 0 ? String(Math.round(number)) : number.toFixed(1).replace(/\.0$/, '');
  return `${normalized}%`;
}

export function parseServerDiskDetails(fields: Record<string, string>): ServerDashboardDiskDetail[] {
  const details: ServerDashboardDiskDetail[] = [];
  const seen = new Set<string>();

  Object.keys(fields)
    .filter(key => /^DISK_FS_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .forEach(key => {
      const parts = String(fields[key] || '').split('|');
      const filesystem = String(parts[0] || '').trim();
      const mount = String(parts[1] || '').trim();
      const totalKb = Number(parts[2]);
      const usedKb = Number(parts[3]);
      const freeKb = Number(parts[4]);
      const percent = String(parts[5] || '').trim();

      if (!filesystem || !mount || !Number.isFinite(totalKb) || totalKb <= 0 || isNoisyServerFilesystem(filesystem, mount)) {
        return;
      }

      const identity = `${filesystem}|${mount}`;
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);

      details.push({
        filesystem,
        mount,
        total: formatBytes(totalKb * 1024),
        used: Number.isFinite(usedKb) ? formatBytes(usedKb * 1024) : '—',
        free: Number.isFinite(freeKb) ? formatBytes(freeKb * 1024) : '—',
        percent: percent || (Number.isFinite(usedKb) ? `${Math.round((usedKb / totalKb) * 100)}%` : '—'),
        totalBytes: totalKb * 1024,
        usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : 0,
        freeBytes: Number.isFinite(freeKb) ? freeKb * 1024 : 0
      });
    });

  if (!details.length) {
    const root = parseRootDiskDetail(fields.DISK_ROOT);
    if (root) {
      details.push(root);
    }
  }

  return details.sort((left, right) => {
    if (left.mount === '/') return -1;
    if (right.mount === '/') return 1;
    return left.mount.localeCompare(right.mount, undefined, { sensitivity: 'base' });
  });
}

export function parseRootDiskDetail(diskText: string | undefined): ServerDashboardDiskDetail | undefined {
  const parts = String(diskText || '').split('|');
  const totalKb = Number(parts[0]);
  const usedKb = Number(parts[1]);
  const freeKb = Number(parts[2]);
  const percent = String(parts[3] || '').trim();

  if (!Number.isFinite(totalKb) || totalKb <= 0) {
    return undefined;
  }

  return {
    filesystem: '/',
    mount: '/',
    total: formatBytes(totalKb * 1024),
    used: Number.isFinite(usedKb) ? formatBytes(usedKb * 1024) : '—',
    free: Number.isFinite(freeKb) ? formatBytes(freeKb * 1024) : '—',
    percent: percent || (Number.isFinite(usedKb) ? `${Math.round((usedKb / totalKb) * 100)}%` : '—'),
    totalBytes: totalKb * 1024,
    usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : 0,
    freeBytes: Number.isFinite(freeKb) ? freeKb * 1024 : 0
  };
}

export function isNoisyServerFilesystem(filesystem: string, mount: string): boolean {
  const fs = String(filesystem || '').trim().toLowerCase();
  const target = String(mount || '').trim().toLowerCase();
  if (!fs || !target) {
    return true;
  }

  if (target === '/') {
    return false;
  }

  if (/^(proc|sysfs|devtmpfs|devfs|cgroup|cgroup2|pstore|securityfs|debugfs|tracefs|configfs|fusectl|mqueue|hugetlbfs|autofs|binfmt_misc|rpc_pipefs|squashfs|overlay)$/i.test(fs)) {
    return true;
  }

  if (/^(tmpfs|udev)$/i.test(fs) && !/^\/(home|var|opt|srv|data|mnt|media)\b/.test(target)) {
    return true;
  }

  if (/^\/(proc|sys|dev|run|var\/run|snap)\b/.test(target)) {
    return true;
  }

  return false;
}

export function parseServerSessionDetails(fields: Record<string, string>): ServerDashboardSessionDetail[] {
  return Object.keys(fields)
    .filter(key => /^SESSION_DETAIL_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .map(key => {
      const parts = String(fields[key] || '').split('|');
      return {
        user: String(parts[0] || '').trim() || '—',
        tty: String(parts[1] || '').trim() || '—',
        from: String(parts[2] || '').trim() || 'local',
        loginTime: String(parts.slice(3).join('|') || '').trim() || '—'
      };
    })
    .filter(item => item.user !== '—');
}

export function parseServerListenerDetails(fields: Record<string, string>): ServerDashboardListenerDetail[] {
  const seen = new Set<string>();
  const details: ServerDashboardListenerDetail[] = [];

  Object.keys(fields)
    .filter(key => /^LISTENER_DETAIL_\d+$/i.test(key))
    .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
    .forEach(key => {
      const parts = String(fields[key] || '').split('|');
      const protocol = String(parts[0] || '').trim().toLowerCase();
      const localAddress = String(parts[1] || '').trim() || '—';
      const port = String(parts[2] || '').trim() || '—';
      const state = String(parts[3] || '').trim() || (protocol.startsWith('tcp') ? 'LISTEN' : '—');
      if (!protocol || !/^(tcp|udp)/.test(protocol)) {
        return;
      }

      const identity = `${protocol}|${localAddress}|${port}|${state}`;
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);
      details.push({ protocol, localAddress, port, state });
    });

  return details.sort((left, right) => {
    const protoDelta = left.protocol.localeCompare(right.protocol);
    if (protoDelta !== 0) return protoDelta;
    const portDelta = Number(left.port) - Number(right.port);
    if (Number.isFinite(portDelta) && portDelta !== 0) return portDelta;
    return left.localAddress.localeCompare(right.localAddress);
  });
}

export function formatServerUptime(secondsText: string | undefined, rawUptime: string | undefined): ServerDashboardOverviewItem {
  const seconds = Number(String(secondsText || '').trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return { label: 'Uptime', value: formatServerDuration(seconds), help: 'System uptime' };
  }

  const raw = String(rawUptime || '').trim();
  const match = /\bup\s+(.+?)(?:,\s+\d+\s+users?|,\s+load averages?:|,\s+load average:|$)/i.exec(raw);
  const duration = formatServerUptimeText(match?.[1] || raw);
  return { label: 'Uptime', value: duration || '—', help: duration ? 'System uptime' : 'Not available' };
}

export function formatServerDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(0, minutes)}m`;
}

export function formatServerUptimeText(value: string | undefined): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const daysMatch = /(\d+)\s+days?/i.exec(text);
  const hoursMinutesMatch = /(\d+):(\d{2})/.exec(text);
  if (daysMatch || hoursMinutesMatch) {
    const days = Number(daysMatch?.[1] || 0);
    const hours = Number(hoursMinutesMatch?.[1] || 0);
    const minutes = Number(hoursMinutesMatch?.[2] || 0);
    const totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60);
    if (totalSeconds > 0) {
      return formatServerDuration(totalSeconds);
    }
  }

  const hourMatch = /(\d+)\s*(?:hours?|hrs?|h)\b/i.exec(text);
  const minuteMatch = /(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(text);
  if (hourMatch || minuteMatch) {
    const hours = Number(hourMatch?.[1] || 0);
    const minutes = Number(minuteMatch?.[1] || 0);
    const totalSeconds = (hours * 3600) + (minutes * 60);
    if (totalSeconds > 0) {
      return formatServerDuration(totalSeconds);
    }
  }

  return '';
}

export function formatServerLoad(rawUptime: string | undefined): ServerDashboardOverviewItem {
  const raw = String(rawUptime || '').trim();
  const match = /load averages?:\s*([0-9.,]+)[, ]+([0-9.,]+)[, ]+([0-9.,]+)/i.exec(raw);
  if (match) {
    const one = formatServerLoadNumber(match[1]);
    const five = formatServerLoadNumber(match[2]);
    const fifteen = formatServerLoadNumber(match[3]);
    return { label: 'Load', value: one || '—', help: five && fifteen ? `5m ${five} • 15m ${fifteen}` : 'Not available' };
  }

  return { label: 'Load', value: '—', help: 'Not available' };
}

export function formatServerLoadNumber(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/[,.]+$/, '')
    .replace(',', '.');
}

export function formatServerMemory(memoryText: string | undefined): ServerDashboardOverviewItem {
  const parts = String(memoryText || '').split('|');
  const totalMb = Number(parts[0]);
  const usedMb = Number(parts[1]);

  if (Number.isFinite(totalMb) && totalMb > 0 && Number.isFinite(usedMb)) {
    const percent = Math.max(0, Math.min(100, Math.round((usedMb / totalMb) * 100)));
    return {
      label: 'Memory',
      value: `${percent}%`,
      help: `${formatBytes(usedMb * 1024 * 1024)} / ${formatBytes(totalMb * 1024 * 1024)}`
    };
  }

  return { label: 'Memory', value: '—', help: 'Not available' };
}

export function formatServerDisk(diskText: string | undefined): ServerDashboardOverviewItem {
  const parts = String(diskText || '').split('|');
  const totalKb = Number(parts[0]);
  const usedKb = Number(parts[1]);
  const freeKb = Number(parts[2]);
  const percentText = String(parts[3] || '').trim();

  if (Number.isFinite(totalKb) && totalKb > 0 && Number.isFinite(usedKb)) {
    const value = percentText || `${Math.round((usedKb / totalKb) * 100)}%`;
    const usedLabel = formatBytes(usedKb * 1024);
    const totalLabel = formatBytes(totalKb * 1024);
    const freeLabel = Number.isFinite(freeKb) ? formatBytes(freeKb * 1024) : '';
    return {
      label: 'Disk',
      value,
      help: `${usedLabel} / ${totalLabel}${freeLabel ? ` • ${freeLabel} free` : ''}`
    };
  }

  return { label: 'Disk', value: '—', help: 'Not available' };
}

export function formatServerSessions(sessionsText: string | undefined): ServerDashboardOverviewItem {
  const parts = String(sessionsText || '').split('|');
  const count = Number(parts[0]);
  const users = String(parts.slice(1).join('|') || '').trim();

  if (Number.isFinite(count) && count >= 0) {
    return {
      label: 'Sessions',
      value: String(count),
      help: users || (count === 1 ? '1 session' : 'logged in')
    };
  }

  return { label: 'Sessions', value: '—', help: 'Not available' };
}

export function formatServerListeners(listenersText: string | undefined): ServerDashboardOverviewItem {
  const parts = String(listenersText || '').split('|');
  const total = Number(parts[0]);
  const tcp = Number(parts[1]);
  const udp = Number(parts[2]);

  if (Number.isFinite(total) && total >= 0) {
    const details: string[] = [];
    if (Number.isFinite(tcp)) {
      details.push(`${tcp} tcp`);
    }
    if (Number.isFinite(udp)) {
      details.push(`${udp} udp`);
    }

    return {
      label: 'Listeners',
      value: String(total),
      help: details.length ? details.join(', ') : 'listening ports'
    };
  }

  return { label: 'Listeners', value: '—', help: 'Not available' };
}

export function formatServerSwap(swapText: string | undefined): ServerDashboardOverviewItem {
  const parts = String(swapText || '').split('|');
  const totalMb = Number(parts[0]);
  const usedMb = Number(parts[1]);

  if (Number.isFinite(totalMb) && totalMb <= 0) {
    return { label: 'Swap', value: 'None', help: 'not configured' };
  }

  if (Number.isFinite(totalMb) && totalMb > 0 && Number.isFinite(usedMb)) {
    const percent = Math.max(0, Math.min(100, Math.round((usedMb / totalMb) * 100)));
    return {
      label: 'Swap',
      value: `${percent}%`,
      help: `${formatBytes(usedMb * 1024 * 1024)} / ${formatBytes(totalMb * 1024 * 1024)}`
    };
  }

  return { label: 'Swap', value: '—', help: 'Not available' };
}

export function formatServerIoWait(ioWaitText: string | undefined): ServerDashboardOverviewItem {
  const text = String(ioWaitText || '').trim().replace(',', '.');
  const value = Number(text);

  if (Number.isFinite(value) && value >= 0) {
    const normalized = value % 1 === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
    return { label: 'IO Wait', value: `${normalized}%`, help: 'waiting on I/O' };
  }

  return { label: 'IO Wait', value: '—', help: 'Not available' };
}

export function formatServerTime(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '—';
  }

  return text.replace(/([+-]\d{2})(\d{2})\b/, 'UTC$1:$2');
}

export function formatServerRefreshTime(timestamp: number): string {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${time} local`;
}


