export function formatRemoteFileOpenFailureReason(error: unknown, remotePath?: string): string {
  let text = error instanceof Error ? error.message : String(error || '');
  const path = String(remotePath || '').trim();

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)[0] || '';

  text = text
    .replace(/^(?:error|details):\s*/i, '')
    .replace(/^_?[a-z]*stat:\s*/i, '')
    .replace(/^getConnection:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/no such file|not found|does not exist/i.test(text)) {
    const match = /(no such file[^:]*|not found|does not exist)[:\s]*(.*)$/i.exec(text);
    const messagePath = String(match?.[2] || '').trim();
    return `No such file${messagePath || path ? `: ${messagePath || path}` : ''}`;
  }

  if (/permission denied|access denied/i.test(text)) {
    return 'Permission denied.';
  }

  if (/is a directory/i.test(text)) {
    return 'Remote path is a directory, not a file.';
  }

  return text || 'Unknown error';
}
