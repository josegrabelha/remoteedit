export function renderServerOverviewLists(): string {
  return `  function renderServerOverviewCards() {
    const state = getActiveServerDashboardState();
    const dataItems = state && state.data && Array.isArray(state.data.overview) ? state.data.overview : getDefaultServerOverviewItems();
    const items = dataItems.map(item => ({
      label: item.label || '',
      value: state && state.loading ? 'Loading...' : (item.value || '—'),
      help: item.help || ''
    }));
    return items.map((item, index) => '<div class="server-overview-card is-clickable" role="button" tabindex="0" data-server-overview-index="' + String(index) + '" data-tooltip="View details"><div class="server-overview-label">' + escapeHtml(item.label) + '</div><div class="server-overview-value">' + escapeHtml(item.value) + '</div><div class="server-overview-help">' + escapeHtml(item.help) + '</div></div>').join('');
  }


  function getCurrentServerOverviewItems() {
    const state = getActiveServerDashboardState();
    const dataItems = state && state.data && Array.isArray(state.data.overview) ? state.data.overview : getDefaultServerOverviewItems();
    return dataItems.map(item => ({
      label: item.label || '',
      value: state && state.loading ? 'Loading...' : (item.value || '—'),
      help: item.help || ''
    }));
  }

  function normalizeOverviewDetailValue(value) {
    const text = String(value == null ? '' : value).trim();
    return text || '—';
  }

  function normalizeOverviewPercent(value) {
    const text = normalizeOverviewDetailValue(value);
    return text === '—' ? text : text;
  }

  function renderOverviewDetailGrid(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return '<div class="server-overview-detail-empty">Details are not available for this platform.</div>';
    return '<div class="server-overview-detail-grid">' + safeRows.map(row => {
      return '<div class="file-properties-label">' + escapeHtml(row[0]) + '</div>'
        + '<div class="file-properties-value">' + escapeHtml(row[1] || '—') + '</div>';
    }).join('') + '</div>';
  }

  function renderOverviewDetailTable(title, headers, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
      return '<div class="server-overview-detail-section"><div class="server-overview-detail-section-title">' + escapeHtml(title) + '</div><div class="server-overview-detail-empty">Details are not available for this platform.</div></div>';
    }
    const headerHtml = headers.map(header => '<th>' + escapeHtml(header) + '</th>').join('');
    const rowsHtml = safeRows.map(row => '<tr>' + row.map(cell => '<td>' + escapeHtml(cell || '—') + '</td>').join('') + '</tr>').join('');
    return '<div class="server-overview-detail-section"><div class="server-overview-detail-section-title">' + escapeHtml(title) + '</div><div class="server-overview-detail-table-wrap"><table class="server-overview-detail-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function getOverviewDetailsData(state) {
    return state && state.data && state.data.overviewDetails ? state.data.overviewDetails : {};
  }

  function getServerOverviewDetailsModel(item, state) {
    const label = String(item && item.label || '').trim();
    const value = String(item && item.value || '').trim() || '—';
    const help = String(item && item.help || '').trim();
    const details = getOverviewDetailsData(state);
    const loading = value === 'Loading...';
    const notLoaded = value === '—' || /^Not loaded$/i.test(help) || /^Not available$/i.test(help);
    const unavailableHtml = renderOverviewDetailGrid([
      ['Status', loading ? 'Loading' : (notLoaded ? (help || 'Not loaded') : 'Not available')]
    ]);

    if (/^Uptime$/i.test(label)) {
      const uptime = details.uptime || {};
      return {
        title: 'Uptime Details',
        subtitle: 'System uptime',
        html: uptime.uptime ? renderOverviewDetailGrid([
          ['Uptime', uptime.uptime],
          ['Meaning', 'How long the server has been running.']
        ]) : unavailableHtml
      };
    }

    if (/^Load$/i.test(label)) {
      const load = details.load || {};
      const rows = [];
      if (load.oneMinute) rows.push(['1 minute', load.oneMinute]);
      if (load.fiveMinutes) rows.push(['5 minutes', load.fiveMinutes]);
      if (load.fifteenMinutes) rows.push(['15 minutes', load.fifteenMinutes]);
      if (rows.length) rows.push(['Meaning', 'Average runnable or waiting work over time.']);
      return {
        title: 'Load Details',
        subtitle: 'Load averages',
        html: rows.length ? renderOverviewDetailGrid(rows) : unavailableHtml
      };
    }

    if (/^Memory$/i.test(label)) {
      const memory = details.memory || {};
      const rows = [];
      if (memory.percent) rows.push(['Usage', normalizeOverviewPercent(memory.percent)]);
      if (memory.total) rows.push(['Total', normalizeOverviewDetailValue(memory.total)]);
      if (memory.used) rows.push(['Used', normalizeOverviewDetailValue(memory.used)]);
      if (memory.free) rows.push(['Free', normalizeOverviewDetailValue(memory.free)]);
      if (memory.available) rows.push(['Available', normalizeOverviewDetailValue(memory.available)]);
      if (memory.buffersCache && memory.buffersCache !== '—') rows.push(['Buffers/cache', normalizeOverviewDetailValue(memory.buffersCache)]);
      return {
        title: 'Memory Details',
        subtitle: 'Physical memory usage',
        html: rows.length ? renderOverviewDetailGrid(rows) : unavailableHtml
      };
    }

    if (/^Disk$/i.test(label)) {
      const disks = Array.isArray(details.disk) ? details.disk : [];
      const rows = disks.map(disk => [
        normalizeOverviewDetailValue(disk.filesystem),
        normalizeOverviewDetailValue(disk.mount),
        normalizeOverviewDetailValue(disk.used),
        normalizeOverviewDetailValue(disk.free),
        normalizeOverviewDetailValue(disk.total),
        normalizeOverviewDetailValue(disk.percent)
      ]);
      return {
        title: 'Disk Details',
        subtitle: 'Filesystems and mount usage',
        html: rows.length ? renderOverviewDetailTable('Filesystems', ['Filesystem', 'Mount', 'Used', 'Free', 'Total', 'Use%'], rows) : unavailableHtml
      };
    }

    if (/^Sessions$/i.test(label)) {
      const sessions = Array.isArray(details.sessions) ? details.sessions : [];
      const rows = sessions.map(session => [
        normalizeOverviewDetailValue(session.user),
        normalizeOverviewDetailValue(session.tty),
        normalizeOverviewDetailValue(session.from),
        normalizeOverviewDetailValue(session.loginTime)
      ]);
      return {
        title: 'Sessions Details',
        subtitle: 'Logged-in user sessions',
        html: rows.length ? renderOverviewDetailTable('Sessions', ['User', 'TTY', 'From', 'Login time'], rows) : unavailableHtml
      };
    }

    if (/^Listeners$/i.test(label)) {
      const listeners = Array.isArray(details.listeners) ? details.listeners : [];
      const rows = listeners.map(listener => [
        normalizeOverviewDetailValue(listener.protocol),
        normalizeOverviewDetailValue(listener.localAddress),
        normalizeOverviewDetailValue(listener.port),
        normalizeOverviewDetailValue(listener.state)
      ]);
      return {
        title: 'Listeners Details',
        subtitle: 'Listening network sockets',
        html: rows.length ? renderOverviewDetailTable('Listeners', ['Proto', 'Local address', 'Port', 'State'], rows) : unavailableHtml
      };
    }

    if (/^Swap$/i.test(label)) {
      const swap = details.swap || {};
      if (swap.configured === false) {
        return {
          title: 'Swap Details',
          subtitle: 'Swap usage',
          html: renderOverviewDetailGrid([
            ['Status', 'Not configured'],
            ['Total', '0 B'],
            ['Used', '0 B'],
            ['Free', '0 B']
          ])
        };
      }
      const rows = [];
      if (swap.percent) rows.push(['Usage', normalizeOverviewPercent(swap.percent)]);
      if (swap.total) rows.push(['Total', normalizeOverviewDetailValue(swap.total)]);
      if (swap.used) rows.push(['Used', normalizeOverviewDetailValue(swap.used)]);
      if (swap.free) rows.push(['Free', normalizeOverviewDetailValue(swap.free)]);
      return {
        title: 'Swap Details',
        subtitle: 'Swap usage',
        html: rows.length ? renderOverviewDetailGrid(rows) : unavailableHtml
      };
    }

    if (/^IO Wait$/i.test(label)) {
      const ioWait = details.ioWait || {};
      const rows = [];
      if (ioWait.wait) rows.push(['IO Wait', normalizeOverviewPercent(ioWait.wait)]);
      if (ioWait.user && ioWait.user !== '—') rows.push(['User CPU', normalizeOverviewPercent(ioWait.user)]);
      if (ioWait.system && ioWait.system !== '—') rows.push(['System CPU', normalizeOverviewPercent(ioWait.system)]);
      if (ioWait.idle && ioWait.idle !== '—') rows.push(['Idle CPU', normalizeOverviewPercent(ioWait.idle)]);
      if (rows.length) rows.push(['Meaning', 'CPU time spent waiting on disk or other I/O.']);
      return {
        title: 'IO Wait Details',
        subtitle: 'CPU waiting on I/O',
        html: rows.length ? renderOverviewDetailGrid(rows) : unavailableHtml
      };
    }

    return {
      title: (label || 'Overview') + ' Details',
      subtitle: 'Server overview',
      html: renderOverviewDetailGrid([
        ['Value', value],
        ['Details', help || '—']
      ])
    };
  }

  function showServerOverviewDetailsDialog(index) {
    if (!serverOverviewDetailsBackdrop || !serverOverviewDetailsTitle || !serverOverviewDetailsSubtitle || !serverOverviewDetailsGrid) return;
    const items = getCurrentServerOverviewItems();
    if (!Number.isFinite(index) || index < 0 || index >= items.length) return;
    const item = items[index];
    const state = getActiveServerDashboardState();
    const model = getServerOverviewDetailsModel(item, state);
    serverOverviewDetailsDialogOpen = true;
    serverOverviewDetailsTitle.textContent = model.title;
    serverOverviewDetailsSubtitle.textContent = model.subtitle;
    serverOverviewDetailsGrid.className = 'server-overview-details';
    serverOverviewDetailsGrid.innerHTML = model.html;
    if (serverOverviewDetailsCopyButton) {
      serverOverviewDetailsCopyButton.textContent = 'Copy';
      serverOverviewDetailsCopyButton.setAttribute('data-original-text', 'Copy');
    }
    serverOverviewDetailsBackdrop.classList.add('visible');
    serverOverviewDetailsBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (serverOverviewDetailsCloseButton) serverOverviewDetailsCloseButton.focus();
    }, 0);
  }

  function hideServerOverviewDetailsDialog() {
    if (!serverOverviewDetailsBackdrop) return;
    serverOverviewDetailsDialogOpen = false;
    serverOverviewDetailsBackdrop.classList.remove('visible');
    serverOverviewDetailsBackdrop.setAttribute('aria-hidden', 'true');
  }


  function renderServerQuickTasks() {
    const list = getRemoteCommandSavedList(activeConnectionId);
    const running = getRemoteCommandSession(activeConnectionId).status === 'running';
    const filterText = getServerQuickTaskFilterText();
    const filteredList = list.filter(item => matchesServerQuickTaskFilter(item, filterText));
    const visibleList = sortServerItems('quickTasks', filteredList, (item, key) => {
      if (key === 'details') return item && (item.details || getRemoteCommandItemRemotePath(item) || item.command);
      return item && (item.name || firstRemoteCommandLine(item.command) || item.command);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countLabel = formatServerListCount(list.length, filteredList.length, filterHasValue, false);
    const filterBox = '<div class="server-quick-tasks-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverQuickTasksFilterInput" class="server-quick-tasks-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter tasks" value="' + escapeHtml(filterText) + '" aria-label="Filter quick tasks"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Quick Tasks Filter" data-tooltip="Clear Filter" data-server-quick-tasks-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const addTooltip = running ? 'A command is already running' : 'Add command';
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(addTooltip) + '"><button class="secondary remote-command-icon-button" type="button" aria-label="Add command" data-server-quick-task-action="add"' + (running ? ' disabled' : '') + '><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const header = '<div class="server-section-title-row server-quick-tasks-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Quick Tasks</div><span class="server-section-count">' + escapeHtml(countLabel) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!list.length) {
      return '<section class="server-section-card server-quick-tasks-card">' + header + '<div class="server-placeholder"><div>No saved commands yet.</div><button class="secondary" type="button" data-server-action="run-command">Open Run Commands</button></div></section>';
    }

    if (!filteredList.length) {
      return '<section class="server-section-card server-quick-tasks-card">' + header + '<div class="server-placeholder">No quick tasks match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('quickTasks', 'server-quick-task-main', [
      { key: 'name', label: 'Name' },
      { key: 'details', label: 'Details' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-quick-task-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-quick-tasks-card">' + header + columns + '<div class="server-list server-quick-tasks-list">'
      + visibleList.map(item => {
        const id = String(item.id || '');
        const name = item.name || firstRemoteCommandLine(item.command) || 'Saved command';
        const details = item.details || truncateRemoteCommandText(item.command, 90);
        const disabledTooltip = running ? 'A command is already running' : 'Run command';
        return '<div class="server-list-row server-quick-task-row" data-server-quick-task-id="' + escapeHtml(id) + '" data-tooltip="Open in Run Commands">'
          + '<div class="server-list-main server-quick-task-main"><span class="server-quick-task-name tooltip-above" data-tooltip="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span><span class="server-quick-task-details tooltip-above" data-tooltip="' + escapeHtml(details) + '">' + escapeHtml(details) + '</span></div>'
          + '<div class="server-quick-task-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(disabledTooltip) + '"><button class="secondary server-quick-task-action-button" type="button" data-server-quick-task-action="run" data-server-quick-task-id="' + escapeHtml(id) + '"' + (running ? ' disabled' : '') + '>Run</button></span></div>'
          + '</div>';
      }).join('')
      + '</div></section>';
  }


  function getServerQuickTaskFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerQuickTaskFilterText() {
    return serverQuickTaskFiltersByConnectionId.get(getServerQuickTaskFilterKey()) || '';
  }

  function setServerQuickTaskFilterText(value) {
    const key = getServerQuickTaskFilterKey();
    const text = String(value || '');
    if (text) serverQuickTaskFiltersByConnectionId.set(key, text);
    else serverQuickTaskFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusQuickTasksFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverQuickTasksFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerQuickTaskFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.details,
      item && item.command,
      getRemoteCommandItemRemotePath(item)
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function formatServerListCount(total, visible, filterHasValue, loading) {
    if (loading && !total) return 'Loading';
    const totalCount = Math.max(0, Number(total) || 0);
    const visibleCount = Math.max(0, Number(visible) || 0);
    const suffix = totalCount === 1 ? 'item' : 'items';
    if (filterHasValue) return visibleCount + ' of ' + totalCount + ' ' + suffix;
    return totalCount + ' ' + suffix;
  }

  function getServerCardSortStorageKey(card) {
    return (activeConnectionId || '__default__') + '::' + String(card || '');
  }

  function getServerCardSort(card) {
    const sort = serverCardSortsByConnectionId.get(getServerCardSortStorageKey(card));
    if (!sort || !sort.key || !sort.direction) return { key: '', direction: '' };
    return { key: String(sort.key || ''), direction: sort.direction === 'desc' ? 'desc' : 'asc' };
  }

  function setServerCardSort(card, key, direction) {
    const storageKey = getServerCardSortStorageKey(card);
    const nextKey = String(key || '');
    const nextDirection = direction === 'desc' ? 'desc' : (direction === 'asc' ? 'asc' : '');
    if (!nextKey || !nextDirection) {
      serverCardSortsByConnectionId.delete(storageKey);
      return;
    }
    serverCardSortsByConnectionId.set(storageKey, { key: nextKey, direction: nextDirection });
  }

  function handleServerCardSortClick(card, key) {
    const normalizedCard = String(card || '');
    const normalizedKey = String(key || '');
    if (!normalizedCard || !normalizedKey) return;
    const current = getServerCardSort(normalizedCard);
    if (current.key !== normalizedKey) {
      setServerCardSort(normalizedCard, normalizedKey, 'asc');
    } else if (current.direction === 'asc') {
      setServerCardSort(normalizedCard, normalizedKey, 'desc');
    } else {
      setServerCardSort(normalizedCard, '', '');
    }
    renderServerView();
  }

  function getServerSortComparable(value) {
    if (value === null || value === undefined) return { empty: true, number: null, text: '' };
    const text = String(value).trim();
    if (!text || text === '—') return { empty: true, number: null, text: '' };
    const numericText = text.replace(/%$/, '').replace(/,/g, '');
    const numericValue = Number(numericText);
    if (Number.isFinite(numericValue) && /^[-+]?\d+(?:\.\d+)?%?$/.test(text.replace(/,/g, ''))) {
      return { empty: false, number: numericValue, text: text.toLowerCase() };
    }
    return { empty: false, number: null, text: text.toLowerCase() };
  }

  function compareServerSortValues(leftValue, rightValue) {
    const left = getServerSortComparable(leftValue);
    const right = getServerSortComparable(rightValue);
    if (left.empty && right.empty) return 0;
    if (left.empty) return 1;
    if (right.empty) return -1;
    if (left.number !== null && right.number !== null) return left.number - right.number;
    return left.text.localeCompare(right.text, undefined, { numeric: true, sensitivity: 'base' });
  }

  function sortServerItems(card, items, getValue) {
    const list = Array.isArray(items) ? items.slice() : [];
    const sort = getServerCardSort(card);
    if (!sort.key || !sort.direction) return list;
    const direction = sort.direction === 'desc' ? -1 : 1;
    return list.map((item, index) => ({ item: item, index: index }))
      .sort((left, right) => {
        const comparison = compareServerSortValues(getValue(left.item, sort.key), getValue(right.item, sort.key));
        if (comparison !== 0) return comparison * direction;
        return left.index - right.index;
      })
      .map(entry => entry.item);
  }

  function renderServerSortButton(card, key, label) {
    const sort = getServerCardSort(card);
    const active = sort.key === key && Boolean(sort.direction);
    const indicator = active ? (sort.direction === 'desc' ? '↓' : '↑') : '';
    const tooltip = active
      ? (sort.direction === 'asc' ? 'Sort descending' : 'Clear sort')
      : 'Sort ascending';
    return '<button class="server-list-column-sort-button' + (active ? ' active' : '') + ' tooltip-above" type="button" data-tooltip="' + escapeHtml(tooltip) + '" data-server-sort-card="' + escapeHtml(card) + '" data-server-sort-key="' + escapeHtml(key) + '"><span>' + escapeHtml(label) + '</span><span class="server-list-sort-indicator" aria-hidden="true">' + escapeHtml(indicator) + '</span></button>';
  }

  function renderServerColumnHeader(card, mainClass, columns, trailingHtml) {
    const columnButtons = (Array.isArray(columns) ? columns : []).map(column => renderServerSortButton(card, column.key, column.label)).join('');
    return '<div class="server-list-column-header"><div class="server-list-column-header-main ' + escapeHtml(mainClass || '') + '">' + columnButtons + '</div>' + (trailingHtml || '') + '</div>';
  }

  function renderServerLogs(session) {
    const shortcuts = getServerLogShortcuts(session);
    const state = getActiveServerDashboardState();
    const loadingDefaults = Boolean(!state || (!state.data && !state.error));
    const filterText = getServerLogShortcutFilterText();
    const filteredShortcuts = shortcuts.filter(shortcut => matchesServerLogShortcutFilter(shortcut, filterText));
    const visibleShortcuts = sortServerItems('logs', filteredShortcuts, (shortcut, key) => {
      if (key === 'path') return shortcut && shortcut.path;
      return shortcut && shortcut.name;
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(shortcuts.length, filteredShortcuts.length, filterHasValue, loadingDefaults);
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="Add log shortcut"><button class="secondary remote-command-icon-button" type="button" aria-label="Add log shortcut" data-server-log-action="add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const filterBox = '<div class="server-logs-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverLogsFilterInput" class="server-logs-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter logs" value="' + escapeHtml(filterText) + '" aria-label="Filter logs"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Logs Filter" data-tooltip="Clear Filter" data-server-logs-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const header = '<div class="server-section-title-row server-logs-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Logs shortcuts</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!shortcuts.length) {
      const message = loadingDefaults ? 'Loading log shortcuts...' : 'No log shortcuts. Use + to add one.';
      return '<section class="server-section-card server-logs-card">' + header + '<div class="server-log-shortcut-empty">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredShortcuts.length) {
      return '<section class="server-section-card server-logs-card">' + header + '<div class="server-log-shortcut-empty">No log shortcuts match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('logs', 'server-log-shortcut-main', [
      { key: 'name', label: 'Name' },
      { key: 'path', label: 'Path' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-log-shortcut-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-logs-card">' + header + columns + '<div class="server-list server-log-shortcuts-list">'
      + visibleShortcuts.map(shortcut => '<div class="server-list-row server-log-shortcut-row" data-server-log-id="' + escapeHtml(shortcut.id) + '"><div class="server-list-main server-log-shortcut-main"><div class="server-list-title server-log-shortcut-title"><button class="server-log-shortcut-title-button tooltip-above" type="button" data-tooltip="' + escapeHtml(shortcut.path) + '">' + escapeHtml(shortcut.name) + '</button></div><span class="server-log-shortcut-path tooltip-above" data-tooltip="' + escapeHtml(shortcut.path) + '">' + escapeHtml(shortcut.path) + '</span></div><div class="server-log-shortcut-actions">'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="Follow in Log Viewer"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="follow" data-server-log-id="' + escapeHtml(shortcut.id) + '">Follow</button></span>'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="View Read-Only"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="readonly" data-server-log-id="' + escapeHtml(shortcut.id) + '">View</button></span>'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="Copy Path"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="copy" data-server-log-id="' + escapeHtml(shortcut.id) + '">Copy</button></span>'
        + '</div></div>').join('')
      + '</div></section>';
  }

  function getServerLogShortcutFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerLogShortcutFilterText() {
    return serverLogShortcutFiltersByConnectionId.get(getServerLogShortcutFilterKey()) || '';
  }

  function setServerLogShortcutFilterText(value) {
    const key = getServerLogShortcutFilterKey();
    const text = String(value || '');
    if (text) serverLogShortcutFiltersByConnectionId.set(key, text);
    else serverLogShortcutFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusLogsFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverLogsFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerLogShortcutFilter(shortcut, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      shortcut && shortcut.name,
      shortcut && shortcut.path
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerProcessFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerProcessFilterText() {
    return serverProcessFiltersByConnectionId.get(getServerProcessFilterKey()) || '';
  }

  function setServerProcessFilterText(value) {
    const key = getServerProcessFilterKey();
    const text = String(value || '');
    if (text) serverProcessFiltersByConnectionId.set(key, text);
    else serverProcessFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusProcessesFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverProcessesFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerProcessFilter(process, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const isZombie = Boolean(process && process.isZombie);
    const haystack = [
      process && process.pid,
      process && process.user,
      process && process.cpu,
      process && process.memory,
      process && process.state,
      isZombie ? 'zombie zombies defunct' : '',
      process && process.command,
      process && process.args,
      process && process.adapter
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerProcessActionState(connectionId) {
    const key = String(connectionId || activeConnectionId || '').trim();
    return key ? serverProcessActionStatesByConnectionId.get(key) || null : null;
  }

  function handleServerProcessActionState(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    const pid = String(payload.pid || '').trim();
    const status = String(payload.status || '').trim();
    if (!connectionId || !pid) return;
    if (status === 'clear') {
      serverProcessActionStatesByConnectionId.delete(connectionId);
    } else {
      serverProcessActionStatesByConnectionId.set(connectionId, {
        connectionId,
        pid,
        status,
        process: payload.process || null
      });
    }
    if (connectionId === activeConnectionId) renderServerView();
  }

  function getServerProcessesForRender(processes) {
    const actionState = getServerProcessActionState(activeConnectionId);
    const items = Array.isArray(processes) ? processes.map(process => Object.assign({}, process)) : [];
    if (!actionState || !actionState.pid) return items;

    const index = items.findIndex(process => String(process.pid || '') === String(actionState.pid));
    const process = Object.assign({}, actionState.process || {}, { pid: actionState.pid, transientStatus: actionState.status });
    if (index >= 0) {
      items[index] = Object.assign({}, items[index], process);
    } else if (process.pid) {
      items.push(process);
    }
    return items;
  }

  function formatServerProcessTransientLabel(status) {
    if (status === 'terminated') return 'Terminated';
    if (status === 'still-running') return 'Still running';
    if (status === 'killing') return 'Killing...';
    return '';
  }

  const SERVER_SCROLL_PRESERVE_SELECTORS = {
    quickTasks: '.server-quick-tasks-list',
    logs: '.server-log-shortcuts-list, .server-log-shortcut-empty',
    services: '.server-services-list',
    processes: '.server-processes-list',
    scheduled: '.server-scheduled-list'
  };

  function captureServerViewScrollState() {
    if (!serverViewContent) return null;
    const connectionId = serverViewContent.getAttribute('data-server-view-connection-id') || '';
    const scrollTops = {};
    Object.keys(SERVER_SCROLL_PRESERVE_SELECTORS).forEach(key => {
      const element = serverViewContent.querySelector(SERVER_SCROLL_PRESERVE_SELECTORS[key]);
      if (element) scrollTops[key] = element.scrollTop;
    });
    return { connectionId, scrollTops };
  }

  function restoreServerViewScrollState(scrollState, connectionId) {
    if (!scrollState || String(scrollState.connectionId || '') !== String(connectionId || '')) return;
    const scrollTops = scrollState.scrollTops || {};
    requestAnimationFrame(() => {
      if (!serverViewContent) return;
      if (serverViewContent.getAttribute('data-server-view-connection-id') !== String(connectionId || '')) return;
      Object.keys(SERVER_SCROLL_PRESERVE_SELECTORS).forEach(key => {
        const value = scrollTops[key];
        if (typeof value !== 'number') return;
        const element = serverViewContent.querySelector(SERVER_SCROLL_PRESERVE_SELECTORS[key]);
        if (element) element.scrollTop = value;
      });
    });
  }

  function getServerServiceFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerServiceFilterText() {
    return serverServiceFiltersByConnectionId.get(getServerServiceFilterKey()) || '';
  }

  function setServerServiceFilterText(value) {
    const key = getServerServiceFilterKey();
    const text = String(value || '');
    if (text) serverServiceFiltersByConnectionId.set(key, text);
    else serverServiceFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusServicesFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverServicesFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerServiceFilter(service, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      service && service.name,
      service && service.displayName,
      service && service.status,
      service && service.statusLabel,
      service && service.rawStatus,
      service && service.adapter
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function renderServerServices() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const services = data && Array.isArray(data.services) ? data.services : [];
    const adapter = data && data.serviceAdapter ? String(data.serviceAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const filterText = getServerServiceFilterText();
    const filteredServices = services.filter(service => matchesServerServiceFilter(service, filterText));
    const visibleServices = sortServerItems('services', filteredServices, (service, key) => {
      if (key === 'status') return service && (service.statusLabel || service.status || service.rawStatus);
      return service && (service.displayName || service.name);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(services.length, filteredServices.length, filterHasValue, Boolean(!data && state && state.loading));
    const header = '<div class="server-section-title-row server-services-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Services</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-services-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverServicesFilterInput" class="server-services-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter services" value="' + escapeHtml(filterText) + '" aria-label="Filter services"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Services Filter" data-tooltip="Clear Filter" data-server-services-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div></div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">Loading services...</div></section>';
    }

    if (!services.length) {
      const message = data && adapter === 'generic-unix'
        ? 'Services are limited for this Unix adapter. No safe service manager was detected.'
        : data ? 'No services found.' : 'Services are not loaded yet.';
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredServices.length) {
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">No services match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('services', 'server-service-main', [
      { key: 'name', label: 'Service' }
    ], '<div class="server-service-trailing server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-service-actions-space" aria-hidden="true"></span>' + renderServerSortButton('services', 'status', 'Status') + '</div>');
    return '<section class="server-section-card server-services-card">' + header + columns + '<div class="server-list server-services-list">'
      + visibleServices.map(service => {
        const name = String(service.name || service.displayName || '');
        const displayName = String(service.displayName || name || 'Service');
        const status = String(service.status || 'unknown');
        const statusLabel = String(service.statusLabel || 'Unknown');
        const rawStatus = String(service.rawStatus || statusLabel);
        const serviceAdapter = String(service.adapter || adapter || 'unknown');
        const startStopAction = service.canStop ? 'stop' : 'start';
        const startStopLabel = service.canStop ? 'Stop' : 'Start';
        const startStopDisabled = !(service.canStart || service.canStop);
        const restartDisabled = !service.canRestart;
        return '<div class="server-list-row server-service-row" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '">'
          + '<div class="server-list-main server-service-main"><div class="server-list-title server-service-name tooltip-above" data-tooltip="' + escapeHtml(name) + '">' + escapeHtml(displayName) + '</div></div>'
          + '<div class="server-service-trailing">'
          + '<div class="server-service-actions">'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(startStopLabel + ' service') + '"><button class="secondary server-service-action-button" type="button" data-server-service-action="' + escapeHtml(startStopAction) + '" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '"' + (startStopDisabled ? ' disabled' : '') + '>' + escapeHtml(startStopLabel) + '</button></span>'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="Restart service"><button class="secondary server-service-action-button" type="button" data-server-service-action="restart" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '"' + (restartDisabled ? ' disabled' : '') + '>Restart</button></span>'
          + '</div>'
          + '<span class="server-service-status ' + escapeHtml(status) + ' tooltip-above" data-tooltip="' + escapeHtml(rawStatus) + '">' + escapeHtml(statusLabel) + '</span>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }

  function renderServerProcesses() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const rawProcesses = data && Array.isArray(data.processes) ? data.processes : [];
    const processes = getServerProcessesForRender(rawProcesses);
    const adapter = data && data.processAdapter ? String(data.processAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const filterText = getServerProcessFilterText();
    const filteredProcesses = processes.filter(process => matchesServerProcessFilter(process, filterText));
    const visibleProcesses = sortServerItems('processes', filteredProcesses, (process, key) => {
      if (key === 'pid') return process && process.pid;
      if (key === 'user') return process && process.user;
      if (key === 'cpu') return process && process.cpu;
      if (key === 'memory') return process && process.memory;
      return process && (process.args || process.command);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(processes.length, filteredProcesses.length, filterHasValue, Boolean(!data && state && state.loading));
    const header = '<div class="server-section-title-row server-processes-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Processes</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-processes-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverProcessesFilterInput" class="server-processes-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter processes" value="' + escapeHtml(filterText) + '" aria-label="Filter processes"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Processes Filter" data-tooltip="Clear Filter" data-server-processes-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div></div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">Loading processes...</div></section>';
    }

    if (!processes.length) {
      const message = data ? 'No processes found.' : 'Processes are not loaded yet.';
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredProcesses.length) {
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">No processes match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('processes', 'server-process-main', [
      { key: 'command', label: 'Command' },
      { key: 'pid', label: 'PID' },
      { key: 'user', label: 'User' },
      { key: 'cpu', label: 'CPU' },
      { key: 'memory', label: 'Mem' }
    ], '<div class="server-process-trailing server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-process-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-processes-card">' + header + columns + '<div class="server-list server-processes-list">'
      + visibleProcesses.map(process => {
        const pid = String(process.pid || '');
        const user = String(process.user || '—');
        const cpu = String(process.cpu || '—');
        const memory = String(process.memory || '—');
        const stateValue = String(process.state || '');
        const isZombie = Boolean(process.isZombie);
        const command = String(process.args || process.command || '—');
        const shortCommand = String(process.command || command || '—');
        const adapterValue = String(process.adapter || adapter || 'ps');
        const transientStatus = String(process.transientStatus || '');
        const transientLabel = formatServerProcessTransientLabel(transientStatus);
        const pidNumber = Number(pid);
        const processCanKill = process.canKill !== false;
        const canKill = !transientStatus && processCanKill && Number.isInteger(pidNumber) && pidNumber > 1;
        const killTooltip = canKill ? 'Kill process' : (pidNumber === 1 ? 'PID 1 cannot be killed' : (processCanKill ? 'Kill unavailable' : 'Process cannot be killed'));
        const rowClass = 'server-list-row server-process-row' + (transientStatus ? ' process-action-active' : '');
        const cpuLabel = cpu !== '—' ? (/%$/.test(cpu) ? cpu : cpu + '%') : '—';
        const memoryLabel = memory !== '—' ? (/%$/.test(memory) ? memory : memory + '%') : '—';
        const dataset = ' data-server-process-pid="' + escapeHtml(pid) + '" data-server-process-user="' + escapeHtml(user) + '" data-server-process-state="' + escapeHtml(stateValue) + '" data-server-process-is-zombie="' + (isZombie ? 'true' : 'false') + '" data-server-process-cpu="' + escapeHtml(cpu) + '" data-server-process-memory="' + escapeHtml(memory) + '" data-server-process-command="' + escapeHtml(shortCommand) + '" data-server-process-args="' + escapeHtml(command) + '" data-server-process-adapter="' + escapeHtml(adapterValue) + '"';
        const zombieBadge = isZombie ? '<span class="server-process-zombie-badge tooltip-above" data-tooltip="Zombie process' + (stateValue ? ' (' + escapeHtml(stateValue) + ')' : '') + '">Zombie</span>' : '';
        return '<div class="' + rowClass + '"' + dataset + '>'
          + '<div class="server-list-main server-process-main">'
          + '<span class="server-process-command-cell">'
          + '<span class="server-process-command tooltip-above" data-tooltip="' + escapeHtml(command) + '">' + escapeHtml(command) + '</span>'
          + zombieBadge
          + '</span>'
          + '<span class="server-process-pid tooltip-above" data-tooltip="PID ' + escapeHtml(pid) + '">' + escapeHtml(pid) + '</span>'
          + '<span class="server-process-user tooltip-above" data-tooltip="' + escapeHtml(user) + '">' + escapeHtml(user) + '</span>'
          + '<span class="server-process-cpu tooltip-above" data-tooltip="CPU ' + escapeHtml(cpuLabel) + '">' + escapeHtml(cpuLabel) + '</span>'
          + '<span class="server-process-memory tooltip-above" data-tooltip="Memory ' + escapeHtml(memoryLabel) + '">' + escapeHtml(memoryLabel) + '</span>'
          + '</div><div class="server-process-trailing">'
          + (transientLabel ? '<span class="server-process-status ' + escapeHtml(transientStatus) + '">' + escapeHtml(transientLabel) + '</span>' : '')
          + '<div class="server-process-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(killTooltip) + '"><button class="secondary server-process-action-button" type="button" data-server-process-action="kill"' + dataset + (canKill ? '' : ' disabled') + '>Kill</button></span></div>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }

`;}
