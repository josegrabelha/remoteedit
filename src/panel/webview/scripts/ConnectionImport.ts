export function renderConnectionImport(): string { return `
  const ci = id => document.getElementById('connectionImport' + id);
  let ciStage = 'sources', ciBusy = false, ciSources = [], ciCandidates = [], ciReturnFocus, ciSelectedCandidateId = '';
  let ciUnlockId = '', ciUnlockReturnFocus = null, ciOpenPicker = null, ciFeedbackDefault = '';
  let ciBatchUnlock = false, ciConfirmReturnFocus = null, ciConfirmMode = 'credentials', ciPendingDeselectId = '';
  const ciBatchSkippedGroups = new Set();
  let ciReviewSort = { key: '', direction: '' };
  const ciChoices = new Map(), ciPreferredActions = new Map(), ciSourceChoices = new Map();
  const ciFieldLabels = { proxyType:'Proxy Type',proxyHost:'Proxy Host',proxyPort:'Proxy Port',proxyAuthentication:'Proxy Authentication',proxyUsername:'Proxy Username', name:'Name', connectionType:'Protocol', host:'Host', port:'Port', username:'Username', authType:'Authentication', startPath:'Remote Path', privateKeyPath:'Private Key', jumpProfileId:'Jump Host' };
  function ciSetFeedback(text, tooltip, error=false) { const el=ci('Feedback'), value=String(text || ''); el.textContent=value; el.classList.toggle('error',!!error); const full=String(tooltip || '').trim(); if(full && (full!==value || el.scrollWidth>el.clientWidth))el.setAttribute('data-tooltip',full);else el.removeAttribute('data-tooltip'); }
  function ciRestoreFeedback() { if(!ciBusy)ciSetFeedback(ciFeedbackDefault); }
  function ciSend(payload) { ciClosePicker(); ciBusy = true; ciSetFeedback('Working...'); ciControls(); vscode.postMessage({ type: 'connectionImport', payload }); }
  function ciControls() {
    ci('Back').hidden = ciStage !== 'review'; ci('Back').disabled = ciBusy;
    ci('Cancel').disabled = ciBusy; ci('Cancel').textContent = ciStage === 'result' ? 'Close' : 'Cancel';
    ci('Next').hidden = ciStage === 'result';
    const count = ciStage === 'sources' ? ciSources.filter(s => ciSourceChoices.get(s.id)).reduce((n,s)=>n+s.count,0) : ciCandidates.filter(c=>ciChoices.get(c.id)?.action !== 'skip').length;
    ci('Next').textContent = ciStage === 'sources' ? 'Review' : 'Import';
    ci('Next').disabled = ciBusy || !count;
    ci('Content').querySelectorAll('button,input').forEach(el => { el.disabled = ciBusy || el.dataset.unavailable === 'true'; });
    ci('Details').querySelectorAll('button,input').forEach(el => { el.disabled = ciBusy || el.dataset.unavailable === 'true'; });
  }
  function ciCloseMenu() { document.getElementById('connectionImportMenu').style.display='none'; manageProfilesImportButton.setAttribute('aria-expanded','false'); }
  function toggleConnectionImportMenu(force) {
    const open=force===true || manageProfilesImportButton.getAttribute('aria-expanded')!=='true';
    ciCloseMenu(); if(open) { positionConnectionManagementMenu(document.getElementById('connectionImportMenu'),manageProfilesImportButton,true); manageProfilesImportButton.setAttribute('aria-expanded','true'); document.getElementById('connectionImportBackup').focus(); }
  }
  const connectionManagementMenu = document.getElementById('connectionManagementMenu');
  const connectionImportMenu = document.getElementById('connectionImportMenu');
  // Fixed menus must be outside the transformed, overflow-hidden connection panel.
  document.body.append(connectionManagementMenu, connectionImportMenu);
  function connectionManagementContains(target) {
    return connectionManagementMenu.contains(target) || connectionImportMenu.contains(target);
  }
  function positionConnectionManagementMenu(menu, anchor, submenu) {
    const rect = anchor.getBoundingClientRect();
    menu.style.display = 'block';
    const width = menu.offsetWidth, height = menu.offsetHeight;
    let left = submenu ? rect.right + 4 : rect.right - width;
    if (submenu && left + width > window.innerWidth - 8) left = rect.left - width - 4;
    menu.style.left = Math.max(8, Math.min(left, window.innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(submenu ? rect.top : rect.bottom + 4, window.innerHeight - height - 8)) + 'px';
  }
  function closeConnectionManagementMenu(focus) {
    ciCloseMenu(); connectionManagementMenu.style.display = 'none';
    manageProfilesButton.setAttribute('aria-expanded', 'false');
    if (focus) restoreDialogFocus(manageProfilesButton);
  }
  function toggleConnectionManagementMenu(key) {
    if (manageProfilesButton.getAttribute('aria-expanded') === 'true' && !key) { closeConnectionManagementMenu(true); return; }
    hideProfileDropdown();
    positionConnectionManagementMenu(connectionManagementMenu, manageProfilesButton, false);
    manageProfilesButton.setAttribute('aria-expanded', 'true');
    const items = connectionManagementItems();
    (key === 'ArrowUp' || key === 'End' ? items[items.length - 1] : items[0]).focus();
  }
  function connectionManagementItems() {
    return Array.from(connectionManagementMenu.querySelectorAll('button[role="menuitem"]')).filter(item => !document.getElementById('connectionImportMenu').contains(item));
  }
  document.getElementById('connectionManagementConnections').addEventListener('click', () => { closeConnectionManagementMenu(true); showManageProfilesDialog(); });
  manageProfilesButton.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); toggleConnectionManagementMenu(event.key); }
  });
  connectionManagementMenu.addEventListener('keydown', event => {
    if (document.getElementById('connectionImportMenu').contains(event.target)) return;
    const items = connectionManagementItems(), index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowRight' && document.activeElement === manageProfilesImportButton) { event.preventDefault(); toggleConnectionImportMenu(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); ciCloseMenu();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next].focus();
    }
  });
  document.addEventListener('keydown', event => {
    if (manageProfilesButton.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (manageProfilesImportButton.getAttribute('aria-expanded') === 'true') { ciCloseMenu(); manageProfilesImportButton.focus(); }
      else closeConnectionManagementMenu(true);
    } else if (event.key === 'Tab') closeConnectionManagementMenu(true);
  }, true);
  document.addEventListener('focusin', event => {
    if (event.target !== manageProfilesButton && !connectionManagementContains(event.target)) closeConnectionManagementMenu(false);
  });
  document.addEventListener('click', event => {
    if (!connectionManagementContains(event.target) && !manageProfilesButton.contains(event.target)) closeConnectionManagementMenu(false);
  });
  window.addEventListener('resize', () => closeConnectionManagementMenu(false));
  document.addEventListener('scroll', event => {
    if (!connectionManagementContains(event.target)) closeConnectionManagementMenu(false);
  }, true);

  function ciClosePicker(focus) {
    if (!ciOpenPicker) return;
    const current = ciOpenPicker; ciOpenPicker = null;
    current.wrapper.classList.remove('open'); current.button.setAttribute('aria-expanded','false'); current.menu.classList.remove('visible'); current.menu.remove();
    if (focus) current.button.focus();
  }
  function ciPositionPicker(current) {
    const rect=current.button.getBoundingClientRect(), margin=8, gap=4;
    const menuWidth=Math.max(1,Math.min(rect.width,innerWidth-margin*2)); current.menu.style.width=menuWidth+'px'; current.menu.style.minWidth=menuWidth+'px'; current.menu.style.maxWidth=menuWidth+'px';
    current.menu.style.left=Math.max(margin,Math.min(rect.left,innerWidth-menuWidth-margin))+'px';
    ci('Backdrop').append(current.menu); current.menu.classList.add('visible');
    const down=innerHeight-rect.bottom-gap-margin, up=rect.top-gap-margin;
    current.menu.style.maxHeight=Math.max(80,Math.min(300,Math.max(down,up)))+'px';
    const height=current.menu.offsetHeight;
    current.menu.style.top=(down>=Math.min(height,220)||down>=up ? rect.bottom+gap : Math.max(margin,rect.top-height-gap))+'px';
  }
  function ciPicker(options, value, ariaLabel, unavailable, onChange) {
    const wrapper=document.createElement('div'); wrapper.className='profile-picker connection-import-picker';
    const button=document.createElement('button'); button.type='button'; button.className='profile-dropdown-button'; button.setAttribute('aria-haspopup','listbox'); button.setAttribute('aria-expanded','false'); button.setAttribute('aria-label',ariaLabel); button.dataset.unavailable=String(!!unavailable);
    const label=document.createElement('span'); label.className='profile-dropdown-label';
    const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg'); chevron.setAttribute('class','profile-dropdown-chevron'); chevron.setAttribute('viewBox','0 0 16 16'); chevron.setAttribute('aria-hidden','true'); const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d','M5 6.5 8 9.5l3-3'); chevron.append(path); button.append(label,chevron); wrapper.append(button);
    const menu=document.createElement('div'); menu.className='profile-dropdown-menu connection-import-picker-menu'; menu.setAttribute('role','listbox'); menu.setAttribute('aria-label',ariaLabel);
    ciTooltipIfClipped(button,()=>{const selected=options.find(o=>o.value===currentValue)||options[0];return selected?.tooltip||selected?.label||'';},label);
    let currentValue=value;
    const update=()=>{ const selected=options.find(o=>o.value===currentValue) || options[0]; label.textContent=selected ? String(selected.label ?? '') : 'Select…'; menu.querySelectorAll('.profile-dropdown-item').forEach(item=>{const selectedItem=item.dataset.value===currentValue;item.classList.toggle('selected',selectedItem);item.setAttribute('aria-selected',String(selectedItem));}); };
    for(const option of options){ const item=document.createElement('button');item.type='button';item.className='profile-dropdown-item';item.setAttribute('role','option');item.dataset.value=option.value;const name=document.createElement('span');name.className='profile-dropdown-name';name.textContent=option.label;item.append(name);ciTooltipIfClipped(item,option.tooltip||option.label,name);item.addEventListener('click',()=>{currentValue=option.value;update();ciClosePicker(true);onChange(currentValue);});menu.append(item); }
    const open=(edge)=>{ if(button.disabled)return;ciClosePicker();ciOpenPicker={wrapper,button,menu};wrapper.classList.add('open');button.setAttribute('aria-expanded','true');ciPositionPicker(ciOpenPicker);update();const items=Array.from(menu.querySelectorAll('button:not(:disabled)'));if(edge==='first')items[0]?.focus();if(edge==='last')items[items.length-1]?.focus(); };
    button.addEventListener('click',()=>ciOpenPicker?.button===button?ciClosePicker(true):open());
    button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();open(e.key==='ArrowUp'||e.key==='End'?'last':'first');}});
    menu.addEventListener('keydown',e=>{const items=Array.from(menu.querySelectorAll('button:not(:disabled)')),index=items.indexOf(document.activeElement);if(e.key==='Escape'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();ciClosePicker(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next]?.focus();}else if(e.key==='Tab')ciClosePicker();});
    update(); return {wrapper,button,setValue(next){currentValue=next;update();},getValue(){return currentValue;}};
  }
  function ciSetReviewLayout(enabled) { const body=ci('Content').parentElement;body.classList.toggle('connection-import-review-layout',!!enabled);if(!enabled)body.classList.remove('connection-import-result-layout'); }
  function ciConflictOptions(conflicts) {
    const nameCount=new Map(); for(const existing of conflicts){const name=String(existing.profile.name || existing.profile.host || 'Existing connection');nameCount.set(name,(nameCount.get(name)||0)+1);}
    return conflicts.map(existing=>{const profile=existing.profile||{},name=String(profile.name || profile.host || 'Existing connection'),host=String(profile.host || ''),protocol=String(profile.connectionType || '').toUpperCase();let label=name;if((nameCount.get(name)||0)>1){const sameHost=conflicts.filter(item=>String(item.profile?.name || item.profile?.host || 'Existing connection')===name&&String(item.profile?.host || '')===host).length;label=host&&sameHost===1?name+' · '+host:name+(protocol?' · '+protocol:'')+(host?' · '+host:'');}const tooltip=[name,protocol,host].filter(Boolean).join(' · ');return {value:existing.id,label,tooltip};});
  }
  function ciSelectedCandidates(){return ciCandidates.filter(c=>ciChoices.get(c.id)?.action!=='skip'&&c.status!=='Unsupported');}
  function ciSetCandidateChecked(candidate,checked){
    const choice=ciChoices.get(candidate.id);
    if(!choice||candidate.status==='Unsupported')return;
    if(checked)choice.action=ciPreferredActions.get(candidate.id)||'new';
    else {if(choice.action!=='skip')ciPreferredActions.set(candidate.id,choice.action);choice.action='skip';}
  }
  // Changes to the selection must preserve the entire jump chain. Never use
  // host/port equality alone to substitute a jump with a different route.
  function ciSelectJumpDependencies(id){
    const seen=new Set(),byId=new Map(ciCandidates.map(c=>[c.id,c]));
    let c=byId.get(id);
    while(c&&c.jumpCandidateId&&!seen.has(c.id)){
      seen.add(c.id);const dependency=byId.get(c.jumpCandidateId);
      if(!dependency||dependency.status==='Unsupported')break;
      ciSetCandidateChecked(dependency,true);c=dependency;
    }
  }
  function ciJumpDependents(id){
    const affected=[];const pending=[id],seen=new Set(pending);
    while(pending.length){const parent=pending.shift();for(const c of ciCandidates){
      if(c.jumpCandidateId!==parent||seen.has(c.id))continue;
      seen.add(c.id);pending.push(c.id);
      if(ciChoices.get(c.id)?.action!=='skip')affected.push(c);
    }}
    return affected;
  }
  function ciInitializeJumpSelections(){
    for(const c of ciCandidates){
      if(!ciChoices.has(c.id))ciChoices.set(c.id,{id:c.id,action:c.status==='Unsupported'||c.status==='Conflict'?'skip':'new',existingId:c.conflicts[0]?.id});
      if(!ciPreferredActions.has(c.id))ciPreferredActions.set(c.id,'new');
    }
    for(const c of ciCandidates){if(ciChoices.get(c.id)?.action!=='skip')ciSelectJumpDependencies(c.id);}
  }
  function ciReplaceMayClearCredentials(c){
    const decision=ciChoices.get(c.id);
    if(decision?.action!=='replace')return false;
    const previous=c.conflicts.find(x=>x.id===decision.existingId);
    return !!previous&&(previous.credentials==='Saved credentials'||previous.credentials==='Master Password')&&c.credentials!=='Password available'&&c.credentials!=='Passphrase available'&&c.credentials!=='Unlocked';
  }
  function ciCredentialRisks(){
    const selected=ciSelectedCandidates();
    return { locked:selected.filter(c=>c.canUnlock),replace:selected.filter(ciReplaceMayClearCredentials) };
  }
  function ciHideConfirmation(){
    ci('ConfirmBackdrop').classList.remove('visible');ci('ConfirmBackdrop').setAttribute('aria-hidden','true');
  }
  function ciShowConfirmation(risks){
    ciClosePicker();ciConfirmMode='credentials';ciConfirmReturnFocus=ci('Next');
    ci('ConfirmTitle').textContent='Protected Credentials';ci('ConfirmBack').textContent='Back';
    ci('ConfirmRisk').classList.remove('connection-import-dependency-list');
    const count=risks.locked.length;
    ci('ConfirmText').textContent=count===1?'1 selected connection has protected credentials that have not been unlocked.':count+' selected connections have protected credentials that have not been unlocked.';
    if(!count)ci('ConfirmText').textContent='Some replacement connections could lose their previously saved credentials.';
    ci('ConfirmRisk').textContent=[count?'Importing without unlocking will omit these saved passwords; they may be needed when connecting.':'',risks.replace.length?risks.replace.length+' replacement(s) may clear existing saved credentials.':''].filter(Boolean).join(' ');
    ci('ConfirmUnlock').hidden=!count;
    ci('ConfirmProceed').textContent=count?'Import Without Credentials':'Import Anyway';
    ci('ConfirmBackdrop').classList.add('visible');ci('ConfirmBackdrop').setAttribute('aria-hidden','false');ci('ConfirmBack').focus();
  }
  function ciConfirmJumpDeselect(candidate,focus){
    const affected=ciJumpDependents(candidate.id);
    if(!affected.length)return false;
    ciClosePicker();ciConfirmMode='jump';ciPendingDeselectId=candidate.id;ciConfirmReturnFocus=focus;
    ci('ConfirmTitle').textContent='Deselect Jump Host?';
    ci('ConfirmText').textContent='The following connections depend on "'+candidate.profile.name+'" and will also be deselected:';
    ci('ConfirmRisk').textContent=affected.map(c=>'• '+c.profile.name).join('\\n');
    ci('ConfirmRisk').classList.add('connection-import-dependency-list');
    ci('ConfirmBack').textContent='Cancel';ci('ConfirmUnlock').hidden=true;ci('ConfirmProceed').textContent='Deselect All';
    ci('ConfirmBackdrop').classList.add('visible');ci('ConfirmBackdrop').setAttribute('aria-hidden','false');ci('ConfirmBack').focus();
    return true;
  }
  function ciCompleteJumpDeselect(){
    const candidate=ciCandidates.find(c=>c.id===ciPendingDeselectId);
    if(!candidate)return;
    const affected=ciJumpDependents(candidate.id);
    ciSetCandidateChecked(candidate,false);
    for(const dependent of affected)ciSetCandidateChecked(dependent,false);
    const scroll=ci('Content').scrollTop;ciSelectedCandidateId=candidate.id;
    ciRenderReview();ci('Content').scrollTop=scroll;
    ciSetFeedback('Deselecting "'+candidate.profile.name+'" also deselected '+affected.length+' dependent connection(s).');
    const row=Array.from(ci('Content').querySelectorAll('tr[data-candidate-id]')).find(r=>r.dataset.candidateId===candidate.id);
    row?.focus();
  }
  function ciImportNow(acknowledge){
    ciHideConfirmation();ciBatchUnlock=false;ciBatchSkippedGroups.clear();
    ciSend({action:'apply',decisions:Array.from(ciChoices.values()),acknowledgeCredentialRisk:!!acknowledge});
  }
  function ciOpenUnlock(c,batch,focus){
    ciUnlockId=c.id;ciBatchUnlock=!!batch;ciUnlockReturnFocus=focus||null;
    ci('UnlockTitle').textContent='Unlock '+c.source+' Credentials';
    ci('UnlockCancel').textContent='Skip';
    ci('UnlockSkipAll').hidden=!batch;
    ci('UnlockSkipAll').disabled=false;
    ci('UnlockPassword').value='';hideTemporaryPassword(ci('UnlockPassword'));
    ci('UnlockFeedback').textContent='';ci('UnlockFeedback').removeAttribute('data-tooltip');
    ci('UnlockBackdrop').classList.add('visible');ci('UnlockBackdrop').setAttribute('aria-hidden','false');ci('UnlockPassword').focus();
  }
  function ciHideUnlock(){
    ci('UnlockPassword').value='';hideTemporaryPassword(ci('UnlockPassword'));
    ci('UnlockBackdrop').classList.remove('visible');ci('UnlockBackdrop').setAttribute('aria-hidden','true');
    ciUnlockId='';ciUnlockReturnFocus=null;
  }
  function ciUnlockNext(){
    const pending=ciSelectedCandidates().find(c=>c.canUnlock&&!ciBatchSkippedGroups.has(c.id));
    if(!pending){ciImportNow(true);return;}
    ciSelectedCandidateId=pending.id;ciRenderReview();
    ciOpenUnlock(pending,true,null);
  }
  function ciDismissUnlock(){
    if(ciBusy)return;
    const focus=ciUnlockReturnFocus;
    ciHideUnlock();ciBatchUnlock=false;ciBatchSkippedGroups.clear();
    if(focus&&document.contains(focus))focus.focus();else ci('Next').focus();
  }
  function ciSkipUnlock(){
    if(ciBusy)return;
    if(!ciBatchUnlock){ciDismissUnlock();return;}
    ci('UnlockCancel').disabled=true;ci('UnlockSkipAll').disabled=true;ci('UnlockSubmit').disabled=true;
    ciSend({action:'skipUnlock',id:ciUnlockId});
  }
  function ciSkipAllUnlock(){
    if(ciBusy||!ciBatchUnlock)return;
    ciHideUnlock();ciImportNow(true);
  }
  function ciStartImport(){
    if(ciBusy||ciStage!=='review')return;
    ciBatchSkippedGroups.clear();
    const risks=ciCredentialRisks();
    if(risks.locked.length||risks.replace.length)ciShowConfirmation(risks);
    else ciImportNow(false);
  }
  function ciOpen() {
    ciReturnFocus=manageProfilesButton; closeConnectionManagementMenu(true); ciClosePicker(); ciStage='sources'; ciSources=[]; ciCandidates=[]; ciChoices.clear(); ciPreferredActions.clear(); ciSourceChoices.clear(); ciReviewSort={key:'',direction:''}; ciSelectedCandidateId=''; ciBatchUnlock=false;ciBatchSkippedGroups.clear();ciUnlockId='';ciConfirmReturnFocus=null;ciHideConfirmation();ci('UnlockBackdrop').classList.remove('visible');ci('UnlockBackdrop').setAttribute('aria-hidden','true'); ciFeedbackDefault=''; ciSetFeedback(''); ciSetReviewLayout(false); ci('Content').replaceChildren(); ci('Details').replaceChildren();
    ci('Step').textContent='Sources'; ci('Backdrop').classList.add('visible'); ci('Backdrop').setAttribute('aria-hidden','false'); ciSend({action:'detect'});
  }
  function ciClose() { if(ciBusy) return; ciHideConfirmation();ciHideUnlock();ciBatchUnlock=false;ciBatchSkippedGroups.clear(); ciClosePicker(); ciSetReviewLayout(false); ci('Backdrop').classList.remove('visible'); ci('Backdrop').setAttribute('aria-hidden','true'); ci('Content').replaceChildren(); ci('Details').replaceChildren(); ciCandidates=[]; ciChoices.clear(); ciPreferredActions.clear(); ciReviewSort={key:'',direction:''}; vscode.postMessage({type:'connectionImport',payload:{action:'close'}}); restoreDialogFocus(ciReturnFocus); }
  function ciText(tag,text) { const el=document.createElement(tag); el.textContent=String(text ?? ''); return el; }
  // Only show the existing custom tooltip when the text is actually clipped.
  // Capturing the event ensures this runs before the shared tooltip handler.
  function ciTooltipIfClipped(element, fullText, measure=element, multiline=false) {
    const update=()=>{
      const clipped=measure.clientWidth>0 && measure.scrollWidth>measure.clientWidth+1;
      const full=typeof fullText==='function'?fullText():fullText;
      if(clipped && full && full!=='—'){
        element.setAttribute('data-tooltip',full);
        if(multiline)element.setAttribute('data-tooltip-multiline','');
      }else{
        element.removeAttribute('data-tooltip');
        element.removeAttribute('data-tooltip-multiline');
      }
    };
    element.addEventListener('mouseover',update,true);
    element.addEventListener('focusin',update);
  }
  function ciTable(headers) { const table=document.createElement('table'); table.className='server-overview-detail-table'; const head=document.createElement('thead'), row=document.createElement('tr'); headers.forEach(h=>row.append(ciText('th',h))); head.append(row); table.append(head); const body=document.createElement('tbody'); table.append(body); ci('Content').append(table); return body; }
  function ciRenderSources() {
    ciClosePicker(); ciSetReviewLayout(false); ci('Content').replaceChildren(); ci('Details').replaceChildren(); const body=ciTable(['Import','Source','Status','Found','Action']); body.parentElement.classList.add('connection-import-sources-table');
    const total=ciSources.reduce((n,s)=>n+s.count,0), detected=ciSources.filter(s=>s.count>0).length; ciFeedbackDefault=detected+' sources · '+total+' connections found'; ciRestoreFeedback();
    for(const s of ciSources) {
      if(!ciSourceChoices.has(s.id)) ciSourceChoices.set(s.id,s.count>0);
      const row=document.createElement('tr'), cell=document.createElement('td'), box=document.createElement('input'); row.className='connection-import-source-row'; row.tabIndex=0; box.type='checkbox';box.className='dialog-checkbox'; box.checked=!!ciSourceChoices.get(s.id); box.setAttribute('aria-label','Import '+s.name); box.dataset.unavailable=String(!s.count); const syncSource=()=>{ciSourceChoices.set(s.id,box.checked);ciControls();}; box.addEventListener('change',syncSource); cell.append(box);const status=ciText('td',s.status);if(s.error&&!s.count){status.classList.add('connection-import-source-error','has-tooltip');status.setAttribute('data-tooltip',s.error);}row.append(cell,ciText('td',s.name),status,ciText('td',s.count || '—'));
      const actions=document.createElement('td'), button=ciText('button',s.count?'Change':'Choose'); button.className='secondary connection-import-source-action'; button.type='button'; button.addEventListener('click',()=>ciSend({action:'choose',source:s.id})); actions.append(button); row.append(actions); body.append(row);
      const statusText=()=>{const location=(s.paths||[])[0];return location?s.name+' · '+location:s.name+' · '+s.status;}; const statusTooltip=()=>[statusText(),...(s.paths||[]).slice(1),...(s.error?[s.error]:[])].join('\\n');
      const toggle=()=>{if(box.disabled||box.dataset.unavailable==='true')return;box.checked=!box.checked;syncSource();};
      row.addEventListener('click',e=>{if(e.target.closest('button,input'))return;toggle();});
      row.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Spacebar')&&!e.target.closest('button,input')){e.preventDefault();toggle();}});
      row.addEventListener('mouseenter',()=>{if(!ciBusy)ciSetFeedback(statusText(),statusTooltip());}); row.addEventListener('mouseleave',ciRestoreFeedback);
      row.addEventListener('focusin',()=>{if(!ciBusy)ciSetFeedback(statusText(),statusTooltip());}); row.addEventListener('focusout',e=>{if(!row.contains(e.relatedTarget))ciRestoreFeedback();});
    }
  }
  function ciDisplayValue(field,value) { if(value===undefined||value===null||value==='')return '—'; if(field==='connectionType')return String(value).toUpperCase(); if(field==='authType')return value==='privateKey'?'Private key':'Password'; return String(value); }
  function ciDetailPair(grid,label,value,wide,tooltip,compact) {
    const name=ciText('div',label), data=ciText('div',value===undefined||value===null||value===''?'—':value); name.className='connection-import-detail-label'; data.className='connection-import-detail-value';
    if(wide){name.classList.add('wide');data.classList.add('wide');} if(compact)data.classList.add('connection-import-detail-ellipsis'); const full=String(tooltip||data.textContent||''); if(full&&full!=='—'){data.classList.add('tooltip-above');ciTooltipIfClipped(data,full,data,true);} grid.append(name,data); return data;
  }
  const ciUnsupportedLabels={logontype:'Logon Type',encodingtype:'Encoding',encoding:'Encoding',bypassproxy:'Proxy Bypass',proxy:'Proxy',proxymethod:'Proxy',compression:'Compression',pasvmode:'Passive Mode',passivemode:'Passive Mode',timeout:'Timeout',keepalive:'Keep Alive',serveraliveinterval:'Keep Alive',cipher:'Cipher',kex:'Key Exchange',hostkey:'Host Key',utf8:'UTF-8',tls:'TLS',ssl:'TLS/SSL',sshconfigpath:'SSH Config',agent:'SSH Agent',putty:'PuTTY Agent'};
  function ciUnsupportedItems(c){const values=[];for(const raw of (c.ignored||[])){const key=String(raw||'').trim().toLowerCase();const label=ciUnsupportedLabels[key];if(label&&!values.includes(label))values.push(label);}return values;}
  function ciDetails(c) {
    ciSelectedCandidateId=c.id; ci('Details').replaceChildren(); ci('Details').scrollTop=0;
    const title=ciText('div','Details'); title.className='server-overview-detail-section-title connection-import-detail-title'; ci('Details').append(title);
    const grid=document.createElement('div'); grid.className='connection-import-detail-grid';
    ciDetailPair(grid,'Source',c.source); ciDetailPair(grid,'User',c.profile.username || '—'); ciDetailPair(grid,'Authentication',c.profile.authType==='privateKey'?'Private key':'Password');
    ciDetailPair(grid,'Status',c.status); ciDetailPair(grid,'Credentials',c.unlocked?'Unlocked':c.credentials || '—'); ciDetailPair(grid,'Group',c.group || '—');
    ciDetailPair(grid,'Remote Path',c.profile.startPath || '—'); ciDetailPair(grid,'Jump Host',c.jump || '—'); ciDetailPair(grid,'Private Key',c.profile.privateKeyPath || '—');
    if(c.profile.proxyType){
      ciDetailPair(grid,'Proxy Type',c.profile.proxyType==='http'?'HTTP CONNECT':String(c.profile.proxyType).toUpperCase());
      ciDetailPair(grid,'Proxy Host',c.profile.proxyHost);ciDetailPair(grid,'Proxy Port',c.profile.proxyPort);
      ciDetailPair(grid,'Proxy Authentication',c.profile.proxyAuthentication==='password'?'Username / Password':'None');
      ciDetailPair(grid,c.profile.proxyType==='socks4'?'Proxy User ID':'Proxy Username',c.profile.proxyUsername||'—');
    }
    ciDetailPair(grid,'Location',c.sourcePath || '—',true);
    const unsupportedItems=ciUnsupportedItems(c); if(unsupportedItems.length){const unsupportedText=unsupportedItems.join(', ');ciDetailPair(grid,'Unsupported',unsupportedText,true,unsupportedText,true);}
    ci('Details').append(grid);
    const warningText=c.reason || (c.warnings||[]).join(' · '); if(warningText){const note=document.createElement('div');note.className='connection-import-detail-note';const value=ciText('span',warningText);value.className='tooltip-above';ciTooltipIfClipped(value,warningText,value,true);note.append(ciText('span',c.reason?'Issue':'Warning'),value);ci('Details').append(note);}
    if(c.duplicate){const note=document.createElement('div');note.className='connection-import-detail-note';const value=ciText('span',c.duplicate);value.className='tooltip-above';ciTooltipIfClipped(value,c.duplicate,value,true);note.append(ciText('span','Conflict'),value);ci('Details').append(note);}
    if(c.canUnlock) {const unlock=ciText('button','Unlock Credentials');unlock.className='secondary connection-import-detail-action';unlock.addEventListener('click',()=>ciOpenUnlock(c,false,unlock));ci('Details').append(unlock);}
    else if(c.unlocked){
      const badge=ciText('span','Credentials unlocked');badge.className='connection-import-unlocked';
      const check=document.createElementNS('http://www.w3.org/2000/svg','svg');check.setAttribute('viewBox','0 0 16 16');check.setAttribute('aria-hidden','true');
      const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');ring.setAttribute('cx','8');ring.setAttribute('cy','8');ring.setAttribute('r','6');
      const tick=document.createElementNS('http://www.w3.org/2000/svg','path');tick.setAttribute('d','M5 8l2 2 4-4');check.append(ring,tick);badge.prepend(check);ci('Details').append(badge);
    }
    const current=c.conflicts.find(x=>x.id===ciChoices.get(c.id)?.existingId);
    if(current) {
      const compareTitle=ciText('div','Compare'); compareTitle.className='server-overview-detail-section-title connection-import-compare-title'; ci('Details').append(compareTitle);
      const wrap=document.createElement('div');wrap.className='server-overview-detail-table-wrap connection-import-compare-wrap';const table=document.createElement('table'); table.className='server-overview-detail-table connection-import-compare-table';
      const header=document.createElement('tr'); ['Field','Existing','Imported'].forEach(t=>header.append(ciText('th',t))); table.append(header);
      const fields=[...new Set([...Object.keys(c.profile),...Object.keys(current.profile || {})])];
      const differences=[];
      for(const field of fields) {
        if(/password|passphrase|secret|token|credential/i.test(field))continue;
        const existing=ciDisplayValue(field,current.profile[field]),imported=ciDisplayValue(field,c.profile[field]);
        if(existing!==imported)differences.push({field:ciFieldLabels[field]||field,existing,imported});
      }
      // Keep the preview compact even when a profile differs in dozens of fields.
      // The remaining differences are available through the compact summary below.
      const maxRows=c.canUnlock||warningText||c.duplicate?2:4;
      for(const difference of differences.slice(0,maxRows)){
        const row=document.createElement('tr');
        for(const value of [difference.field,difference.existing,difference.imported]){
          const cell=ciText('td',value);cell.classList.add('tooltip-above');ciTooltipIfClipped(cell,value,cell,true);row.append(cell);
        }
        table.append(row);
      }
      if(!differences.length){const row=document.createElement('tr'),cell=ciText('td','No field differences.');cell.colSpan=3;row.append(cell);table.append(row);}
      wrap.append(table);ci('Details').append(wrap);
      if(differences.length>maxRows){
        const rest=differences.slice(maxRows);
        const summary=ciText('div','+'+rest.length+' more differences…');summary.className='connection-import-compare-summary tooltip-above';
        summary.setAttribute('data-tooltip',rest.map(d=>d.field+': '+d.existing+' → '+d.imported).join('\\n'));summary.setAttribute('data-tooltip-multiline','');
        ci('Details').append(summary);
      }
      if(ciChoices.get(c.id)?.action==='replace'){
        const content='Replace updates this profile. Existing credentials will be replaced or cleared; the Remote Edit Master Password is unchanged.';
        const note=ciText('div',content);note.className='connection-import-detail-footnote tooltip-above';ciTooltipIfClipped(note,content,note,true);ci('Details').append(note);
      }
    }
  }
  function ciReviewCell(value) { const cell=ciText('td',value===undefined||value===null||value===''?'—':value); cell.className='connection-import-review-value'; return cell; }
  function ciRenderReview() {
    ciClosePicker(); ciInitializeJumpSelections(); ciSetReviewLayout(true); ci('Content').replaceChildren(); ci('Details').replaceChildren(); const body=ciTable(['','Source','Name','Protocol','Host','Status','Action']); const table=body.parentElement; table.classList.add('connection-import-review-table'); ciFeedbackDefault=ciCandidates.length+' connections to review'; ciRestoreFeedback();
    const selectAll=document.createElement('input');selectAll.type='checkbox';selectAll.className='dialog-checkbox connection-import-select-all';selectAll.setAttribute('aria-label','Select all connections for import');table.querySelector('thead th')?.replaceChildren(selectAll);
    const reviewRows=[]; let selectedRow=null, selectedCandidate=null;
    const sortColumns=[['source','Source'],['name','Name'],['protocol','Protocol'],['host','Host'],['status','Status'],['action','Action']];
    const sortValue=(item,key)=>{
      const c=item.c,choice=item.choice;
      if(key==='source')return c.source;
      if(key==='name')return c.profile.name;
      if(key==='protocol')return c.profile.connectionType;
      if(key==='host')return c.profile.host;
      if(key==='status')return c.status;
      if(key==='action')return !item.box.checked?'Skip':!c.conflicts.length?'Import':choice.action==='replace'?'Replace':'Import as New';
      return '';
    };
    const applySort=()=>{
      const ordered=reviewRows.slice().sort((a,b)=>{
        if(!ciReviewSort.direction)return a.originalIndex-b.originalIndex;
        const comparison=String(sortValue(a,ciReviewSort.key)||'').localeCompare(String(sortValue(b,ciReviewSort.key)||''),undefined,{numeric:true,sensitivity:'base'});
        return (ciReviewSort.direction==='desc'?-comparison:comparison)||(a.originalIndex-b.originalIndex);
      });
      for(const item of ordered)body.append(item.row);
    };
    sortColumns.forEach(([key,label],index)=>{
      const header=table.querySelectorAll('thead th')[index+1];
      const button=document.createElement('button');button.type='button';button.className='server-list-column-sort-button';
      const name=ciText('span',label),indicator=ciText('span','');indicator.className='server-list-sort-indicator';button.append(name,indicator);header.replaceChildren(button);
      const update=()=>{
        const active=ciReviewSort.key===key&&!!ciReviewSort.direction;
        button.classList.toggle('active',active);
        indicator.textContent=active?(ciReviewSort.direction==='desc'?'↓':'↑'):'';
        const next=active?(ciReviewSort.direction==='asc'?'Sort descending':'Clear sort'):'Sort ascending';
        button.setAttribute('aria-label',label+'. '+next);
        header.setAttribute('aria-sort',active?(ciReviewSort.direction==='asc'?'ascending':'descending'):'none');
      };
      button.addEventListener('click',()=>{
        if(ciReviewSort.key!==key||!ciReviewSort.direction)ciReviewSort={key,direction:'asc'};
        else if(ciReviewSort.direction==='asc')ciReviewSort={key,direction:'desc'};
        else ciReviewSort={key:'',direction:''};
        applySort();for(const th of table.querySelectorAll('thead th'))th._ciUpdateSort?.();
      });
      header._ciUpdateSort=update;update();
    });
    const syncSelectAll=()=>{const available=reviewRows.filter(item=>item.importable),selected=available.filter(item=>item.box.checked).length;selectAll.dataset.unavailable=String(available.length===0);selectAll.disabled=ciBusy||available.length===0;selectAll.checked=available.length>0&&selected===available.length;selectAll.indeterminate=selected>0&&selected<available.length;selectAll.setAttribute('aria-checked',selectAll.indeterminate?'mixed':String(selectAll.checked));};
    for(const c of ciCandidates) {
      const choice=ciChoices.get(c.id), row=document.createElement('tr'), cell=document.createElement('td'), box=document.createElement('input'); row.className='connection-import-review-row'; box.type='checkbox';box.className='dialog-checkbox';box.checked=choice.action!=='skip';box.setAttribute('aria-label','Import '+c.profile.name);box.dataset.unavailable=String(c.status==='Unsupported');cell.append(box);row.append(cell,ciReviewCell(c.source),ciReviewCell(c.profile.name),ciReviewCell(String(c.profile.connectionType||'').toUpperCase()),ciReviewCell(c.profile.host),ciReviewCell(c.status));
      const actionCell=document.createElement('td'), actionControls=document.createElement('div'); actionControls.className='connection-import-action-controls'; actionCell.append(actionControls);
      let targetPicker,actionPicker;
      if(!ciPreferredActions.has(c.id))ciPreferredActions.set(c.id,choice.action==='replace'?'replace':'new');
      const selectRow=()=>{body.querySelectorAll('.selected').forEach(r=>r.classList.remove('selected'));row.classList.add('selected');ciSelectedCandidateId=c.id;ciDetails(c);};
      const renderAction=()=>{
        ciClosePicker(); actionControls.replaceChildren(); actionPicker=undefined; targetPicker=undefined;
        const unsupported=c.status==='Unsupported', unavailable=!box.checked||unsupported;
        if(!c.conflicts.length){
          const label=ciText('span',unavailable?'':'Import');
          label.className='connection-import-action-label';
          label.setAttribute('aria-hidden',unavailable?'true':'false');
          actionControls.append(label);
          return;
        }
        const currentAction=choice.action==='replace'||ciPreferredActions.get(c.id)==='replace'?'replace':'new';
        const actionOptions=[{value:'new',label:'Import as New'},{value:'replace',label:'Replace'}];
        if(unsupported){
          actionPicker=ciPicker([{value:'',label:''}],'','Import action for '+c.profile.name,true,()=>{});
          actionPicker.wrapper.classList.add('connection-import-action-picker','connection-import-action-picker-empty');
          const disabledButton=actionPicker.wrapper.querySelector('.profile-dropdown-button');
          if(disabledButton)disabledButton.disabled=true;
          actionControls.append(actionPicker.wrapper);
          return;
        }
        actionPicker=ciPicker(actionOptions,currentAction,'Import action for '+c.profile.name,unavailable,value=>{choice.action=value;ciPreferredActions.set(c.id,value);renderAction();selectRow();syncSelectAll();applySort();ciControls();}); actionPicker.wrapper.classList.add('connection-import-action-picker');
        if(unavailable){actionPicker.wrapper.classList.add('connection-import-action-picker-disabled');const disabledButton=actionPicker.wrapper.querySelector('.profile-dropdown-button');if(disabledButton)disabledButton.disabled=true;}
        actionControls.append(actionPicker.wrapper);
        if(!choice.existingId)choice.existingId=c.conflicts[0].id;
        if(currentAction==='replace'){targetPicker=ciPicker(ciConflictOptions(c.conflicts),choice.existingId,'Replace target for '+c.profile.name,unavailable,value=>{choice.existingId=value;selectRow();});targetPicker.wrapper.classList.add('connection-import-target-picker');if(unavailable){const disabledTarget=targetPicker.wrapper.querySelector('.profile-dropdown-button');if(disabledTarget)disabledTarget.disabled=true;}actionControls.append(targetPicker.wrapper);}
      };
    const updateSelection=(checked,fromBulk)=>{if(c.status==='Unsupported')return;
      if(!checked&&!fromBulk&&ciConfirmJumpDeselect(c,box)){box.checked=true;return;}
      box.checked=checked;ciSetCandidateChecked(c,checked);if(!fromBulk){
        if(checked)ciSelectJumpDependencies(c.id);
        const scroll=ci('Content').scrollTop;ciSelectedCandidateId=c.id;ciRenderReview();ci('Content').scrollTop=scroll;
        const focus=Array.from(ci('Content').querySelectorAll('tr[data-candidate-id]')).find(row=>row.dataset.candidateId===c.id);focus?.focus();
        ciControls();return;
      }
      renderAction();syncSelectAll();applySort();ciControls();};
      renderAction();
      box.addEventListener('change',()=>updateSelection(box.checked,false));
      row.append(actionCell);row.tabIndex=0;row.dataset.candidateId=c.id;row.addEventListener('click',e=>{if(e.target.closest('button,input'))return;selectRow();});row.addEventListener('keydown',e=>{if(e.target!==row)return;if(e.key===' '||e.key==='Spacebar'||e.key==='Enter'){e.preventDefault();selectRow();}});body.append(row);
      reviewRows.push({c,choice,row,box,actionPicker,targetPicker,importable:c.status!=='Unsupported',updateSelection,originalIndex:reviewRows.length});
      if(c.id===ciSelectedCandidateId){selectedRow=row;selectedCandidate=c;}
    }
    selectAll.addEventListener('change',()=>{const select=selectAll.checked;for(const item of reviewRows){if(!item.importable)continue;ciSetCandidateChecked(item.c,select);}if(select){for(const item of reviewRows)if(item.importable)ciSelectJumpDependencies(item.c.id);}const scroll=ci('Content').scrollTop;ciRenderReview();ci('Content').scrollTop=scroll;ciControls();});
    syncSelectAll();applySort();
    if(!selectedCandidate&&ciCandidates.length){selectedCandidate=ciCandidates[0];selectedRow=body.querySelector('tr[data-candidate-id="'+selectedCandidate.id+'"]');ciSelectedCandidateId=selectedCandidate.id;}
    if(selectedRow&&selectedCandidate){selectedRow.classList.add('selected');ciDetails(selectedCandidate);}else{const title=ciText('div','Details');title.className='server-overview-detail-section-title connection-import-detail-title';const empty=ciText('div','Select a connection to view details.');empty.className='connection-import-detail-empty';ci('Details').append(title,empty);}
  }
  function ciRenderResultDetails(item){
    ci('Details').replaceChildren();
    const title=ciText('div','Details — '+item.name);title.className='server-overview-detail-section-title connection-import-detail-title';ci('Details').append(title);
    const grid=document.createElement('div');grid.className='connection-import-result-detail-grid';
    const field=(label,value)=>{const name=ciText('span',label);name.className='connection-import-detail-label';const text=ciText('span',value||'—');text.className='connection-import-result-detail-value';grid.append(name,text);};
    field('Source',item.source);field('Action',item.action);field('Result',item.status);field('Credentials',item.credentials);
    if(item.savedName&&item.savedName!==item.name)field('Saved as',item.savedName);
    if(item.jump)field('Jump Host',item.jump);
    ci('Details').append(grid);
    const note=(label,value,warning)=>{if(!value)return;const wrap=document.createElement('div');wrap.className='connection-import-result-note';if(warning)wrap.classList.add('warning');const heading=ciText('span',label+': ');heading.className='connection-import-detail-label';wrap.append(heading,ciText('span',value));ci('Details').append(wrap);};
    note('Reason',item.reason,item.status==='Failed');
    if(item.warnings?.length)note('Warnings',item.warnings.join(' · '),true);
  }
  function ciRenderResult(result){
    ciClosePicker();ciSetReviewLayout(true);ci('Content').parentElement.classList.add('connection-import-result-layout');
    ci('Content').replaceChildren();ci('Details').replaceChildren();
    const summary=ciText('div',result.imported+' imported · '+result.skipped+' skipped · '+result.failed+' failed   |   '+result.credentials+' credentials imported · '+result.warnings+' connections with warnings');
    summary.className='connection-import-result-summary';ci('Content').append(summary);
    const entries=Array.isArray(result.entries)?result.entries:[];
    const body=ciTable(['Connection','Result','Details']);body.parentElement.classList.add('connection-import-result-table');
    const tableScroll=document.createElement('div');tableScroll.className='connection-import-result-table-scroll';
    tableScroll.append(body.parentElement);ci('Content').append(tableScroll);
    let selected;
    for(const item of entries){
      const row=document.createElement('tr');row.className='connection-import-result-row';row.tabIndex=0;
      const reason=item.status==='Skipped'||item.status==='Failed'?item.reason:item.warnings?.length?item.warnings.length+' warning(s)':item.reason;
      for(const value of [item.name,item.status,reason]){const cell=ciText('td',value||'—');cell.className='connection-import-review-value';row.append(cell);}
      row.cells[1].classList.add(item.status==='Failed'?'connection-import-result-failed':item.status==='Imported'?'connection-import-result-imported':'connection-import-result-skipped');
      const show=()=>{selected?.classList.remove('selected');row.classList.add('selected');selected=row;ciRenderResultDetails(item);};
      row.addEventListener('click',show);row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();show();}});
      body.append(row);if(!selected)show();
    }
    if(!entries.length)ci('Details').append(ciText('div','No connections were processed.'));
    ciFeedbackDefault=result.imported+' imported · '+result.skipped+' skipped · '+result.failed+' failed';
    ciSetFeedback(ciFeedbackDefault,'',result.failed>0);
  }
  function receiveConnectionImportState(payload) {
    ciBusy=false;
    if(ciUnlockId) {
      ci('UnlockPassword').value='';hideTemporaryPassword(ci('UnlockPassword'));
      ci('UnlockSubmit').disabled=false;ci('UnlockCancel').disabled=false;ci('UnlockSkipAll').disabled=false;
      if(payload.error){
        const msg='Unable to unlock. Check the password and try again.';
        ci('UnlockFeedback').textContent=msg;
        ciControls();ci('UnlockPassword').focus();return;
      }
      if(Array.isArray(payload.unlocked)){
        const selectedId=ciUnlockId, batch=ciBatchUnlock, unlocked=new Set(payload.unlocked);
        const stillLocked=new Set(payload.stillLocked||[]);
        for(const c of ciCandidates){if(unlocked.has(c.id)){
          c.canUnlock=stillLocked.has(c.id);c.unlocked=!c.canUnlock;c.credentials=c.canUnlock?'Partially unlocked':'Unlocked';
          c.warnings=c.warnings.filter(w=>!/^Protected\\b/.test(w));
          c.status=c.reason?'Unsupported':c.conflicts.length||c.duplicate?'Conflict':c.warnings.length?'Warning':'Ready';
        }}
        const focus=ciUnlockReturnFocus;
        ciHideUnlock();ciRenderReview();
        if(batch){ciUnlockNext();return;}
        const row=ci('Content').querySelector('tr[data-candidate-id="'+selectedId+'"]');
        if(row)row.focus();else if(focus&&document.contains(focus))focus.focus();
      }
      if(Array.isArray(payload.skippedUnlockGroup)){
        for(const id of payload.skippedUnlockGroup)ciBatchSkippedGroups.add(id);
        ciHideUnlock();ciUnlockNext();return;
      }
    }
    const ciResponseError=payload.error || '';
    if(payload.sources) { ciSources=payload.sources; for(const s of ciSources) if(s.status==='Loaded manually')ciSourceChoices.set(s.id,s.count>0); }
    if(payload.stage) ciStage=payload.stage;
    ci('Step').textContent=ciStage==='sources'?'Sources':ciStage==='review'?'Review Import':'Import Result';
    if(ciStage==='sources') ciRenderSources();
    if(payload.candidates) {ciCandidates=payload.candidates;ciRenderReview();}
    if(payload.result)ciRenderResult(payload.result);
    if(ciResponseError)ciSetFeedback(ciResponseError,ciResponseError,true);
    ciControls(); if(!ciUnlockId)ci('Cancel').focus();
  }
  document.getElementById('connectionImportMenuWrap').addEventListener('mouseenter', () => { positionConnectionManagementMenu(document.getElementById('connectionImportMenu'), manageProfilesImportButton, true); manageProfilesImportButton.setAttribute('aria-expanded', 'true'); });
  connectionManagementItems().filter(item => item !== manageProfilesImportButton).forEach(item => item.addEventListener('mouseenter', ciCloseMenu));
  document.getElementById('connectionImportOpen').addEventListener('click',ciOpen);
  document.getElementById('connectionImportBackup').addEventListener('click',()=>{closeConnectionManagementMenu(true);vscode.postMessage({type:'requestImportConnectionsSettings'});});
  document.addEventListener('click',e=>{if(!document.getElementById('connectionImportMenuWrap').contains(e.target)&&!connectionImportMenu.contains(e.target))ciCloseMenu();if(ciOpenPicker&&!ciOpenPicker.menu.contains(e.target)&&!ciOpenPicker.wrapper.contains(e.target))ciClosePicker();});
  window.addEventListener('resize',()=>ciClosePicker());
  document.addEventListener('scroll',e=>{if(ciOpenPicker&&!ciOpenPicker.menu.contains(e.target))ciClosePicker();},true);
  document.getElementById('connectionImportMenu').addEventListener('keydown',e=>{const items=Array.from(document.getElementById('connectionImportMenu').querySelectorAll('button'));const index=items.indexOf(document.activeElement);if(e.key==='Escape'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();ciCloseMenu();manageProfilesImportButton.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next]?.focus();}});
  bindTemporaryPasswordReveal(ci('UnlockReveal'),ci('UnlockPassword'));
  ci('UnlockCancel').addEventListener('click',ciSkipUnlock);
  ci('UnlockSkipAll').addEventListener('click',ciSkipAllUnlock);
  ci('UnlockSubmit').addEventListener('click',()=>{if(ciBusy)return;const password=ci('UnlockPassword').value;ci('UnlockPassword').value='';hideTemporaryPassword(ci('UnlockPassword'));ci('UnlockSubmit').disabled=true;ci('UnlockCancel').disabled=true;ci('UnlockSkipAll').disabled=true;ciSend({action:'unlock',id:ciUnlockId,password,batch:ciBatchUnlock});});
  ci('UnlockPassword').addEventListener('keydown',e=>{if(e.key==='Enter'&&!ciBusy){e.preventDefault();ci('UnlockSubmit').click();}});
  ci('Cancel').addEventListener('click',ciClose);
  ci('Back').addEventListener('click',()=>{if(ciBusy)return;ciStage='sources';ci('Step').textContent='Sources';ciRenderSources();ciControls();});
  ci('Next').addEventListener('click',()=>{if(ciBusy)return;if(ciStage==='sources')ciSend({action:'review',sources:ciSources.filter(s=>ciSourceChoices.get(s.id)).map(s=>s.id)});else ciStartImport();});
  ci('ConfirmBack').addEventListener('click',()=>{const focus=ciConfirmReturnFocus;ciPendingDeselectId='';ciHideConfirmation();if(focus&&document.contains(focus))focus.focus();else ci('Next').focus();});
  ci('ConfirmProceed').addEventListener('click',()=>{if(ciConfirmMode==='jump'){ciHideConfirmation();ciCompleteJumpDeselect();ciPendingDeselectId='';}else ciImportNow(true);});
  ci('ConfirmUnlock').addEventListener('click',()=>{if(ciConfirmMode!=='credentials')return;ciHideConfirmation();ciBatchUnlock=true;ciBatchSkippedGroups.clear();ciUnlockNext();});
  document.addEventListener('keydown',e=>{if(!ci('Backdrop').classList.contains('visible'))return;if(e.key==='Escape'||e.key==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();if(ciOpenPicker)ciClosePicker(true);else if(ciUnlockId)ciDismissUnlock();else if(ci('ConfirmBackdrop').classList.contains('visible'))ci('ConfirmBack').click();else ciClose();}if(e.key==='Tab'&&!ciOpenPicker){e.stopImmediatePropagation();const focusable=Array.from((ciUnlockId?ci('UnlockBackdrop'):ci('ConfirmBackdrop').classList.contains('visible')?ci('ConfirmBackdrop'):ci('Backdrop')).querySelectorAll('button:not(:disabled):not([hidden]),input:not(:disabled),tr[tabindex]')).filter(item=>item.getClientRects().length);const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},true);
`; }
