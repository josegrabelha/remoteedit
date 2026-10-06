export function renderMasterPassword(): string {
  return `
  function masterElement(id) { return document.getElementById(id); }
  function closePasswordSourceMenu() {
    passwordSourcePicker.classList.remove('open');
    passwordSourceButton.setAttribute('aria-expanded', 'false');
  }
  function togglePasswordSourceMenu() {
    if (passwordSourceButton.disabled) return;
    const open = !passwordSourcePicker.classList.contains('open');
    passwordSourcePicker.classList.toggle('open', open);
    passwordSourceButton.setAttribute('aria-expanded', String(open));
    if (open) passwordSourcePicker.querySelector('[data-password-source="' + passwordSource + '"]').focus();
  }
  function updatePasswordSourceUI() {
    const master = passwordSource === 'master';
    password.classList.toggle('hidden', master);
    masterElement('masterPasswordSelection').classList.toggle('hidden', !master);
    masterElement('rememberPasswordRow').classList.toggle('hidden', master);
    passwordSecretState.classList.toggle('hidden', master);
    masterElement('masterPasswordHint').classList.toggle('hidden', !master);
    masterElement('masterPasswordHintText').textContent = masterPasswordState.configured
      ? 'Master Password configured.' : 'Master Password is not configured.';
    masterElement('configureMasterPasswordInline').classList.toggle('hidden', masterPasswordState.configured);
    if (master) { hideTemporaryPassword(password); passwordRevealButton.style.display = 'none'; }
    else updateConnectionCredentialRevealControls();
    passwordSourcePicker.querySelectorAll('[data-password-source]').forEach(option => {
      const selected = option.dataset.passwordSource === passwordSource;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
  }
  function receiveMasterPasswordState(payload) {
    if (typeof payload.configured === 'boolean') {
      masterPasswordState = { configured: payload.configured, usedBy: Number(payload.usedBy || 0) };
      masterElement('masterPasswordSummary').textContent = (payload.configured ? 'Configured' : 'Not configured')
        + ' · Used by ' + masterPasswordState.usedBy + ' connections';
      masterElement('manageMasterPasswordButton').textContent = payload.configured ? 'Manage' : 'Configure...';
      updatePasswordSourceUI();
    }
    if (payload.error || payload.completed) {
      masterPasswordBusy = false;
      if (payload.completed) closeMasterPasswordDialog();
      else { renderMasterPasswordDialog(); masterElement('masterPasswordFeedback').textContent = payload.error; }
    }
    setControls();
  }
  function clearMasterPasswordFields() {
    for (const id of ['masterPasswordNew', 'masterPasswordConfirm']) {
      masterElement(id).value = ''; hideTemporaryPassword(masterElement(id));
    }
  }
  function openMasterPasswordDialog() {
    closePasswordSourceMenu();
    masterPasswordReturnFocus = document.activeElement;
    masterPasswordMode = masterPasswordState.configured ? 'manage' : 'configure';
    clearMasterPasswordFields(); renderMasterPasswordDialog();
    masterPasswordBackdrop.classList.add('visible');
    masterPasswordBackdrop.setAttribute('aria-hidden', 'false');
    focusMasterPasswordDialog();
    vscode.postMessage({ type: 'masterPassword', payload: { action: 'state' } });
  }
  function closeMasterPasswordDialog() {
    if (masterPasswordBusy) return;
    clearMasterPasswordFields(); masterPasswordMode = '';
    masterPasswordBackdrop.classList.remove('visible');
    masterPasswordBackdrop.setAttribute('aria-hidden', 'true');
    if (masterPasswordReturnFocus && !masterPasswordReturnFocus.disabled) masterPasswordReturnFocus.focus();
  }
  function focusMasterPasswordDialog() {
    masterElement(masterPasswordMode === 'manage' ? 'masterPasswordChange'
      : masterPasswordMode === 'remove' ? 'masterPasswordCancel' : 'masterPasswordNew').focus();
  }
  function renderMasterPasswordDialog() {
    const editing = masterPasswordMode === 'configure' || masterPasswordMode === 'change';
    const removing = masterPasswordMode === 'remove';
    masterElement('masterPasswordTitle').textContent = removing ? 'Remove Master Password?'
      : masterPasswordMode === 'change' ? 'Change Master Password'
      : editing ? 'Configure Master Password' : 'Master Password';
    masterElement('masterPasswordStatus').textContent = (masterPasswordState.configured ? 'Configured' : 'Not configured')
      + ' · Used by ' + masterPasswordState.usedBy + ' saved connections';
    masterElement('masterPasswordFields').classList.toggle('hidden', !editing);
    masterElement('masterPasswordActions').classList.toggle('hidden', masterPasswordMode !== 'manage');
    masterElement('masterPasswordNewLabel').textContent = masterPasswordMode === 'change' ? 'New Master Password' : 'Master Password';
    masterElement('masterPasswordImpact').textContent = removing
      ? 'Removing it will not remove or modify these connections. They will require a configured Master Password or a different password source before connecting again.'
      : masterPasswordMode === 'change'
        ? 'The new password will be used by all ' + masterPasswordState.usedBy + ' connections using Master Password on their next connection.'
        : 'Use one password across multiple password-authenticated connections.';
    masterElement('masterPasswordCancel').textContent = masterPasswordMode === 'manage' ? 'Close' : 'Cancel';
    masterElement('masterPasswordSave').classList.toggle('hidden', masterPasswordMode === 'manage');
    masterElement('masterPasswordSave').textContent = removing ? 'Remove' : masterPasswordMode === 'change' ? 'Change' : 'Save';
    masterElement('masterPasswordFeedback').textContent = '';
    masterPasswordBackdrop.querySelectorAll('button, input').forEach(element => { element.disabled = masterPasswordBusy; });
  }
  function submitMasterPassword() {
    if (masterPasswordBusy || masterPasswordMode === 'manage' || !masterPasswordMode) return;
    const value = masterElement('masterPasswordNew').value;
    const confirmation = masterElement('masterPasswordConfirm').value;
    if (masterPasswordMode !== 'remove' && (!value || value !== confirmation)) {
      masterElement('masterPasswordFeedback').textContent = !value ? 'Master Password is required.' : 'Passwords do not match.';
      masterElement(!value ? 'masterPasswordNew' : 'masterPasswordConfirm').focus(); return;
    }
    const payload = masterPasswordMode === 'remove' ? { action: 'remove' } : { action: 'save', password: value, confirmation };
    masterPasswordBusy = true; renderMasterPasswordDialog();
    vscode.postMessage({ type: 'masterPassword', payload }); clearMasterPasswordFields();
  }
  passwordSourceButton.addEventListener('click', togglePasswordSourceMenu);
  masterElement('masterPasswordSelection').addEventListener('click', togglePasswordSourceMenu);
  passwordSourcePicker.querySelectorAll('[data-password-source]').forEach(option => {
    option.addEventListener('click', () => {
      if (passwordSourceButton.disabled) return;
      passwordSource = option.dataset.passwordSource; closePasswordSourceMenu();
      clearConnectionValidationErrors(); updatePasswordSourceUI(); setControls();
      if (passwordSource === 'master' && !masterPasswordState.configured) openMasterPasswordDialog();
      else passwordSourceButton.focus();
    });
  });
  passwordSourcePicker.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closePasswordSourceMenu(); passwordSourceButton.focus(); event.stopPropagation(); event.preventDefault();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      const options = Array.from(passwordSourcePicker.querySelectorAll('[data-password-source]'));
      if (!passwordSourcePicker.classList.contains('open')) togglePasswordSourceMenu();
      else options[(options.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus();
    } else if (event.key === 'Tab') closePasswordSourceMenu();
  });
  document.addEventListener('click', event => { if (!passwordSourcePicker.contains(event.target)) closePasswordSourceMenu(); });
  masterElement('manageMasterPasswordButton').addEventListener('click', openMasterPasswordDialog);
  masterElement('configureMasterPasswordInline').addEventListener('click', openMasterPasswordDialog);
  masterElement('masterPasswordChange').addEventListener('click', () => {
    masterPasswordMode = 'change'; clearMasterPasswordFields(); renderMasterPasswordDialog(); focusMasterPasswordDialog();
  });
  masterElement('masterPasswordRemove').addEventListener('click', () => {
    masterPasswordMode = 'remove'; renderMasterPasswordDialog(); focusMasterPasswordDialog();
  });
  masterElement('masterPasswordCancel').addEventListener('click', closeMasterPasswordDialog);
  masterElement('masterPasswordSave').addEventListener('click', submitMasterPassword);
  for (const id of ['masterPasswordNew', 'masterPasswordConfirm']) bindTemporaryPasswordReveal(masterElement(id + 'Reveal'), masterElement(id));
  function trapMasterPasswordFocus(event) {
    if (!masterPasswordMode || event.key !== 'Tab') return;
    const controls = Array.from(masterPasswordBackdrop.querySelectorAll('button, input'))
      .filter(element => !element.disabled && element.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  masterPasswordBackdrop.addEventListener('keydown', trapMasterPasswordFocus);
`;
}
