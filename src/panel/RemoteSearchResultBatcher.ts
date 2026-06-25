import type { RemoteSearchResult, RemoteSearchResultMeta } from '../search/RemoteSearchService';
import { RemoteEditOutboundMessageType } from './PanelMessages';
import type { PendingRemoteSearchResultBatch } from './PanelTypes';

export class RemoteSearchResultBatcher {
  private readonly pendingBatches = new Map<string, PendingRemoteSearchResultBatch>();

  constructor(private readonly postMessage: (type: RemoteEditOutboundMessageType, payload: any) => void) {}

  queue(result: RemoteSearchResult, meta: RemoteSearchResultMeta): void {
    const connectionId = meta.connectionId;
    let batch = this.pendingBatches.get(connectionId);
    if (!batch || batch.meta.searchId !== meta.searchId) {
      if (batch) {
        this.flush(connectionId);
      }
      batch = { meta: { ...meta }, results: [] };
      this.pendingBatches.set(connectionId, batch);
    }

    batch.meta = { ...meta };
    batch.results.push(result);

    if (!batch.timer) {
      batch.timer = setTimeout(() => this.flush(connectionId), 100);
    }
  }

  flush(connectionId: string): void {
    const batch = this.pendingBatches.get(connectionId);
    if (!batch) {
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = undefined;
    }

    if (!batch.results.length) {
      this.pendingBatches.delete(connectionId);
      return;
    }

    const results = batch.results.splice(0, batch.results.length);
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchResultsBatch, {
      connectionId: batch.meta.connectionId,
      results,
      status: batch.meta.status,
      searchId: batch.meta.searchId,
      totalResults: batch.meta.totalResults
    });
    this.pendingBatches.delete(connectionId);
  }

  clear(connectionId: string): void {
    const batch = this.pendingBatches.get(connectionId);
    if (batch?.timer) {
      clearTimeout(batch.timer);
    }
    this.pendingBatches.delete(connectionId);
  }

  clearAll(): void {
    for (const batch of this.pendingBatches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }
    this.pendingBatches.clear();
  }
}
