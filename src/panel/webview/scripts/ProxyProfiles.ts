export function renderProxyProfiles(): string { return `
  let proxyProfiles = [], proxyBusy = false, proxyPage = 'list', proxyReturnFocus, proxyCreationOrigin = null;
  const proxySelect = document.getElementById('proxyProfileId');
  const proxyElement = id => document.getElementById(id);
  function renderProxySelection(value) {
    const selected = value === undefined ? proxySelect.value : value;
    proxySelect.replaceChildren(new Option('No Proxy', ''));
    proxyProfiles.forEach(p => proxySelect.add(new Option(p.name, p.id)));
    if (selected && !proxyProfiles.some(p => p.id === selected)) proxySelect.add(new Option('Unavailable Proxy', selected));
    proxySelect.value = selected || ''; window.RemoteEditControls.refresh();
  }
  function receiveProxyProfiles(payload) {
    proxyBusy = false;
    proxyElement('proxyFeedback').textContent = payload.error || '';
    proxyElement('proxyFeedback').classList.toggle('error', Boolean(payload.error));
    proxyElement('proxyFeedback').setAttribute('data-tooltip', payload.error || '');
    if (payload.profiles) {
      proxyProfiles = payload.profiles; renderProxySelection(); renderProxyList();
      const editorSelect = document.getElementById('edit_proxyProfileId');
      if (editorSelect) {
        const selected = editorSelect.value;
        editorSelect.replaceChildren(new Option('No Proxy',''));
        proxyProfiles.forEach(p => editorSelect.add(new Option(p.name,p.id)));
        if (selected && !proxyProfiles.some(p => p.id === selected)) editorSelect.add(new Option('Unavailable Proxy',selected));
        editorSelect.value = selected;
      }
      window.RemoteEditControls.refresh();
    }
    updateProxyBusy();
    if (payload.completed && payload.savedProfileId && proxyCreationOrigin) {
      const origin = proxyCreationOrigin;
      if (document.contains(origin)) { origin.value = payload.savedProfileId; origin.dispatchEvent(new Event('change',{bubbles:true})); }
      window.RemoteEditControls.refresh(); closeProxyProfiles();
    }
    else if (payload.completed) showProxyList();
    else if (proxyCreationOrigin && proxyPage==='editor' && !payload.error) proxyElement('proxyName').focus();
    else if(proxyPage==='list' && proxyElement('proxyProfilesBackdrop').classList.contains('visible')) proxyElement('proxyNew').focus();
  }
  function renderProxyList() {
    const list = proxyElement('proxyList'); list.replaceChildren();
    proxyProfiles.forEach(p => {
      const row = document.createElement('div'); row.className = 'target-set-card';
      const main = document.createElement('div'); main.className='target-set-main'; main.tabIndex=0; main.setAttribute('role','button'); main.setAttribute('aria-label','Edit '+p.name);
      const label = document.createElement('div'); label.className='target-set-name'; label.textContent=p.name;
      const detail = document.createElement('div'); detail.className='target-set-detail manage-profile-meta'; detail.textContent=(p.type==='http'?'HTTP CONNECT':p.type.toUpperCase())+' · '+p.host+':'+p.port;
      main.append(label,detail); main.onclick=()=>{if(!proxyBusy)editProxyProfile(p);};
      main.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();main.click();}};
      const actions=document.createElement('div'); actions.className='target-set-actions';
      const edit = document.createElement('button'); edit.className='secondary compact'; edit.textContent='Edit'; edit.onclick=()=>{if(!proxyBusy)editProxyProfile(p);};
      const remove = document.createElement('button'); remove.className='secondary compact'; remove.textContent='Delete';
      remove.onclick=()=>{ if(proxyBusy)return; proxyBusy=true; updateProxyBusy(); vscode.postMessage({type:'proxyProfiles',payload:{action:'delete',id:p.id}}); };
      actions.append(edit,remove); row.append(main,actions); list.append(row);
    });
    if(!proxyProfiles.length){const empty=document.createElement('div');empty.className='profile-dropdown-empty';empty.textContent='No proxy profiles configured.';list.append(empty);}
  }
  function updateProxyBusy() {
    for(const id of ['proxyNew','proxyBack','proxyClose','proxySave','proxyPasswordReveal']) proxyElement(id).disabled=proxyBusy;
    proxyElement('proxyListPage').inert=proxyBusy;
    proxyElement('proxyEditorPage').inert=proxyBusy;
  }
  function setProxyPage(page) {
    window.RemoteEditControls.closeCombo(); proxyPage=page;
    const editing=page==='editor';
    proxyElement('proxyListPage').hidden=editing; proxyElement('proxyEditorPage').hidden=!editing;
    proxyElement('proxyBack').hidden=!editing; proxyElement('proxySave').hidden=!editing;
    proxyElement('proxyNew').hidden=editing; proxyElement('proxyClose').hidden=editing;
    proxyElement('proxyFeedback').textContent=''; proxyElement('proxyFeedback').classList.remove('error'); proxyElement('proxyFeedback').removeAttribute('data-tooltip');
  }
  function showProxyList() {
    if(proxyBusy)return;
    if (proxyCreationOrigin?.id === 'proxyProfileId') proxyCreationOrigin = null;
    setProxyPage('list'); proxyElement('proxyProfilesTitle').textContent='Proxy Profiles';
    proxyElement('proxyPassword').value=''; hideTemporaryPassword(proxyElement('proxyPassword')); proxyElement('proxyEditId').value='';
    proxyElement('proxyNew').focus();
  }
  function editProxyProfile(p = {}) {
    if(proxyBusy)return;
    setProxyPage('editor'); proxyElement('proxyProfilesTitle').textContent=p.id?'Edit Proxy Profile':'New Proxy Profile';
    proxyElement('proxyEditId').value=p.id||'';
    for (const [id,key] of [['proxyName','name'],['proxyHost','host'],['proxyPort','port'],['proxyUsername','username']]) proxyElement(id).value=p[key]||'';
    proxyElement('proxyType').value=p.type||'socks5'; proxyElement('proxyAuthentication').value=p.authentication||'none';
    proxyElement('proxyPassword').value=''; hideTemporaryPassword(proxyElement('proxyPassword')); proxyElement('proxyPassword').placeholder=p.hasSavedPassword?'Saved password — leave blank to keep':'';
    updateProxyFields(); proxyElement('proxyEditorPage').scrollTop=0; proxyElement('proxyName').focus();
  }
  function updateProxyFields() {
    const socks4=proxyElement('proxyType').value==='socks4';
    const auth=!socks4 && proxyElement('proxyAuthentication').value==='password';
    proxyElement('proxyAuthenticationRow').hidden=socks4;
    proxyElement('proxyUsernameRow').hidden=!(socks4||auth);
    proxyElement('proxyUsernameLabel').textContent=socks4?'User ID (optional)':'Username';
    proxyElement('proxyPasswordRow').hidden=!auth;
    if(!auth)hideTemporaryPassword(proxyElement('proxyPassword'));
    window.RemoteEditControls.refresh();
  }
  proxyElement('manageProxyProfilesButton').onclick=()=>{
    closeConnectionManagementMenu(true); proxyElement('proxyProfilesBackdrop').classList.remove('nested-proxy-backdrop'); proxyCreationOrigin=null; proxyReturnFocus=manageProfilesButton; showProxyList(); renderProxyList();
    proxyElement('proxyProfilesBackdrop').classList.add('visible'); proxyElement('proxyProfilesBackdrop').setAttribute('aria-hidden','false');
    proxyBusy=true; updateProxyBusy(); vscode.postMessage({type:'proxyProfiles',payload:{action:'list'}});
  };
  document.addEventListener('comboAction', event => {
    const origin = event.target;
    if (!['proxyProfileId','edit_proxyProfileId'].includes(origin.id) || proxyBusy) return;
    proxyCreationOrigin = origin; proxyReturnFocus = document.activeElement;
    proxyElement('proxyProfilesBackdrop').classList.toggle('nested-proxy-backdrop', origin.id === 'edit_proxyProfileId');
    if (origin.id === 'edit_proxyProfileId') manageProfilesBackdrop.inert = true;
    editProxyProfile();
    proxyElement('proxyProfilesBackdrop').classList.add('visible'); proxyElement('proxyProfilesBackdrop').setAttribute('aria-hidden','false');
    proxyBusy=true; updateProxyBusy(); vscode.postMessage({type:'proxyProfiles',payload:{action:'list'}});
  });
  function closeProxyProfiles() {
    if(proxyBusy)return;
    window.RemoteEditControls.closeCombo(); proxyElement('proxyPassword').value=''; hideTemporaryPassword(proxyElement('proxyPassword'));
    proxyElement('proxyProfilesBackdrop').classList.remove('visible', 'nested-proxy-backdrop'); proxyElement('proxyProfilesBackdrop').setAttribute('aria-hidden','true');
    if (proxyCreationOrigin?.id === 'edit_proxyProfileId') manageProfilesBackdrop.inert = false;
    proxyCreationOrigin = null; restoreDialogFocus(proxyReturnFocus);
  }
  proxyElement('proxyClose').onclick=closeProxyProfiles;
  proxyElement('proxyBack').onclick=()=>proxyCreationOrigin?.id === 'edit_proxyProfileId'?closeProxyProfiles():showProxyList();
  proxyElement('proxyNew').onclick=()=>editProxyProfile();
  proxyElement('proxyType').onchange=updateProxyFields; proxyElement('proxyAuthentication').onchange=updateProxyFields;
  proxyElement('proxySave').onclick=()=>{
    if(proxyBusy)return; proxyBusy=true; updateProxyBusy();
    vscode.postMessage({type:'proxyProfiles',payload:{action:'save',profile:{
      id:proxyElement('proxyEditId').value,name:proxyElement('proxyName').value,type:proxyElement('proxyType').value,
      host:proxyElement('proxyHost').value,port:Number(proxyElement('proxyPort').value),authentication:proxyElement('proxyAuthentication').value,
      username:proxyElement('proxyUsername').value,password:proxyElement('proxyPassword').value
    }}}); proxyElement('proxyPassword').value=''; hideTemporaryPassword(proxyElement('proxyPassword'));
  };
  document.addEventListener('keydown',event=>{
    const backdrop=proxyElement('proxyProfilesBackdrop');
    if(!backdrop.classList.contains('visible'))return;
    if(confirmDialogOpen)return;
    const menu=document.querySelector('.sync-combo-menu[data-for="proxyType"],.sync-combo-menu[data-for="proxyAuthentication"]');
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();
      if(menu)window.RemoteEditControls.closeCombo(true);
      else if(proxyPage==='editor') { if(proxyCreationOrigin?.id === 'edit_proxyProfileId')closeProxyProfiles(); else showProxyList(); }
      else closeProxyProfiles();
    }
    if(event.key==='Tab'){
      if(menu)return;
      event.stopImmediatePropagation();
      const items=[...backdrop.querySelectorAll('input:not([type=hidden]):not(:disabled),button:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
      if(!items.length){event.preventDefault();return;}
      if(!backdrop.contains(document.activeElement)){event.preventDefault();(event.shiftKey?items.at(-1):items[0])?.focus();return;}
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}
    }
  },true);
  bindTemporaryPasswordReveal(proxyElement('proxyPasswordReveal'),proxyElement('proxyPassword'));
  proxySelect.addEventListener('change',()=>setControls());
`; }
