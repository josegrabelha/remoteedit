export function renderComboboxControls(): string {
  return `(() => {
  const combos = new Map();
  let opened;
  const dialogs = [];
  let serial = 0;
  function closeCombo(focus = false) {
    if (!opened) return;
    const current = opened;
    opened = undefined;
    current.menu.remove();
    current.wrapper.classList.remove('open');
    current.button.setAttribute('aria-expanded', 'false');
    if (focus) current.button.focus();
  }
  function positionCombo(current) {
    const rect = current.button.getBoundingClientRect();
    const height = Math.min(300, Math.max(100, innerHeight - 24));
    current.menu.style.width = \`\${Math.min(rect.width, innerWidth - 16)}px\`;
    current.menu.style.left = \`\${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px\`;
    current.menu.style.maxHeight = \`\${height}px\`;
    current.menu.style.top = \`\${rect.bottom + 4}px\`;
    if (rect.bottom + current.menu.offsetHeight > innerHeight - 8) current.menu.style.top = \`\${Math.max(8, rect.top - current.menu.offsetHeight - 4)}px\`;
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
  function openCombo(current) {
    if (current.button.disabled) return;
    closeCombo(); opened = current;
    current.wrapper.classList.add('open'); current.button.setAttribute('aria-expanded', 'true');
    const host = dialogs.length ? dialogs[dialogs.length - 1].element : document.body;
    host.append(current.menu);
    current.search.value = ''; fillCombo(current); current.search.focus();
  }
  function refresh() {
    for (const [select, item] of combos) {
      if (!document.contains(select)) { if (opened === item) closeCombo(); item.observer.disconnect(); item.menu.remove(); combos.delete(select); continue; }
      item.label.textContent = select.selectedOptions[0]?.text || 'Select…';
      item.button.disabled = select.disabled;
      if (item.button.disabled && opened === item) closeCombo();
    }
    document.querySelectorAll('select').forEach(select => {
      if (combos.has(select)) return;
      const wrapper = document.createElement('div'); wrapper.className = 'profile-picker'; wrapper.dataset.for = select.id;
      select.after(wrapper); select.classList.add('profile-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'profile-dropdown-button'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', select.getAttribute('aria-label') || ({mapping:'Mapping',target:'Target',mapDirection:'Direction'})[select.id] || 'Connection');
      const label = document.createElement('span'); label.className = 'profile-dropdown-label';
      button.append(label); button.insertAdjacentHTML('beforeend', '<svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>'); wrapper.append(button);
      const menu = document.createElement('div'); menu.className = 'profile-dropdown-menu sync-combo-menu';
      const searchWrap = document.createElement('div'); searchWrap.className = 'profile-dropdown-filter';
      const search = document.createElement('input'); search.placeholder = 'Filter…'; search.setAttribute('aria-label', 'Filter options'); searchWrap.append(search);
      const list = document.createElement('div'); list.id = \`sync-options-\${++serial}\`; list.setAttribute('role','listbox'); list.setAttribute('aria-label',button.getAttribute('aria-label')); button.setAttribute('aria-controls',list.id);
      menu.append(searchWrap, list);
      const item = { select, wrapper, button, label, menu, search, list, observer: new MutationObserver(() => refresh()) };
      item.observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled','selected'] }); combos.set(select,item);
      button.onclick = () => opened === item ? closeCombo() : openCombo(item);
      button.onkeydown = event => { if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); openCombo(item); const items = [...list.querySelectorAll('button:not(:disabled)')]; (event.key === 'End' || event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus(); } };
      search.oninput = () => fillCombo(item, search.value);
      menu.onkeydown = event => {
        const items = [...list.querySelectorAll('button:not(:disabled)')]; const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCombo(true); }
        else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length; items[next]?.focus(); }
        else if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); items[0]?.click(); }
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
