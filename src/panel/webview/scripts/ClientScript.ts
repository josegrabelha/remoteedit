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
  permissionsDisplayMode: string;
}

export function renderClientScript(options: ClientScriptOptions): string {
  const showRemotePathBreadcrumbDirectoryDetails = options.showRemotePathBreadcrumbDirectoryDetails !== false;
  const openFileListItemsOnNameClick = options.openFileListItemsOnNameClick !== false;
  const permissionsDisplayMode = options.permissionsDisplayMode || 'symbolic';

  return renderStateDialogs(showRemotePathBreadcrumbDirectoryDetails, openFileListItemsOnNameClick, permissionsDisplayMode) +
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
