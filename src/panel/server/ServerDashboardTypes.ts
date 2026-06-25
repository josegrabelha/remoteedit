export interface ServerDashboardOverviewItem {
  label: string;
  value: string;
  help: string;
}

export interface ServerDashboardSystemInfoItem {
  label: string;
  value: string;
}

export interface ServerDashboardServiceItem {
  id: string;
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
  statusLabel: string;
  rawStatus: string;
  description: string;
  adapter: string;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
}

export interface ServerDashboardProcessItem {
  id: string;
  pid: string;
  user: string;
  state?: string;
  isZombie?: boolean;
  cpu: string;
  memory: string;
  command: string;
  args: string;
  adapter: string;
  canKill: boolean;
}

export interface ServerDashboardScheduledJobItem {
  id: string;
  name: string;
  countLabel: string;
  typeLabel: string;
  source: string;
  sourceType: string;
  user: string;
  path: string;
  canOpen: boolean;
  canEdit: boolean;
  copyValue: string;
}


export interface ServerDashboardSessionDetail {
  user: string;
  tty: string;
  from: string;
  loginTime: string;
}

export interface ServerDashboardListenerDetail {
  protocol: string;
  localAddress: string;
  port: string;
  state: string;
}

export interface ServerDashboardDiskDetail {
  filesystem: string;
  mount: string;
  total: string;
  used: string;
  free: string;
  percent: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface ServerDashboardMemoryDetail {
  total: string;
  used: string;
  free: string;
  available: string;
  buffersCache: string;
  percent: string;
}

export interface ServerDashboardSwapDetail {
  total: string;
  used: string;
  free: string;
  percent: string;
  configured: boolean;
}

export interface ServerDashboardLoadDetail {
  oneMinute: string;
  fiveMinutes: string;
  fifteenMinutes: string;
}

export interface ServerDashboardIoWaitDetail {
  wait: string;
  user: string;
  system: string;
  idle: string;
}

export interface ServerDashboardUptimeDetail {
  uptime: string;
}

export interface ServerDashboardOverviewDetails {
  uptime?: ServerDashboardUptimeDetail;
  load?: ServerDashboardLoadDetail;
  memory?: ServerDashboardMemoryDetail;
  disk?: ServerDashboardDiskDetail[];
  sessions?: ServerDashboardSessionDetail[];
  listeners?: ServerDashboardListenerDetail[];
  swap?: ServerDashboardSwapDetail;
  ioWait?: ServerDashboardIoWaitDetail;
}

export interface ServerDashboardSnapshot {
  connectionId: string;
  requestId: string;
  refreshedAt: number;
  overview: ServerDashboardOverviewItem[];
  overviewDetails: ServerDashboardOverviewDetails;
  systemInfo: ServerDashboardSystemInfoItem[];
  services: ServerDashboardServiceItem[];
  serviceAdapter: string;
  processes: ServerDashboardProcessItem[];
  processAdapter: string;
  scheduledJobs: ServerDashboardScheduledJobItem[];
  scheduledJobsAdapter: string;
  capabilities: string[];
  error?: string;
}
