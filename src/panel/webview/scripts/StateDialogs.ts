export function renderStateDialogs(showRemotePathBreadcrumbDirectoryDetails: boolean, openFileListItemsOnNameClick: boolean, permissionsDisplayMode: string): string {
  return `  const vscode = acquireVsCodeApi();
  let showRemotePathBreadcrumbDirectoryDetails = ${showRemotePathBreadcrumbDirectoryDetails ? 'true' : 'false'};
  let openFileListItemsOnNameClick = ${openFileListItemsOnNameClick ? 'true' : 'false'};
  let permissionsDisplayMode = normalizePermissionsDisplayMode('${permissionsDisplayMode}');

  function normalizePermissionsDisplayMode(value) {
    const mode = String(value || '').trim();
    return mode === 'numeric' || mode === 'both' ? mode : 'symbolic';
  }

  function permissionModeFromString(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^[0-7]{3,4}$/.test(text)) return text.padStart(4, '0');
    return permissionModeFromSymbolic(text);
  }

  function permissionModeFromSymbolic(permissions) {
    const text = String(permissions || '').trim();
    if (!/^[bcdlps-][rwxStTs-]{9}/.test(text)) return '';

    const chars = text.slice(1, 10);
    let mode = 0;

    if (chars[0] === 'r') mode |= 0o400;
    if (chars[1] === 'w') mode |= 0o200;
    if (chars[2] === 'x' || chars[2] === 's') mode |= 0o100;
    if (chars[2] === 's' || chars[2] === 'S') mode |= 0o4000;

    if (chars[3] === 'r') mode |= 0o040;
    if (chars[4] === 'w') mode |= 0o020;
    if (chars[5] === 'x' || chars[5] === 's') mode |= 0o010;
    if (chars[5] === 's' || chars[5] === 'S') mode |= 0o2000;

    if (chars[6] === 'r') mode |= 0o004;
    if (chars[7] === 'w') mode |= 0o002;
    if (chars[8] === 'x' || chars[8] === 't') mode |= 0o001;
    if (chars[8] === 't' || chars[8] === 'T') mode |= 0o1000;

    return (mode & 0o7777).toString(8).padStart(4, '0');
  }

  function formatPermissionsForDisplay(permissions, mode) {
    const text = String(permissions || '').trim();
    if (!text) return '';

    const octal = permissionModeFromString(text);
    if (!octal) return text;

    const isNumericText = /^[0-7]{3,4}$/.test(text);
    const displayMode = normalizePermissionsDisplayMode(mode || permissionsDisplayMode);
    if (displayMode === 'numeric') return octal;
    if (displayMode === 'both') return isNumericText ? octal : text + ' (' + octal + ')';
    return text;
  }

  function formatPermissionsPropertyValue(permissions) {
    const text = String(permissions || '').trim();
    if (!text) return '—';

    const octal = permissionModeFromString(text);
    if (!octal) return text;

    return /^[0-7]{3,4}$/.test(text) ? octal : text + ' (' + octal + ')';
  }

  const mainLayout = document.getElementById('mainLayout');
  const connectionResizeHandle = document.getElementById('connectionResizeHandle');
  const hideConnectionPanelButton = document.getElementById('hideConnectionPanelButton');
  const showConnectionPanelButton = document.getElementById('showConnectionPanelButton');
  const connectionRail = document.querySelector('.connection-rail');
  const connectionCard = document.querySelector('.connection-card');
  const browserCard = document.querySelector('.browser-card');
  const profileSelect = document.getElementById('profileSelect');
  const profileDropdownButton = document.getElementById('profileDropdownButton');
  const profileDropdownLabel = document.getElementById('profileDropdownLabel');
  const profileDropdownMenu = document.getElementById('profileDropdownMenu');
  const manageProfilesButton = document.getElementById('manageProfilesButton');
  const connectionNameBackdrop = document.getElementById('connectionNameBackdrop');
  const connectionNameInput = document.getElementById('connectionNameInput');
  const connectionNameFeedback = document.getElementById('connectionNameFeedback');
  const connectionNameCreateButton = document.getElementById('connectionNameCreateButton');
  const connectionNameCancelButton = document.getElementById('connectionNameCancelButton');
  const profileName = document.getElementById('profileName');
  const host = document.getElementById('host');
  const port = document.getElementById('port');
  const username = document.getElementById('username');
  const connectionNameGroup = document.getElementById('connectionNameGroup');
  const connectionNameGroupPicker = document.getElementById('connectionNameGroupPicker');
  const connectionNameGroupDropdownButton = document.getElementById('connectionNameGroupDropdownButton');
  const connectionNameGroupDropdownLabel = document.getElementById('connectionNameGroupDropdownLabel');
  const connectionNameGroupDropdownMenu = document.getElementById('connectionNameGroupDropdownMenu');
  const connectionNameGroupNewInput = document.getElementById('connectionNameGroupNewInput');
  const connectionType = document.getElementById('connectionType');
  const connectionTypeDropdownButton = document.getElementById('connectionTypeDropdownButton');
  const connectionTypeDropdownLabel = document.getElementById('connectionTypeDropdownLabel');
  const connectionTypeDropdownMenu = document.getElementById('connectionTypeDropdownMenu');
  const ftpsCertificateBlock = document.getElementById('ftpsCertificateBlock');
  const ftpsAllowSelfSignedCertificate = document.getElementById('ftpsAllowSelfSignedCertificate');
  const ftpsCaCertificateBlock = document.getElementById('ftpsCaCertificateBlock');
  const ftpsCaCertificatePath = document.getElementById('ftpsCaCertificatePath');
  const ftpsCaCertificateBrowseButton = document.getElementById('ftpsCaCertificateBrowseButton');
  const authType = document.getElementById('authType');
  const authMethodBlock = document.getElementById('authMethodBlock');
  const authDropdownButton = document.getElementById('authDropdownButton');
  const authDropdownLabel = document.getElementById('authDropdownLabel');
  const authDropdownMenu = document.getElementById('authDropdownMenu');
  const password = document.getElementById('password');
  const passwordRevealButton = document.getElementById('passwordRevealButton');
  const rememberPassword = document.getElementById('rememberPassword');
  const passwordSecretState = document.getElementById('passwordSecretState');
  const privateKeyPath = document.getElementById('privateKeyPath');
  const privateKeyBrowseButton = document.getElementById('privateKeyBrowseButton');
  const passphrase = document.getElementById('passphrase');
  const passphraseRevealButton = document.getElementById('passphraseRevealButton');
  const rememberPassphrase = document.getElementById('rememberPassphrase');
  const passphraseSecretState = document.getElementById('passphraseSecretState');
  const startPath = document.getElementById('startPath');
  const keepAlive = document.getElementById('keepAlive');
  const passwordBlock = document.getElementById('passwordBlock');
  const privateKeyBlock = document.getElementById('privateKeyBlock');
  const passphraseBlock = document.getElementById('passphraseBlock');
  const sessionTabs = document.getElementById('sessionTabs');
  const sessionTabsScrollbar = document.getElementById('sessionTabsScrollbar');
  const sessionTabsScrollbarThumb = document.getElementById('sessionTabsScrollbarThumb');
  const filesView = document.getElementById('filesView');
  const serverView = document.getElementById('serverView');
  const serverViewContent = document.getElementById('serverViewContent');
  const serverOverviewDetailsBackdrop = document.getElementById('serverOverviewDetailsBackdrop');
  const serverOverviewDetailsTitle = document.getElementById('serverOverviewDetailsTitle');
  const serverOverviewDetailsSubtitle = document.getElementById('serverOverviewDetailsSubtitle');
  const serverOverviewDetailsGrid = document.getElementById('serverOverviewDetailsGrid');
  const serverOverviewDetailsCopyButton = document.getElementById('serverOverviewDetailsCopyButton');
  const serverOverviewDetailsCloseButton = document.getElementById('serverOverviewDetailsCloseButton');
  const serverLogShortcutBackdrop = document.getElementById('serverLogShortcutBackdrop');
  const serverLogShortcutTitle = document.getElementById('serverLogShortcutTitle');
  const serverLogShortcutSubtitle = document.getElementById('serverLogShortcutSubtitle');
  const serverLogShortcutNameInput = document.getElementById('serverLogShortcutNameInput');
  const serverLogShortcutPathInput = document.getElementById('serverLogShortcutPathInput');
  const serverLogShortcutBrowseButton = document.getElementById('serverLogShortcutBrowseButton');
  const serverLogShortcutPathPicker = document.getElementById('serverLogShortcutPathPicker');
  const serverLogShortcutPathPickerPath = document.getElementById('serverLogShortcutPathPickerPath');
  const serverLogShortcutPathPickerList = document.getElementById('serverLogShortcutPathPickerList');
  const serverLogShortcutPathPickerCancelButton = document.getElementById('serverLogShortcutPathPickerCancelButton');
  const serverLogShortcutFeedback = document.getElementById('serverLogShortcutFeedback');
  const serverLogShortcutRemoveButton = document.getElementById('serverLogShortcutRemoveButton');
  const serverLogShortcutSaveButton = document.getElementById('serverLogShortcutSaveButton');
  const serverLogShortcutCancelButton = document.getElementById('serverLogShortcutCancelButton');
  const serverLogShortcutRemoveBackdrop = document.getElementById('serverLogShortcutRemoveBackdrop');
  const serverLogShortcutRemovePath = document.getElementById('serverLogShortcutRemovePath');
  const serverLogShortcutRemoveConfirmButton = document.getElementById('serverLogShortcutRemoveConfirmButton');
  const serverLogShortcutRemoveCancelButton = document.getElementById('serverLogShortcutRemoveCancelButton');
  const serverPortForwardBackdrop = document.getElementById('serverPortForwardBackdrop');
  const serverPortForwardTitle = document.getElementById('serverPortForwardTitle');
  const serverPortForwardSubtitle = document.getElementById('serverPortForwardSubtitle');
  const serverPortForwardNameInput = document.getElementById('serverPortForwardNameInput');
  const serverPortForwardLocalHostInput = document.getElementById('serverPortForwardLocalHostInput');
  const serverPortForwardLocalPortInput = document.getElementById('serverPortForwardLocalPortInput');
  const serverPortForwardRemoteHostInput = document.getElementById('serverPortForwardRemoteHostInput');
  const serverPortForwardRemotePortInput = document.getElementById('serverPortForwardRemotePortInput');
  const serverPortForwardAutoStartInput = document.getElementById('serverPortForwardAutoStartInput');
  const serverPortForwardRunningNote = document.getElementById('serverPortForwardRunningNote');
  const serverPortForwardFeedback = document.getElementById('serverPortForwardFeedback');
  const serverPortForwardDeleteButton = document.getElementById('serverPortForwardDeleteButton');
  const serverPortForwardSaveButton = document.getElementById('serverPortForwardSaveButton');
  const serverPortForwardCancelButton = document.getElementById('serverPortForwardCancelButton');
  const serverPortForwardRemoveBackdrop = document.getElementById('serverPortForwardRemoveBackdrop');
  const serverPortForwardRemovePath = document.getElementById('serverPortForwardRemovePath');
  const serverPortForwardRemoveConfirmButton = document.getElementById('serverPortForwardRemoveConfirmButton');
  const serverPortForwardRemoveCancelButton = document.getElementById('serverPortForwardRemoveCancelButton');
  const browserSectionDivider = document.querySelector('.browser-section-divider');
  const pathbar = document.querySelector('.pathbar');
  const currentPath = document.getElementById('currentPath');
  const remotePathLeadingIcon = document.querySelector('.remote-path-leading-icon');
  const SESSION_TAB_REMOTE_ICON = '<svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12 11.5C12 11.5989 11.9707 11.6956 11.9157 11.7778C11.8608 11.86 11.7827 11.9241 11.6913 11.9619C11.6 11.9998 11.4994 12.0097 11.4025 11.9904C11.3055 11.9711 11.2164 11.9235 11.1464 11.8536C11.0765 11.7836 11.0289 11.6945 11.0096 11.5975C10.9903 11.5006 11.0002 11.4 11.0381 11.3087C11.0759 11.2173 11.14 11.1392 11.2222 11.0843C11.3044 11.0293 11.4011 11 11.5 11C11.6326 11 11.7598 11.0527 11.8536 11.1464C11.9473 11.2402 12 11.3674 12 11.5ZM11.5 8C11.5989 8 11.6956 7.97068 11.7778 7.91573C11.86 7.86079 11.9241 7.7827 11.9619 7.69134C11.9998 7.59998 12.0097 7.49945 11.9904 7.40245C11.9711 7.30546 11.9235 7.21637 11.8536 7.14645C11.7836 7.07652 11.6945 7.0289 11.5975 7.00961C11.5006 6.99031 11.4 7.00022 11.3087 7.03806C11.2173 7.0759 11.1392 7.13999 11.0843 7.22221C11.0293 7.30444 11 7.40111 11 7.5C11 7.63261 11.0527 7.75979 11.1464 7.85355C11.2402 7.94732 11.3674 8 11.5 8ZM14 4.5C13.999 4.87026 13.86 5.22685 13.61 5.5C13.86 5.77315 13.999 6.12974 14 6.5V8.5C13.999 8.87026 13.86 9.22685 13.61 9.5C13.86 9.77315 13.999 10.1297 14 10.5V12.5C14 12.8978 13.842 13.2794 13.5607 13.5607C13.2794 13.842 12.8978 14 12.5 14H3.5C3.10218 14 2.72064 13.842 2.43934 13.5607C2.15804 13.2794 2 12.8978 2 12.5V10.5C2.00097 10.1297 2.14003 9.77315 2.39 9.5C2.14003 9.22685 2.00097 8.87026 2 8.5V6.5C2.00097 6.12974 2.14003 5.77315 2.39 5.5C2.14003 5.22685 2.00097 4.87026 2 4.5V2.5C2 2.10218 2.15804 1.72064 2.43934 1.43934C2.72064 1.15804 3.10218 1 3.5 1H12.5C12.8978 1 13.2794 1.15804 13.5607 1.43934C13.842 1.72064 14 2.10218 14 2.5V4.5ZM3 4.5C3 4.63261 3.05268 4.75979 3.14645 4.85355C3.24021 4.94732 3.36739 5 3.5 5H12.5C12.6326 5 12.7598 4.94732 12.8536 4.85355C12.9473 4.75979 13 4.63261 13 4.5V2.5C13 2.36739 12.9473 2.24021 12.8536 2.14645C12.7598 2.05268 12.6326 2 12.5 2H3.5C3.36739 2 3.24021 2.05268 3.14645 2.14645C3.05268 2.24021 3 2.36739 3 2.5V4.5ZM12.5 6H3.5C3.36739 6 3.24021 6.05268 3.14645 6.14645C3.05268 6.24021 3 6.36739 3 6.5V8.5C3 8.63261 3.05268 8.75979 3.14645 8.85355C3.24021 8.94732 3.36739 9 3.5 9H12.5C12.6326 9 12.7598 8.94732 12.8536 8.85355C12.9473 8.75979 13 8.63261 13 8.5V6.5C13 6.36739 12.9473 6.24021 12.8536 6.14645C12.7598 6.05268 12.6326 6 12.5 6ZM13 10.5C13 10.3674 12.9473 10.2402 12.8536 10.1464C12.7598 10.0527 12.6326 10 12.5 10H3.5C3.36739 10 3.24021 10.0527 3.14645 10.1464C3.05268 10.2402 3 10.3674 3 10.5V12.5C3 12.6326 3.05268 12.7598 3.14645 12.8536C3.24021 12.9473 3.36739 13 3.5 13H12.5C12.6326 13 12.7598 12.9473 12.8536 12.8536C12.9473 12.7598 13 12.6326 13 12.5V10.5ZM11.5 4C11.5989 4 11.6956 3.97068 11.7778 3.91573C11.86 3.86079 11.9241 3.7827 11.9619 3.69134C11.9998 3.59998 12.0097 3.49945 11.9904 3.40245C11.9711 3.30546 11.9235 3.21637 11.8536 3.14645C11.7836 3.07652 11.6945 3.0289 11.5975 3.00961C11.5006 2.99031 11.4 3.00022 11.3087 3.03806C11.2173 3.0759 11.1392 3.13999 11.0843 3.22221C11.0293 3.30444 11 3.40111 11 3.5C11 3.63261 11.0527 3.75979 11.1464 3.85355C11.2402 3.94732 11.3674 4 11.5 4Z"/></svg>';
  const SESSION_TAB_CONNECTING_ICON = '<div class="spinner" aria-hidden="true"></div>';
  const SESSION_TAB_ERROR_ICON = '<svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm0 2.06L2.72 13h10.56L8 3.56ZM7.25 6h1.5v3.8h-1.5V6Zm0 5h1.5v1.5h-1.5V11Z" /></svg>';
  const remotePathBox = document.getElementById('remotePathBox');
  const remotePathResizeHandle = document.getElementById('remotePathResizeHandle');
  const remotePathBreadcrumb = document.getElementById('remotePathBreadcrumb');
  const remotePathDropdown = document.getElementById('remotePathDropdown');
  const remotePathBackButton = document.getElementById('remotePathBackButton');
  const remotePathForwardButton = document.getElementById('remotePathForwardButton');
  const togglePathFavoriteButton = document.getElementById('togglePathFavoriteButton');
  const pathFavoritesButton = document.getElementById('pathFavoritesButton');
  const pathFavoritesPopover = document.getElementById('pathFavoritesPopover');
  const pathFavoritesList = document.getElementById('pathFavoritesList');
  const filterBox = document.getElementById('filterBox');
  const filterInput = document.getElementById('filterInput');
  const clearFilterButton = document.getElementById('clearFilterButton');
  const entriesTableWrap = document.getElementById('entriesTableWrap');
  const entriesTable = document.getElementById('entriesTable');
  const entriesBody = document.getElementById('entriesBody');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const statusOutputLink = document.getElementById('statusOutputLink');
  const statusCancelButton = document.getElementById('statusCancelButton');
  const statusCopyButton = document.getElementById('statusCopyButton');
  const statusCopyFeedback = document.getElementById('statusCopyFeedback');
  const webviewTooltip = document.getElementById('webviewTooltip');
  const inputPromptBackdrop = document.getElementById('inputPromptBackdrop');
  const inputPromptTitle = document.getElementById('inputPromptTitle');
  const inputPromptMessage = document.getElementById('inputPromptMessage');
  const inputPromptLabel = document.getElementById('inputPromptLabel');
  const inputPromptInputWrap = document.getElementById('inputPromptInputWrap');
  const inputPromptInput = document.getElementById('inputPromptInput');
  const inputPromptRevealButton = document.getElementById('inputPromptRevealButton');
  const inputPromptFeedback = document.getElementById('inputPromptFeedback');
  const inputPromptConfirmButton = document.getElementById('inputPromptConfirmButton');
  const inputPromptCancelButton = document.getElementById('inputPromptCancelButton');
  const browserSubtitle = document.getElementById('browserSubtitle');
  const serverRefreshActions = document.getElementById('serverRefreshActions');
  const serverToolbarStatus = document.getElementById('serverToolbarStatus');
  const serverAutoRefreshCountdown = document.getElementById('serverAutoRefreshCountdown');
  const serverRefreshButton = document.getElementById('serverRefreshButton');
  const serverAutoRefreshPicker = document.getElementById('serverAutoRefreshPicker');
  const serverAutoRefreshDropdownButton = document.getElementById('serverAutoRefreshDropdownButton');
  const serverAutoRefreshDropdownLabel = document.getElementById('serverAutoRefreshDropdownLabel');
  const serverAutoRefreshDropdownMenu = document.getElementById('serverAutoRefreshDropdownMenu');
  const serverRefreshActionsSeparator = document.getElementById('serverRefreshActionsSeparator');
  const commandActionsSeparator = document.getElementById('commandActionsSeparator');
  const commandActions = document.getElementById('commandActions');
  const transferActionsSeparator = document.getElementById('transferActionsSeparator');
  const transferActions = document.querySelector('.transfer-actions');
  const sudoToggleSeparator = document.getElementById('sudoToggleSeparator');
  const sudoToggleLabel = document.getElementById('sudoToggleLabel');
  const sudoToggle = document.getElementById('sudoToggle');
  const sudoToggleState = document.getElementById('sudoToggleState');

  const saveProfileButton = document.getElementById('saveProfileButton');
  const connectButton = document.getElementById('connectButton');
  const showSettingsButton = document.getElementById('showSettingsButton');
  const showOutputButton = document.getElementById('showOutputButton');
  const runRemoteCommandAction = document.getElementById('runRemoteCommandAction');
  const openSshTerminalAction = document.getElementById('openSshTerminalAction');
  const openLogViewerAction = document.getElementById('openLogViewerAction');
  const runRemoteCommandButton = document.getElementById('runRemoteCommandButton');
  const remoteCommandBadge = document.getElementById('remoteCommandBadge');
  const openSshTerminalButton = document.getElementById('openSshTerminalButton');
  const openLogViewerButton = document.getElementById('openLogViewerButton');
  const logViewerBadge = document.getElementById('logViewerBadge');
  const remoteSearchButton = document.getElementById('remoteSearchButton');
  const remoteSearchBadge = document.getElementById('remoteSearchBadge');
  const remoteSearchBackdrop = document.getElementById('remoteSearchBackdrop');
  const remoteSearchConnectedTo = document.getElementById('remoteSearchConnectedTo');
  const remoteSearchRunAs = document.getElementById('remoteSearchRunAs');
  const remoteSearchScopePath = document.getElementById('remoteSearchScopePath');
  const remoteSearchBrowseButton = document.getElementById('remoteSearchBrowseButton');
  const remoteSearchScopePicker = document.getElementById('remoteSearchScopePicker');
  const remoteSearchScopePickerPath = document.getElementById('remoteSearchScopePickerPath');
  const remoteSearchScopePickerList = document.getElementById('remoteSearchScopePickerList');
  const remoteSearchScopeSelectButton = document.getElementById('remoteSearchScopeSelectButton');
  const remoteSearchScopeCancelButton = document.getElementById('remoteSearchScopeCancelButton');
  const remoteSearchSubdirectories = document.getElementById('remoteSearchSubdirectories');
  const remoteSearchHiddenFiles = document.getElementById('remoteSearchHiddenFiles');
  const remoteSearchCaseSensitive = document.getElementById('remoteSearchCaseSensitive');
  const remoteSearchSudoRow = document.getElementById('remoteSearchSudoRow');
  const remoteSearchUseSudo = document.getElementById('remoteSearchUseSudo');
  const remoteSearchSudoNote = document.getElementById('remoteSearchSudoNote');
  const remoteSearchInsideRow = document.getElementById('remoteSearchInsideRow');
  const remoteSearchInsideFiles = document.getElementById('remoteSearchInsideFiles');
  const remoteSearchFileName = document.getElementById('remoteSearchFileName');
  const remoteSearchTextField = document.getElementById('remoteSearchTextField');
  const remoteSearchTextToFind = document.getElementById('remoteSearchTextToFind');
  const remoteSearchValidation = document.getElementById('remoteSearchValidation');
  const remoteSearchResultsStatus = document.getElementById('remoteSearchResultsStatus');
  const remoteSearchResults = document.getElementById('remoteSearchResults');
  const remoteSearchPrimaryButton = document.getElementById('remoteSearchPrimaryButton');
  const remoteSearchCopyButton = document.getElementById('remoteSearchCopyButton');
  const remoteSearchClearButton = document.getElementById('remoteSearchClearButton');
  const remoteSearchCloseButton = document.getElementById('remoteSearchCloseButton');
  const remoteSearchResultContextMenu = document.getElementById('remoteSearchResultContextMenu');
  const remoteSearchContextOpen = document.getElementById('remoteSearchContextOpen');
  const remoteSearchContextOpenReadOnly = document.getElementById('remoteSearchContextOpenReadOnly');
  const remoteSearchContextFileSeparator = document.getElementById('remoteSearchContextFileSeparator');
  const remoteSearchContextCopyPath = document.getElementById('remoteSearchContextCopyPath');
  const remoteSearchContextCopyName = document.getElementById('remoteSearchContextCopyName');
  const remoteSearchContextResultsSeparator = document.getElementById('remoteSearchContextResultsSeparator');
  const remoteSearchContextCopyResults = document.getElementById('remoteSearchContextCopyResults');
  const uploadButton = document.getElementById('uploadButton');
  const downloadButton = document.getElementById('downloadButton');
  const transferQueueButton = document.getElementById('transferQueueButton');
  const transferQueueTooltip = document.getElementById('transferQueueTooltip');
  const transferQueueCount = document.getElementById('transferQueueCount');
  const transferQueueModal = document.getElementById('transferQueueModal');
  const transferQueueFooterCloseButton = document.getElementById('transferQueueFooterCloseButton');
  const transferQueueCurrent = document.getElementById('transferQueueCurrent');
  const transferQueuePending = document.getElementById('transferQueuePending');
  const transferQueueCompleted = document.getElementById('transferQueueCompleted');
  const confirmDialogBackdrop = document.getElementById('confirmDialogBackdrop');
  const confirmDialogTitle = document.getElementById('confirmDialogTitle');
  const confirmDialogMessage = document.getElementById('confirmDialogMessage');
  const confirmDialogBody = document.getElementById('confirmDialogBody');
  const confirmDialogDetails = document.getElementById('confirmDialogDetails');
  const confirmDialogCopyButton = document.getElementById('confirmDialogCopyButton');
  const confirmDialogCancelButton = document.getElementById('confirmDialogCancelButton');
  const confirmDialogConfirmButton = document.getElementById('confirmDialogConfirmButton');
  const transferConflictBackdrop = document.getElementById('transferConflictBackdrop');
  const transferConflictDialog = transferConflictBackdrop ? transferConflictBackdrop.querySelector('.transfer-conflict-dialog') : null;
  const transferConflictTitle = document.getElementById('transferConflictTitle');
  const transferConflictMessage = document.getElementById('transferConflictMessage');
  const transferConflictName = document.getElementById('transferConflictName');
  const transferConflictPath = document.getElementById('transferConflictPath');
  const transferConflictSourceType = document.getElementById('transferConflictSourceType');
  const transferConflictSourcePath = document.getElementById('transferConflictSourcePath');
  const transferConflictSourceSize = document.getElementById('transferConflictSourceSize');
  const transferConflictSourceModified = document.getElementById('transferConflictSourceModified');
  const transferConflictDestinationType = document.getElementById('transferConflictDestinationType');
  const transferConflictDestinationPath = document.getElementById('transferConflictDestinationPath');
  const transferConflictDestinationSize = document.getElementById('transferConflictDestinationSize');
  const transferConflictDestinationModified = document.getElementById('transferConflictDestinationModified');
  const transferConflictNote = document.getElementById('transferConflictNote');
  const transferConflictActions = document.getElementById('transferConflictActions');
  const goButton = document.getElementById('goButton');
  const entryContextMenu = document.getElementById('entryContextMenu');
  const contextOpen = document.getElementById('contextOpen');
  const contextOpenReadOnly = document.getElementById('contextOpenReadOnly');
  const contextCompare = document.getElementById('contextCompare');
  const contextOpenSeparator = document.getElementById('contextOpenSeparator');
  const contextCreateFile = document.getElementById('contextCreateFile');
  const contextCreateDirectory = document.getElementById('contextCreateDirectory');
  const contextUpload = document.getElementById('contextUpload');
  const contextEmptyCopySeparator = document.getElementById('contextEmptyCopySeparator');
  const contextCopyCurrentPath = document.getElementById('contextCopyCurrentPath');
  const contextEmptyRefreshSeparator = document.getElementById('contextEmptyRefreshSeparator');
  const contextDownload = document.getElementById('contextDownload');
  const contextUploadEntry = document.getElementById('contextUploadEntry');
  const contextItemSeparator = document.getElementById('contextItemSeparator');
  const contextTransferSeparator = document.getElementById('contextTransferSeparator');
  const contextCopySeparator = document.getElementById('contextCopySeparator');
  const contextCutRemote = document.getElementById('contextCutRemote');
  const contextPasteRemoteHere = document.getElementById('contextPasteRemoteHere');
  const contextPasteRemote = document.getElementById('contextPasteRemote');
  const contextRemoteClipboardSeparator = document.getElementById('contextRemoteClipboardSeparator');
  const contextCopyPath = document.getElementById('contextCopyPath');
  const contextCopyName = document.getElementById('contextCopyName');
  const contextCompressSubmenu = document.getElementById('contextCompressSubmenu');
  const contextMakeCopy = document.getElementById('contextMakeCopy');
  const contextSetPermissions = document.getElementById('contextSetPermissions');
  const contextChangeOwnerGroup = document.getElementById('contextChangeOwnerGroup');
  const contextFileProperties = document.getElementById('contextFileProperties');
  const contextCalculateChecksums = document.getElementById('contextCalculateChecksums');
  const contextRename = document.getElementById('contextRename');
  const contextDeleteSeparator = document.getElementById('contextDeleteSeparator');
  const contextDelete = document.getElementById('contextDelete');
  const contextRefreshSeparator = document.getElementById('contextRefreshSeparator');
  const contextRefresh = document.getElementById('contextRefresh');
  const contextRunRemoteCommand = document.getElementById('contextRunRemoteCommand');
  const contextOpenLogViewer = document.getElementById('contextOpenLogViewer');
  const contextOpenSshTerminal = document.getElementById('contextOpenSshTerminal');
  const textEditContextMenu = document.getElementById('textEditContextMenu');
  const textEditContextUndo = document.getElementById('textEditContextUndo');
  const textEditContextRedo = document.getElementById('textEditContextRedo');
  const textEditContextCut = document.getElementById('textEditContextCut');
  const textEditContextCopy = document.getElementById('textEditContextCopy');
  const textEditContextPaste = document.getElementById('textEditContextPaste');
  const textEditContextSelectAll = document.getElementById('textEditContextSelectAll');

  const remoteCommandBackdrop = document.getElementById('remoteCommandBackdrop');
  const remoteCommandConnectedTo = document.getElementById('remoteCommandConnectedTo');
  const remoteCommandWorkingDirectory = document.getElementById('remoteCommandWorkingDirectory');
  const remoteCommandBrowseWorkingDirectoryButton = document.getElementById('remoteCommandBrowseWorkingDirectoryButton');
  const remoteCommandWorkingDirectoryPicker = document.getElementById('remoteCommandWorkingDirectoryPicker');
  const remoteCommandWorkingDirectoryPickerPath = document.getElementById('remoteCommandWorkingDirectoryPickerPath');
  const remoteCommandWorkingDirectoryPickerList = document.getElementById('remoteCommandWorkingDirectoryPickerList');
  const remoteCommandWorkingDirectorySelectButton = document.getElementById('remoteCommandWorkingDirectorySelectButton');
  const remoteCommandWorkingDirectoryCancelButton = document.getElementById('remoteCommandWorkingDirectoryCancelButton');
  const remoteCommandSudoRow = document.getElementById('remoteCommandSudoRow');
  const remoteCommandUseSudo = document.getElementById('remoteCommandUseSudo');
  const remoteCommandSudoNote = document.getElementById('remoteCommandSudoNote');
  const remoteCommandSaveCurrentButton = document.getElementById('remoteCommandSaveCurrentButton');
  const remoteCommandSavedList = document.getElementById('remoteCommandSavedList');
  const remoteCommandHistoryList = document.getElementById('remoteCommandHistoryList');
  const remoteCommandRunAs = document.getElementById('remoteCommandRunAs');
  const remoteCommandInput = document.getElementById('remoteCommandInput');
  const remoteCommandRunButton = document.getElementById('remoteCommandRunButton');
  const remoteCommandCopyButton = document.getElementById('remoteCommandCopyButton');
  const remoteCommandClearButton = document.getElementById('remoteCommandClearButton');
  const remoteCommandCloseButton = document.getElementById('remoteCommandCloseButton');
  const remoteCommandOutputWrap = document.getElementById('remoteCommandOutputWrap');
  const remoteCommandOutput = document.getElementById('remoteCommandOutput');
  const remoteCommandStatus = document.getElementById('remoteCommandStatus');
  const remoteCommandOutputNotice = document.getElementById('remoteCommandOutputNotice');
  const remoteCommandCloseWarning = document.getElementById('remoteCommandCloseWarning');
  const remoteCommandKeepRunningButton = document.getElementById('remoteCommandKeepRunningButton');
  const remoteCommandStopAndCloseButton = document.getElementById('remoteCommandStopAndCloseButton');
  const remoteCommandStopWarning = document.getElementById('remoteCommandStopWarning');
  const remoteCommandKeepStoppingButton = document.getElementById('remoteCommandKeepStoppingButton');
  const remoteCommandForceKillButton = document.getElementById('remoteCommandForceKillButton');

  const filePropertiesBackdrop = document.getElementById('filePropertiesBackdrop');
  const filePropertiesTitle = document.getElementById('filePropertiesTitle');
  const filePropertiesPath = document.getElementById('filePropertiesPath');
  const filePropertiesGrid = document.getElementById('filePropertiesGrid');
  const filePropertiesCopyPathButton = document.getElementById('filePropertiesCopyPathButton');
  const filePropertiesCloseButton = document.getElementById('filePropertiesCloseButton');
  const checksumsBackdrop = document.getElementById('checksumsBackdrop');
  const checksumsPath = document.getElementById('checksumsPath');
  const checksumsGrid = document.getElementById('checksumsGrid');
  const checksumsCopySha256Button = document.getElementById('checksumsCopySha256Button');
  const checksumsCopyMd5Button = document.getElementById('checksumsCopyMd5Button');
  const checksumsCopyAllButton = document.getElementById('checksumsCopyAllButton');
  const checksumsCloseButton = document.getElementById('checksumsCloseButton');
  const ownerGroupBackdrop = document.getElementById('ownerGroupBackdrop');
  const ownerGroupTitle = document.getElementById('ownerGroupTitle');
  const ownerGroupPath = document.getElementById('ownerGroupPath');
  const ownerGroupOwnerInput = document.getElementById('ownerGroupOwnerInput');
  const ownerGroupOwnerSuggestions = document.getElementById('ownerGroupOwnerSuggestions');
  const ownerGroupGroupInput = document.getElementById('ownerGroupGroupInput');
  const ownerGroupGroupSuggestions = document.getElementById('ownerGroupGroupSuggestions');
  const ownerGroupHelperBlock = document.getElementById('ownerGroupHelperBlock');
  const ownerGroupRecursiveRow = document.getElementById('ownerGroupRecursiveRow');
  const ownerGroupRecursiveInput = document.getElementById('ownerGroupRecursiveInput');
  const ownerGroupNote = document.getElementById('ownerGroupNote');
  const ownerGroupValidation = document.getElementById('ownerGroupValidation');
  const ownerGroupCancelButton = document.getElementById('ownerGroupCancelButton');
  const ownerGroupApplyButton = document.getElementById('ownerGroupApplyButton');
  const manageProfilesBackdrop = document.getElementById('manageProfilesBackdrop');
  const manageProfilesFilterBox = document.getElementById('manageProfilesFilterBox');
  const manageProfilesFilterInput = document.getElementById('manageProfilesFilterInput');
  const manageProfilesFilterClearButton = document.getElementById('manageProfilesFilterClearButton');
  const manageProfilesFeedback = document.getElementById('manageProfilesFeedback');
  const manageProfilesList = document.getElementById('manageProfilesList');
  const manageProfilesCloseButton = document.getElementById('manageProfilesCloseButton');
  const manageProfilesAddGroupButton = document.getElementById('manageProfilesAddGroupButton');
  const manageProfilesExpandAllButton = document.getElementById('manageProfilesExpandAllButton');
  const manageProfilesCollapseAllButton = document.getElementById('manageProfilesCollapseAllButton');
  const manageProfilesImportButton = document.getElementById('manageProfilesImportButton');
  const manageProfilesExportButton = document.getElementById('manageProfilesExportButton');
  const manageGroupBackdrop = document.getElementById('manageGroupBackdrop');
  const manageGroupTitle = document.getElementById('manageGroupTitle');
  const manageGroupSubtitle = document.getElementById('manageGroupSubtitle');
  const manageGroupNameInput = document.getElementById('manageGroupNameInput');
  const manageGroupFeedback = document.getElementById('manageGroupFeedback');
  const manageGroupCancelButton = document.getElementById('manageGroupCancelButton');
  const manageGroupSaveButton = document.getElementById('manageGroupSaveButton');
  const manageGroupRemoveBackdrop = document.getElementById('manageGroupRemoveBackdrop');
  const manageGroupRemoveSubtitle = document.getElementById('manageGroupRemoveSubtitle');
  const manageGroupRemoveName = document.getElementById('manageGroupRemoveName');
  const manageGroupRemoveOnlyRadio = document.getElementById('manageGroupRemoveOnlyRadio');
  const manageGroupRemoveConnectionsRadio = document.getElementById('manageGroupRemoveConnectionsRadio');
  const manageGroupRemoveConnectionsHelp = document.getElementById('manageGroupRemoveConnectionsHelp');
  const manageGroupRemoveFeedback = document.getElementById('manageGroupRemoveFeedback');
  const manageGroupRemoveCancelButton = document.getElementById('manageGroupRemoveCancelButton');
  const manageGroupRemoveConfirmButton = document.getElementById('manageGroupRemoveConfirmButton');
  const exportBackupBackdrop = document.getElementById('exportBackupBackdrop');
  const exportIncludeSettings = document.getElementById('exportIncludeSettings');
  const exportIncludeConnections = document.getElementById('exportIncludeConnections');
  const exportIncludeFavorites = document.getElementById('exportIncludeFavorites');
  const exportIncludeUsernames = document.getElementById('exportIncludeUsernames');
  const exportIncludeCredentials = document.getElementById('exportIncludeCredentials');
  const exportCredentialsBlock = document.getElementById('exportCredentialsBlock');
  const exportCredentialsDisabledHelp = document.getElementById('exportCredentialsDisabledHelp');
  const exportCredentialPassword = document.getElementById('exportCredentialPassword');
  const exportCredentialPasswordError = document.getElementById('exportCredentialPasswordError');
  const exportCredentialPasswordRevealButton = document.getElementById('exportCredentialPasswordRevealButton');
  const exportCredentialConfirmPassword = document.getElementById('exportCredentialConfirmPassword');
  const exportCredentialConfirmPasswordError = document.getElementById('exportCredentialConfirmPasswordError');
  const exportCredentialConfirmPasswordRevealButton = document.getElementById('exportCredentialConfirmPasswordRevealButton');
  const exportBackupResult = document.getElementById('exportBackupResult');
  const exportBackupValidation = document.getElementById('exportBackupValidation');
  const exportBackupCancelButton = document.getElementById('exportBackupCancelButton');
  const exportBackupApplyButton = document.getElementById('exportBackupApplyButton');
  const importBackupBackdrop = document.getElementById('importBackupBackdrop');
  const importBackupSummary = document.getElementById('importBackupSummary');
  const importIncludeSettings = document.getElementById('importIncludeSettings');
  const importIncludeConnections = document.getElementById('importIncludeConnections');
  const importIncludeFavorites = document.getElementById('importIncludeFavorites');
  const importIncludeUsernames = document.getElementById('importIncludeUsernames');
  const importRestoreCredentials = document.getElementById('importRestoreCredentials');
  const importCredentialsBlock = document.getElementById('importCredentialsBlock');
  const importCredentialsDisabledHelp = document.getElementById('importCredentialsDisabledHelp');
  const importCredentialPassword = document.getElementById('importCredentialPassword');
  const importCredentialPasswordError = document.getElementById('importCredentialPasswordError');
  const importCredentialPasswordRevealButton = document.getElementById('importCredentialPasswordRevealButton');
  const importModeBlock = document.getElementById('importModeBlock');
  const importModeMerge = document.getElementById('importModeMerge');
  const importModeReplace = document.getElementById('importModeReplace');
  const importModeHelp = document.getElementById('importModeHelp');
  const importBackupResult = document.getElementById('importBackupResult');
  const importBackupValidation = document.getElementById('importBackupValidation');
  const importBackupCancelButton = document.getElementById('importBackupCancelButton');
  const importBackupApplyButton = document.getElementById('importBackupApplyButton');

  const permissionBackdrop = document.getElementById('permissionBackdrop');
  const permissionDialogTitle = document.getElementById('permissionDialogTitle');
  const permissionDialogPath = document.getElementById('permissionDialogPath');
  const permissionModeInput = document.getElementById('permissionModeInput');
  const permissionCurrentText = document.getElementById('permissionCurrentText');
  const permissionValidation = document.getElementById('permissionValidation');
  const permissionApplyButton = document.getElementById('permissionApplyButton');
  const permissionCancelButton = document.getElementById('permissionCancelButton');
  const permissionHelperBlock = document.getElementById('permissionHelperBlock');
  const permissionRecursiveRow = document.getElementById('permissionRecursiveRow');
  const permissionRecursiveInput = document.getElementById('permissionRecursiveInput');
  const permissionNote = document.getElementById('permissionNote');
  const permissionSetuidLabel = document.getElementById('permissionSetuidLabel');
  const permissionSetgidLabel = document.getElementById('permissionSetgidLabel');
  const permissionStickyLabel = document.getElementById('permissionStickyLabel');
  const permissionCheckboxes = Array.from(document.querySelectorAll('#permissionBackdrop input[data-permission]'));

  const SAVED_SECRET_MASK = '••••••••';
  const FILES_STATUS_GLOBAL_KEY = '__global__';
  const FILES_STATUS_TRANSIENT_DURATION_MS = 2000;
  const CONNECTION_PANEL_MIN_WIDTH = 240;
  const CONNECTION_PANEL_COLLAPSE_THRESHOLD = 40;
  const CONNECTION_PANEL_EXPAND_THRESHOLD = 80;
  const CONNECTION_PANEL_MAX_WIDTH = 390;
  const CONNECTION_PANEL_DEFAULT_WIDTH = 320;
  const CONNECTION_PANEL_STORAGE_KEY = 'remoteedit.connectionPanelLayout';
  const REMOTE_PATH_MIN_WIDTH = 400;
  const REMOTE_PATH_FILTER_MIN_WIDTH = 110;
  const REMOTE_PATH_FILTER_DEFAULT_WIDTH = 150;
  const REMOTE_PATH_STORAGE_KEY = 'remoteedit.remotePathLayout';
  const NAVIGATION_HISTORY_STORAGE_KEY = 'remoteedit.remotePathNavigationHistory';
  const PROFILE_DROPDOWN_GROUPS_STORAGE_KEY = 'remoteedit.profileDropdownGroups';
  const REMOTE_PATH_GO_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M683.15-460H200v-40h483.15L451.46-731.69 480-760l280 280-280 280-28.54-28.31L683.15-460Z" /></svg>';
  const REMOTE_PATH_REFRESH_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg>';

  const columnOrder = ['name', 'type', 'size', 'owner', 'group', 'permissions', 'modified'];
  const columnWidths = { name: 300, type: 86, size: 92, owner: 84, group: 84, permissions: 150, modified: 170 };
  const minColumnWidths = { name: 150, type: 62, size: 72, owner: 64, group: 64, permissions: 110, modified: 130 };

  let profiles = [];
  let connectionGroups = [];
  let sessions = [];
  const clientPendingSessionsByConnectionId = new Map();
  const filesStatusByConnectionId = new Map();
  const filesStableStatusByConnectionId = new Map();
  let draggedSessionId = '';
  let sessionDragOverId = '';
  let sessionDragOverPosition = '';
  let sessionDragDropIndex = -1;
  let sessionTabDragging = false;
  let sessionTabsScrollbarDragging = false;
  let sessionTabsScrollbarDragStartX = 0;
  let sessionTabsScrollbarDragStartScrollLeft = 0;
  let draggedManageProfileId = '';
  let manageProfileDragOverId = '';
  let manageProfileDragOverPosition = '';
  let manageProfileDragOverGroupId = '';
  let manageProfileDragOverLoose = false;
  let manageProfileDragging = false;
  let manageProfileAutoExpandTimer = 0;
  let manageProfileAutoExpandGroupId = '';
  let manageProfileAutoExpandedGroupId = '';
  let selectedProfileId = '';
  let pendingConnectionNameResolver = null;
  let connectionNameDialogOpen = false;
  let pendingConnectionNameGroupId = '';
  let pendingConnectionNameNewGroupName = '';
  let profileDropdownOpen = false;
  let connectionNameGroupDropdownOpen = false;
  let connectionNameGroupDropdownPositionFrame = 0;
  let connectionNameGroupNewMode = false;
  let connectionNameGroupPreviousId = '';
  let profileDropdownFilterText = '';
  let collapsedProfileDropdownGroupIds = new Set();
  let connectionTypeDropdownOpen = false;
  let authDropdownOpen = false;
  let serverAutoRefreshDropdownOpen = false;
  let serverAutoRefreshValue = '30';
  let serverAutoRefreshTimer = null;
  let serverAutoRefreshRemainingSeconds = 30;
  const serverDashboardStatesByConnectionId = new Map();
  const serverServiceFiltersByConnectionId = new Map();
  const serverQuickTaskFiltersByConnectionId = new Map();
  const serverProcessFiltersByConnectionId = new Map();
  const serverScheduledJobFiltersByConnectionId = new Map();
  const serverProcessActionStatesByConnectionId = new Map();
  const serverLogShortcutFiltersByConnectionId = new Map();
  const serverCardSortsByConnectionId = new Map();
  const serverLogShortcutsSessionByConnectionId = new Map();
  const SERVER_LOG_SHORTCUTS_STORAGE_KEY = 'remoteedit.serverLogShortcuts';
  const serverPortForwardFiltersByConnectionId = new Map();
  const serverPortForwardsSessionByConnectionId = new Map();
  const serverPortForwardRuntimeByConnectionId = new Map();
  const serverPortForwardAutoStartedConnectionIds = new Set();
  const SERVER_PORT_FORWARDS_STORAGE_KEY = 'remoteedit.serverPortForwards';
  let serverPortForwardDialogOpen = false;
  let serverPortForwardDialogMode = 'add';
  let serverPortForwardDialogForwardId = '';
  let serverPortForwardRemoveDialogOpen = false;
  let serverPortForwardRemoveId = '';
  let serverLogShortcutDialogOpen = false;
  let serverLogShortcutDialogMode = 'add';
  let serverLogShortcutDialogShortcutId = '';
  let serverLogShortcutPathPickerOpen = false;
  let serverLogShortcutPathPickerPathValue = '/var/log';
  let serverLogShortcutPathPickerRequestId = 0;
  let serverLogShortcutRemoveDialogOpen = false;
  let serverLogShortcutRemoveId = '';
  let manageProfilesDialogOpen = false;
  let manageGroupDialogOpen = false;
  let manageGroupDialogMode = 'add';
  let manageGroupDialogGroupId = '';
  let manageGroupRemoveDialogOpen = false;
  let manageGroupRemoveGroupId = '';
  let exportBackupDialogOpen = false;
  let importBackupDialogOpen = false;
  let importBackupSummaryState = null;
  let manageProfilesFilterText = '';
  let renameProfileId = '';
  let renameGroupId = '';
  let collapsedConnectionGroupIds = new Set();
  let activeConnectionId = '';
  const activeConnectionViewsByConnectionId = new Map();
  let logViewerActiveSessionCount = 0;
  let currentEntries = [];
  const fileListSnapshotsByConnectionId = new Map();
  let entriesRenderGeneration = 0;
  const ENTRY_RENDER_DIRECT_THRESHOLD = 500;
  const ENTRY_RENDER_CHUNK_SIZE = 300;
  const FILE_FILTER_DEBOUNCE_MS = 180;
  let pendingFilterApplyTimer = 0;
  let selectedEntryPath = '';
  let selectedEntryPaths = new Set();
  let selectionAnchorPath = '';
  let remoteClipboardState = { hasItems: false, itemCount: 0, itemNames: [], sourceItems: [], sourceParentDirectories: [], canPaste: false };
  let remotePathEditing = false;
  let breadcrumbDropdownState = { open: false, path: '', requestId: '', anchorPath: '' };
  let filterText = '';
  let currentSort = { key: '', direction: '' };
  let busy = false;
  let statusCancelAction = '';
  let statusCancelLabel = 'Cancel';
  let connectionButtonState = '';
  let lastSyncedActiveConnectionId = '';
  let statusCopyFeedbackTimer = 0;
  const filesStatusResetTimersByConnectionId = new Map();
  const filesStatusResetTokensByConnectionId = new Map();
  let saveProfileButtonFeedbackProfileId = '';
  let pendingProfileSelectionAfterSaveId = '';
  let pendingDirtyProfileSwitchResolver = null;
  let pendingDirtyProfileSwitchRequestId = '';
  let serverToolbarStatusTimer = 0;
  const serverPortForwardPendingActions = new Map();
  const profileDisconnectingIds = new Set();
  let serverOverviewDetailsDialogOpen = false;
  let filePropertiesDialogOpen = false;
  let filePropertiesRemotePath = '';
  let checksumsDialogOpen = false;
  let ownerGroupDialogOpen = false;
  let ownerGroupEntries = [];
  const ownerGroupSuggestionsByConnectionId = new Map();
  let ownerGroupActiveSuggestionKind = '';
  let ownerGroupSuggestionRepositionFrame = 0;
  let checksumsCopyState = { sha256: '', md5: '', all: '' };
  let permissionsDialogOpen = false;
  let permissionPreviewKind = 'file';
  let transferQueueState = { current: null, currentTransfers: [], pending: [], completed: [] };
  const transferQueueCancelingIds = new Set();
  const transferQueueRemovingIds = new Set();
  let transferQueueModalOpen = false;
  let remoteCommandDialogOpen = false;
  let remoteCommandDialogConnectionId = '';
  let remoteCommandWorkingDirectoryPickerOpen = false;
  let remoteCommandWorkingDirectoryPickerPathValue = '/';
  let remoteCommandEditingSavedId = '';
  let remoteCommandDeletingSavedId = '';
  let remoteCommandStopEscalationTimer = null;
  const REMOTE_COMMAND_STORAGE_KEY = 'remoteedit.savedRemoteCommands';
  const REMOTE_COMMAND_HISTORY_STORAGE_KEY = 'remoteedit.remoteCommandHistory';
  const REMOTE_COMMAND_STOP_ESCALATION_MS = 10000;
  const REMOTE_COMMAND_MAX_OUTPUT_CHARS = 500000;
  const REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION = 50;
  const remoteCommandSessionsByConnectionId = new Map();
  const remoteCommandSavedByConnectionId = new Map();
  const remoteCommandHistoryByConnectionId = new Map();
  let persistentStorageApplyingSnapshot = false;
  let confirmDialogOpen = false;
  let confirmDialogRequestId = '';
  let confirmDialogCopyable = false;
  let inputPromptOpen = false;
  let inputPromptRequestId = '';
  let inputPromptPasswordMode = false;
  let transferConflictDialogOpen = false;
  let transferConflictRequestId = '';
  let pathFavoritesOpen = false;
  const navigationHistoryByConnectionId = new Map();
  let pendingNavigationHistoryMode = '';
  function readPersistentConnectionPanelState() {
    try {
      const rawState = localStorage.getItem(CONNECTION_PANEL_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  function readPersistentRemotePathState() {
    try {
      const rawState = localStorage.getItem(REMOTE_PATH_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  function readPersistentNavigationHistoryState() {
    try {
      const rawState = localStorage.getItem(NAVIGATION_HISTORY_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  function readPersistentProfileDropdownGroupsState() {
    try {
      const rawState = localStorage.getItem(PROFILE_DROPDOWN_GROUPS_STORAGE_KEY);
      const parsed = rawState ? JSON.parse(rawState) : {};
      const ids = Array.isArray(parsed && parsed.collapsedGroupIds) ? parsed.collapsedGroupIds : [];
      return { collapsedProfileDropdownGroupIds: ids.map(value => String(value || '').trim()).filter(Boolean) };
    } catch (_) {
      return { collapsedProfileDropdownGroupIds: [] };
    }
  }

  function persistProfileDropdownGroupsState() {
    try {
      const groupState = { collapsedGroupIds: Array.from(collapsedProfileDropdownGroupIds || []) };
      localStorage.setItem(PROFILE_DROPDOWN_GROUPS_STORAGE_KEY, JSON.stringify(groupState));
    } catch (_) {
      // Ignore localStorage failures.
    }
  }

  const initialWebviewState = Object.assign({}, readPersistentConnectionPanelState(), readPersistentRemotePathState(), readPersistentNavigationHistoryState(), readPersistentProfileDropdownGroupsState(), vscode.getState() || {});
  collapsedProfileDropdownGroupIds = new Set(Array.isArray(initialWebviewState.collapsedProfileDropdownGroupIds) ? initialWebviewState.collapsedProfileDropdownGroupIds.map(value => String(value || '').trim()).filter(Boolean) : []);
  let connectionPanelCollapsed = Boolean(initialWebviewState.connectionPanelCollapsed);
  let connectionPanelWidth = normalizeConnectionPanelWidth(initialWebviewState.connectionPanelWidth);
  let connectionPanelResizeState = null;
  let remotePathLayoutPreference = normalizeRemotePathLayoutPreference(initialWebviewState);
  let remotePathResizeState = null;
  let remotePathResetTransitionTimer = 0;
  let toolbarLayoutTransitionTimer = 0;
  let toolbarCapabilityState = '';
  let remoteSearchDialogOpen = false;
  let remoteSearchScopePickerOpen = false;
  let remoteSearchScopePickerPathValue = '/';
  let remoteSearchContextPath = '';
  let remoteSearchContextKind = '';
  const remoteSearchStatesByConnectionId = new Map();
  const remoteSearchFormsByConnectionId = new Map();
  let remoteSearchState = { status: 'idle', connectionId: '', results: [], totalResults: 0, options: {} };
  const remoteSearchExpandedResultPaths = new Set();
  let remoteSearchSelectedResultKeys = new Set();
  let remoteSearchSelectionAnchorKey = '';
  const remoteSearchVisibleLimitsByConnectionId = new Map();
  let remoteSearchRenderTimer = 0;
  const REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS = 2000;
  const REMOTE_SEARCH_SHOW_MORE_STEP = 2000;
  let connectionPanelTransitionTimer = 0;

  restoreNavigationHistoryFromState(initialWebviewState.navigationHistoryByConnectionId);

  const TOOLTIP_SHOW_DELAY_MS = 500;
  const TOOLTIP_TRANSIENT_DURATION_MS = 1500;
  const TOOLTIP_FADE_MS = 80;
  let activeTooltipTarget = null;
  let tooltipTimer = 0;

  function hideWebviewTooltip() {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = 0;
    }
    activeTooltipTarget = null;
    if (!webviewTooltip) return;
    webviewTooltip.classList.remove('visible');
    webviewTooltip.setAttribute('aria-hidden', 'true');
  }

  function positionWebviewTooltip(target, preferAbove = false) {
    if (!webviewTooltip || !target) return;

    const gap = 7;
    const margin = 8;
    const rect = target.getBoundingClientRect();
    const tooltipRect = webviewTooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

    let top = preferAbove ? (rect.top - tooltipRect.height - gap) : (rect.bottom + gap);
    if (top < margin) top = rect.bottom + gap;
    if (top + tooltipRect.height > window.innerHeight - margin) top = rect.top - tooltipRect.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    webviewTooltip.style.left = Math.round(left) + 'px';
    webviewTooltip.style.top = Math.round(top) + 'px';
  }

  function showWebviewTooltip(target) {
    if (!webviewTooltip || !target || sessionTabDragging || manageProfileDragging) return;
    const text = String(target.getAttribute('data-tooltip') || '').trim();
    if (!text) return;

    if (tooltipTimer) clearTimeout(tooltipTimer);
    activeTooltipTarget = target;
    webviewTooltip.textContent = text;
    webviewTooltip.setAttribute('aria-hidden', 'false');
    webviewTooltip.classList.remove('visible');
    webviewTooltip.style.left = '0px';
    webviewTooltip.style.top = '0px';

    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== target) return;
      const preferAbove = target.classList.contains('tooltip-above') || target.getAttribute('data-tooltip-position') === 'above';
      positionWebviewTooltip(target, preferAbove);
      webviewTooltip.classList.add('visible');
    }, TOOLTIP_SHOW_DELAY_MS);
  }

  function showTransientActionTooltip(target, message = 'Copied', durationMs = TOOLTIP_TRANSIENT_DURATION_MS) {
    if (!webviewTooltip || !target) return;
    const tooltipTarget = target.closest ? (target.closest('.tooltip-anchor') || target) : target;
    if (!tooltipTarget) return;

    if (tooltipTimer) clearTimeout(tooltipTimer);
    activeTooltipTarget = tooltipTarget;
    webviewTooltip.textContent = String(message || 'Copied');
    webviewTooltip.setAttribute('aria-hidden', 'false');
    webviewTooltip.classList.remove('visible');
    webviewTooltip.style.left = '0px';
    webviewTooltip.style.top = '0px';

    positionWebviewTooltip(tooltipTarget, true);
    webviewTooltip.classList.add('visible');

    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== tooltipTarget) return;
      hideWebviewTooltip();
    }, Number(durationMs || 0) || TOOLTIP_TRANSIENT_DURATION_MS);
  }

  function getTooltipTarget(eventTarget) {
    if (sessionTabDragging || manageProfileDragging) return null;
    return eventTarget && eventTarget.closest ? eventTarget.closest('[data-tooltip]') : null;
  }

  document.addEventListener('mouseover', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target === activeTooltipTarget) return;
    showWebviewTooltip(target);
  });

  document.addEventListener('mouseout', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target !== activeTooltipTarget) return;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    hideWebviewTooltip();
  });

  document.addEventListener('focusin', event => {
    const target = getTooltipTarget(event.target);
    if (target) showWebviewTooltip(target);
  });

  document.addEventListener('focusout', event => {
    const target = getTooltipTarget(event.target);
    if (target && target === activeTooltipTarget) hideWebviewTooltip();
  });

  window.addEventListener('scroll', () => {
    hideWebviewTooltip();
    if (serverLogShortcutPathPickerOpen) positionServerLogShortcutPathPicker();
  }, true);
  window.addEventListener('resize', () => {
    hideWebviewTooltip();
    hideRemotePathDropdown();
    updateActiveSessionTabDivider();
    if (serverLogShortcutPathPickerOpen) positionServerLogShortcutPathPicker();
  });

  function showInputPromptDialog(payload) {
    if (!inputPromptBackdrop || !inputPromptInput) return;

    inputPromptRequestId = String(payload.requestId || '');
    inputPromptOpen = Boolean(inputPromptRequestId);
    inputPromptPasswordMode = Boolean(payload.password);

    if (inputPromptTitle) inputPromptTitle.textContent = String(payload.title || 'Input');
    if (inputPromptMessage) inputPromptMessage.textContent = String(payload.prompt || '');
    if (inputPromptLabel) inputPromptLabel.textContent = String(payload.label || (inputPromptPasswordMode ? 'Sudo password' : 'Name'));
    if (inputPromptFeedback) inputPromptFeedback.textContent = String(payload.validationMessage || '');

    inputPromptInput.type = inputPromptPasswordMode ? 'password' : 'text';
    inputPromptInput.value = String(payload.value || '');
    inputPromptInput.placeholder = String(payload.placeHolder || '');
    inputPromptInput.classList.toggle('backup-input-invalid', Boolean(payload.validationMessage));

    if (inputPromptInputWrap) {
      inputPromptInputWrap.classList.toggle('reveal-hidden', !inputPromptPasswordMode);
    }
    if (inputPromptRevealButton) {
      inputPromptRevealButton.disabled = !inputPromptPasswordMode;
      inputPromptRevealButton.style.display = inputPromptPasswordMode ? '' : 'none';
    }

    if (inputPromptConfirmButton) inputPromptConfirmButton.textContent = String(payload.confirmLabel || 'OK');
    if (inputPromptCancelButton) inputPromptCancelButton.textContent = String(payload.cancelLabel || 'Cancel');

    inputPromptBackdrop.classList.add('visible');
    inputPromptBackdrop.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      inputPromptInput.focus();
      const selection = Array.isArray(payload.valueSelection) ? payload.valueSelection : null;
      if (selection && selection.length >= 2) {
        inputPromptInput.setSelectionRange(Number(selection[0]) || 0, Number(selection[1]) || inputPromptInput.value.length);
      } else {
        inputPromptInput.select();
      }
    }, 0);
  }

  function closeInputPromptDialog(confirmed) {
    if (!inputPromptOpen) return;
    const requestId = inputPromptRequestId;
    const value = inputPromptInput ? String(inputPromptInput.value || '') : '';

    inputPromptOpen = false;
    inputPromptRequestId = '';
    inputPromptPasswordMode = false;

    if (inputPromptInput) {
      inputPromptInput.value = '';
      inputPromptInput.type = 'text';
      inputPromptInput.classList.remove('backup-input-invalid');
    }
    if (inputPromptFeedback) inputPromptFeedback.textContent = '';
    if (inputPromptInputWrap) inputPromptInputWrap.classList.add('reveal-hidden');
    if (inputPromptRevealButton) {
      inputPromptRevealButton.disabled = true;
      inputPromptRevealButton.style.display = 'none';
    }
    if (inputPromptBackdrop) {
      inputPromptBackdrop.classList.remove('visible');
      inputPromptBackdrop.setAttribute('aria-hidden', 'true');
    }

    vscode.postMessage({ type: 'inputDialogResponse', payload: { requestId, confirmed: Boolean(confirmed), value: confirmed ? value : '' } });
  }

  function trapInputPromptFocus(event) {
    if (!inputPromptOpen || event.key !== 'Tab') return;
    const focusable = [inputPromptInput, inputPromptRevealButton, inputPromptCancelButton, inputPromptConfirmButton]
      .filter(element => element && !element.hidden && element.style.display !== 'none' && !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function buildDetailsDialogCopyText(bodyElement) {
    if (!bodyElement) return '';

    const lines = [];
    const appendLine = (line) => {
      const text = String(line == null ? '' : line).trim();
      if (text) lines.push(text);
    };

    const appendLabelValueGrid = (grid) => {
      const children = Array.from(grid ? grid.children : []);
      for (let i = 0; i < children.length; i += 2) {
        const labelElement = children[i];
        const valueElement = children[i + 1];
        if (!labelElement || !valueElement) continue;
        if (!labelElement.classList.contains('file-properties-label') || !valueElement.classList.contains('file-properties-value')) continue;
        const label = String(labelElement.innerText || labelElement.textContent || '').trim();
        const value = String(valueElement.innerText || valueElement.textContent || '').trim();
        if (label && value) appendLine(label + ': ' + value);
        else if (label) appendLine(label + ':');
        else if (value) appendLine(value);
      }
    };

    const grids = Array.from(bodyElement.querySelectorAll('.file-properties-grid, .server-overview-detail-grid'));
    if (bodyElement.classList.contains('file-properties-grid') || bodyElement.classList.contains('server-overview-detail-grid')) {
      grids.unshift(bodyElement);
    }

    const uniqueGrids = [];
    grids.forEach(grid => {
      if (grid && !uniqueGrids.includes(grid)) uniqueGrids.push(grid);
    });
    uniqueGrids.forEach(grid => appendLabelValueGrid(grid));

    const appendFormattedTable = (headers, rows) => {
      const safeHeaders = Array.isArray(headers) ? headers.map(value => String(value == null ? '' : value).trim()) : [];
      const safeRows = Array.isArray(rows) ? rows.map(row => (Array.isArray(row) ? row : []).map(value => String(value == null ? '' : value).trim())) : [];
      const columnCount = Math.max(safeHeaders.length, ...safeRows.map(row => row.length), 0);
      if (!columnCount) return;

      const widths = Array.from({ length: columnCount }, (_, index) => {
        const headerWidth = safeHeaders[index] ? safeHeaders[index].length : 0;
        const rowWidth = safeRows.reduce((max, row) => Math.max(max, row[index] ? row[index].length : 0), 0);
        return Math.max(headerWidth, rowWidth);
      });

      const formatRow = (row) => widths.map((width, index) => {
        const value = row[index] || '';
        return index === widths.length - 1 ? value : value.padEnd(width);
      }).join('  ').trimEnd();

      if (safeHeaders.some(Boolean)) appendLine(formatRow(safeHeaders));
      safeRows.forEach(row => {
        if (row.some(Boolean)) appendLine(formatRow(row));
      });
    };

    const tables = Array.from(bodyElement.querySelectorAll('.server-overview-detail-table'));
    tables.forEach(table => {
      const section = table.closest('.server-overview-detail-section');
      const sectionTitle = section ? String((section.querySelector('.server-overview-detail-section-title') || {}).textContent || '').trim() : '';
      if (sectionTitle) appendLine(sectionTitle + ':');
      const headers = Array.from(table.querySelectorAll('thead th')).map(cell => String(cell.innerText || cell.textContent || '').trim());
      const rows = Array.from(table.querySelectorAll('tbody tr')).map(row => {
        return Array.from(row.querySelectorAll('td')).map(cell => String(cell.innerText || cell.textContent || '').trim());
      });
      appendFormattedTable(headers, rows);
    });

    if (lines.length) return lines.join('\\n');
    return String(bodyElement.innerText || bodyElement.textContent || '').trim();
  }

  function showTemporaryButtonText(button, text = 'Copied', durationMs = 1200) {
    if (!button) return;
    const originalText = button.getAttribute('data-original-text') || button.textContent || '';
    button.setAttribute('data-original-text', originalText);
    button.textContent = String(text || 'Copied');
    if (button._remoteEditCopyFeedbackTimer) {
      window.clearTimeout(button._remoteEditCopyFeedbackTimer);
    }
    button._remoteEditCopyFeedbackTimer = window.setTimeout(() => {
      button.textContent = button.getAttribute('data-original-text') || originalText || 'Copy';
      button._remoteEditCopyFeedbackTimer = 0;
    }, Number(durationMs || 0) || 1200);
  }

  async function copyServerOverviewDetails() {
    const text = buildDetailsDialogCopyText(serverOverviewDetailsGrid);
    if (!text) return;
    await copyTextFromEditableMenu(text);
    showTemporaryButtonText(serverOverviewDetailsCopyButton, 'Copied');
  }

  async function copyConfirmDialogDetails() {
    if (!confirmDialogCopyable) return;
    const text = buildDetailsDialogCopyText(confirmDialogDetails);
    if (!text) return;
    await copyTextFromEditableMenu(text);
    showTemporaryButtonText(confirmDialogCopyButton, 'Copied');
  }

  function showConfirmDialog(payload) {
    confirmDialogRequestId = String(payload.requestId || '');
    confirmDialogOpen = Boolean(confirmDialogRequestId);

    confirmDialogTitle.textContent = String(payload.title || 'Confirm action');
    confirmDialogMessage.textContent = String(payload.message || 'Confirm this action?');

    const details = String(payload.details || '').trim();
    confirmDialogDetails.textContent = details;
    confirmDialogDetails.hidden = !details;
    if (confirmDialogBody) confirmDialogBody.hidden = !details;

    confirmDialogCopyable = Boolean(payload.copyable) && Boolean(details);
    if (confirmDialogCopyButton) {
      confirmDialogCopyButton.hidden = !confirmDialogCopyable;
      confirmDialogCopyButton.textContent = 'Copy';
      confirmDialogCopyButton.setAttribute('data-original-text', 'Copy');
    }

    const hideCancel = Boolean(payload.hideCancel);
    confirmDialogCancelButton.textContent = String(payload.cancelLabel || 'Cancel');
    confirmDialogCancelButton.hidden = hideCancel;
    confirmDialogConfirmButton.textContent = String(payload.confirmLabel || 'Confirm');
    confirmDialogConfirmButton.classList.toggle('danger', Boolean(payload.danger));

    hideWebviewTooltip();
    hideContextMenu();
    hideProfileDropdown();
    hideAuthDropdown();
    hideRemotePathDropdown();
    hidePathFavoritesPopover();

    confirmDialogBackdrop.classList.add('visible');
    confirmDialogBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => (confirmDialogCancelButton.hidden ? confirmDialogConfirmButton : confirmDialogCancelButton).focus(), 0);
  }

  function closeConfirmDialog(confirmed) {
    if (!confirmDialogOpen) return;

    const requestId = confirmDialogRequestId;
    confirmDialogOpen = false;
    confirmDialogRequestId = '';
    confirmDialogBackdrop.classList.remove('visible');
    confirmDialogBackdrop.setAttribute('aria-hidden', 'true');
    confirmDialogCopyable = false;
    if (confirmDialogCopyButton) {
      confirmDialogCopyButton.hidden = true;
      confirmDialogCopyButton.textContent = 'Copy';
      confirmDialogCopyButton.setAttribute('data-original-text', 'Copy');
    }
    confirmDialogCancelButton.hidden = false;
    confirmDialogConfirmButton.classList.remove('danger');

    if (requestId.indexOf('client:closeConnection:') === 0) {
      if (confirmed) {
        const connectionId = requestId.slice('client:closeConnection:'.length);
        disconnectSessionFromTabClose(connectionId);
      }
      return;
    }

    if (requestId.indexOf('client:profileDirtySwitch:') === 0) {
      const resolver = pendingDirtyProfileSwitchResolver;
      pendingDirtyProfileSwitchResolver = null;
      pendingDirtyProfileSwitchRequestId = '';
      if (resolver) resolver(confirmed === true ? 'save' : (confirmed === false ? 'discard' : 'cancel'));
      return;
    }

    vscode.postMessage({ type: 'confirmDialogResponse', payload: { requestId, confirmed: Boolean(confirmed) } });
  }

  function setTransferConflictMeta(element, label, value) {
    if (!element) return;
    const text = value === undefined || value === null || value === '' || value === 'unknown'
      ? ''
      : label + ': ' + String(value);
    element.textContent = text;
    element.hidden = !text;
  }

  function showTransferConflictDialog(payload) {
    transferConflictRequestId = String(payload.requestId || '');
    transferConflictDialogOpen = Boolean(transferConflictRequestId);

    if (!transferConflictDialogOpen) return;

    transferConflictTitle.textContent = String(payload.title || 'Transfer conflict');
    transferConflictMessage.textContent = String(payload.message || 'A conflict decision is required to continue.');
    transferConflictName.textContent = String(payload.itemName || payload.relativePath || '');
    transferConflictPath.textContent = String(payload.relativePath || '');

    setTransferConflictMeta(transferConflictSourceType, 'Type', payload.sourceType || 'Source');
    setTransferConflictMeta(transferConflictSourcePath, 'Path', payload.sourcePath || '');
    setTransferConflictMeta(transferConflictSourceSize, 'Size', payload.sourceSize || '');
    setTransferConflictMeta(transferConflictSourceModified, 'Modified', payload.sourceModified || '');
    setTransferConflictMeta(transferConflictDestinationType, 'Type', payload.destinationType || 'Destination');
    setTransferConflictMeta(transferConflictDestinationPath, 'Path', payload.destinationPath || '');
    setTransferConflictMeta(transferConflictDestinationSize, 'Size', payload.destinationSize || '');
    setTransferConflictMeta(transferConflictDestinationModified, 'Modified', payload.destinationModified || '');

    const note = String(payload.note || '');
    transferConflictNote.textContent = note;
    transferConflictNote.hidden = !note;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    transferConflictActions.innerHTML = choices.map(choice => {
      const label = String(choice && choice.label || 'Cancel');
      const decision = String(choice && choice.decision || 'cancel');
      const classes = [];
      if (!choice || !choice.primary) classes.push('secondary');
      if (choice && choice.danger) classes.push('danger');
      return '<button class="' + classes.join(' ') + '" type="button" data-transfer-conflict-decision="' + escapeHtml(decision) + '">' + escapeHtml(label) + '</button>';
    }).join('');

    transferConflictBackdrop.classList.add('visible');
    transferConflictBackdrop.setAttribute('aria-hidden', 'false');

    const cancelButton = transferConflictActions.querySelector('button[data-transfer-conflict-decision="cancel"]');
    const firstButton = transferConflictActions.querySelector('button');
    setTimeout(() => (cancelButton || firstButton || transferConflictDialog).focus(), 0);
  }

  function hideTransferConflictDialog() {
    transferConflictDialogOpen = false;
    transferConflictRequestId = '';
    transferConflictBackdrop.classList.remove('visible');
    transferConflictBackdrop.setAttribute('aria-hidden', 'true');
    transferConflictActions.innerHTML = '';
  }

  function closeTransferConflictDialog(decision) {
    if (!transferConflictDialogOpen) return;

    const requestId = transferConflictRequestId;
    hideTransferConflictDialog();
    vscode.postMessage({ type: 'transferConflictResponse', payload: { requestId, decision: decision || 'cancel' } });
  }

  function trapTransferConflictFocus(event) {
    if (!transferConflictDialogOpen || event.key !== 'Tab') return;

    const focusable = Array.from(transferConflictBackdrop.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')).filter(element => !element.disabled);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function trapConfirmDialogFocus(event) {
    if (!confirmDialogOpen || event.key !== 'Tab') return;

    const focusable = [confirmDialogCopyButton, confirmDialogCancelButton, confirmDialogConfirmButton].filter(element => element && !element.hidden && element.style.display !== 'none' && !element.disabled);
    if (!focusable.length) return;

`;
}
