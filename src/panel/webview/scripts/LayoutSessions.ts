export function renderLayoutSessions(): string {
  return `  function updateFileListNameClickOpenState() {
    if (!entriesTableWrap) return;
    entriesTableWrap.classList.toggle('name-click-open-enabled', openFileListItemsOnNameClick);
  }

  applyColumnWidths();
  updateSortIndicators();
  updateFileListNameClickOpenState();

  for (const input of [profileName, host, port, username, password, privateKeyPath, passphrase, startPath]) {
    input.addEventListener('keydown', event => { if (event.key === 'Enter') connectButton.click(); });
  }

  for (const input of [host, port, username, password, privateKeyPath, ftpsCaCertificatePath]) {
    if (!input) continue;
    input.addEventListener('input', () => clearConnectionFieldInvalid(input));
    input.addEventListener('change', () => clearConnectionFieldInvalid(input));
  }

  for (const input of [host, port, username, password, privateKeyPath, passphrase, startPath, ftpsCaCertificatePath]) {
    if (!input) continue;
    input.addEventListener('input', () => setControls());
    input.addEventListener('change', () => setControls());
  }


  function normalizeRemotePathWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return null;
    return Math.round(numericWidth);
  }

  function normalizeRemotePathFilterWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return null;
    return Math.round(numericWidth);
  }

  function normalizeRemotePathLayoutPreference(state) {
    if (!state || typeof state !== 'object') return null;
    const pathWidth = normalizeRemotePathWidth(state.remotePathWidth);
    if (pathWidth === null) return null;
    const filterWidth = normalizeRemotePathFilterWidth(state.remotePathFilterWidth) || REMOTE_PATH_FILTER_DEFAULT_WIDTH;
    return { pathWidth, filterWidth };
  }

  function getVisiblePathbarChildren() {
    if (!pathbar) return [];
    return Array.from(pathbar.children).filter(child => {
      if (!(child instanceof HTMLElement)) return false;
      if (child === remotePathResizeHandle) return false;
      return window.getComputedStyle(child).display !== 'none';
    });
  }

  function getRemotePathAvailableWidth() {
    if (!pathbar || !remotePathBox || !filterBox) return 0;
    const pathbarRect = pathbar.getBoundingClientRect();
    if (!pathbarRect.width) return 0;

    const visibleChildren = getVisiblePathbarChildren();
    const pathbarStyle = window.getComputedStyle(pathbar);
    const gap = parseFloat(pathbarStyle.columnGap || pathbarStyle.gap || '0') || 0;
    const gapWidth = Math.max(0, visibleChildren.length - 1) * gap;

    let fixedWidth = 0;
    for (const child of visibleChildren) {
      if (child === remotePathBox || child === filterBox) continue;
      fixedWidth += child.getBoundingClientRect().width;
    }

    return Math.max(0, Math.floor(pathbarRect.width - fixedWidth - gapWidth));
  }

  function getRemotePathLayoutLimits(availableWidth = getRemotePathAvailableWidth()) {
    const available = Math.max(0, Math.floor(Number(availableWidth) || 0));
    const pathMin = Math.min(REMOTE_PATH_MIN_WIDTH, Math.max(0, available - REMOTE_PATH_FILTER_MIN_WIDTH));
    const filterMin = Math.min(REMOTE_PATH_FILTER_MIN_WIDTH, Math.max(0, available - pathMin));
    const pathMax = Math.max(pathMin, available - filterMin);
    return { available, pathMin, filterMin, pathMax };
  }


  function createRemotePathLayoutPreference(pathWidth, availableWidth = getRemotePathAvailableWidth()) {
    const limits = getRemotePathLayoutLimits(availableWidth);
    if (!limits.available) return remotePathLayoutPreference;

    const numericWidth = Number(pathWidth);
    const currentPathWidth = remotePathBox ? Math.round(remotePathBox.getBoundingClientRect().width) : limits.pathMin;
    const requestedPathWidth = Number.isFinite(numericWidth) ? Math.round(numericWidth) : currentPathWidth;
    const nextPathWidth = Math.max(limits.pathMin, Math.min(limits.pathMax, requestedPathWidth));
    const nextFilterWidth = Math.max(0, limits.available - nextPathWidth);

    return {
      pathWidth: Math.round(nextPathWidth),
      filterWidth: Math.round(nextFilterWidth)
    };
  }

  function getRemotePathLayoutForAvailableWidth(availableWidth = getRemotePathAvailableWidth()) {
    const limits = getRemotePathLayoutLimits(availableWidth);
    if (!limits.available) return { pathWidth: 0, filterWidth: 0, limits };

    let pathWidth;
    let filterWidth;

    if (remotePathLayoutPreference === null) {
      filterWidth = Math.min(
        REMOTE_PATH_FILTER_DEFAULT_WIDTH,
        Math.max(limits.filterMin, limits.available - limits.pathMin)
      );
      pathWidth = Math.max(0, limits.available - filterWidth);
    } else {
      const preferredPathWidth = Math.max(0, Number(remotePathLayoutPreference.pathWidth) || 0);
      const preferredFilterWidth = Math.max(0, Number(remotePathLayoutPreference.filterWidth) || 0);
      const preferredTotalWidth = Math.max(1, preferredPathWidth + preferredFilterWidth);
      const scaledPathWidth = preferredPathWidth * (limits.available / preferredTotalWidth);
      pathWidth = Math.max(limits.pathMin, Math.min(limits.pathMax, Math.round(scaledPathWidth)));
      filterWidth = Math.max(0, limits.available - pathWidth);
    }

    return {
      pathWidth: Math.round(pathWidth),
      filterWidth: Math.round(filterWidth),
      limits
    };
  }

  function updateRemotePathResizeHandlePosition() {
    if (!pathbar || !remotePathBox || !filterBox || !remotePathResizeHandle) return;
    if (window.getComputedStyle(remotePathResizeHandle).display === 'none') return;

    const pathbarRect = pathbar.getBoundingClientRect();
    const pathRect = remotePathBox.getBoundingClientRect();
    const filterRect = filterBox.getBoundingClientRect();
    if (!pathbarRect.width || !pathRect.width || !filterRect.width) return;

    const midpoint = ((pathRect.right + filterRect.left) / 2) - pathbarRect.left;
    pathbar.style.setProperty('--remote-path-resize-left', Math.round(midpoint) + 'px');
  }

  function applyRemotePathLayout() {
    if (!pathbar) return;

    const availableWidth = getRemotePathAvailableWidth();
    if (!availableWidth) {
      updateRemotePathResizeHandlePosition();
      return;
    }

    const layout = getRemotePathLayoutForAvailableWidth(availableWidth);
    const pathWidth = layout.pathWidth;
    const filterWidth = layout.filterWidth;
    const limits = layout.limits;

    pathbar.style.setProperty('--remote-path-width', pathWidth + 'px');
    pathbar.style.setProperty('--remote-path-filter-width', filterWidth + 'px');

    if (remotePathResizeHandle) {
      remotePathResizeHandle.setAttribute('aria-valuemin', String(REMOTE_PATH_MIN_WIDTH));
      remotePathResizeHandle.setAttribute('aria-valuenow', String(pathWidth));
      remotePathResizeHandle.setAttribute('aria-valuemax', String(Math.max(REMOTE_PATH_MIN_WIDTH, limits.pathMax)));
    }

    updateRemotePathResizeHandlePosition();
    updateRemotePathBreadcrumbOverflow();
  }

  function scheduleRemotePathLayoutUpdate() {
    if (!pathbar) return;
    requestAnimationFrame(() => {
      applyRemotePathLayout();
      updateRemotePathBreadcrumbOverflow();
    });
  }

  function persistRemotePathLayout() {
    const pathState = remotePathLayoutPreference === null
      ? { remotePathWidth: null, remotePathFilterWidth: null }
      : {
        remotePathWidth: remotePathLayoutPreference.pathWidth,
        remotePathFilterWidth: remotePathLayoutPreference.filterWidth
      };
    vscode.setState(Object.assign({}, vscode.getState() || {}, pathState));
    try {
      if (remotePathLayoutPreference === null) {
        localStorage.removeItem(REMOTE_PATH_STORAGE_KEY);
      } else {
        localStorage.setItem(REMOTE_PATH_STORAGE_KEY, JSON.stringify(pathState));
      }
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the layout while this webview is alive.
    }
  }

  function resizeRemotePathByStep(delta) {
    if (!remotePathBox) return;
    const availableWidth = getRemotePathAvailableWidth();
    const currentWidth = Math.round(remotePathBox.getBoundingClientRect().width);
    remotePathLayoutPreference = createRemotePathLayoutPreference(currentWidth + delta, availableWidth);
    applyRemotePathLayout();
    persistRemotePathLayout();
  }

  function handleRemotePathResizeKeydown(event) {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      resizeRemotePathByStep(key === 'ArrowRight' ? 20 : -20);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      const limits = getRemotePathLayoutLimits();
      remotePathLayoutPreference = createRemotePathLayoutPreference(limits.pathMin, limits.available);
      applyRemotePathLayout();
      persistRemotePathLayout();
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      const limits = getRemotePathLayoutLimits();
      remotePathLayoutPreference = createRemotePathLayoutPreference(limits.pathMax, limits.available);
      applyRemotePathLayout();
      persistRemotePathLayout();
    }
  }

  function startRemotePathResize(event) {
    if (!pathbar || !remotePathBox || !filterBox || !remotePathResizeHandle) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    hideWebviewTooltip();

    const availableWidth = getRemotePathAvailableWidth();
    remotePathResizeState = {
      startX: event.clientX,
      startWidth: Math.round(remotePathBox.getBoundingClientRect().width),
      availableWidth: availableWidth
    };

    document.body.classList.add('resizing-remote-path');
    if (remotePathResizeHandle.setPointerCapture && event.pointerId !== undefined) {
      remotePathResizeHandle.setPointerCapture(event.pointerId);
    }
    window.addEventListener('pointermove', moveRemotePathResize);
    window.addEventListener('pointerup', stopRemotePathResize);
    window.addEventListener('pointercancel', stopRemotePathResize);
  }

  function moveRemotePathResize(event) {
    if (!remotePathResizeState) return;
    const nextWidth = remotePathResizeState.startWidth + event.clientX - remotePathResizeState.startX;
    remotePathLayoutPreference = createRemotePathLayoutPreference(nextWidth, remotePathResizeState.availableWidth);
    applyRemotePathLayout();
  }

  function stopRemotePathResize() {
    if (!remotePathResizeState) return;
    remotePathResizeState = null;
    document.body.classList.remove('resizing-remote-path');
    window.removeEventListener('pointermove', moveRemotePathResize);
    window.removeEventListener('pointerup', stopRemotePathResize);
    window.removeEventListener('pointercancel', stopRemotePathResize);
    persistRemotePathLayout();
  }

  function startRemotePathResetTransition() {
    if (!pathbar) return;
    pathbar.classList.add('remote-path-reset-animating');
    // Force the current layout to be committed before applying the default sizes.
    void pathbar.offsetWidth;
    if (remotePathResetTransitionTimer) clearTimeout(remotePathResetTransitionTimer);
    remotePathResetTransitionTimer = window.setTimeout(() => {
      if (pathbar) pathbar.classList.remove('remote-path-reset-animating');
      remotePathResetTransitionTimer = 0;
    }, 170);
  }

  function resetRemotePathLayout() {
    startRemotePathResetTransition();
    remotePathLayoutPreference = null;
    applyRemotePathLayout();
    persistRemotePathLayout();
  }

  function getToolbarLayoutItems() {
    const pathbarViewSwitch = pathbar ? pathbar.querySelector('.pathbar-view-switch') : null;
    const viewSwitchSeparator = pathbar ? pathbar.querySelector('.view-switch-separator') : null;
    return [
      remotePathBox,
      filterBox,
      serverRefreshActions,
      serverRefreshActionsSeparator,
      commandActionsSeparator,
      commandActions,
      transferActionsSeparator,
      transferActions,
      sudoToggleSeparator,
      sudoToggleLabel,
      viewSwitchSeparator,
      pathbarViewSwitch
    ].filter(Boolean);
  }

  function isToolbarLayoutItemVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function prepareToolbarLayoutTransition() {
    if (!pathbar || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

    pathbar.classList.add('toolbar-layout-animating');
    // Commit the current toolbar layout before changing protocol-specific actions.
    void pathbar.offsetWidth;

    const snapshot = new Map();
    for (const element of getToolbarLayoutItems()) {
      if (!isToolbarLayoutItemVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      snapshot.set(element, { left: rect.left, top: rect.top });
    }
    return snapshot;
  }

  function finishToolbarLayoutTransition(snapshot) {
    if (!pathbar || !snapshot) return;

    const animatedElements = [];
    const appearingElements = [];

    for (const element of getToolbarLayoutItems()) {
      if (!isToolbarLayoutItemVisible(element)) continue;

      const start = snapshot.get(element);
      if (!start) {
        appearingElements.push(element);
        continue;
      }

      const rect = element.getBoundingClientRect();
      const dx = start.left - rect.left;
      const dy = start.top - rect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      element.style.transition = 'none';
      element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      animatedElements.push(element);
    }

    for (const element of appearingElements) {
      element.style.transition = 'none';
      element.style.opacity = '0';
    }

    void pathbar.offsetWidth;

    for (const element of animatedElements) {
      element.style.transition = 'transform 150ms ease-out';
      element.style.transform = '';
    }

    for (const element of appearingElements) {
      element.style.transition = 'opacity 150ms ease-out';
      element.style.opacity = '';
    }

    if (toolbarLayoutTransitionTimer) clearTimeout(toolbarLayoutTransitionTimer);
    toolbarLayoutTransitionTimer = window.setTimeout(() => {
      for (const element of animatedElements.concat(appearingElements)) {
        element.style.transition = '';
        element.style.transform = '';
        element.style.opacity = '';
      }
      if (pathbar) pathbar.classList.remove('toolbar-layout-animating');
      toolbarLayoutTransitionTimer = 0;
    }, 170);
  }


  function clampConnectionPanelWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) return CONNECTION_PANEL_DEFAULT_WIDTH;
    return Math.max(CONNECTION_PANEL_MIN_WIDTH, Math.min(CONNECTION_PANEL_MAX_WIDTH, Math.round(numericWidth)));
  }

  function normalizeConnectionPanelWidth(width) {
    return clampConnectionPanelWidth(width || CONNECTION_PANEL_DEFAULT_WIDTH);
  }

  function applyConnectionPanelWidth() {
    if (!mainLayout) return;
    mainLayout.style.setProperty('--connection-panel-width', connectionPanelWidth + 'px');
    if (connectionResizeHandle) connectionResizeHandle.setAttribute('aria-valuenow', String(connectionPanelWidth));
  }

  function persistConnectionPanelState() {
    const panelState = {
      connectionPanelCollapsed: connectionPanelCollapsed,
      connectionPanelWidth: connectionPanelWidth
    };

    vscode.setState(Object.assign({}, vscode.getState() || {}, panelState));

    try {
      localStorage.setItem(CONNECTION_PANEL_STORAGE_KEY, JSON.stringify(panelState));
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the layout while this webview is alive.
    }
  }

  function startConnectionPanelResize(event) {
    if (!mainLayout || !connectionCard || connectionPanelCollapsed) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    hideWebviewTooltip();

    const rect = connectionCard.getBoundingClientRect();
    connectionPanelResizeState = {
      startX: event.clientX,
      startWidth: clampConnectionPanelWidth(rect.width)
    };

    connectionCard.classList.add('resizing');
    document.body.classList.add('resizing-connection-panel');
    if (connectionResizeHandle && connectionResizeHandle.setPointerCapture && event.pointerId !== undefined) {
      connectionResizeHandle.setPointerCapture(event.pointerId);
    }
    window.addEventListener('pointermove', moveConnectionPanelResize);
    window.addEventListener('pointerup', stopConnectionPanelResize);
    window.addEventListener('pointercancel', stopConnectionPanelResize);
  }

  function moveConnectionPanelResize(event) {
    if (!connectionPanelResizeState) return;
    const rawWidth = connectionPanelResizeState.startWidth + event.clientX - connectionPanelResizeState.startX;

    if (rawWidth <= CONNECTION_PANEL_COLLAPSE_THRESHOLD) {
      if (!connectionPanelCollapsed) {
        connectionPanelCollapsed = true;
        connectionPanelWidth = CONNECTION_PANEL_MIN_WIDTH;
        updateConnectionPanelLayout({ animateCollapse: true });
      }
      return;
    }

    if (connectionPanelCollapsed && rawWidth < CONNECTION_PANEL_EXPAND_THRESHOLD) {
      return;
    }

    const nextWidth = clampConnectionPanelWidth(rawWidth);
    let changed = false;
    let animateCollapse = false;

    if (connectionPanelCollapsed) {
      connectionPanelCollapsed = false;
      changed = true;
      animateCollapse = true;
    }

    if (nextWidth !== connectionPanelWidth) {
      connectionPanelWidth = nextWidth;
      changed = true;
    }

    if (changed) {
      updateConnectionPanelLayout({ animateCollapse: animateCollapse });
    }
  }

  function stopConnectionPanelResize() {
    if (!connectionPanelResizeState) return;
    connectionPanelResizeState = null;
    if (connectionCard) connectionCard.classList.remove('resizing');
    document.body.classList.remove('resizing-connection-panel');
    window.removeEventListener('pointermove', moveConnectionPanelResize);
    window.removeEventListener('pointerup', stopConnectionPanelResize);
    window.removeEventListener('pointercancel', stopConnectionPanelResize);
    persistConnectionPanelState();
  }

  function resetConnectionPanelWidth() {
    if (connectionPanelCollapsed) return;
    connectionPanelWidth = CONNECTION_PANEL_DEFAULT_WIDTH;
    applyConnectionPanelWidth();
    persistConnectionPanelState();
  }

  if (connectionResizeHandle) {
    connectionResizeHandle.addEventListener('pointerdown', startConnectionPanelResize);
    connectionResizeHandle.addEventListener('dblclick', resetConnectionPanelWidth);
  }

  if (remotePathResizeHandle) {
    remotePathResizeHandle.addEventListener('pointerdown', startRemotePathResize);
    remotePathResizeHandle.addEventListener('dblclick', resetRemotePathLayout);
    remotePathResizeHandle.addEventListener('keydown', handleRemotePathResizeKeydown);
  }

  window.addEventListener('resize', () => {
    applyRemotePathLayout();
    updateRemotePathBreadcrumbOverflow();
  });

  if (typeof ResizeObserver !== 'undefined' && pathbar && remotePathBox && filterBox) {
    const remotePathResizeObserver = new ResizeObserver(() => {
      scheduleRemotePathLayoutUpdate();
    });
    remotePathResizeObserver.observe(pathbar);
    remotePathResizeObserver.observe(remotePathBox);
    remotePathResizeObserver.observe(filterBox);
  }

  function updateConnectionRailPosition() {
    if (!mainLayout || !connectionRail || !connectionPanelCollapsed) return;
    const layoutRect = mainLayout.getBoundingClientRect();
    connectionRail.style.top = Math.max(6, Math.round(layoutRect.top + 8)) + 'px';
  }

  function updateConnectionPanelLayout(options = {}) {
    if (!mainLayout) return;
    const animateCollapse = Boolean(options && options.animateCollapse);
    if (animateCollapse) {
      mainLayout.classList.add('connection-collapse-animating');
      if (connectionPanelTransitionTimer) clearTimeout(connectionPanelTransitionTimer);
      connectionPanelTransitionTimer = window.setTimeout(() => {
        if (mainLayout) mainLayout.classList.remove('connection-collapse-animating');
        connectionPanelTransitionTimer = 0;
      }, 170);
    }
    applyConnectionPanelWidth();
    mainLayout.classList.toggle('connection-collapsed', connectionPanelCollapsed);
    if (connectionCard) {
      connectionCard.toggleAttribute('inert', connectionPanelCollapsed);
      connectionCard.setAttribute('aria-hidden', String(connectionPanelCollapsed));
    }
    if (connectionRail) {
      connectionRail.toggleAttribute('inert', !connectionPanelCollapsed);
      connectionRail.setAttribute('aria-hidden', String(!connectionPanelCollapsed));
    }
    if (hideConnectionPanelButton) {
      hideConnectionPanelButton.setAttribute('aria-expanded', String(!connectionPanelCollapsed));
      hideConnectionPanelButton.tabIndex = connectionPanelCollapsed ? -1 : 0;
    }
    if (showConnectionPanelButton) {
      showConnectionPanelButton.setAttribute('aria-expanded', String(!connectionPanelCollapsed));
      showConnectionPanelButton.tabIndex = connectionPanelCollapsed ? 0 : -1;
    }
    updateConnectionRailPosition();
  }

  function setConnectionPanelCollapsed(collapsed) {
    connectionPanelCollapsed = Boolean(collapsed);
    updateConnectionPanelLayout();
    hideWebviewTooltip();
    persistConnectionPanelState();
  }

  function renderProfiles(preferredId) {
    const previousId = preferredId || selectedProfileId || '';
    profileSelect.innerHTML = '<option value="">New / Quick Connection</option>';

    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      profileSelect.appendChild(option);
    }

    const wasProfileDropdownOpen = profileDropdownOpen;
    renderConnectionNameGroupOptions('');
    const exists = profiles.some(profile => profile.id === previousId);
    const nextId = exists ? previousId : '';
    selectProfile(nextId, { preserveStatus: true, keepDropdownOpen: wasProfileDropdownOpen });
    renderProfileDropdown({ preserveFilter: wasProfileDropdownOpen, preserveScroll: wasProfileDropdownOpen });
    renderManageProfilesList();
    setControls();
  }

  function selectProfile(profileId, options = {}) {
    selectedProfileId = profileId || '';
    profileSelect.value = selectedProfileId;
    if (!options.keepDropdownOpen) hideProfileDropdown();

    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    if (profile) {
      fillForm(profile);
    } else {
      clearForm();
      if (!options.preserveStatus) setStatus('New quick connection.');
    }

    updateProfileDropdownLabel();
    renderProfileDropdown({ preserveFilter: options.keepDropdownOpen, preserveScroll: options.keepDropdownOpen });
    setControls();
  }

  function updateProfileDropdownLabel() {
    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    profileDropdownLabel.textContent = profile ? profile.name : 'New / Quick Connection';
    profileDropdownButton.setAttribute('data-tooltip', profile ? formatProfileTarget(profile) : 'Use the form below');
  }

  function normalizeConnectionFilter(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getConnectionGroupName(groupId) {
    const id = String(groupId || '').trim();
    if (!id) return '';
    const group = connectionGroups.find(item => item && item.id === id);
    return group ? String(group.name || '') : '';
  }

  function compareConnectionGroupsByName(a, b) {
    const nameCompare = String(a && a.name || '').localeCompare(String(b && b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;
    return String(a && a.id || '').localeCompare(String(b && b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function getSortedConnectionGroups() {
    return (connectionGroups || [])
      .slice()
      .sort(compareConnectionGroupsByName);
  }

  function groupMatchesFilter(group, filter) {
    const normalized = normalizeConnectionFilter(filter);
    if (!normalized) return true;
    return String(group && group.name || '').toLowerCase().includes(normalized);
  }

  function groupProfilesForDisplay(sourceProfiles, options) {
    const groups = getSortedConnectionGroups();
    const includeEmptyGroups = Boolean(options && options.includeEmptyGroups);
    const groupFilter = String(options && options.groupFilter || '');
    const profileGroups = groups.map(group => ({ group, profiles: [] }));
    const groupBucketById = new Map(profileGroups.map(bucket => [bucket.group.id, bucket]));
    const looseProfiles = [];

    for (const profile of sourceProfiles || []) {
      const bucket = groupBucketById.get(String(profile && profile.groupId || ''));
      if (bucket) {
        bucket.profiles.push(profile);
      } else {
        looseProfiles.push(profile);
      }
    }

    return {
      grouped: profileGroups.filter(bucket => bucket.profiles.length > 0 || (includeEmptyGroups && groupMatchesFilter(bucket.group, groupFilter))),
      loose: looseProfiles
    };
  }

  function getConnectionNameGroupById(groupId) {
    const id = String(groupId || '').trim();
    if (!id) return null;
    return (connectionGroups || []).find(group => group && group.id === id) || null;
  }

  function getConnectionNameGroupLabel(groupId) {
    const group = getConnectionNameGroupById(groupId);
    return group ? String(group.name || 'Unnamed group') : 'No group';
  }

  function normalizeConnectionNameGroupSelection(groupId) {
    const id = String(groupId || '').trim();
    return getConnectionNameGroupById(id) ? id : '';
  }

  function syncConnectionNameGroupPicker() {
    const selectedId = connectionNameGroup ? String(connectionNameGroup.value || '').trim() : '';
    if (connectionNameGroupDropdownLabel) {
      connectionNameGroupDropdownLabel.textContent = getConnectionNameGroupLabel(selectedId);
    }

    if (connectionNameGroupPicker) {
      connectionNameGroupPicker.classList.toggle('new-group-mode', Boolean(connectionNameGroupNewMode));
    }

    if (connectionNameGroupDropdownButton) {
      connectionNameGroupDropdownButton.setAttribute('aria-expanded', String(Boolean(connectionNameGroupDropdownOpen)));
      connectionNameGroupDropdownButton.hidden = Boolean(connectionNameGroupNewMode);
    }

    if (connectionNameGroupNewInput) {
      connectionNameGroupNewInput.hidden = !connectionNameGroupNewMode;
    }

    if (connectionNameGroupDropdownMenu) {
      const items = Array.from(connectionNameGroupDropdownMenu.querySelectorAll('[data-connection-name-group-option]'));
      items.forEach(item => {
        const value = item.dataset.connectionNameGroupOption || '';
        const selected = !connectionNameGroupNewMode && value === selectedId;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }
  }

  function renderConnectionNameGroupOptions(selectedGroupId) {
    if (!connectionNameGroup) return;
    const selectedId = normalizeConnectionNameGroupSelection(selectedGroupId);
    connectionNameGroup.value = selectedId;
    connectionNameGroupPreviousId = selectedId;
    connectionNameGroupNewMode = false;
    pendingConnectionNameNewGroupName = '';

    if (connectionNameGroupNewInput) {
      connectionNameGroupNewInput.value = '';
      connectionNameGroupNewInput.classList.remove('connection-input-invalid');
    }

    if (!connectionNameGroupDropdownMenu) {
      syncConnectionNameGroupPicker();
      return;
    }

    connectionNameGroupDropdownMenu.innerHTML = '';
    connectionNameGroupDropdownMenu.appendChild(buildConnectionNameGroupDropdownItem('__new__', '+ New group'));

    const separator = document.createElement('div');
    separator.className = 'profile-dropdown-separator';
    connectionNameGroupDropdownMenu.appendChild(separator);

    connectionNameGroupDropdownMenu.appendChild(buildConnectionNameGroupDropdownItem('', 'No group'));

    for (const group of getSortedConnectionGroups()) {
      connectionNameGroupDropdownMenu.appendChild(buildConnectionNameGroupDropdownItem(group.id, group.name || 'Unnamed group'));
    }

    syncConnectionNameGroupPicker();
  }

  function buildConnectionNameGroupDropdownItem(value, name, meta) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'profile-dropdown-item';
    item.dataset.connectionNameGroupOption = String(value || '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');

    const nameElement = document.createElement('span');
    nameElement.className = 'profile-dropdown-name';
    nameElement.textContent = name || 'No group';
    item.appendChild(nameElement);

    if (meta) {
      const metaElement = document.createElement('span');
      metaElement.className = 'profile-dropdown-meta';
      metaElement.textContent = meta;
      item.appendChild(metaElement);
    }

    return item;
  }

  function ensureConnectionNameGroupDropdownPortal() {
    if (!connectionNameGroupDropdownMenu) return;
    if (connectionNameGroupDropdownMenu.parentElement !== document.body) {
      document.body.appendChild(connectionNameGroupDropdownMenu);
    }
  }

  function positionConnectionNameGroupDropdown() {
    if (!connectionNameGroupDropdownOpen || !connectionNameGroupDropdownButton || !connectionNameGroupDropdownMenu) return;

    ensureConnectionNameGroupDropdownPortal();

    const rect = connectionNameGroupDropdownButton.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.max(220, Math.round(rect.width || 220));
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(Math.round(rect.left), maxLeft));
    const availableBelow = window.innerHeight - rect.bottom - margin - gap;
    const availableAbove = rect.top - margin - gap;
    const preferredHeight = Math.min(260, Math.max(96, connectionNameGroupDropdownMenu.scrollHeight || 180));
    const placeBelow = availableBelow >= Math.min(preferredHeight, 150) || availableBelow >= availableAbove;
    const maxHeight = Math.max(72, Math.min(260, placeBelow ? availableBelow : availableAbove));
    const top = placeBelow
      ? Math.round(rect.bottom + gap)
      : Math.max(margin, Math.round(rect.top - gap - maxHeight));

    connectionNameGroupDropdownMenu.style.left = left + 'px';
    connectionNameGroupDropdownMenu.style.top = top + 'px';
    connectionNameGroupDropdownMenu.style.width = width + 'px';
    connectionNameGroupDropdownMenu.style.maxHeight = Math.round(maxHeight) + 'px';
  }

  function scheduleConnectionNameGroupDropdownPosition() {
    if (!connectionNameGroupDropdownOpen) return;
    if (connectionNameGroupDropdownPositionFrame) cancelAnimationFrame(connectionNameGroupDropdownPositionFrame);
    connectionNameGroupDropdownPositionFrame = requestAnimationFrame(() => {
      connectionNameGroupDropdownPositionFrame = 0;
      positionConnectionNameGroupDropdown();
    });
  }

  function showConnectionNameGroupDropdown() {
    if (!connectionNameGroupPicker || !connectionNameGroupDropdownButton || !connectionNameGroupDropdownMenu || connectionNameGroupNewMode) return;
    hideProfileDropdown();
    hideConnectionTypeDropdown();
    hideAuthDropdown();
    ensureConnectionNameGroupDropdownPortal();
    connectionNameGroupDropdownOpen = true;
    connectionNameGroupPicker.classList.add('open');
    connectionNameGroupDropdownMenu.classList.add('visible');
    syncConnectionNameGroupPicker();
    positionConnectionNameGroupDropdown();
  }

  function hideConnectionNameGroupDropdown() {
    connectionNameGroupDropdownOpen = false;
    if (connectionNameGroupDropdownPositionFrame) {
      cancelAnimationFrame(connectionNameGroupDropdownPositionFrame);
      connectionNameGroupDropdownPositionFrame = 0;
    }
    if (connectionNameGroupPicker) connectionNameGroupPicker.classList.remove('open');
    if (connectionNameGroupDropdownMenu) connectionNameGroupDropdownMenu.classList.remove('visible');
    syncConnectionNameGroupPicker();
  }

  function toggleConnectionNameGroupDropdown() {
    if (connectionNameGroupDropdownOpen) {
      hideConnectionNameGroupDropdown();
    } else {
      showConnectionNameGroupDropdown();
    }
  }

  function enterConnectionNameNewGroupMode() {
    connectionNameGroupPreviousId = connectionNameGroup ? String(connectionNameGroup.value || '').trim() : '';
    if (connectionNameGroup) connectionNameGroup.value = '';
    connectionNameGroupNewMode = true;
    pendingConnectionNameNewGroupName = '';
    hideConnectionNameGroupDropdown();
    syncConnectionNameGroupPicker();
    window.setTimeout(() => {
      if (!connectionNameGroupNewInput) return;
      connectionNameGroupNewInput.focus();
      connectionNameGroupNewInput.select();
    }, 0);
  }

  function exitConnectionNameNewGroupMode(restorePrevious) {
    connectionNameGroupNewMode = false;
    pendingConnectionNameNewGroupName = '';
    if (connectionNameGroupNewInput) {
      connectionNameGroupNewInput.value = '';
      connectionNameGroupNewInput.classList.remove('connection-input-invalid');
    }
    if (connectionNameGroup) {
      connectionNameGroup.value = restorePrevious ? normalizeConnectionNameGroupSelection(connectionNameGroupPreviousId) : String(connectionNameGroup.value || '').trim();
    }
    syncConnectionNameGroupPicker();
  }

  function selectConnectionNameGroupOption(value) {
    const optionValue = String(value || '').trim();
    if (optionValue === '__new__') {
      enterConnectionNameNewGroupMode();
      return;
    }

    connectionNameGroupNewMode = false;
    pendingConnectionNameNewGroupName = '';
    if (connectionNameGroupNewInput) {
      connectionNameGroupNewInput.value = '';
      connectionNameGroupNewInput.classList.remove('connection-input-invalid');
    }
    if (connectionNameGroup) {
      connectionNameGroup.value = normalizeConnectionNameGroupSelection(optionValue);
      connectionNameGroupPreviousId = connectionNameGroup.value;
    }
    hideConnectionNameGroupDropdown();
    syncConnectionNameGroupPicker();
  }

  function profileMatchesFilter(profile, filter) {
    const normalized = normalizeConnectionFilter(filter);
    if (!normalized) return true;

    const haystack = [
      profile && profile.name,
      profile && profile.host,
      profile && profile.port,
      profile && profile.username,
      profile && getConnectionTypeLabel(profile.connectionType),
      profile && getConnectionGroupName(profile.groupId),
      profile ? formatProfileTarget(profile) : ''
    ].map(value => String(value || '').toLowerCase()).join(' ');

    return haystack.includes(normalized);
  }

  function renderProfileDropdown(options = {}) {
    if (!profileDropdownMenu) return;
    const currentList = profileDropdownMenu.querySelector ? profileDropdownMenu.querySelector('.profile-dropdown-list') : null;
    const previousListScrollTop = options.preserveScroll && currentList ? currentList.scrollTop : 0;
    const filterTextBeforeRender = profileDropdownFilterText;
    profileDropdownMenu.innerHTML = '';

    const filterWrap = document.createElement('div');
    filterWrap.className = 'profile-dropdown-filter';
    const filterInput = document.createElement('input');
    filterInput.id = 'profileDropdownFilterInput';
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter connections...';
    filterInput.setAttribute('aria-label', 'Filter Saved Connections');
    filterInput.setAttribute('autocomplete', 'off');
    filterInput.value = filterTextBeforeRender;
    filterWrap.appendChild(filterInput);
    profileDropdownMenu.appendChild(filterWrap);

    const pinnedWrap = document.createElement('div');
    pinnedWrap.className = 'profile-dropdown-pinned';
    const quick = buildProfileDropdownItem('', 'New / Quick Connection', 'Use the form below', { suppressSelectedVisual: true });
    pinnedWrap.appendChild(quick);

    if (profiles.length) {
      const separator = document.createElement('div');
      separator.className = 'profile-dropdown-separator';
      pinnedWrap.appendChild(separator);
    }
    profileDropdownMenu.appendChild(pinnedWrap);

    const listWrap = document.createElement('div');
    listWrap.className = 'profile-dropdown-list';
    profileDropdownMenu.appendChild(listWrap);

    const filteredProfiles = profiles.filter(profile => profileMatchesFilter(profile, filterTextBeforeRender));
    if (profiles.length && !filteredProfiles.length) {
      const empty = document.createElement('div');
      empty.className = 'profile-dropdown-empty';
      empty.textContent = 'No saved connections found.';
      listWrap.appendChild(empty);
    } else {
      const displayGroups = groupProfilesForDisplay(filteredProfiles);
      for (const bucket of displayGroups.grouped) {
        const groupId = String(bucket.group && bucket.group.id || '');
        const filteringProfiles = Boolean(String(filterTextBeforeRender || '').trim());
        const isCollapsed = !filteringProfiles && collapsedProfileDropdownGroupIds.has(groupId);
        const groupBlock = document.createElement('div');
        groupBlock.className = 'profile-dropdown-group-block' + (isCollapsed ? ' collapsed' : ' expanded');
        groupBlock.dataset.profileGroupId = groupId;
        const groupHeader = buildProfileDropdownGroupHeader(bucket.group, bucket.profiles.length, isCollapsed);
        groupBlock.appendChild(groupHeader);
        if (!isCollapsed) {
          const groupItems = document.createElement('div');
          groupItems.className = 'profile-dropdown-group-items';
          for (const profile of bucket.profiles) {
            groupItems.appendChild(buildProfileDropdownItem(profile.id, profile.name, formatProfileTarget(profile), { grouped: true }));
          }
          groupBlock.appendChild(groupItems);
        }
        listWrap.appendChild(groupBlock);
      }
      for (const profile of displayGroups.loose) {
        listWrap.appendChild(buildProfileDropdownItem(profile.id, profile.name, formatProfileTarget(profile)));
      }
    }

    updateProfileDropdownLabel();

    if (options.preserveScroll && previousListScrollTop) {
      requestAnimationFrame(() => {
        const nextList = profileDropdownMenu.querySelector ? profileDropdownMenu.querySelector('.profile-dropdown-list') : null;
        if (nextList) nextList.scrollTop = previousListScrollTop;
      });
    }

    if (options.focusFilter) {
      setTimeout(() => {
        const nextFilterInput = document.getElementById('profileDropdownFilterInput');
        if (!nextFilterInput) return;
        nextFilterInput.focus();
        const valueLength = String(nextFilterInput.value || '').length;
        try { nextFilterInput.setSelectionRange(valueLength, valueLength); } catch (error) { /* ignore */ }
      }, 0);
    }
  }

  function buildProfileDropdownGroupHeader(group, count, isCollapsed) {
    const groupId = String(group && group.id || '');
    const header = document.createElement('div');
    header.className = 'profile-dropdown-group-header' + (isCollapsed ? ' collapsed' : '');
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.dataset.profileGroupToggle = groupId;
    header.setAttribute('aria-expanded', String(!isCollapsed));
    header.setAttribute('aria-label', (isCollapsed ? 'Expand ' : 'Collapse ') + String(group && group.name || 'connection group'));

    const chevron = document.createElement('span');
    chevron.className = 'profile-dropdown-group-chevron';
    chevron.textContent = isCollapsed ? '▸' : '▾';
    header.appendChild(chevron);

    const name = document.createElement('span');
    name.className = 'profile-dropdown-group-name';
    name.textContent = String(group && group.name || 'Connections');
    header.appendChild(name);

    const counter = document.createElement('span');
    counter.className = 'profile-dropdown-group-count';
    counter.textContent = String(count || 0);
    header.appendChild(counter);

    header.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleProfileDropdownGroup(groupId);
    });

    return header;
  }

  function toggleProfileDropdownGroup(groupId) {
    const id = String(groupId || '').trim();
    if (!id) return;
    if (collapsedProfileDropdownGroupIds.has(id)) {
      collapsedProfileDropdownGroupIds.delete(id);
    } else {
      collapsedProfileDropdownGroupIds.add(id);
    }
    persistProfileDropdownGroupsState();
    renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
  }

  function buildProfileDropdownItem(id, name, meta, options = {}) {
    const profileId = String(id || '');
    const isSelected = profileId === selectedProfileId;
    const showSelectedVisual = isSelected && !options.suppressSelectedVisual;
    const item = document.createElement('div');
    item.className = 'profile-dropdown-item' + (options.grouped ? ' grouped' : '') + (showSelectedVisual ? ' selected' : '');
    item.dataset.profileId = profileId;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));
    item.tabIndex = 0;

    const main = document.createElement('span');
    main.className = 'profile-dropdown-main';

    const nameRow = document.createElement('span');
    nameRow.className = 'profile-dropdown-name-row';

    const connectedSession = profileId ? getConnectedSessionForProfileId(profileId) : null;
    const pendingSession = profileId ? getPendingSessionForProfileId(profileId) : null;
    const disconnecting = profileId ? profileDisconnectingIds.has(profileId) : false;
    const isConnected = Boolean(connectedSession);
    const isBusy = Boolean(pendingSession) || disconnecting;

    const nameElement = document.createElement('span');
    const isDirtySelectedProfile = isSelected && isSelectedSavedConnectionDirty();
    nameElement.className = 'profile-dropdown-name' + (isConnected ? ' connected' : '') + (isDirtySelectedProfile ? ' dirty' : '');
    nameElement.textContent = name || 'Unnamed connection';
    nameRow.appendChild(nameElement);
    main.appendChild(nameRow);

    if (meta) {
      const metaElement = document.createElement('span');
      metaElement.className = 'profile-dropdown-meta';
      metaElement.textContent = meta;
      main.appendChild(metaElement);
    }

    item.appendChild(main);

    if (profileId) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'profile-dropdown-action' + (isConnected ? ' connected' : '') + (isBusy ? ' busy' : '');
      action.dataset.profileAction = isConnected ? 'disconnect' : 'connect';
      action.dataset.profileActionId = profileId;
      action.disabled = isBusy;
      action.setAttribute('aria-label', (isConnected ? 'Disconnect ' : 'Connect ') + (name || 'connection'));

      action.setAttribute('data-tooltip', disconnecting ? 'Disconnecting' : (pendingSession ? 'Connecting' : (isConnected ? 'Disconnect' : 'Connect')));

      const spinner = document.createElement('span');
      spinner.className = 'profile-dropdown-action-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      action.appendChild(spinner);

      if (!isBusy) {
        const icon = document.createElement('span');
        icon.className = 'profile-dropdown-action-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = isConnected ? PROFILE_ACTION_DISCONNECT_ICON : PROFILE_ACTION_CONNECT_ICON;
        action.appendChild(icon);
      }
      item.appendChild(action);
    }

    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void requestSelectProfile(profileId);
    });

    return item;
  }

  function toggleProfileDropdown() {
    if (!profileDropdownButton) return;
    if (profileDropdownOpen) {
      hideProfileDropdown();
      return;
    }

    hideConnectionTypeDropdown();
    hideAuthDropdown();
    hideConnectionNameGroupDropdown();
    profileDropdownOpen = true;
    profileDropdownFilterText = '';
    profileDropdownButton.setAttribute('aria-expanded', 'true');
    profileDropdownButton.closest('.profile-picker').classList.add('open');
    renderProfileDropdown({ focusFilter: true });
  }

  function hideProfileDropdown() {
    profileDropdownOpen = false;
    profileDropdownFilterText = '';
    if (profileDropdownButton) profileDropdownButton.setAttribute('aria-expanded', 'false');
    const picker = profileDropdownButton ? profileDropdownButton.closest('.profile-picker') : null;
    if (picker) picker.classList.remove('open');
  }

  function updateActiveSessionTabDivider() {
    if (!browserSectionDivider) return;
    browserSectionDivider.style.removeProperty('--active-tab-left');
    browserSectionDivider.style.removeProperty('--active-tab-width');
  }

  function getSessionTabsViewportWidth() {
    if (!sessionTabs) return 0;
    const rect = sessionTabs.getBoundingClientRect ? sessionTabs.getBoundingClientRect() : null;
    return Math.max(0, Math.floor((rect && rect.width) || sessionTabs.clientWidth || 0));
  }

  function getSessionTabsContentWidth() {
    if (!sessionTabs) return 0;
    const tabs = Array.from(sessionTabs.querySelectorAll('.session-tab[data-session-id]'));
    if (!tabs.length) return 0;
    const firstTab = tabs[0];
    const lastTab = tabs[tabs.length - 1];
    return Math.max(0, Math.ceil((lastTab.offsetLeft + lastTab.offsetWidth) - firstTab.offsetLeft));
  }

  function getSessionTabsMeasuredMaxScroll() {
    const viewportWidth = getSessionTabsViewportWidth();
    const contentWidth = getSessionTabsContentWidth();
    if (!viewportWidth || !contentWidth) return 0;
    return Math.max(0, contentWidth - viewportWidth);
  }

  function getSessionTabsMaxScroll() {
    if (!sessionTabs || sessionTabs.classList.contains('empty')) return 0;
    const measuredMaxScroll = getSessionTabsMeasuredMaxScroll();
    if (measuredMaxScroll <= 4) return 0;
    const nativeMaxScroll = Math.max(0, Math.ceil(sessionTabs.scrollWidth) - Math.ceil(sessionTabs.clientWidth));
    return Math.max(measuredMaxScroll, nativeMaxScroll);
  }

  function updateSessionTabsScrollbar() {
    if (!sessionTabs || !sessionTabsScrollbar || !sessionTabsScrollbarThumb) return;

    const maxScroll = getSessionTabsMaxScroll();
    const hasOverflow = maxScroll > 4;
    sessionTabsScrollbar.hidden = !hasOverflow;
    sessionTabsScrollbar.classList.toggle('visible', hasOverflow);

    if (!hasOverflow) {
      sessionTabs.scrollLeft = 0;
      sessionTabsScrollbar.classList.remove('dragging');
      sessionTabsScrollbarThumb.style.width = '';
      sessionTabsScrollbarThumb.style.transform = '';
      return;
    }

    const trackWidth = Math.max(0, sessionTabsScrollbar.clientWidth || sessionTabs.clientWidth);
    if (!trackWidth) return;

    const viewportWidth = getSessionTabsViewportWidth();
    const contentWidth = Math.max(viewportWidth, getSessionTabsContentWidth());
    const visibleRatio = Math.max(0, Math.min(1, viewportWidth / Math.max(1, contentWidth)));
    const thumbWidth = Math.max(24, Math.round(trackWidth * visibleRatio));
    const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
    const scrollRatio = maxScroll > 0 ? sessionTabs.scrollLeft / maxScroll : 0;
    const thumbLeft = Math.max(0, Math.min(maxThumbLeft, Math.round(maxThumbLeft * scrollRatio)));

    sessionTabsScrollbarThumb.style.width = thumbWidth + 'px';
    sessionTabsScrollbarThumb.style.transform = 'translateX(' + thumbLeft + 'px)';
  }

  function scrollSessionTabsToScrollbarPointer(event) {
    if (!sessionTabs || !sessionTabsScrollbar || !sessionTabsScrollbarThumb) return;
    const maxScroll = getSessionTabsMaxScroll();
    if (maxScroll <= 4) return;

    const rect = sessionTabsScrollbar.getBoundingClientRect();
    const trackWidth = Math.max(0, rect.width);
    const thumbWidth = Math.max(24, sessionTabsScrollbarThumb.offsetWidth || 24);
    const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
    if (!trackWidth || !maxThumbLeft) return;

    const targetThumbLeft = Math.max(0, Math.min(maxThumbLeft, event.clientX - rect.left - thumbWidth / 2));
    sessionTabs.scrollLeft = (targetThumbLeft / maxThumbLeft) * maxScroll;
    updateSessionTabsScrollbar();
  }

  function getSessionTabsScrollForDragDelta(deltaX) {
    if (!sessionTabs || !sessionTabsScrollbar || !sessionTabsScrollbarThumb) return 0;
    const maxScroll = getSessionTabsMaxScroll();
    const trackWidth = Math.max(0, sessionTabsScrollbar.clientWidth || sessionTabs.clientWidth);
    const thumbWidth = Math.max(24, sessionTabsScrollbarThumb.offsetWidth || 24);
    const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
    if (maxScroll <= 4 || maxThumbLeft <= 0) return 0;
    return (deltaX / maxThumbLeft) * maxScroll;
  }

  function handleSessionTabsScrollbarPointerDown(event) {
    if (!sessionTabs || !sessionTabsScrollbar || !sessionTabsScrollbarThumb) return;
    const maxScroll = getSessionTabsMaxScroll();
    if (maxScroll <= 4) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.target !== sessionTabsScrollbarThumb) {
      scrollSessionTabsToScrollbarPointer(event);
    }

    sessionTabsScrollbarDragging = true;
    sessionTabsScrollbarDragStartX = event.clientX;
    sessionTabsScrollbarDragStartScrollLeft = sessionTabs.scrollLeft;
    sessionTabsScrollbar.classList.add('dragging');
    if (sessionTabsScrollbar.setPointerCapture && event.pointerId !== undefined) {
      sessionTabsScrollbar.setPointerCapture(event.pointerId);
    }
  }

  function handleSessionTabsScrollbarPointerMove(event) {
    if (!sessionTabsScrollbarDragging || !sessionTabs) return;
    event.preventDefault();
    const deltaX = event.clientX - sessionTabsScrollbarDragStartX;
    sessionTabs.scrollLeft = sessionTabsScrollbarDragStartScrollLeft + getSessionTabsScrollForDragDelta(deltaX);
    updateSessionTabsScrollbar();
  }

  function stopSessionTabsScrollbarDrag(event) {
    if (!sessionTabsScrollbarDragging) return;
    sessionTabsScrollbarDragging = false;
    if (sessionTabsScrollbar) {
      sessionTabsScrollbar.classList.remove('dragging');
      if (sessionTabsScrollbar.releasePointerCapture && event && event.pointerId !== undefined) {
        try { sessionTabsScrollbar.releasePointerCapture(event.pointerId); } catch (_) {}
      }
    }
  }

  function getSessionTabOrder() {
    return sessions.map(session => session.id).filter(Boolean);
  }

  function ensureSessionTabDropLine() {
    if (!sessionTabs) return null;
    let line = sessionTabs.querySelector('.session-tab-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'session-tab-drop-line';
      line.setAttribute('aria-hidden', 'true');
      sessionTabs.appendChild(line);
    }
    return line;
  }

  function hideSessionTabDropLine() {
    if (!sessionTabs) return;
    const line = sessionTabs.querySelector('.session-tab-drop-line');
    if (line) {
      line.style.display = 'none';
      line.style.left = '';
    }
  }

  function clearSessionTabDragState() {
    draggedSessionId = '';
    sessionDragOverId = '';
    sessionDragOverPosition = '';
    sessionDragDropIndex = -1;
    sessionTabDragging = false;
    if (!sessionTabs) return;
    for (const tab of Array.from(sessionTabs.querySelectorAll('.session-tab'))) {
      tab.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    }
    hideSessionTabDropLine();
  }

  function getSessionTabButtons() {
    if (!sessionTabs) return [];
    return Array.from(sessionTabs.querySelectorAll('.session-tab[data-session-id]'));
  }

  function getSessionTabDropZoneRect() {
    if (!sessionTabs) return null;
    const zone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    return zone.getBoundingClientRect();
  }

  function getSessionDropIndex(event) {
    const tabs = getSessionTabButtons();
    if (!tabs.length || !sessionTabs) return -1;

    const zoneRect = getSessionTabDropZoneRect();
    if (zoneRect) {
      const verticalPadding = 12;
      const horizontalPadding = 24;
      const insideZone = event.clientX >= zoneRect.left - horizontalPadding && event.clientX <= zoneRect.right + horizontalPadding && event.clientY >= zoneRect.top - verticalPadding && event.clientY <= zoneRect.bottom + verticalPadding;
      if (!insideZone) return -1;
    }

    const firstRect = tabs[0].getBoundingClientRect();
    const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
    if (event.clientX <= firstRect.left) return 0;
    if (event.clientX >= lastRect.right) return tabs.length;

    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (event.clientX < centerX) return index;
    }
    return tabs.length;
  }

  function showSessionTabDropLine(insertionIndex) {
    const tabs = getSessionTabButtons();
    if (!sessionTabs || !tabs.length || insertionIndex < 0) return;
    const line = ensureSessionTabDropLine();
    if (!line) return;

    const clampedIndex = Math.max(0, Math.min(insertionIndex, tabs.length));
    let left = 0;
    if (clampedIndex <= 0) {
      left = tabs[0].offsetLeft;
    } else if (clampedIndex >= tabs.length) {
      const lastTab = tabs[tabs.length - 1];
      left = lastTab.offsetLeft + lastTab.offsetWidth;
    } else {
      const previousTab = tabs[clampedIndex - 1];
      const nextTab = tabs[clampedIndex];
      left = ((previousTab.offsetLeft + previousTab.offsetWidth) + nextTab.offsetLeft) / 2;
    }

    const maxLeft = Math.max(0, sessionTabs.scrollWidth - 1);
    line.style.left = Math.max(0, Math.min(Math.round(left), maxLeft)) + 'px';
    line.style.display = 'block';
  }

  function setSessionTabDropIndicator(insertionIndex) {
    if (insertionIndex < 0) {
      sessionDragDropIndex = -1;
      hideSessionTabDropLine();
      return;
    }
    if (sessionDragDropIndex !== insertionIndex) {
      sessionDragOverId = '';
      sessionDragOverPosition = '';
      sessionDragDropIndex = insertionIndex;
    }
    showSessionTabDropLine(insertionIndex);
  }

  function reorderSessionTabsByIndex(draggedId, insertionIndex) {
    if (!draggedId || insertionIndex < 0) return;
    const orderedIds = getSessionTabOrder();
    const fromIndex = orderedIds.indexOf(draggedId);
    if (fromIndex < 0) return;

    const clampedIndex = Math.max(0, Math.min(insertionIndex, orderedIds.length));
    orderedIds.splice(fromIndex, 1);
    let insertIndex = clampedIndex;
    if (fromIndex < clampedIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, orderedIds.length));
    orderedIds.splice(insertIndex, 0, draggedId);

    const currentOrder = getSessionTabOrder();
    if (orderedIds.length === currentOrder.length && orderedIds.every((id, index) => id === currentOrder[index])) {
      return;
    }

    const sessionById = new Map(sessions.map(session => [session.id, session]));
    sessions = orderedIds.map(id => sessionById.get(id)).filter(Boolean);
    renderSessionTabs();
    vscode.postMessage({ type: 'reorderSessions', payload: { connectionIds: orderedIds } });
  }

  function getSessionDropPosition(event, tab) {
    const rect = tab.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  }

  function reorderSessionTabs(draggedId, targetId, position) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const orderedIds = getSessionTabOrder();
    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex < 0) return;
    reorderSessionTabsByIndex(draggedId, position === 'after' ? targetIndex + 1 : targetIndex);
  }

  function activateClientSession(connectionId) {
    const sessionId = String(connectionId || '').trim();
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;

    activeConnectionId = sessionId;
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    restoreFilesStatusForActiveConnection();
    setControls();

    if (isSessionConnected(session)) {
      setBusy(true, 'Switching to ' + session.name + '...', '', 'Cancel', session.id);
      vscode.postMessage({ type: 'switchSession', payload: { connectionId: session.id } });
      return;
    }

    currentEntries = [];
    currentPath.value = session.currentPath || session.startPath || '/';
    const message = isSessionFailed(session) ? (session.error || 'Connection failed.') : 'Connecting...';
    entriesRenderGeneration += 1;
    renderEntriesEmptyMessage(message);
  }

  function getSessionCloseDisplayName(session) {
    const rawName = session && (session.name || session.host || session.id);
    const name = String(rawName || 'this connection').trim();
    return name || 'this connection';
  }

  function disconnectSessionFromTabClose(connectionId) {
    const sessionId = String(connectionId || '');
    if (!sessionId || connectionButtonState === 'disconnecting') return;
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;
    connectionButtonState = 'disconnecting';
    setBusy(true, 'Disconnecting...');
    vscode.postMessage({ type: 'disconnect', payload: { connectionId: sessionId } });
  }

  function requestCloseSessionFromTab(session) {
    if (!session || !session.id || connectionButtonState === 'disconnecting') return;
    if (!isSessionConnected(session)) {
      removeClientPendingSession(session.id);
      return;
    }
    showConfirmDialog({
      requestId: 'client:closeConnection:' + session.id,
      title: 'Close connection?',
      message: 'This will disconnect "' + getSessionCloseDisplayName(session) + '" and stop any active Remote Edit operations for this connection.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Disconnect'
    });
  }

  function renderSessionTabs() {
    if (!sessions.length) {
      sessionTabs.classList.add('empty');
      sessionTabs.closest('.browser-open-section')?.classList.add('empty-session-tabs');
      sessionTabs.closest('.browser-session-strip')?.classList.remove('has-session-tabs');
      sessionTabs.innerHTML = '<span class="session-empty">No active connections</span>';
      updateActiveSessionTabDivider();
      updateSessionTabsScrollbar();
      return;
    }

    sessionTabs.classList.remove('empty');
    sessionTabs.closest('.browser-open-section')?.classList.remove('empty-session-tabs');
    sessionTabs.closest('.browser-session-strip')?.classList.add('has-session-tabs');
    sessionTabs.innerHTML = '';

    for (const session of sessions) {
      const tab = document.createElement('button');
      const tabStateClass = isSessionConnecting(session) ? ' connecting' : (isSessionFailed(session) ? ' failed' : '');
      const tabIcon = isSessionConnecting(session) ? SESSION_TAB_CONNECTING_ICON : (isSessionFailed(session) ? SESSION_TAB_ERROR_ICON : SESSION_TAB_REMOTE_ICON);
      tab.className = 'session-tab has-tooltip tooltip-above' + tabStateClass + (session.id === activeConnectionId ? ' active' : '');
      tab.dataset.sessionId = session.id || '';
      tab.dataset.tooltip = formatSessionTooltipTarget(session);
      tab.draggable = true;
      tab.innerHTML = '<span class="session-icon" aria-hidden="true">' + tabIcon + '</span><span class="session-name">' + escapeHtml(session.name) + '</span><span class="session-close has-tooltip tooltip-above" data-tooltip="Disconnect"></span>';
      tab.addEventListener('click', () => {
        if (session.id === activeConnectionId) {
          if (isSessionConnected(session)) syncConnectionFormWithActiveSession({ preserveStatus: true });
          return;
        }
        activateClientSession(session.id);
      });

      tab.addEventListener('dragstart', event => {
        if (event.target && event.target.closest && event.target.closest('.session-close')) {
          event.preventDefault();
          return;
        }
        draggedSessionId = session.id || '';
        sessionDragOverId = '';
        sessionDragOverPosition = '';
        sessionTabDragging = true;
        hideWebviewTooltip();
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedSessionId);
        }
        tab.classList.add('dragging');
      });

      tab.addEventListener('dragend', clearSessionTabDragState);

      const close = tab.querySelector('.session-close');
      close.addEventListener('pointerdown', event => { event.stopPropagation(); });
      close.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      close.addEventListener('click', event => {
        event.stopPropagation();
        requestCloseSessionFromTab(session);
      });

      sessionTabs.appendChild(tab);
    }
    updateActiveSessionTabDivider();
    requestAnimationFrame(updateSessionTabsScrollbar);
  }

  function handleSessionTabsDragOver(event) {
    if (!draggedSessionId) return;
    const insertionIndex = getSessionDropIndex(event);
    if (insertionIndex < 0) {
      setSessionTabDropIndicator(-1);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setSessionTabDropIndicator(insertionIndex);
  }

  function handleSessionTabsDrop(event) {
    if (!draggedSessionId) return;
    const insertionIndex = getSessionDropIndex(event);
    if (insertionIndex < 0) return;
    event.preventDefault();
    const droppedSessionId = draggedSessionId;
    clearSessionTabDragState();
    reorderSessionTabsByIndex(droppedSessionId, insertionIndex);
  }

  function handleSessionTabsDragLeave(event) {
    if (!draggedSessionId || !sessionTabs) return;
    const zone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && zone.contains(relatedTarget)) return;
    hideSessionTabDropLine();
  }

  function handleSessionTabsWheel(event) {
    if (!sessionTabs) return;
    const maxScroll = getSessionTabsMaxScroll();
    if (maxScroll <= 4) return;
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    sessionTabs.scrollLeft = Math.max(0, Math.min(maxScroll, sessionTabs.scrollLeft + delta));
    updateSessionTabsScrollbar();
    event.preventDefault();
  }

  if (sessionTabs) {
    sessionTabs.addEventListener('scroll', () => {
      updateActiveSessionTabDivider();
      updateSessionTabsScrollbar();
      if (sessionDragDropIndex >= 0) showSessionTabDropLine(sessionDragDropIndex);
    });
    sessionTabs.addEventListener('wheel', handleSessionTabsWheel, { passive: false });
    if (sessionTabsScrollbar) {
      sessionTabsScrollbar.addEventListener('pointerdown', handleSessionTabsScrollbarPointerDown);
      sessionTabsScrollbar.addEventListener('pointermove', handleSessionTabsScrollbarPointerMove);
      sessionTabsScrollbar.addEventListener('pointerup', stopSessionTabsScrollbarDrag);
      sessionTabsScrollbar.addEventListener('pointercancel', stopSessionTabsScrollbarDrag);
      sessionTabsScrollbar.addEventListener('lostpointercapture', stopSessionTabsScrollbarDrag);
    }
    window.addEventListener('resize', updateSessionTabsScrollbar);
    if (typeof ResizeObserver !== 'undefined') {
      const sessionTabsResizeObserver = new ResizeObserver(updateSessionTabsScrollbar);
      sessionTabsResizeObserver.observe(sessionTabs);
      const sessionTabsContainer = sessionTabs.closest('.browser-session-strip');
      if (sessionTabsContainer) sessionTabsResizeObserver.observe(sessionTabsContainer);
    }
    const sessionDropZone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    sessionDropZone.addEventListener('dragover', handleSessionTabsDragOver);
    sessionDropZone.addEventListener('drop', handleSessionTabsDrop);
    sessionDropZone.addEventListener('dragleave', handleSessionTabsDragLeave);
  }

`;
}
