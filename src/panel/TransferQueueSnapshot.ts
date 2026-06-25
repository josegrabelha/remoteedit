import type { ActiveTransferState, QueuedTransferJob, TransferQueueItemSnapshot, TransferQueueStateSnapshot } from './PanelTypes';

export function buildTransferQueueItemSnapshot(
  job: QueuedTransferJob,
  status: TransferQueueItemSnapshot['status'],
  canCancel: boolean
): TransferQueueItemSnapshot {
  return {
    id: job.id,
    operation: job.operation,
    title: job.title,
    connectionId: job.connectionId,
    connection: job.connectionLabel,
    from: job.from,
    to: job.to,
    status,
    progress: job.progress || (status === 'Waiting' ? '--' : ''),
    canCancel,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    skippedItems: job.resultSummary?.skippedItems.slice(),
    failedItems: job.resultSummary?.failedItems.slice(),
    canceledItems: job.resultSummary?.canceledItems.slice()
  };
}

export function buildTransferQueueStateSnapshot(
  activeTransfers: Iterable<ActiveTransferState>,
  pendingTransfers: readonly QueuedTransferJob[],
  completedTransfers: readonly TransferQueueItemSnapshot[]
): TransferQueueStateSnapshot {
  const currentTransfers = Array.from(activeTransfers).map(activeTransfer => buildTransferQueueItemSnapshot(
    activeTransfer.job,
    activeTransfer.canceling ? 'Canceling' : activeTransfer.status,
    !activeTransfer.canceling
  ));

  return {
    current: currentTransfers[0],
    currentTransfers,
    pending: pendingTransfers.map(job => buildTransferQueueItemSnapshot(job, 'Waiting', false)),
    completed: completedTransfers.slice()
  };
}
