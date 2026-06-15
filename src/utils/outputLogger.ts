import * as vscode from 'vscode';
import { getBooleanSetting } from './settingsUtils';

export type OutputLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'PERF';
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

export function isDebugLoggingEnabled(): boolean {
  return getBooleanSetting('diagnostics.debugLogs', false);
}

export function isPerformanceLoggingEnabled(): boolean {
  return getBooleanSetting('diagnostics.performanceLogs', false);
}

export function appendDebugLog(
  output: vscode.OutputChannel | undefined,
  source: string,
  message: string,
  details?: OutputLogDetails
): void {
  if (!output || !isDebugLoggingEnabled()) {
    return;
  }

  const inlineDetails = details
    ? Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ')
    : '';

  output.appendLine(`[${formatLocalTimestamp()}] [DEBUG] [${source}] ${message}${inlineDetails ? ` | ${inlineDetails}` : ''}`);
}

export function appendPerformanceLog(
  output: vscode.OutputChannel | undefined,
  source: string,
  message: string,
  details?: OutputLogDetails
): void {
  if (!output || !isPerformanceLoggingEnabled()) {
    return;
  }

  const inlineDetails = details
    ? Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ')
    : '';

  output.appendLine(`[${formatLocalTimestamp()}] [PERF] [${source}] ${message}${inlineDetails ? ` | ${inlineDetails}` : ''}`);
}

export function createPerformanceTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
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
