import * as vscode from 'vscode';
import { toolViews } from './ToolNavigationActions';

/** Only the three existing open commands may be invoked by navigation messages. */
export async function handleToolNavigation(message: any): Promise<boolean> {
  if (message?.type !== 'toolNavigation') return false;
  const destination = toolViews.find(view => view.id === message.payload?.destination);
  if (destination) await vscode.commands.executeCommand(destination.command);
  return true;
}
