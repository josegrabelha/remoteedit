export type RemotePlatform = 'posix' | 'windows' | 'unknown';
export type RemoteShell = 'sh' | 'cmd' | 'powershell' | 'unknown';

export function normalizeRemotePlatform(value: unknown): RemotePlatform {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'windows' || normalized === 'win32') {
    return 'windows';
  }

  if (normalized === 'posix' || normalized === 'unix' || normalized === 'linux' || normalized === 'aix' || normalized === 'darwin' || normalized === 'freebsd') {
    return 'posix';
  }

  return 'unknown';
}

export function isWindowsRemotePlatform(value: unknown): boolean {
  return normalizeRemotePlatform(value) === 'windows';
}

export function isPosixCompatibleRemotePlatform(value: unknown): boolean {
  const platform = normalizeRemotePlatform(value);
  return platform === 'posix' || platform === 'unknown';
}

export function getCapabilityPlatform(value: unknown): RemotePlatform {
  const platform = normalizeRemotePlatform(value);
  return platform === 'windows' ? 'windows' : 'posix';
}
