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
