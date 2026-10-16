export function renderSshKeyToolsMarkup(): string { return `
<div id="sshKeyToolsBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="sshKeyToolsTitle" aria-hidden="true">
<section class="file-properties-dialog ssh-key-dialog">
<div class="file-properties-header"><h2 id="sshKeyToolsTitle" class="file-properties-title">SSH Key Tools</h2><div id="sshKeySubtitle" class="file-properties-path">Generate, inspect and deploy SSH authentication keys.</div></div>
<div class="file-properties-body">
<div id="sshKey_home" class="ssh-key-page"><div class="ssh-key-home-item"><div><strong>Generate SSH Key</strong><p>Create a new SSH key pair on this computer.</p></div><button id="sshKeyGenerate">Generate SSH Key</button></div><div class="ssh-key-home-item"><div><strong>Inspect SSH Key</strong><p>View details of an existing SSH key.</p></div><button id="sshKeyInspect">Inspect SSH Key</button></div><div class="ssh-key-home-item"><div><strong>Deploy Public Key</strong><p>Install a public key on a remote SSH server.</p></div><button id="sshKeyDeploy">Deploy Public Key</button></div></div>
<div id="sshKey_generate" class="ssh-key-page" hidden><div class="ssh-key-grid"><div><label for="sshKeyType">Key Type</label><select id="sshKeyType" data-proxy data-filter="false"><option value="ed25519">ED25519 (Recommended)</option><option value="rsa">RSA</option><option value="ecdsa">ECDSA</option></select></div><div id="sshKeyBitsBlock" hidden><label for="sshKeyBits">Key Size</label><select id="sshKeyBits" data-proxy data-filter="false"></select></div><div class="full"><label for="sshKeyLocation">Save Location (Private Key)</label><div class="input-with-button"><input id="sshKeyLocation" autocomplete="off"/><button id="sshKeySaveBrowse" class="input-icon-button has-tooltip" type="button" aria-label="Choose SSH Key Save Location" data-tooltip="Choose SSH Key Save Location"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div></div><div class="full"><label for="sshKeyComment">Comment (Optional)</label><input id="sshKeyComment" autocomplete="off"/><p class="ssh-key-hint">Used to identify the public key. Does not affect SSH authentication.</p></div><div><label for="sshKeyPassphrase">Passphrase (Optional)</label><input id="sshKeyPassphrase" type="password" autocomplete="new-password"/></div><div><label for="sshKeyConfirm">Confirm Passphrase</label><input id="sshKeyConfirm" type="password" autocomplete="new-password"/></div></div><p class="ssh-key-hint">A passphrase protects your private key. Existing key files are never overwritten.</p></div>
<div id="sshKey_inspect" class="ssh-key-page" hidden><label for="sshKeyInspectPath">SSH Key File</label><div class="input-with-button"><input id="sshKeyInspectPath" autocomplete="off"/><button id="sshKeyInspectBrowse" class="input-icon-button has-tooltip" type="button" aria-label="Select SSH Key File" data-tooltip="Select SSH Key File"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div><label for="sshKeyInspectPassphrase">Private Key Passphrase (If Required)</label><input id="sshKeyInspectPassphrase" type="password" autocomplete="off"/></div>
<div id="sshKey_details" class="ssh-key-page" hidden><div id="sshKeyDetails"></div><p class="ssh-key-hint">The public key must be authorized on the server before it can be used to log in.</p></div>
<div id="sshKey_deploy" class="ssh-key-page" hidden><label for="sshKeyPublicPath">Key File (Public or Private)</label><div class="input-with-button"><input id="sshKeyPublicPath" autocomplete="off"/><button id="sshKeyPublicBrowse" class="input-icon-button has-tooltip" type="button" aria-label="Select Public or Private Key File" data-tooltip="Select Public or Private Key File"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div><div class="credential-state">Only the public key will be installed on the server. If a private key is selected, its public key is extracted locally.</div><div class="ssh-key-access"><strong>Verify SSH Authentication (Optional)</strong><div id="sshKeyTestPrivateBlock"><label for="sshKeyPrivatePath">Matching Private Key</label><div class="input-with-button"><input id="sshKeyPrivatePath" autocomplete="off"/><button id="sshKeyPrivateBrowse" class="input-icon-button has-tooltip" type="button" aria-label="Select Private Key File" data-tooltip="Select Private Key File"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div><div class="credential-state">Used to test SSH authentication after deployment. The private key stays on your computer.</div></div><div id="sshKeyTestHint" class="credential-state" aria-live="polite"></div><div id="sshKeyDeployPassphraseBlock" hidden><label for="sshKeyDeployPassphrase">Private Key Passphrase (If Required)</label><input id="sshKeyDeployPassphrase" type="password" autocomplete="off"/><div class="credential-state">Enter the passphrase protecting the private key, not your server password.</div></div></div><div class="ssh-key-access"><strong>Deployment Target</strong><label for="sshKeyTarget">Target Connection</label><select id="sshKeyTarget" data-proxy data-placement="down"><option value="">Select a saved SFTP connection</option></select><div id="sshKeyRemoteUser" class="credential-state"></div><label for="sshKeyAccessAuth">Authentication</label><select id="sshKeyAccessAuth" data-proxy data-filter="false"><option value="password">Password</option><option value="privateKey">Private Key</option></select><div class="credential-state">Used only for this deployment. Saved connection settings will not be changed.</div><div id="sshKeyAccessPasswordBlock"><label for="sshKeyAccessPassword">Password</label><div id="sshKeyAccessPasswordSourcePicker" class="auth-picker password-source-picker" data-source="connection">
              <div class="input-with-button">
                <button id="sshKeyAccessMasterPasswordSelection" type="button" class="profile-dropdown-button hidden">Master Password</button>
                <input id="sshKeyAccessPassword" type="password" autocomplete="current-password" />
                <button id="sshKeyAccessPasswordReveal" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password" data-tooltip="Hold to Show Password">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                </button>
                <button id="sshKeyAccessPasswordSourceButton" type="button" class="input-icon-button password-source-button" aria-label="Password source" aria-haspopup="listbox" aria-expanded="false"><svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg></button>
              </div>
              <div id="sshKeyAccessPasswordSourceMenu" class="profile-dropdown-menu auth-dropdown-menu" role="listbox" aria-label="Password source">
                <button type="button" class="profile-dropdown-item" role="option" data-password-source="connection"><span class="profile-dropdown-name">Enter Password</span></button>
                <button type="button" class="profile-dropdown-item" role="option" data-password-source="master"><span class="profile-dropdown-name">Master Password</span></button>
              </div>
              </div><div id="sshKeyAccessPasswordState" class="credential-state"></div></div><div id="sshKeyAccessPrivateBlock" hidden><label for="sshKeyAccessPrivatePath">Existing Access Private Key</label><div class="input-with-button"><input id="sshKeyAccessPrivatePath" autocomplete="off"/><button id="sshKeyAccessPrivateBrowse" class="input-icon-button has-tooltip" type="button" aria-label="Select Private Key File" data-tooltip="Select Private Key File"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div><label for="sshKeyAccessPassphrase">Passphrase (If Required)</label><div class="input-with-button"><input id="sshKeyAccessPassphrase" type="password" autocomplete="off"/><button id="sshKeyAccessPassphraseReveal" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Passphrase" data-tooltip="Hold to Show Passphrase"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg></button></div><div id="sshKeyAccessPassphraseState" class="credential-state"></div></div></div></div>
<div id="sshKey_unavailable" class="ssh-key-page" hidden><p>Unable to verify the server's effective SSH configuration.</p><div id="sshKeyUnavailableReason" class="ssh-key-pair"></div><p class="ssh-key-hint">The server may still support public key authentication using standard SSH paths. Remote Edit can inspect common locations and let you choose where to install the public key.</p><p class="ssh-key-hint">No remote files have been modified.</p><button class="secondary" data-ssh-key-manual>Manual Installation</button></div>
<div id="sshKey_destinations" class="ssh-key-page" hidden><div id="sshKeyDestinationContext"></div><div id="sshKeyDestinations"></div><p class="ssh-key-hint">The effective SSH configuration could not be verified. These are conventional OpenSSH locations; installing a key does not guarantee authentication.</p><button class="secondary" data-ssh-key-manual>Manual Installation</button></div>
<div id="sshKey_review" class="ssh-key-page" hidden><div id="sshKeyReview"></div><p class="ssh-key-hint">Existing authorized keys will be preserved. Confirm the destination before deployment.</p><button class="secondary" data-ssh-key-manual>Manual Installation</button></div>
<div id="sshKey_result" class="ssh-key-page" hidden><div id="sshKeyResult"></div><div id="sshKeyAdditional" hidden><p class="ssh-key-hint" id="sshKeyAdditionalHint"></p><button id="sshKeyAdditionalButton">Install in Additional File</button></div><button class="secondary" data-ssh-key-manual>Manual Installation</button></div>
<div id="sshKey_manual" class="ssh-key-page" hidden><p id="sshKeyManualReason"></p><p>Ask your administrator to authorize this public key for the SSH user. Confirm the server's effective AuthorizedKeysFile and preserve its existing entries.</p><p class="ssh-key-hint">POSIX: normally ~/.ssh/authorized_keys with owner-only permissions. Windows OpenSSH: the user file or administrators_authorized_keys, with the required Windows ACLs. Custom paths must be verified by the server administrator.</p><textarea id="sshKeyManualPublic" rows="4" wrap="soft" readonly aria-label="Public Key"></textarea></div>
<div id="sshKey_choose" class="ssh-key-page" hidden><p>How would you like to configure an SSH key?</p><button id="sshKeyChooseExisting" class="secondary">Select Existing Key</button><button id="sshKeyChooseGenerate">Generate SSH Key</button></div>
</div>
<div class="file-properties-actions connection-import-actions"><div id="sshKeyFeedback" class="connection-import-footer-status" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span id="sshKeyFeedbackText"></span></div><button id="sshKeyBack" class="secondary" hidden>Back</button><button id="sshKeyCopy" class="secondary" hidden>Copy Public Key</button><button id="sshKeyNextDeploy" class="secondary" hidden>Deploy Public Key</button><button id="sshKeyUse" class="secondary" hidden>Use This Key</button><button id="sshKeyPrimary" hidden>Continue</button><button id="sshKeyClose" class="secondary">Close</button></div>
</section></div>`; }
export function renderSshKeyToolsStyles(): string { return `
.file-properties-dialog.ssh-key-dialog{resize:none;box-sizing:border-box;width:min(640px,calc(100vw - 48px));height:min(560px,calc(100vh - 48px));max-height:calc(100vh - 48px)}
.ssh-key-dialog .file-properties-header,.ssh-key-dialog .file-properties-actions{flex-shrink:0}
.ssh-key-dialog .file-properties-body{flex:1 1 auto;min-height:0;overflow:auto}
#sshKey_manual:not([hidden]){display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}
#sshKeyManualPublic{flex:1 1 auto;resize:none;min-height:84px;min-width:0;width:100%;max-width:100%;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap}
.ssh-key-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ssh-key-grid .full{grid-column:1/-1}
.ssh-key-page label{display:block;font-size:11px;margin:10px 0 5px}.ssh-key-page input,.ssh-key-page select,.ssh-key-page textarea{box-sizing:border-box;width:100%;font-size:11px;min-height:28px}
.ssh-key-destination{display:flex!important;align-items:flex-start;gap:8px;padding:8px 0}.ssh-key-destination .dialog-checkbox{width:14px;min-width:14px;height:14px;min-height:14px;flex:0 0 14px;margin:2px 0}.ssh-key-destination span{overflow-wrap:anywhere}.ssh-key-destination small{display:block;color:var(--vscode-descriptionForeground);line-height:1.5;margin-top:4px}
#sshKeyAccessPasswordBlock .hidden{display:none!important}
#sshKeyAccessMasterPasswordSelection{padding-right:34px;text-align:left}
.ssh-key-page .input-with-button input{min-width:0;min-height:31px}.ssh-key-home-item{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid var(--vscode-panel-border)}
.ssh-key-home-item button{width:150px;min-width:150px;flex:0 0 150px;white-space:nowrap}.ssh-key-home-item p,.ssh-key-hint{font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.5}
.ssh-key-access{margin-top:14px;padding-top:12px;border-top:1px solid var(--vscode-panel-border);font-size:11px}
.ssh-key-access > strong{display:block;margin-bottom:4px}
.ssh-key-dialog .credential-state:empty{display:none}
/* Reserve exactly one status line; longer messages wrap naturally without clipping. */
.ssh-key-dialog #sshKeyTestHint{display:block;min-height:1.3em;line-height:1.3;overflow-wrap:anywhere}
.ssh-key-pair{margin:8px 0;overflow-wrap:anywhere;font-size:11px}.ssh-key-pair strong{display:block;color:var(--vscode-descriptionForeground);font-weight:400;margin-bottom:3px}
#sshKeyToolsBackdrop .file-properties-actions{flex-wrap:wrap;justify-content:flex-end;min-height:64px;box-sizing:border-box}#sshKeyFeedback{flex-basis:100%;height:25px;display:flex;align-items:center;gap:6px;overflow:auto;overflow-wrap:anywhere;white-space:normal}#sshKeyFeedback .spinner{display:none}#sshKeyFeedback.busy .spinner{display:block}#sshKeyFeedbackText{min-width:0}
.profile-dropdown-menu.sync-combo-menu[data-for="sshKeyTarget"]{display:flex!important;flex-direction:column;overflow:hidden}
.sync-combo-menu[data-for="sshKeyTarget"] > [role="listbox"]{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden}
#sshKeyToolsBackdrop .file-properties-actions > button{box-sizing:border-box;flex-shrink:0;white-space:nowrap}
#sshKeyBack,#sshKeyClose{width:72px;min-width:72px}
#sshKeyCopy{width:124px;min-width:124px}
#sshKeyNextDeploy,#sshKeyPrimary{width:140px;min-width:140px}
#sshKeyUse{width:112px;min-width:112px}
#sshKey_choose > button{width:150px;min-width:150px}
#sshKeyFeedback.error,.ssh-key-pair.error{color:var(--remoteedit-validation-error);opacity:1}
`; }
export function renderSshKeyTools(): string { return String.raw`
  const sk = id => document.getElementById(id);
  let skPage='home',skBusy=false,skBusyAction='',skCommit=false,skOrigin=null,skKey=null,skResult=null,skProfiles=[],skDirectory='',skReturnFocus=null,skGeneratedPassphrase='',skMasterConfigured=false,skDetailsFrom='inspect',skDetailsSnapshot=null,skDeployFrom='home',skDiscovery=null,skAssisted=false,skFailureReason='',skManualFrom='deploy',skChoices=null;
  let skProbeId=0,skProbeTimer=null,skPrivateManual=false,skSkipPrivate=false,skCommentEdited=false,skPreviousType='ed25519';
  function skFeedback(message,error=false){sk('sshKeyFeedbackText').textContent=message;sk('sshKeyFeedback').classList.toggle('error',error);}
  // Busy still guards pending requests (including native file pickers). Only real key
  // processing and remote SSH work should show the Connecting-style spinner.
  const skProgressMessages={generate:'Generating SSH key…',inspect:'Inspecting SSH key…',prepare:'Checking SSH connection…',discover:'Finding authorized keys files…',select:'Checking selected authorized keys files…',additional:'Checking additional authorized keys files…',deploy:'Installing public key…',test:'Testing SSH authentication…'};
  function skRequest(action,fields={}) {
    skFeedback(skProgressMessages[action]||'');skBusy=true;skBusyAction=action;skSetBusy();vscode.postMessage({type:'sshKeyTools',payload:{action,...fields}});
  }
  function skSetBusy(){
    sk('sshKeyFeedback').classList.toggle('busy',skBusy&&!!skProgressMessages[skBusyAction]);
    sk('sshKeyToolsBackdrop').querySelectorAll('input,select,textarea,button,summary').forEach(n=>{n.disabled=skBusy;});
    sk('sshKeyClose').disabled=skCommit;sk('sshKeyClose').hidden=skPage==='details'&&!!skOrigin&&!skBusy;sk('sshKeyClose').textContent=(skBusy&&!['open','pick'].includes(skBusyAction))||skPage==='choose'?'Cancel':'Close';
    sk('sshKeyPrimary').disabled=skBusy||(skPage==='destinations'&&!sk('sshKeyDestinations').querySelector('input:checked:not(:disabled)'));
    if(!skBusy)sk('sshKeyDestinations').querySelectorAll('input[data-unsafe]').forEach(n=>n.disabled=true);
    skUpdateAccessReveal();window.RemoteEditControls?.refresh();
  }
  function skShow(page){
    if(skPage==='deploy'&&page!=='deploy'){skProbeId++;clearTimeout(skProbeTimer);}
    skClosePasswordSource();
    skPage=page;document.querySelectorAll('.ssh-key-page').forEach(n=>n.hidden=n.id!=='sshKey_'+page);
    const titles={home:'SSH Key Tools',generate:'Generate SSH Key',inspect:'Inspect SSH Key',details:'SSH Key Details',deploy:'Deploy Public Key',review:skAssisted?'Review Assisted Installation':'Review Public Key Deployment',result:'Public Key Deployment',manual:'Manual Installation',choose:'Set Up SSH Key',unavailable:'SSH Configuration Unavailable',destinations:'Choose Authorized Keys File'};
    sk('sshKeyToolsTitle').textContent=titles[page];
    sk('sshKeyBack').hidden=page==='home'||page==='choose';
    sk('sshKeyCopy').hidden=!skKey||!['details','result','manual'].includes(page);
    sk('sshKeyNextDeploy').hidden=page!=='details';if(page==='deploy')sk('sshKeyAdditional').hidden=true;sk('sshKeyNextDeploy').classList.toggle('secondary',!!skOrigin);sk('sshKeyUse').classList.remove('secondary');
    sk('sshKeyUse').hidden=!(skKey?.privatePath && ((page==='details'&&skOrigin)||(page==='result'&&skResult?.authentication==='passed')));
    sk('sshKeyUse').textContent=page==='result'&&!skOrigin?'Use SSH Key':'Use This Key';
    const primary={generate:'Generate SSH Key',inspect:'Inspect SSH Key',deploy:'Continue',review:skAssisted?(skKey?.privatePath?'Install & Test':'Install'):'Deploy Public Key',unavailable:'Continue',destinations:'Continue'};
    sk('sshKeyPrimary').hidden=!primary[page];sk('sshKeyPrimary').textContent=primary[page]||'Continue';
    skFeedback('');skSetBusy();
    (sk('sshKey_'+page).querySelector('input,button')||sk('sshKeyClose')).focus();
  }
  function skPairs(element,pairs){element.replaceChildren();pairs.filter(([,v])=>v!==undefined&&v!=='').forEach(([label,value])=>{const row=document.createElement('div');row.className='ssh-key-pair';if(skPage==='result'&&((label==='Authentication'&&skResult?.authentication==='failed')||skResult?.destinations?.some(r=>r.destination===label&&!r.installed)))row.classList.add('error');const title=document.createElement('strong');title.textContent=label;const body=document.createElement('span');body.textContent=String(value);row.append(title,body);element.append(row);});}
  function skTypeChanged(updateLocation=true){
    const type=sk('sshKeyType').value,changed=type!==skPreviousType;skPreviousType=type;sk('sshKeyBitsBlock').hidden=type==='ed25519';sk('sshKeyBits').replaceChildren();
    (type==='rsa'?[3072,4096]:[256,384,521]).forEach(bits=>sk('sshKeyBits').add(new Option(bits+' bits',String(bits))));
    const nextDefault=skDirectory+(skDirectory.includes(String.fromCharCode(92))?String.fromCharCode(92):'/')+'id_'+type;
    const location=sk('sshKeyLocation').value,slash=Math.max(location.lastIndexOf('/'),location.lastIndexOf(String.fromCharCode(92)));
    if(!location)sk('sshKeyLocation').value=nextDefault;
    else if(updateLocation&&changed)sk('sshKeyLocation').value=(slash>=0?location.slice(0,slash+1):'')+'id_'+type;
    window.RemoteEditControls?.refresh();
  }
  function openSshKeyTools(origin=null,page='home'){
    closeConnectionManagementMenu(true);hideWebviewTooltip();skOrigin=origin;skReturnFocus=document.activeElement;
    skProbeId++;clearTimeout(skProbeTimer);skPrivateManual=false;skSkipPrivate=false;skCommentEdited=false;sk('sshKeyType').value='ed25519';skPreviousType='ed25519';sk('sshKeyDeployPassphraseBlock').hidden=true;sk('sshKeyTestPrivateBlock').hidden=false;sk('sshKeyTestHint').textContent='';
    skKey=null;skResult=null;skGeneratedPassphrase='';skBusy=false;skCommit=false;skDirectory='';skDetailsSnapshot=null;skDeployFrom='home';skDiscovery=null;skAssisted=false;skFailureReason='';skChoices=null;
    sk('sshKeyToolsBackdrop').querySelectorAll('input').forEach(n=>n.value='');
    if(origin==='editor'){manageProfilesBackdrop.classList.remove('visible');manageProfilesBackdrop.setAttribute('aria-hidden','true');}
    sk('sshKeyToolsBackdrop').classList.add('visible');sk('sshKeyToolsBackdrop').setAttribute('aria-hidden','false');
    window.RemoteEditControls?.closeCombo();sk('mainLayout').inert=true;skShow(page);skRequest('open');
  }
  function closeSshKeyTools(){
    if(skCommit)return;
    skProbeId++;clearTimeout(skProbeTimer);
    skClosePasswordSource();
    if(skBusy){vscode.postMessage({type:'sshKeyTools',payload:{action:'cancel'}});skFeedback('Cancelling…');sk('sshKeyClose').disabled=true;return;}
    vscode.postMessage({type:'sshKeyTools',payload:{action:'close'}});
    sk('sshKeyToolsBackdrop').classList.remove('visible');sk('sshKeyToolsBackdrop').setAttribute('aria-hidden','true');window.RemoteEditControls?.closeCombo();sk('mainLayout').inert=false;
    if(skOrigin==='editor'){manageProfilesBackdrop.classList.add('visible');manageProfilesBackdrop.setAttribute('aria-hidden','false');}
    sk('sshKeyToolsBackdrop').querySelectorAll('input[type=password]').forEach(n=>n.value='');skGeneratedPassphrase='';skKey=null;skResult=null;skDetailsSnapshot=null;
    skReturnFocus?.focus();
  }
  function skAccessProfile(){return skProfiles.find(p=>p.id===sk('sshKeyTarget').value);}
  function skUpdateAccessReveal(){
    for(const field of ['sshKeyAccessPassword','sshKeyAccessPassphrase']){
      updateConnectionCredentialRevealButton(sk(field+'Reveal'),sk(field));
      if(sk(field).readOnly){sk(field+'Reveal').disabled=true;hideTemporaryPassword(sk(field));}
    }
  }
  function skClosePasswordSource(){
    const picker=sk('sshKeyAccessPasswordSourcePicker'),menu=sk('sshKeyAccessPasswordSourceMenu');
    picker.classList.remove('open');sk('sshKeyAccessPasswordSourceButton').setAttribute('aria-expanded','false');
    picker.append(menu);menu.removeAttribute('style');
  }
  function skPositionPasswordSource(){
    const picker=sk('sshKeyAccessPasswordSourcePicker');if(!picker.classList.contains('open'))return;
    const menu=sk('sshKeyAccessPasswordSourceMenu'),rect=picker.getBoundingClientRect(),margin=8,gap=4;
    const width=Math.min(rect.width,innerWidth-margin*2),below=Math.max(0,innerHeight-rect.bottom-gap-margin),above=Math.max(0,rect.top-gap-margin);
    Object.assign(menu.style,{position:'fixed',display:'block',zIndex:'500',width:width+'px',maxWidth:width+'px',left:Math.max(margin,Math.min(rect.left,innerWidth-width-margin))+'px',right:'auto',maxHeight:Math.min(300,innerHeight-margin*2)+'px'});
    const up=menu.offsetHeight>below&&above>below;menu.dataset.placement=up?'up':'down';
    menu.style.maxHeight=Math.min(300,up?above:below)+'px';
    menu.style.top=(up?Math.max(margin,rect.top-menu.offsetHeight-gap):rect.bottom+gap)+'px';
  }
  function skTogglePasswordSource(){
    if(sk('sshKeyAccessPasswordSourceButton').disabled)return;
    const picker=sk('sshKeyAccessPasswordSourcePicker'),menu=sk('sshKeyAccessPasswordSourceMenu');
    if(picker.classList.contains('open')){skClosePasswordSource();return;}
    window.RemoteEditControls?.closeCombo();picker.classList.add('open');sk('sshKeyAccessPasswordSourceButton').setAttribute('aria-expanded','true');
    sk('sshKeyToolsBackdrop').append(menu);skPositionPasswordSource();
    menu.querySelector('[data-password-source="'+picker.dataset.source+'"]').focus();
  }
  function skAccessFields(){
    const p=skAccessProfile(),privateKey=sk('sshKeyAccessAuth').value==='privateKey';
    sk('sshKeyAccessPasswordBlock').hidden=privateKey;sk('sshKeyAccessPrivateBlock').hidden=!privateKey;
    const picker=sk('sshKeyAccessPasswordSourcePicker'),master=picker.dataset.source==='master',input=sk('sshKeyAccessPassword');
    input.readOnly=false;input.classList.toggle('hidden',master);sk('sshKeyAccessMasterPasswordSelection').classList.toggle('hidden',!master);
    picker.querySelectorAll('[data-password-source]').forEach(option=>{const selected=option.dataset.passwordSource===picker.dataset.source;option.classList.toggle('selected',selected);option.setAttribute('aria-selected',String(selected));});
    const saved=input.value===SAVED_SECRET_MASK;
    input.placeholder=saved?'Saved password':'';
    sk('sshKeyAccessPasswordState').textContent=master?(skMasterConfigured?'Master Password configured.':'Master Password is not configured.'):saved?'Password saved in VS Code SecretStorage.':'';
    const phrase=sk('sshKeyAccessPassphrase'),keyPath=sk('sshKeyAccessPrivatePath').value.trim();
    if(phrase.dataset.keyPath!==keyPath){phrase.value='';phrase.dataset.keyPath=keyPath;hideTemporaryPassword(phrase);}
    phrase.readOnly=false;phrase.placeholder=phrase.value===SAVED_SECRET_MASK?'Saved passphrase':'';
    sk('sshKeyAccessPassphraseState').textContent=phrase.value===SAVED_SECRET_MASK?'Passphrase saved in VS Code SecretStorage.':'Passphrase is used only for this deployment; leave blank for an unencrypted key.';
    for(const [id,available] of [['sshKeyAccessPasswordState',master?skMasterConfigured:saved],['sshKeyAccessPassphraseState',phrase.value===SAVED_SECRET_MASK]]){sk(id).classList.toggle('saved',available);sk(id).classList.toggle('not-saved',!available);}
    skUpdateAccessReveal();sk('sshKeyAccessPasswordReveal').classList.toggle('hidden',master);window.RemoteEditControls?.refresh();
  }
  function skAccessTargetChanged(){
    const p=skAccessProfile();skClosePasswordSource();
    sk('sshKeyAccessPassword').value=p?.hasSavedPassword?SAVED_SECRET_MASK:'';
    sk('sshKeyAccessPassphrase').value=p?.authType==='privateKey'&&p.hasSavedPassphrase?SAVED_SECRET_MASK:'';
    hideTemporaryPassword(sk('sshKeyAccessPassword'));hideTemporaryPassword(sk('sshKeyAccessPassphrase'));
    sk('sshKeyAccessAuth').value=p?.authType||'password';sk('sshKeyAccessPrivatePath').value=p?.privateKeyPath||'';
    sk('sshKeyAccessPassphrase').dataset.keyPath=p?.privateKeyPath||'';
    sk('sshKeyAccessPasswordSourcePicker').dataset.source=p?.passwordSource==='master'?'master':'connection';
    sk('sshKeyRemoteUser').textContent=p?'SSH User: '+(p.username||'Not configured'):'';skAccessFields();
  }
  function skShowDetails(){
    skKey=skDetailsSnapshot.key;skGeneratedPassphrase=skDetailsSnapshot.passphrase;skShow('details');
    sk('sshKeyToolsTitle').textContent=skDetailsSnapshot.generated?'SSH Key Generated':'SSH Key Details';
    skPairs(sk('sshKeyDetails'),[['Type',skKey.type],['Size',skKey.bits+' bits'],['Fingerprint',skKey.fingerprint],['Comment',skKey.comment||'—'],['Private Key',skKey.privatePath],['Public Key',skKey.publicPath||'Derived from private key (not saved)']]);
  }
  function skProbeSelection(){
    clearTimeout(skProbeTimer);const requestId=++skProbeId;
    if(!sk('sshKeyPublicPath').value.trim()){
      sk('sshKeyTestPrivateBlock').hidden=false;
      sk('sshKeyDeployPassphraseBlock').hidden=true;
      sk('sshKeyTestHint').textContent='';
      return;
    }
    sk('sshKeyTestHint').textContent='';
    const fields={location:sk('sshKeyPublicPath').value,privatePath:skPrivateManual?sk('sshKeyPrivatePath').value:'',autoDetectPrivate:!skSkipPrivate,passphrase:sk('sshKeyDeployPassphrase').value};
    skProbeTimer=setTimeout(()=>{if(!skBusy&&skPage==='deploy')vscode.postMessage({type:'sshKeyTools',payload:{action:'probe',requestId,...fields}});},200);
  }
  function skDeploymentPathChanged(field){
    skProbeId++;sk('sshKeyDeployPassphrase').value='';sk('sshKeyDeployPassphraseBlock').hidden=true;sk('sshKeyTestPrivateBlock').hidden=false;
    if(field==='sshKeyPrivatePath'){skPrivateManual=!!sk('sshKeyPrivatePath').value.trim();skSkipPrivate=!skPrivateManual;}
    else {skSkipPrivate=false;if(!skPrivateManual){sk('sshKeyPrivatePath').value='';}}
    skProbeSelection();
  }
  function skDeployPage(){
    skDeployFrom=skPage==='details'?'details':'home';
    const fromDetails=skDeployFrom==='details';
    skProbeId++;clearTimeout(skProbeTimer);
    sk('sshKeyPublicPath').value=fromDetails?(skKey?.privatePath||skKey?.publicPath||''):'';
    sk('sshKeyPrivatePath').value='';
    skPrivateManual=false;skSkipPrivate=false;
    sk('sshKeyDeployPassphrase').value=fromDetails?skGeneratedPassphrase:'';
    sk('sshKeyDeployPassphraseBlock').hidden=true;
    sk('sshKeyTestPrivateBlock').hidden=fromDetails&&!!skKey?.privatePath;
    sk('sshKeyTestHint').textContent='';
    skShow('deploy');skProbeSelection();
  }
  function receiveSshKeyTools(payload){
    if(!sk('sshKeyToolsBackdrop').classList.contains('visible'))return;
    if(payload.state==='keySelection'){
      if(payload.requestId!==skProbeId||skPage!=='deploy')return;
      if(payload.message){sk('sshKeyTestHint').textContent=payload.message;return;}
      if(!skPrivateManual){sk('sshKeyPrivatePath').value=payload.privatePath||'';}
      const mainPrivate=!!payload.sourceIsPrivate;
      sk('sshKeyTestPrivateBlock').hidden=mainPrivate;
      sk('sshKeyDeployPassphraseBlock').hidden=!payload.requiresPassphrase;
      if(!payload.requiresPassphrase)sk('sshKeyDeployPassphrase').value='';
      sk('sshKeyTestHint').textContent=mainPrivate
        ? (payload.privatePath ? 'The selected private key will also be used to test authentication after deployment.' : 'Enter the passphrase to extract the public key and test authentication.')
        : payload.privatePath
          ? 'Matching private key detected. Authentication will be tested after deployment.'
          : payload.requiresPassphrase
            ? (skPrivateManual ? 'The selected private key is encrypted. Enter its passphrase to verify the match, or clear this field to deploy without testing.' : 'A possible matching private key is encrypted. Enter its passphrase to verify the match and enable testing, or continue without the test.')
            : 'No matching private key available. Deployment will proceed without an authentication test.';
      return;
    }
    skBusy=false;skBusyAction='';skCommit=false;skSetBusy();
    if(payload.state==='ready'){
      skFeedback('');skProfiles=payload.profiles||[];skMasterConfigured=!!payload.masterPasswordConfigured;skDirectory=payload.defaultDirectory;skTypeChanged(false);if(!skCommentEdited)sk('sshKeyComment').value=payload.defaultComment||'';
      sk('sshKeyTarget').replaceChildren(new Option('Select a saved SFTP connection',''));
      skProfiles.forEach(p=>sk('sshKeyTarget').add(new Option(p.name,p.id)));skAccessTargetChanged();window.RemoteEditControls?.refresh();
    }else if(payload.state==='picked'){skFeedback('');if(payload.path&&sk(payload.field)){sk(payload.field).value=payload.path;if(payload.field==='sshKeyAccessPrivatePath')skAccessFields();if(['sshKeyPublicPath','sshKeyPrivatePath'].includes(payload.field))skDeploymentPathChanged(payload.field);}}
    else if(payload.state==='passphraseRequired'){sk('sshKeyDeployPassphraseBlock').hidden=false;skFeedback(payload.message,true);sk('sshKeyDeployPassphrase').focus();}
    else if(payload.state==='generated'||payload.state==='inspected'){
      skDetailsFrom=payload.state==='generated'?'generate':'inspect';skDetailsSnapshot={key:payload.key,passphrase:skGeneratedPassphrase,generated:payload.state==='generated'};skShowDetails();if(payload.state==='generated')skFeedback('SSH key pair generated successfully.');
    }else if(payload.state==='unavailable'){
      skKey=payload.key;skFailureReason=payload.reason;skAssisted=true;skShow('unavailable');skPairs(sk('sshKeyUnavailableReason'),[['Reason',skFailureReason]]);
    }else if(payload.state==='destinations'){
      skDiscovery=payload.discovery;skChoices=null;skShowDestinations();
    }else if(payload.state==='review'){
      skKey=payload.key;skAssisted=!!payload.assisted;skShow('review');
      if(skAssisted){
        skChoices=payload.reviews.map(r=>r.assistedName||r.destination.split(/[\\/]/).pop());
        sk('sshKeyToolsTitle').textContent='Review Assisted Installation';
        skPairs(sk('sshKeyReview'),[['Connection',payload.target.name],['SSH User',payload.reviews[0]?.username||payload.target.username],['Platform',payload.reviews[0]?.platform],...payload.reviews.map(r=>[r.destination,(r.exists?'Existing file':r.directoryExists?'Create authorized keys file':'Create SSH directory and authorized keys file')+(r.alreadyInstalled?' · Key already present':'')]),['SSH Configuration','Not verified — destinations selected by you'],['Existing Keys','Will be preserved; duplicate keys will be skipped'],['Permissions','Will be revalidated immediately before installation'],['Authentication',skKey.privatePath?'A single key-only authentication test will follow installation.':'No matching private key available; authentication cannot be tested.'],['Multiple Files',payload.reviews.length>1?'Revoking this key later may require removing it from every selected file.':'']]);return;
      }
skPairs(sk('sshKeyReview'),[['Connection',payload.target.name],['SSH User',payload.target.username],['Platform',payload.review.platform],['Destination',payload.review.destination],['Fingerprint',skKey.fingerprint],['Host Identity', 'Existing SSH Host Key Verification completed; follows your current setting.'],['Permissions',payload.review.permissions],['Public Key',payload.review.alreadyInstalled?'Already authorized; no duplicate will be added':'Ready to install']]);
    }else if(payload.state==='testing'){
      skResult=payload.result;sk('sshKeyAdditional').hidden=true;skShow('result');skBusy=true;skBusyAction='test';skSetBusy();skFeedback('Testing SSH authentication…');skPairs(sk('sshKeyResult'),[['Public Key','Installed'],['Authentication','Testing key-only authentication…']]);
    }else if(payload.state==='result'){
      skResult=payload.result;skKey=payload.key;skShow('result');
      skPairs(sk('sshKeyResult'),[...(skResult.destinations||[]).map(r=>[r.destination,r.installed?(r.alreadyInstalled?'Key already present; no duplicate added':'Public key installed'):'Installation failed or unconfirmed: '+r.message]),['Authentication',skResult.authentication==='passed'?'Key-only authentication successful':skResult.authentication==='failed'?'Authentication failed. The server may use a different authorized key file or reject this key for another reason.':skResult.authentication==='cancelled'?'Authentication test cancelled':'Authentication not verified'+(!skKey?.privatePath?' — no matching private key available.':'.')],['Connection','Saved credentials remain unchanged until you choose Use SSH Key.']]);
      sk('sshKeyAdditional').hidden=!payload.additional?.length;sk('sshKeyAdditionalHint').textContent=payload.additional?.length?'Another safe destination was found: '+payload.additional.join(', ')+'. The previous installation will be preserved.':'';

    }else if(payload.state==='manual'){
      skKey=payload.key;skShow('manual');sk('sshKeyManualReason').textContent=payload.message;sk('sshKeyManualPublic').value=skKey?.publicKey||'';
    }else if(payload.state==='configured'){skShow('result');sk('sshKeyUse').hidden=true;skFeedback(payload.message);}
    else if(payload.state==='cancelled'){skResult=payload.result;skFeedback(skResult?.installed?'Public key installed; remaining operation cancelled.':'Operation cancelled.');}
    else if(payload.state==='error'){if(payload.result?.installed){skResult=payload.result;skShow('result');}skFeedback(payload.message,true);}
  }
  function skShowDestinations(){
    skShow('destinations');const entries=skDiscovery.destinations||[],first=entries.find(d=>d.review)?.review;
    if(first&&!first.directoryExists)sk('sshKeyToolsTitle').textContent='Create SSH Directory';
    skPairs(sk('sshKeyDestinationContext'),[['Remote User',first?.username],['SSH Directory',first?.destination.replace(/[\\/][^\\/]+$/,'')],['Directory',first&&!first.directoryExists?'No .ssh directory found. It will be created during installation.':''],['Available Destinations',entries.some(d=>d.review?.exists)?'Choose one or more files.':'No safe existing authorized key files found.']]);
    sk('sshKeyDestinations').replaceChildren();
    entries.forEach(d=>{
      const label=document.createElement('label');label.className='ssh-key-destination';
      const box=document.createElement('input');box.type='checkbox';box.className='dialog-checkbox';box.value=d.name;box.checked=!!d.review&&(skChoices?skChoices.includes(d.name):d.name==='authorized_keys');box.disabled=!d.review;if(!d.review)box.dataset.unsafe='true';
      const text=document.createElement('span');text.textContent=d.review?.destination||d.name;
      const note=document.createElement('small');note.textContent=d.review?(d.review.exists?'Existing · Writable':'Create after confirmation')+(d.name==='authorized_keys'?' · Recommended':' · Legacy alternative. Select only if your server may use this file, or to install in both locations.'):(d.reason||'Unavailable');
      text.append(note);label.append(box,text);sk('sshKeyDestinations').append(label);box.onchange=()=>{skChoices=[...sk('sshKeyDestinations').querySelectorAll('input:checked:not(:disabled)')].map(n=>n.value);skSetBusy();};
    });skSetBusy();
  }
  sk('sshKeyToolsBackdrop').querySelectorAll('[data-ssh-key-manual]').forEach(button=>button.onclick=()=>{skManualFrom=skPage;skShow('manual');sk('sshKeyManualReason').textContent=skFailureReason||'Install this public key manually if preferred.';sk('sshKeyManualPublic').value=skKey?.publicKey||'';});
  sk('sshKeyAdditionalButton').onclick=()=>skRequest('additional');
  document.addEventListener('keydown',event=>{
    const backdrop=sk('sshKeyToolsBackdrop');
    if(!backdrop.classList.contains('visible')||document.querySelector('.ssh-confirm-dialog-backdrop.visible')||confirmDialogOpen)return;
    const combo=document.querySelector('.sync-combo-menu[data-for^=sshKey]');
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(sk('sshKeyAccessPasswordSourcePicker').classList.contains('open')){skClosePasswordSource();sk('sshKeyAccessPasswordSourceButton').focus();}else if(combo)window.RemoteEditControls?.closeCombo(true);else if(!sk('sshKeyBack').hidden)sk('sshKeyBack').click();else closeSshKeyTools();}
    if(event.key==='Tab'&&!combo){
      const items=[...backdrop.querySelectorAll('input:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex=\"0\"]')].filter(n=>n.getClientRects().length&&!n.closest('[hidden]'));
      if(!items.length){event.preventDefault();return;}
      if(!backdrop.contains(document.activeElement)||(event.shiftKey&&document.activeElement===items[0])||(!event.shiftKey&&document.activeElement===items.at(-1))){event.preventDefault();(event.shiftKey?items.at(-1):items[0]).focus();}
    }
  });
  sk('sshKeySetupDiagnostic').onclick=()=>openSshKeyTools('main','choose');
  sk('sshKeyToolsButton').onclick=()=>openSshKeyTools();
  sk('generateSshKeyButton').onclick=()=>openSshKeyTools('main','generate');
  sk('sshKeyGenerate').onclick=()=>skShow('generate');sk('sshKeyInspect').onclick=()=>skShow('inspect');sk('sshKeyDeploy').onclick=skDeployPage;
  sk('sshKeyChooseGenerate').onclick=()=>skShow('generate');sk('sshKeyChooseExisting').onclick=()=>skShow('inspect');
  sk('sshKeyType').onchange=()=>skTypeChanged();
  sk('sshKeyComment').oninput=()=>{skCommentEdited=true;};
  for(const field of ['sshKeyPublicPath','sshKeyPrivatePath'])sk(field).oninput=()=>skDeploymentPathChanged(field);
  sk('sshKeyDeployPassphrase').oninput=skProbeSelection;
  sk('sshKeyTarget').onchange=skAccessTargetChanged;
  sk('sshKeyAccessAuth').onchange=skAccessFields;
  sk('sshKeyAccessPasswordSourceButton').onclick=skTogglePasswordSource;sk('sshKeyAccessMasterPasswordSelection').onclick=skTogglePasswordSource;
  sk('sshKeyAccessPasswordSourcePicker').querySelectorAll('[data-password-source]').forEach(option=>option.onclick=()=>{sk('sshKeyAccessPasswordSourcePicker').dataset.source=option.dataset.passwordSource;skClosePasswordSource();hideTemporaryPassword(sk('sshKeyAccessPassword'));skAccessFields();sk('sshKeyAccessPasswordSourceButton').focus();});
  const skPasswordSourceKeydown=event=>{
    if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||(event.shiftKey&&event.key!=='Tab'))return;
    if(event.key==='Escape'&&sk('sshKeyAccessPasswordSourcePicker').classList.contains('open')){event.preventDefault();event.stopPropagation();skClosePasswordSource();sk('sshKeyAccessPasswordSourceButton').focus();}
    else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();const picker=sk('sshKeyAccessPasswordSourcePicker'),options=[...sk('sshKeyAccessPasswordSourceMenu').querySelectorAll('[data-password-source]')];if(!picker.classList.contains('open'))skTogglePasswordSource();else options[(options.indexOf(document.activeElement)+(event.key==='ArrowDown'?1:options.length-1))%options.length].focus();}
    else if(event.key==='Tab')skClosePasswordSource();
  };
  sk('sshKeyAccessPasswordSourcePicker').onkeydown=skPasswordSourceKeydown;sk('sshKeyAccessPasswordSourceMenu').onkeydown=skPasswordSourceKeydown;
  document.addEventListener('click',event=>{if(!sk('sshKeyAccessPasswordSourcePicker').contains(event.target)&&!sk('sshKeyAccessPasswordSourceMenu').contains(event.target))skClosePasswordSource();});
  sk('sshKeyToolsBackdrop').querySelector('.file-properties-body').addEventListener('scroll',()=>skClosePasswordSource());
  window.addEventListener('resize',skPositionPasswordSource);
  sk('sshKeyAccessPrivatePath').oninput=skAccessFields;
  for(const field of ['sshKeyAccessPassword','sshKeyAccessPassphrase']){bindTemporaryPasswordReveal(sk(field+'Reveal'),sk(field));sk(field).oninput=skAccessFields;sk(field).onfocus=()=>{if(sk(field).value===SAVED_SECRET_MASK)sk(field).select();};}
  for(const [button,field,save] of [['sshKeySaveBrowse','sshKeyLocation',true],['sshKeyInspectBrowse','sshKeyInspectPath',false],['sshKeyPublicBrowse','sshKeyPublicPath',false],['sshKeyPrivateBrowse','sshKeyPrivatePath',false],['sshKeyAccessPrivateBrowse','sshKeyAccessPrivatePath',false]])sk(button).onclick=()=>skRequest('pick',{field,save,location:sk(field).value});
  sk('sshKeyClose').onclick=closeSshKeyTools;sk('sshKeyNextDeploy').onclick=skDeployPage;
  sk('sshKeyBack').onclick=()=>{
    if(skPage==='manual'&&skAssisted){skShow(skManualFrom);return;}
    if(skPage==='destinations'){skShow('unavailable');return;}
    if(skPage==='review'&&skAssisted){skShowDestinations();return;}
    if(['unavailable','review','result','manual'].includes(skPage)){skShow('deploy');return;}
    if(skPage==='details'){skShow(skDetailsFrom);return;}
    if(skPage==='deploy'){if(skDeployFrom==='details'&&skDetailsSnapshot)skShowDetails();else skShow('home');return;}
    if(skOrigin){closeSshKeyTools();return;}
    skShow('home');
  };
  sk('sshKeyCopy').onclick=async()=>{try{await navigator.clipboard.writeText(skKey.publicKey);skFeedback('Public key copied.');}catch{skFeedback('Clipboard unavailable.',true);}};
  sk('sshKeyPrimary').onclick=()=>{
    if(skPage==='generate'){
      if(sk('sshKeyPassphrase').value!==sk('sshKeyConfirm').value){skFeedback('Passphrases do not match.',true);return;}
      skGeneratedPassphrase=sk('sshKeyPassphrase').value;skRequest('generate',{type:sk('sshKeyType').value,bits:Number(sk('sshKeyBits').value),location:sk('sshKeyLocation').value,comment:sk('sshKeyComment').value,passphrase:skGeneratedPassphrase,confirmPassphrase:sk('sshKeyConfirm').value});
    }else if(skPage==='inspect'){skGeneratedPassphrase=sk('sshKeyInspectPassphrase').value;skRequest('inspect',{location:sk('sshKeyInspectPath').value,passphrase:skGeneratedPassphrase});}
    else if(skPage==='deploy'){skProbeId++;clearTimeout(skProbeTimer);skGeneratedPassphrase=sk('sshKeyDeployPassphrase').value;skRequest('prepare',{location:sk('sshKeyPublicPath').value,privatePath:sk('sshKeyPrivatePath').value,autoDetectPrivate:!skSkipPrivate,passphrase:sk('sshKeyDeployPassphrase').value,targetId:sk('sshKeyTarget').value,access:{authType:sk('sshKeyAccessAuth').value,passwordSource:sk('sshKeyAccessPasswordSourcePicker').dataset.source==='master'?'master':sk('sshKeyAccessPassword').value===SAVED_SECRET_MASK?'saved':'connection',password:sk('sshKeyAccessPassword').value===SAVED_SECRET_MASK?'':sk('sshKeyAccessPassword').value,privateKeyPath:sk('sshKeyAccessPrivatePath').value,passphraseSource:sk('sshKeyAccessPassphrase').value===SAVED_SECRET_MASK?'saved':'enter',passphrase:sk('sshKeyAccessPassphrase').value===SAVED_SECRET_MASK?'':sk('sshKeyAccessPassphrase').value}});}
    else if(skPage==='unavailable'){skRequest('discover');}
    else if(skPage==='destinations'){skRequest('select',{destinations:[...sk('sshKeyDestinations').querySelectorAll('input:checked:not(:disabled)')].map(n=>n.value)});}
    else if(skPage==='review'){skCommit=true;skRequest('deploy');}
  };
  sk('sshKeyUse').onclick=()=>{
    if(skPage==='result'&&!skOrigin){skRequest('use');return;}
    if(!skOrigin||!skKey?.privatePath)return;
    const field=skOrigin==='editor'?editElement:sk;
    field('privateKeyPath').value=skKey.privatePath;field('privateKeyPath').dataset.freshKey='true';
    field('passphrase').value=skGeneratedPassphrase;field('passphrase').placeholder='';field('rememberPassphrase').checked=false;
    if(skOrigin==='editor'){editElement('authType').value='privateKey';updateConnectionEditorFields();}else{authType.value='privateKey';updateAuthFields();}
    field('privateKeyPath').dispatchEvent(new Event('input',{bubbles:true}));closeSshKeyTools();
  };
`; }
