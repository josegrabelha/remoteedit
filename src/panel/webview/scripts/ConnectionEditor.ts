/** The editor copies the existing connection markup and uses the shared controls,
 * validation and profile persistence, without changing the main form's selection. */
export function renderConnectionEditor(): string {
  return `
  let connectionEditorProfile = null, connectionEditorInitial = '', connectionEditorSaving = false, connectionEditorKeptDraft = false;
  let connectionEditorCloseAfterDiscard = false, connectionEditorScroll = 0;
  const editElement = id => document.getElementById('edit_' + id);
  const connectionEditor = document.getElementById('manageConnectionEditor');
  const connectionListPage = document.getElementById('manageProfilesListPage');
  const connectionEditBack = document.getElementById('manageConnectionBack');
  const connectionEditSave = document.getElementById('manageConnectionSave');

  function connectionEditorPayload() {
    const value = id => editElement(id).value;
    const checked = id => editElement(id).checked;
    const type = normalizeConnectionTypeValue(value('connectionType'));
    const auth = type === 'sftp' ? value('authType') : 'password';
    const source = auth === 'password' ? editElement('passwordSourcePicker').dataset.source : 'connection';
    return {
      id: connectionEditorProfile.id, name: value('name'), groupId: value('groupId'),
      host: value('host'), port: value('port'), connectionType: type, keepAlive: checked('keepAlive'),
      username: value('username'), proxyProfileId: value('proxyProfileId'),
      jumpProfileId: type === 'sftp' ? value('jumpProfileId') : '', authType: auth,
      passwordSource: source, password: source === 'master' ? '' : (value('password') === SAVED_SECRET_MASK ? '' : value('password')),
      rememberPassword: source !== 'master' && checked('rememberPassword'),
      privateKeyPath: value('privateKeyPath'), passphrase: value('passphrase') === SAVED_SECRET_MASK ? '' : value('passphrase'),
      rememberPassphrase: checked('rememberPassphrase'), startPath: value('startPath'),
      ftpsAllowSelfSignedCertificate: checked('ftpsAllowSelfSignedCertificate'),
      ftpsCaCertificatePath: value('ftpsCaCertificatePath')
    };
  }

  function showConnectionEditor(profile) {
    if (connectionEditorSaving) return;
    connectionEditorProfile = profile;
    connectionEditorKeptDraft = false;
    connectionEditorScroll = manageProfilesList.scrollTop;
    connectionEditor.replaceChildren();
    const grid = document.querySelector('.connection-details-scroll .form-grid').cloneNode(true);
    // The existing custom pickers are replaced by the same shared combobox used
    // by Proxy Profiles. Keep native option values and the original field markup.
    grid.querySelectorAll('.connection-type-picker,.jump-profile-picker,.auth-picker:not(.password-source-picker),.profile-picker').forEach(node => node.remove());
    grid.querySelectorAll('[id]').forEach(node => { node.id = 'edit_' + node.id; });
    grid.querySelectorAll('[for]').forEach(node => { node.htmlFor = 'edit_' + node.htmlFor; });
    grid.querySelectorAll('input,button,select').forEach(node => { node.disabled = false; node.classList.remove('connection-input-invalid'); node.removeAttribute('aria-invalid'); });
    const makeField = (id, labelText, tag) => {
      const row = document.createElement('div'); row.className = 'full';
      const label = document.createElement('label'); label.htmlFor = 'edit_' + id; label.textContent = labelText;
      const input = document.createElement(tag); input.id = 'edit_' + id; input.setAttribute('aria-label', labelText);
      row.append(label, input); return row;
    };
    const nameRow = makeField('name', 'Profile', 'input');
    const groupRow = makeField('groupId', 'Group', 'select');
    groupRow.querySelector('select').add(new Option('No Group', ''));
    getSortedConnectionGroups().forEach(group => groupRow.querySelector('select').add(new Option(group.name, group.id)));
    // Keep labels associated with the native select behind each shared picker.
    for (const [labelFor, selectId] of [['connectionTypeDropdownButton','connectionType'],['authDropdownButton','authType'],['jumpProfileDropdownButton','jumpProfileId']]) {
      const label = grid.querySelector('label[for="edit_' + labelFor + '"]');
      if (label) label.htmlFor = 'edit_' + selectId;
    }
    const feedback = document.createElement('div'); feedback.id = 'edit_feedback'; feedback.className = 'manage-profiles-feedback'; feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite');
    const identity = document.createElement('div'); identity.className = 'form-grid'; identity.append(nameRow,groupRow);
    const divider = document.createElement('div'); divider.className = 'connection-panel-divider';
    const title = document.createElement('div'); title.className = 'connection-details-title'; title.textContent = 'Connection details';
    connectionEditor.append(feedback,identity,divider,title,grid);
    for (const id of ['host','username','privateKeyPath','startPath','ftpsCaCertificatePath']) editElement(id).value = profile[id] || '';
    editElement('name').value = profile.name || '';
    editElement('groupId').value = profile.groupId || '';
    editElement('port').value = profile.port || getDefaultPortForConnectionType(profile.connectionType);
    editElement('connectionType').value = normalizeConnectionTypeValue(profile.connectionType);
    editElement('authType').value = profile.authType || 'password';
    editElement('passwordSourcePicker').dataset.source = profile.passwordSource === 'master' ? 'master' : 'connection';
    editElement('keepAlive').checked = profile.keepAlive !== false;
    editElement('ftpsAllowSelfSignedCertificate').checked = Boolean(profile.ftpsAllowSelfSignedCertificate);
    for (const [id, saved] of [['password',profile.hasSavedPassword],['passphrase',profile.hasSavedPassphrase]]) {
      editElement(id).value = saved ? SAVED_SECRET_MASK : ''; editElement(id).type = 'password';
      editElement(id).placeholder = saved ? (id === 'password' ? 'Saved password' : 'Saved passphrase') : '';
      editElement(id).classList.remove('hidden');
      editElement(id === 'password' ? 'rememberPassword' : 'rememberPassphrase').checked = Boolean(saved);
      const state = editElement(id + 'SecretState'); const label = id === 'password' ? 'Password' : 'Passphrase';
      state.textContent = saved ? label + ' saved in VS Code SecretStorage.' : label + ' not saved.';
      state.classList.toggle('saved', saved);
      state.classList.toggle('not-saved', !saved);
      bindTemporaryPasswordReveal(editElement(id + 'RevealButton'), editElement(id));
      editElement(id).addEventListener('input', () => updateConnectionCredentialRevealButton(editElement(id + 'RevealButton'), editElement(id)));
    }
    const proxy = editElement('proxyProfileId'); proxy.replaceChildren(new Option('No Proxy',''));
    proxyProfiles.forEach(item => proxy.add(new Option(item.name,item.id)));
    if (profile.proxyProfileId && !proxyProfiles.some(item => item.id === profile.proxyProfileId)) proxy.add(new Option('Unavailable Proxy',profile.proxyProfileId));
    proxy.value = profile.proxyProfileId || '';
    const jump = editElement('jumpProfileId'); jump.replaceChildren(new Option('Direct',''));
    profiles.filter(item => analyzeJumpProfileCandidate(item.id,profile.id).valid).forEach(item => jump.add(new Option(item.name,item.id)));
    if (profile.jumpProfileId && ![...jump.options].some(item => item.value === profile.jumpProfileId)) jump.add(new Option('Unavailable Jump Host',profile.jumpProfileId));
    jump.value = profile.jumpProfileId || '';
    connectionEditor.querySelectorAll('select').forEach(select => {
      select.dataset.proxy = ''; select.setAttribute('aria-label', select.closest('div').querySelector('label')?.textContent || 'Select');
      if (['edit_connectionType','edit_authType','edit_passwordSource'].includes(select.id)) select.dataset.filter = 'false';
    });
    editElement('connectionType').onchange = () => {
      const previous = connectionEditor.dataset.type;
      const next = editElement('connectionType').value;
      if (Number(editElement('port').value) === getDefaultPortForConnectionType(previous)) editElement('port').value = getDefaultPortForConnectionType(next);
      updateConnectionEditorFields();
    };
    for (const id of ['authType','ftpsAllowSelfSignedCertificate','jumpProfileId']) editElement(id).onchange = updateConnectionEditorFields;
    const sourcePicker = editElement('passwordSourcePicker');
    const sourceButton = editElement('passwordSourceButton');
    const closeSource = () => { sourcePicker.classList.remove('open'); sourceButton.setAttribute('aria-expanded','false'); };
    const toggleSource = () => {
      const open = !sourcePicker.classList.contains('open');
      sourcePicker.classList.toggle('open',open); sourceButton.setAttribute('aria-expanded',String(open));
      if (open) sourcePicker.querySelector('[data-password-source="' + sourcePicker.dataset.source + '"]').focus();
    };
    sourceButton.onclick = toggleSource;
    editElement('masterPasswordSelection').onclick = toggleSource;
    sourcePicker.querySelectorAll('[data-password-source]').forEach(option => {
      option.onclick = () => {
        sourcePicker.dataset.source = option.dataset.passwordSource; closeSource(); updateConnectionEditorFields();
        if (sourcePicker.dataset.source === 'master' && !masterPasswordState.configured) openMasterPasswordDialog();
        else sourceButton.focus();
      };
    });
    sourcePicker.onkeydown = event => {
      if (event.key === 'Escape') {
        closeSource(); sourceButton.focus(); event.stopPropagation(); event.preventDefault();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        const options = Array.from(sourcePicker.querySelectorAll('[data-password-source]'));
        if (!sourcePicker.classList.contains('open')) toggleSource();
        else options[(options.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus();
      } else if (event.key === 'Tab') closeSource();
    };
    for (const [id,remember] of [['password','rememberPassword'],['passphrase','rememberPassphrase']]) {
      editElement(remember).onchange = () => {
        if (!editElement(remember).checked) {
          editElement(id).placeholder = '';
          if (editElement(id).value === SAVED_SECRET_MASK) editElement(id).value = '';
        }
        updateConnectionCredentialRevealButton(editElement(id + 'RevealButton'),editElement(id));
      };
    }
    for (const [button,field,type] of [['privateKeyBrowseButton','privateKeyPath','pickPrivateKeyPath'],['ftpsCaCertificateBrowseButton','ftpsCaCertificatePath','pickCaCertificatePath']]) {
      editElement(button).onclick = () => {
        vscode.postMessage({type,payload:{editorProfileId:profile.id}});
      };
    }
    editElement('configureMasterPasswordInline').onclick = openMasterPasswordDialog;
    connectionEditor.querySelectorAll('input').forEach(input => input.addEventListener('input', () => input.classList.remove('connection-input-invalid')));
    connectionListPage.hidden = true; connectionEditor.hidden = false;
    connectionEditBack.hidden = false; connectionEditSave.hidden = false; manageProfilesCloseButton.hidden = true;
    document.getElementById('manageProfilesTitle').textContent = 'Edit Connection';
    manageProfilesBackdrop.querySelector('.file-properties-path').textContent = profile.name || '';
    updateConnectionEditorFields();
    connectionEditorInitial = JSON.stringify(connectionEditorPayload());
    connectionEditor.scrollTop = 0;
    editElement('name').focus();
  }

  function updateConnectionEditorFields() {
    if (!connectionEditorProfile) return;
    const type = editElement('connectionType').value;
    const sftp = type === 'sftp', key = sftp && editElement('authType').value === 'privateKey';
    const master = !key && editElement('passwordSourcePicker').dataset.source === 'master';
    connectionEditor.dataset.type = type;
    const display = (id,visible) => { const node = editElement(id); node.classList.remove('hidden'); node.style.display = visible ? '' : 'none'; if (node.classList.contains('auth-block') || node.classList.contains('ftps-certificate-block')) node.classList.toggle('visible',visible); };
    display('authMethodBlock',sftp); display('jumpProfileBlock',sftp);
    display('passwordBlock',!key); display('privateKeyBlock',key); display('passphraseBlock',key);
    display('ftpsCertificateBlock',type === 'ftps');
    display('ftpsCaCertificateBlock',!editElement('ftpsAllowSelfSignedCertificate').checked);
    display('password',!master); display('masterPasswordSelection',master); display('passwordRevealButton',!master);
    editElement('passwordSourcePicker').querySelectorAll('[data-password-source]').forEach(option => {
      const selected = option.dataset.passwordSource === editElement('passwordSourcePicker').dataset.source;
      option.classList.toggle('selected',selected); option.setAttribute('aria-selected',String(selected));
    });
    display('rememberPasswordRow',!master); display('passwordSecretState',!master); display('masterPasswordHint',master);
    editElement('masterPasswordHintText').textContent = masterPasswordState.configured ? 'Master Password configured.' : 'Master Password is not configured.';
    display('configureMasterPasswordInline',!masterPasswordState.configured);
    const analysis = analyzeJumpProfileCandidate(editElement('jumpProfileId').value, connectionEditorProfile.id);
    editElement('jumpRouteSummary').textContent = analysis.valid ? 'Route: ' + (analysis.profiles.map(item => item.name).concat(connectionEditorProfile.name).join(' → ')) : 'Unavailable Jump Host';
    hideTemporaryPassword(editElement('password')); hideTemporaryPassword(editElement('passphrase'));
    updateConnectionCredentialRevealButton(editElement('passwordRevealButton'),editElement('password'));
    updateConnectionCredentialRevealButton(editElement('passphraseRevealButton'),editElement('passphrase'));
    window.RemoteEditControls.refresh();
  }

  function receiveConnectionEditorPath(field, payload) {
    if (!payload.editorProfileId) return false;
    if (connectionEditorProfile?.id === payload.editorProfileId && payload.path) { editElement(field).value = payload.path; editElement(field).classList.remove('connection-input-invalid'); }
    return true;
  }

  function leaveConnectionEditor(closeDialog) {
    if (!connectionEditorProfile || connectionEditorSaving) return;
    window.RemoteEditControls.closeCombo();
    if (JSON.stringify(connectionEditorPayload()) !== connectionEditorInitial) {
      connectionEditorCloseAfterDiscard = closeDialog;
      showConfirmDialog({requestId:'client:connectionEditorDiscard',title:'Discard changes?',message:'The connection has unsaved changes.',confirmLabel:'Discard',cancelLabel:'Back',danger:true});
      return;
    }
    finishConnectionEditor(closeDialog);
  }

  function finishConnectionEditor(closeDialog) {
    window.RemoteEditControls.closeCombo();
    const id = connectionEditorProfile?.id;
    connectionEditorProfile = null; connectionEditorInitial = '';
    connectionEditor.replaceChildren(); connectionEditor.hidden = true; connectionListPage.hidden = false;
    connectionEditBack.hidden = true; connectionEditSave.hidden = true; manageProfilesCloseButton.hidden = false;
    document.getElementById('manageProfilesTitle').textContent = 'Manage Connections';
    manageProfilesBackdrop.querySelector('.file-properties-path').textContent = 'Clone, edit, reorder, or remove saved connection profiles.';
    renderManageProfilesList(); manageProfilesList.scrollTop = connectionEditorScroll;
    window.RemoteEditControls.refresh();
    if (closeDialog) hideManageProfilesDialog();
    else (Array.from(manageProfilesList.querySelectorAll('[data-profile-id]')).find(row => row.dataset.profileId === id)?.querySelector('[data-manage-action="edit"]') || manageProfilesCloseButton).focus();
  }

  function receiveConnectionEditResult(payload) {
    if (!connectionEditorProfile || payload.id !== connectionEditorProfile.id) return;
    connectionEditorSaving = false; connectionEditBack.disabled = false; connectionEditSave.disabled = false; connectionEditor.inert = false;
    if (payload.saved) {
      finishConnectionEditor(false);
      if (connectionEditorKeptDraft) showManageProfilesFeedback('Connection saved. Unsaved changes in Connections were kept.', false);
    }
    else { editElement('feedback').textContent = payload.error || 'Unable to save connection.'; editElement('feedback').classList.add('error'); connectionEditor.scrollTop = 0; }
  }

  document.addEventListener('click', event => {
    const picker = editElement('passwordSourcePicker');
    if (picker && !picker.contains(event.target)) { picker.classList.remove('open'); editElement('passwordSourceButton').setAttribute('aria-expanded','false'); }
  });
  window.addEventListener('message', event => { if (event.data.type === 'masterPasswordState' && connectionEditorProfile) updateConnectionEditorFields(); });
  manageProfilesBackdrop.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !connectionEditorProfile || confirmDialogOpen || masterPasswordMode || document.querySelector('.sync-combo-menu[data-for^=edit_],#edit_passwordSourcePicker.open')) return;
    const items = Array.from(manageProfilesBackdrop.querySelectorAll('input:not(:disabled),button:not(:disabled),[tabindex="0"]')).filter(node => node.getClientRects().length && !node.closest('[hidden]'));
    if (!items.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  });

  connectionEditBack.onclick = () => leaveConnectionEditor(false);
  connectionEditSave.onclick = () => {
    if (!connectionEditorProfile || connectionEditorSaving) return;
    const fields = {};
    for (const id of ['host','port','username','connectionType','authType','ftpsAllowSelfSignedCertificate','ftpsCaCertificatePath','privateKeyPath','password']) fields[id] = editElement(id);
    fields.passwordSource = editElement('passwordSourcePicker').dataset.source;
    fields.passwordSourceButton = editElement('passwordSourceButton'); fields.jumpProfileDropdownButton = editElement('jumpProfileId');
    fields.getJumpProfileSelectionError = () => analyzeJumpProfileCandidate(editElement('jumpProfileId').value,connectionEditorProfile.id).valid ? '' : 'The selected Jump Host is unavailable or creates a circular chain.';
    const errors = getConnectionValidationErrors('save',fields);
    const nameError = getConnectionNameError(editElement('name').value,connectionEditorProfile.id);
    if (nameError) errors.unshift({field:editElement('name'),message:nameError});
    if (editElement('proxyProfileId').value && !proxyProfiles.some(item => item.id === editElement('proxyProfileId').value)) errors.push({field:editElement('proxyProfileId'),message:'Selected proxy profile is unavailable.'});
    connectionEditor.querySelectorAll('.connection-input-invalid').forEach(node => node.classList.remove('connection-input-invalid'));
    editElement('feedback').textContent = errors.map(error => error.message).join(' ');
    editElement('feedback').classList.toggle('error',Boolean(errors.length));
    if (errors.length) {
      errors.forEach(error => {error.field.classList.add('connection-input-invalid'); error.field.nextElementSibling?.querySelector('button')?.classList.add('connection-input-invalid');});
      const field = errors[0].field; (field.tagName === 'SELECT' ? field.nextElementSibling?.querySelector('button') : field)?.focus();
      field.parentElement.scrollIntoView({block:'nearest'}); return;
    }
    connectionEditorSaving = true; connectionEditBack.disabled = true; connectionEditSave.disabled = true; connectionEditor.inert = true;
    window.RemoteEditControls.closeCombo();
    vscode.postMessage({type:'saveConnection',payload:{...connectionEditorPayload(),editorSave:true}});
  };
`;
}
