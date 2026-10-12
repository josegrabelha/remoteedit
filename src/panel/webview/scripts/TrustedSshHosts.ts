export function renderTrustedSshHosts(): string { return `
  let trustedHosts = [], trustedHostsBusy = false, trustedHostsDetails = false, trustedHostsEnvironment = '';
  let trustedHostsSort = { key: 'host', direction: null }, trustedHostsCopyText = '', trustedHostsCopyTimer;
  const trustElement = id => document.getElementById(id);
  function showTrustedHostsList() {
    hideTrustedHostsContextMenu();
    trustedHostsDetails = false;
    clearTimeout(trustedHostsCopyTimer);
    trustElement('trustedHostsCopy').hidden = true;
    trustElement('trustedHostsCopy').textContent = 'Copy';
    trustElement('trustedHostsTitle').textContent = 'Trusted SSH Hosts';
    trustElement('trustedHostsListPage').hidden = false;
    trustElement('trustedHostsDetailsPage').hidden = true;
    trustElement('trustedHostsBack').hidden = true;
    renderTrustedHostsList();
  }
  function setTrustedHostsBusy(busy) {
    trustedHostsBusy = busy;
    trustElement('trustedHostsListPage').inert = busy;
    trustElement('trustedHostsClose').disabled = busy;
  }
  function receiveTrustedSshHosts(payload) {
    setTrustedHostsBusy(false);
    if (payload.hosts) { trustedHosts = payload.hosts; trustedHostsEnvironment = payload.environment || ''; }
    trustElement('trustedHostsFeedback').textContent = payload.error || trustedHosts.length + ' trusted key' + (trustedHosts.length === 1 ? '' : 's');
    trustElement('trustedHostsFeedback').classList.toggle('error', Boolean(payload.error));
    trustElement('trustedHostsFeedback').setAttribute('data-tooltip', payload.error || trustedHostsEnvironment);
    renderTrustedHostsList();
  }
  function renderTrustedHostsList() {
    const list = trustElement('trustedHostsList'); list.replaceChildren();
    const filter = trustElement('trustedHostsFilter').value.trim().toLowerCase(), source = trustElement('trustedHostsSource').value;
    const hasFilter = Boolean(trustElement('trustedHostsFilter').value);
    trustElement('trustedHostsFilterClear').disabled = !hasFilter;
    trustElement('trustedHostsFilter').parentElement.classList.toggle('has-value', hasFilter);
    const visible = trustedHosts.filter(item => (!source || item.source === source) && (!filter || (item.host + ' ' + item.fingerprint).toLowerCase().includes(filter)));
    if (trustedHostsSort.direction) visible.sort((left, right) => {
      const key = trustedHostsSort.key;
      const result = String(left[key]).localeCompare(String(right[key]), undefined, { numeric: true, sensitivity: 'base' });
      const compared = result || (key === 'host' ? (left.port || 22) - (right.port || 22) : String(left.host).localeCompare(String(right.host), undefined, { numeric: true }));
      return trustedHostsSort.direction === 'asc' ? compared : -compared;
    });
    for (const header of trustElement('trustedHostsTable').querySelectorAll('th.sortable')) {
      const active = header.dataset.sortKey === trustedHostsSort.key && trustedHostsSort.direction;
      header.setAttribute('aria-sort', active ? (trustedHostsSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      header.querySelector('.sort-indicator').textContent = active ? (trustedHostsSort.direction === 'asc' ? '↑' : '↓') : '';
    }
    for (const item of visible) {
      const row = document.createElement('tr'); row.tabIndex = 0;
      row.setAttribute('aria-label', 'View details for ' + item.host);
      row.onclick = () => { if (!trustedHostsBusy) showTrustedHostDetails(item); };
      row.onkeydown = event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click(); } };
      for (const value of [item.host + (item.port ? ':' + item.port : ''), item.keyType.replace(/^ssh-/,'').toUpperCase()]) {
        const cell = document.createElement('td'); cell.textContent = value; cell.className = 'has-tooltip'; ciTooltipIfClipped(cell, value); row.append(cell);
      }
      const source = document.createElement('td'), content = document.createElement('div'); content.className = 'trusted-host-source-content';
      const label = document.createElement('span'); label.className = 'trusted-host-source-label'; label.textContent = item.source; label.classList.add('has-tooltip'); ciTooltipIfClipped(label, item.source); content.append(label);
      if (item.source === 'Remote Edit' || item.removable) {
        const remove = document.createElement('button'); remove.className = 'secondary remote-command-icon-button has-tooltip'; remove.type = 'button'; remove.textContent = '×';
        remove.setAttribute('aria-label', 'Delete trusted SSH host ' + item.host); remove.setAttribute('data-tooltip', 'Delete trusted SSH host');
        remove.onclick = event => { event.stopPropagation(); if (trustedHostsBusy) return; setTrustedHostsBusy(true); vscode.postMessage({type:'trustedSshHosts',payload:{action:'delete',id:item.id,publicKey:item.publicKey,fileDigest:item.fileDigest}}); };
        content.append(remove);
      }
      source.append(content); row.append(source); list.append(row);
    }
    trustElement('trustedHostsEmpty').hidden = visible.length > 0;
  }
  function showTrustedHostDetails(item) {
    trustedHostsDetails = true;
    clearTimeout(trustedHostsCopyTimer);
    trustElement('trustedHostsCopy').hidden = false;
    trustElement('trustedHostsCopy').textContent = 'Copy';
    trustElement('trustedHostsTitle').textContent = 'SSH Host Details';
    trustElement('trustedHostsListPage').hidden = true; trustElement('trustedHostsDetailsPage').hidden = false; trustElement('trustedHostsBack').hidden = false;
    const page = trustElement('trustedHostsDetailsPage'); page.replaceChildren();
    const fields = [['Host', item.host], ['Port', item.port], ['Key Type', item.keyType], ['SHA-256 Fingerprint', item.fingerprint], ['Public Key', item.publicKey], ['Source', item.source], ['Extension Host', trustedHostsEnvironment], ['File', item.filePath], ['Line', item.line], ['Host Patterns', item.patterns], ['Marker', item.marker], ['First Trusted', item.firstTrusted], ['Last Verified', item.lastVerified]];
    trustedHostsCopyText = fields.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => label + ': ' + String(value)).join('\\n');
    for (const [label, value] of fields) {
      if (value === undefined || value === '') continue;
      const field = document.createElement('div'); field.className = 'master-password-field';
      const heading = document.createElement('label'); heading.textContent = label;
      const text = document.createElement('div'); text.className = 'file-properties-path trusted-host-value'; text.textContent = String(value);
      field.append(heading, text); page.append(field);
    }
    trustElement('trustedHostsBack').focus();
  }
  function closeTrustedHosts() {
    if (trustedHostsBusy) return;
    hideTrustedHostsContextMenu();
    clearTimeout(trustedHostsCopyTimer);
    window.RemoteEditControls.closeCombo();
    trustElement('trustedHostsBackdrop').classList.remove('visible'); trustElement('trustedHostsBackdrop').setAttribute('aria-hidden','true');
    restoreDialogFocus(manageProfilesButton);
  }
  trustElement('manageTrustedSshHostsButton').onclick = () => {
    closeConnectionManagementMenu(true); hideWebviewTooltip(); showTrustedHostsList();
    trustElement('trustedHostsBackdrop').classList.add('visible'); trustElement('trustedHostsBackdrop').setAttribute('aria-hidden','false');
    trustElement('trustedHostsFilter').focus(); setTrustedHostsBusy(true);
    vscode.postMessage({type:'trustedSshHosts',payload:{action:'list'}});
  };
  for (const header of trustElement('trustedHostsTable').querySelectorAll('th.sortable')) {
    header.onclick = () => {
      if (trustedHostsBusy) return;
      const key = header.dataset.sortKey;
      trustedHostsSort = { key, direction: trustedHostsSort.key !== key || !trustedHostsSort.direction ? 'asc' : trustedHostsSort.direction === 'asc' ? 'desc' : null };
      renderTrustedHostsList();
    };
    header.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); } };
  }
  async function copyTrustedHostDetails(text) {
    if (!text) return;
    await copyTextFromEditableMenu(text);
    if (!trustedHostsDetails) return;
    const button = trustElement('trustedHostsCopy'); button.textContent = 'Copied';
    clearTimeout(trustedHostsCopyTimer);
    trustedHostsCopyTimer = setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  }
  let trustedHostsSelectedText = '';
  function hideTrustedHostsContextMenu() {
    trustElement('trustedHostsContextMenu').classList.remove('visible');
  }
  function showTrustedHostsContextMenu(clientX, clientY) {
    hideContextMenu(); hideRemoteSearchResultContextMenu(); hideTextEditContextMenu(); hideWebviewTooltip();
    const page = trustElement('trustedHostsDetailsPage'), selection = window.getSelection();
    trustedHostsSelectedText = selection && !selection.isCollapsed && page.contains(selection.anchorNode) && page.contains(selection.focusNode) ? selection.toString() : '';
    trustElement('trustedHostsCopySelected').disabled = !trustedHostsSelectedText;
    positionTextEditContextMenu(clientX, clientY, trustElement('trustedHostsContextMenu'));
  }
  trustElement('trustedHostsCopy').onclick = () => copyTrustedHostDetails(trustedHostsCopyText);
  trustElement('trustedHostsCopySelected').onclick = () => { hideTrustedHostsContextMenu(); void copyTrustedHostDetails(trustedHostsSelectedText); };
  trustElement('trustedHostsCopyAll').onclick = () => { hideTrustedHostsContextMenu(); void copyTrustedHostDetails(trustedHostsCopyText); };
  document.addEventListener('click', event => { if (!trustElement('trustedHostsContextMenu').contains(event.target)) hideTrustedHostsContextMenu(); });
  trustElement('trustedHostsClose').onclick = closeTrustedHosts;
  trustElement('trustedHostsBack').onclick = () => { showTrustedHostsList(); trustElement('trustedHostsFilter').focus(); };
  trustElement('trustedHostsFilter').oninput = renderTrustedHostsList;
  trustElement('trustedHostsFilterClear').onclick = () => { trustElement('trustedHostsFilter').value = ''; renderTrustedHostsList(); trustElement('trustedHostsFilter').focus(); };
  trustElement('trustedHostsSource').onchange = renderTrustedHostsList;
  document.addEventListener('keydown', event => {
    const backdrop = trustElement('trustedHostsBackdrop');
    if (!backdrop.classList.contains('visible') || confirmDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      const menu = document.querySelector('.sync-combo-menu[data-for="trustedHostsSource"]');
      if (trustElement('trustedHostsContextMenu').classList.contains('visible')) hideTrustedHostsContextMenu();
      else if (menu) window.RemoteEditControls.closeCombo(true);
      else if (!trustedHostsDetails && document.activeElement === trustElement('trustedHostsFilter') && trustElement('trustedHostsFilter').value) trustElement('trustedHostsFilterClear').click();
      else if (trustedHostsDetails) showTrustedHostsList();
      else closeTrustedHosts();
    }
    if (event.key === 'Tab') {
      if (document.querySelector('.sync-combo-menu[data-for="trustedHostsSource"]')) return;
      event.stopImmediatePropagation();
      const items = [...backdrop.querySelectorAll('input:not(:disabled),button:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
      if (!items.length) { event.preventDefault(); return; }
      if (!backdrop.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0]).focus(); }
      else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
  }, true);
`; }
