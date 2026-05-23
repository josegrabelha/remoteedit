export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteTempPath(connectionId: string, remotePath: string): string {
  const safeConnectionId = connectionId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) || 'connection';
  const rawBaseName = remotePath.split('/').filter(Boolean).pop() || 'file';
  const safeBaseName = rawBaseName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'file';
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `/tmp/.remoteedit-${safeConnectionId}-${Date.now()}-${randomPart}-${safeBaseName}.tmp`;
}

export function buildSudoErrorMessage(rawMessage: string): string {
  const cleanedMessage = String(rawMessage || '').replace(/\r/g, '').trim();
  const lowerMessage = cleanedMessage.toLowerCase();

  if (lowerMessage.includes('a terminal is required') || lowerMessage.includes('must have a tty')) {
    return 'Sudo requires a TTY on this host. RemoteEdit sudo mode currently supports sudo -S without requiretty.';
  }

  if (lowerMessage.includes('sorry, try again') || lowerMessage.includes('incorrect password') || lowerMessage.includes('authentication failure')) {
    return 'Invalid sudo password.';
  }

  if (lowerMessage.includes('not in the sudoers file') || lowerMessage.includes('may not run sudo')) {
    return 'This user is not allowed to run sudo on this host.';
  }

  return cleanedMessage || 'Sudo command failed.';
}
