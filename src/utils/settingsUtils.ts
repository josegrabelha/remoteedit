import * as vscode from 'vscode';

export function getNumberSetting(
  key: string,
  defaultValue: number,
  minValue: number,
  maxValue: number
): number {
  const value = vscode.workspace.getConfiguration('remoteedit').get<number>(key, defaultValue);

  if (!Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.min(maxValue, Math.max(minValue, value));
}


export function getStringSetting(key: string, defaultValue: string): string {
  const value = vscode.workspace.getConfiguration('remoteedit').get<string>(key, defaultValue);

  if (typeof value !== 'string') {
    return defaultValue;
  }

  const trimmedValue = value.trim();
  return trimmedValue || defaultValue;
}


export function getBooleanSetting(key: string, defaultValue: boolean): boolean {
  const value = vscode.workspace.getConfiguration('remoteedit').get<boolean>(key, defaultValue);

  return typeof value === 'boolean' ? value : defaultValue;
}
