import { renderStateDialogs } from './StateDialogs';
import { renderEventBindings } from './EventBindings';
import { renderTransferContextActions } from './TransferContextActions';
import { renderTextEditContextMenu } from './TextEditContextMenu';
import { renderLayoutSessions } from './LayoutSessions';
import { renderServerStorageRefresh } from './ServerStorageRefresh';
import { renderServerOverviewLists } from './ServerOverviewLists';
import { renderServerJobsPortsActions } from './ServerJobsPortsActions';
import { renderRemoteCommandActions } from './RemoteCommandActions';
import { renderRemoteCommandOutput } from './RemoteCommandOutput';
import { renderRemoteCommandLists } from './RemoteCommandLists';
import { renderOwnerGroupProperties } from './OwnerGroupProperties';
import { renderRemoteSearch } from './RemoteSearch';
import { renderFileBrowser } from './FileBrowser';
import { renderTransfersStatus } from './TransfersStatus';

export interface ClientScriptOptions {
  showRemotePathBreadcrumbDirectoryDetails: boolean;
  openFileListItemsOnNameClick: boolean;
}

export function renderClientScript(options: ClientScriptOptions): string {
  const showRemotePathBreadcrumbDirectoryDetails = options.showRemotePathBreadcrumbDirectoryDetails !== false;
  const openFileListItemsOnNameClick = options.openFileListItemsOnNameClick !== false;

  return renderStateDialogs(showRemotePathBreadcrumbDirectoryDetails, openFileListItemsOnNameClick) +
    renderEventBindings() +
    renderTransferContextActions() +
    renderTextEditContextMenu() +
    renderLayoutSessions() +
    renderServerStorageRefresh() +
    renderServerOverviewLists() +
    renderServerJobsPortsActions() +
    renderRemoteCommandActions() +
    renderRemoteCommandOutput() +
    renderRemoteCommandLists() +
    renderOwnerGroupProperties() +
    renderRemoteSearch() +
    renderFileBrowser() +
    renderTransfersStatus();
}
