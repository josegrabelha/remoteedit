import * as vscode from 'vscode';

export type OutputLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
export type OutputLogDetails = Record<string, string | number | boolean | undefined | null>;

export function appendOutputLog(
  output: vscode.OutputChannel,
  level: OutputLogLevel,
  message: string,
  details?: OutputLogDetails
): void {
  output.appendLine(`[${formatLocalTimestamp()}] [${level}] ${message}`);

  if (!details) {
    return;
  }

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    output.appendLine(`    ${key}: ${String(value)}`);
  }
}

function formatLocalTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
