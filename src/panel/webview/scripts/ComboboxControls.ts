export function renderComboboxControls(selector = 'select'): string {
  return `(() => {
  const combos = new Map();
  let opened;
  const dialogs = [];
  let serial = 0;
  function closeCombo(focus = false) {
    if (!opened) return;
    const current = opened;
    opened = undefined;
    current.placement = undefined;
    current.menu.remove();
    current.wrapper.classList.remove('open');
    current.button.setAttribute('aria-expanded', 'false');
    if (focus) current.button.focus();
  }
  function positionCombo(current) {
    const rect = current.button.getBoundingClientRect();
    const viewportMargin = 8;
    const menuGap = 4;
    current.menu.style.width = \`\${Math.min(rect.width, innerWidth - (viewportMargin * 2))}px\`;
    current.menu.style.left = \`\${Math.max(viewportMargin, Math.min(rect.left, innerWidth - rect.width - viewportMargin))}px\`;
    if (current.forceDown) {
      const top = rect.bottom + menuGap;
      const availableHeight = Math.max(0, innerHeight - top - viewportMargin);
      current.menu.dataset.placement = 'down';
      current.menu.style.top = \`\${top}px\`;
      current.menu.style.maxHeight = \`\${Math.min(300, availableHeight)}px\`;
      return;
    }
    const height = Math.min(300, Math.max(100, innerHeight - 24));
    current.menu.style.maxHeight = \`\${height}px\`;
    if (!current.placement) current.placement = rect.bottom + current.menu.offsetHeight > innerHeight - viewportMargin ? 'up' : 'down';
    current.menu.dataset.placement = current.placement;
    current.menu.style.top = current.placement === 'up'
      ? \`\${Math.max(viewportMargin, rect.top - current.menu.offsetHeight - menuGap)}px\`
      : \`\${rect.bottom + menuGap}px\`;
  }
  function fillCombo(current, query = '') {
    current.list.replaceChildren();
    const options = [...current.select.options].filter(item => !item.hidden && item.text.toLowerCase().includes(query.toLowerCase()));
    options.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'profile-dropdown-item';
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
      item.classList.toggle('selected', option.selected); item.disabled = option.disabled;
      const label = document.createElement('span'); label.className = 'profile-dropdown-name'; label.textContent = option.text;
      item.append(label);
      item.onclick = () => { current.select.value = option.value; closeCombo(true); current.select.dispatchEvent(new Event('change', { bubbles: true })); refresh(); };
      current.list.append(item);
    });
    if (!options.length) { const empty = document.createElement('div'); empty.className = 'profile-dropdown-empty'; empty.textContent = 'No matching options'; current.list.append(empty); }
    positionCombo(current);
  }
  function clearComboFilter(current) {
    if (!current.search) return;
    current.search.value = '';
    current.searchWrap.classList.remove('has-value');
    current.clearSearch.disabled = true;
    fillCombo(current);
    current.search.focus();
  }
  function updateComboFilterState(current) {
    if (!current.search) return;
    const hasValue = Boolean(current.search.value);
    current.searchWrap.classList.toggle('has-value', hasValue);
    current.clearSearch.disabled = !hasValue;
  }
  function openCombo(current) {
    if (current.button.disabled) return;
    closeCombo(); opened = current;
    current.placement = undefined;
    current.wrapper.classList.add('open'); current.button.setAttribute('aria-expanded', 'true');
    const host = dialogs.length ? dialogs[dialogs.length - 1].element : document.body;
    host.append(current.menu);
    if (current.search) {
      current.search.value = '';
      updateComboFilterState(current);
      fillCombo(current);
      current.search.focus();
    } else {
      fillCombo(current);
    }
  }
  function refresh() {
    for (const [select, item] of combos) {
      if (!document.contains(select)) { if (opened === item) closeCombo(); item.observer.disconnect(); item.menu.remove(); combos.delete(select); continue; }
      item.label.textContent = select.selectedOptions[0]?.text || 'Select…';
      item.button.disabled = select.disabled;
      if (item.button.disabled && opened === item) closeCombo();
    }
    document.querySelectorAll(${JSON.stringify(selector)}).forEach(select => {
      if (combos.has(select)) return;
      const wrapper = document.createElement('div'); wrapper.className = 'profile-picker'; wrapper.dataset.for = select.id;
      select.after(wrapper); select.classList.add('profile-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'profile-dropdown-button'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', select.getAttribute('aria-label') || ({mapping:'Mapping',target:'Target',mapDirection:'Direction'})[select.id] || 'Connection');
      const label = document.createElement('span'); label.className = 'profile-dropdown-label';
      button.append(label); button.insertAdjacentHTML('beforeend', '<svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3"/></svg>'); wrapper.append(button);
      const menu = document.createElement('div'); menu.className = 'profile-dropdown-menu sync-combo-menu'; menu.dataset.for = select.id;
      const hasFilter = select.dataset.filter !== 'false' && !['mapDirection', 'proxyType', 'proxyAuthentication'].includes(select.id);
      let searchWrap, search, clearSearch;
      if (hasFilter) {
        const filterWrap = document.createElement('div'); filterWrap.className = 'profile-dropdown-filter';
        searchWrap = document.createElement('div'); searchWrap.className = 'filter-box';
        filterWrap.append(searchWrap);
        search = document.createElement('input'); search.className = 'filter-input'; search.placeholder = 'Filter…'; search.setAttribute('aria-label', 'Filter options');
        clearSearch = document.createElement('button'); clearSearch.type = 'button'; clearSearch.className = 'filter-clear-button'; clearSearch.setAttribute('aria-label', 'Clear Filter'); clearSearch.setAttribute('data-tooltip', 'Clear Filter'); clearSearch.disabled = true;
        clearSearch.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg>';
        searchWrap.append(search, clearSearch); menu.append(filterWrap);
      }
      const list = document.createElement('div'); list.id = \`sync-options-\${++serial}\`; list.setAttribute('role','listbox'); list.setAttribute('aria-label',button.getAttribute('aria-label')); button.setAttribute('aria-controls',list.id);
      let action;
      if (select.dataset.comboAction) {
        menu.classList.add('combo-with-action');
        const pinned = document.createElement('div'); pinned.className = 'profile-dropdown-pinned';
        action = document.createElement('button'); action.type = 'button'; action.className = 'profile-dropdown-item';
        action.textContent = select.dataset.comboAction; action.setAttribute('role','option');
        action.onclick = () => { closeCombo(true); select.dispatchEvent(new CustomEvent('comboAction', { bubbles: true })); };
        const separator = document.createElement('div'); separator.className = 'profile-dropdown-separator';
        pinned.append(action, separator); menu.append(pinned); list.className = 'profile-dropdown-list';
      }
      menu.append(list);
      const item = { select, wrapper, button, label, menu, searchWrap, search, clearSearch, list, forceDown: Boolean(select.closest('#mappingDialog')), placement: undefined, observer: new MutationObserver(() => refresh()) };
      item.observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled','selected'] }); combos.set(select,item);
      button.onclick = () => opened === item ? closeCombo() : openCombo(item);
      button.onkeydown = event => { if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); openCombo(item); const items = [...(action ? [action] : []), ...list.querySelectorAll('button:not(:disabled)')]; (event.key === 'End' || event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus(); } };
      if (search) {
        search.oninput = () => { updateComboFilterState(item); fillCombo(item, search.value); };
        clearSearch.onclick = event => { event.preventDefault(); event.stopPropagation(); clearComboFilter(item); };
      }
      menu.onkeydown = event => {
        const items = [...(action ? [action] : []), ...list.querySelectorAll('button:not(:disabled)')]; const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (search && search.value) clearComboFilter(item); else closeCombo(true);
        }
        else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length; items[next]?.focus(); }
        else if (event.key === 'Enter' && search && document.activeElement === search) { event.preventDefault(); items[0]?.click(); }
        else if (event.key === 'Tab') closeCombo();
      };
      label.textContent = select.selectedOptions[0]?.text || 'Select…'; button.disabled = select.disabled;
    });
  }
  function openDialog(id, cancel) {
    closeCombo();
    const element = document.getElementById(id);
    if (dialogs.some(item => item.element === element)) return;
    const previous = document.activeElement;
    if (dialogs.length) dialogs.at(-1).element.inert = true;
    else document.getElementById('workspaceContent').inert = true;
    dialogs.push({ element, previous, cancel }); element.hidden = false; element.style.zIndex = String(1000 + dialogs.length * 10);
    refresh();
    queueMicrotask(() => element.querySelector('input:not([type=checkbox]):not([type=hidden]), button:not(:disabled), [tabindex="0"]')?.focus());
  }
  function closeDialog(id) {
    const index = dialogs.findIndex(item => item.element.id === id);
    if (index < 0) return;
    closeCombo();
    const [item] = dialogs.splice(index,1); item.element.hidden = true; item.element.inert = false;
    if (dialogs.length) dialogs.at(-1).element.inert = false;
    else document.getElementById('workspaceContent').inert = false;
    if (index === dialogs.length && document.contains(item.previous)) item.previous.focus();
  }
  document.addEventListener('pointerdown', event => { if (opened && !opened.menu.contains(event.target) && !opened.wrapper.contains(event.target)) closeCombo(); });
  window.addEventListener('resize', () => closeCombo());
  document.addEventListener('scroll', event => { if (opened && !opened.menu.contains(event.target)) closeCombo(); }, true);
  document.addEventListener('keydown', event => {
    const active = dialogs.at(-1); if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); if (opened) closeCombo(true); else if (active.cancel) active.cancel(); else closeDialog(active.element.id); }
    if (event.key === 'Tab') {
      const items = [...active.element.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item => item.getClientRects().length && !item.closest('[hidden]'));
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.RemoteEditControls = { refresh, openDialog, closeDialog, closeCombo };
})();
`;
}
