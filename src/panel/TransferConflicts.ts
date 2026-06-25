import * as path from 'path';
import { formatBytes } from '../utils/progressUtils';
import type { PendingTransferConflict, TransferConflictChoice } from './PanelTypes';
import { toPosixRelativePath } from './TransferUtils';

export function buildNativeTransferConflictMessage(options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>): string {
  const operation = options.operation.toLowerCase();

  if (options.kind === 'directory') {
    return `Remote Edit: ${operation} folder conflict. The directory already exists. What would you like to do?`;
  }

  if (options.kind === 'typeMismatch') {
    return `Remote Edit: ${operation} type conflict. ${buildTypeMismatchConflictMessage(options as PendingTransferConflict)}`;
  }

  return `Remote Edit: ${operation} file conflict. The file already exists. What would you like to do?`;
}

export function buildNativeTransferConflictDetail(options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>): string {
  const lines = [
    `Item: ${options.relativePath}`,
    `Source: ${options.sourcePath}`,
    `Destination: ${options.destinationPath}`
  ];

  if (options.kind === 'directory') {
    lines.push('', 'Merge uses the existing directory and copies content into it. It does not delete extra files already in the destination.');
  }

  return lines.join('\n');
}

export function buildTransferConflictDialogPayload(conflict: PendingTransferConflict, formatTimestampForDialog: (value: number) => string): any {
  const itemName = path.posix.basename(toPosixRelativePath(conflict.relativePath)) || toPosixRelativePath(conflict.relativePath);
  const isUpload = conflict.operation === 'Upload';
  const action = isUpload ? 'Upload' : 'Download';
  const lowerAction = action.toLowerCase();
  const title = conflict.kind === 'directory'
    ? `${action} folder conflict`
    : `${action} conflict`;
  const message = conflict.kind === 'directory'
    ? 'A folder with the same name already exists in the destination.'
    : conflict.kind === 'typeMismatch'
      ? buildTypeMismatchConflictMessage(conflict)
      : 'A file with the same name already exists in the destination.';

  return {
    requestId: conflict.requestId,
    operation: conflict.operation,
    kind: conflict.kind,
    title,
    message,
    itemName,
    relativePath: conflict.relativePath,
    sourcePath: conflict.sourcePath,
    destinationPath: conflict.destinationPath,
    sourceType: conflict.sourceType,
    destinationType: conflict.destinationType,
    sourceSize: conflict.sourceSize && conflict.sourceSize > 0 ? formatBytes(conflict.sourceSize) : '',
    destinationSize: conflict.destinationSize && conflict.destinationSize > 0 ? formatBytes(conflict.destinationSize) : '',
    sourceModified: formatTimestampForDialog(conflict.sourceModified || 0),
    destinationModified: formatTimestampForDialog(conflict.destinationModified || 0),
    choices: buildTransferConflictChoices(conflict),
    note: conflict.kind === 'directory'
      ? 'Merge uses the existing folder and copies content into it. It does not delete extra files already in the destination.'
      : conflict.kind === 'file' && conflict.hasMultipleItems
        ? 'Overwrite All and Skip All apply only to future file conflicts in this transfer.'
        : '',
    lowerAction
  };
}

export function buildTypeMismatchConflictMessage(conflict: PendingTransferConflict): string {
  if (conflict.sourceType.toLowerCase().includes('folder')) {
    return 'A folder cannot be copied because a file with the same name already exists in the destination.';
  }

  return 'A file cannot be copied because a folder with the same name already exists in the destination.';
}

export function buildTransferConflictChoices(conflict: PendingTransferConflict): Array<{ label: string; decision: TransferConflictChoice; primary?: boolean; danger?: boolean }> {
  if (conflict.kind === 'typeMismatch') {
    return [
      { label: 'Skip', decision: 'skip' },
      { label: 'Cancel', decision: 'cancel', danger: true }
    ];
  }

  if (conflict.kind === 'directory') {
    const choices: Array<{ label: string; decision: TransferConflictChoice; primary?: boolean; danger?: boolean }> = [
      { label: 'Merge', decision: 'merge', primary: true },
      { label: 'Skip', decision: 'skip' }
    ];

    if (conflict.hasMultipleItems) {
      choices.push({ label: 'Merge All', decision: 'mergeAll' });
      choices.push({ label: 'Skip All', decision: 'skipAll' });
    }

    choices.push({ label: 'Cancel', decision: 'cancel', danger: true });
    return choices;
  }

  if (!conflict.hasMultipleItems) {
    return [
      { label: 'Overwrite', decision: 'overwrite', primary: true },
      { label: 'Cancel', decision: 'cancel', danger: true }
    ];
  }

  return [
    { label: 'Overwrite', decision: 'overwrite', primary: true },
    { label: 'Skip', decision: 'skip' },
    { label: 'Overwrite All', decision: 'overwriteAll' },
    { label: 'Skip All', decision: 'skipAll' },
    { label: 'Cancel', decision: 'cancel', danger: true }
  ];
}

export function isValidTransferConflictChoice(value: string): value is TransferConflictChoice {
  return value === 'overwrite'
    || value === 'skip'
    || value === 'overwriteAll'
    || value === 'skipAll'
    || value === 'cancel'
    || value === 'merge'
    || value === 'mergeAll';
}
