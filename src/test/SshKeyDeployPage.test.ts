import assert from 'node:assert/strict';
import { test } from './helpers/TestHarness';
import { runInNewContext } from 'node:vm';
import { renderSshKeyTools, renderSshKeyToolsMarkup, renderSshKeyToolsStyles } from '../panel/webview/scripts/SshKeyTools';

function fragment(start: string, end: string): string {
  const script = renderSshKeyTools();
  const from = script.indexOf(start), to = script.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing function: ${start}`);
  return script.slice(from, to);
}

function element(): any {
  return {
    hidden: false, textContent: '', value: '', style: {},
    classList: { toggle() {}, remove() {} },
    querySelector() { return { focus() {} }; }, focus() {}
  };
}

test('Deploy Public Key uses two named sections and the existing credential-description style', () => {
  const markup = renderSshKeyToolsMarkup();
  const deploy = markup.slice(markup.indexOf('<div id="sshKey_deploy"'), markup.indexOf('<div id="sshKey_unavailable"'));
  const styles = renderSshKeyToolsStyles();
  assert.equal((deploy.match(/class="ssh-key-access"/g) || []).length, 2, 'Only the two top-level section dividers remain');
  assert(deploy.indexOf('<strong>Verify SSH Authentication (Optional)</strong>') < deploy.indexOf('<strong>Deployment Target</strong>'));
  assert(deploy.includes('<strong>Deployment Target</strong><label for="sshKeyTarget">Target Connection</label>'));
  // The field descriptions and hierarchy are checked together in one test.
  assert(deploy.includes('<label for="sshKeyPublicPath">Key File (Public or Private)</label>'));
  assert(deploy.includes('Only the public key will be installed on the server. If a private key is selected, its public key is extracted locally.'));
  assert(deploy.includes('<label for="sshKeyPrivatePath">Matching Private Key</label>'));
  assert(deploy.includes('Used to test SSH authentication after deployment. The private key stays on your computer.'));
  assert(deploy.includes('Enter the passphrase protecting the private key, not your server password.'));
  assert(!deploy.includes('Private Key for Authentication Test'));
  assert(!deploy.includes('Without a matching private key, installation can continue without verifying authentication.'));
  assert(deploy.includes('<label for="sshKeyAccessAuth">Authentication</label>'));
  assert(deploy.includes('<div class="credential-state">Used only for this deployment. Saved connection settings will not be changed.</div>'));
  assert(!deploy.includes('<strong>Credentials</strong>'));
  assert(!deploy.includes('Used to connect to the server and install the public key.'));
  assert(!deploy.includes('Select a key file to configure the optional authentication test.'));
  assert(!deploy.includes('Password is used only for this deployment.'));
  assert.equal((deploy.match(/class="ssh-key-hint"/g) || []).length, 0, 'Explanations reuse the credential-state style');
  assert(deploy.includes('id="sshKeyTestHint" class="credential-state"'));
  assert(deploy.includes('id="sshKeyRemoteUser" class="credential-state"'));
  assert(styles.includes('.ssh-key-access > strong{display:block;'));
});

test('a new Deploy from Home resets conditional key controls; Deploy from Details preselects its key', () => {
  const script = fragment('  function skDeployPage()', '  function receiveSshKeyTools(');
  const ids = ['sshKeyPublicPath', 'sshKeyPrivatePath', 'sshKeyDeployPassphrase', 'sshKeyDeployPassphraseBlock', 'sshKeyTestPrivateBlock', 'sshKeyTestHint'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  let cleared = 0, probes = 0;
  const ctx: any = {
    sk: (id: string) => elements[id], skPage: 'home', skDeployFrom: 'details',
    skKey: { privatePath: '/keys/old_private', publicPath: '/keys/old_private.pub' },
    skGeneratedPassphrase: 'old-phrase', skPrivateManual: true, skSkipPrivate: true,
    skProbeId: 7, skProbeTimer: 1,
    clearTimeout: () => { cleared++; },
    skShow: (page: string) => { ctx.skPage = page; },
    skProbeSelection: () => { probes++; }
  };
  elements.sshKeyTestPrivateBlock.hidden = true; // Previous private-key selection.
  elements.sshKeyTestHint.textContent = 'Previous probe response';
  runInNewContext(script + ';skDeployPage()', ctx);
  assert.equal(ctx.skPage, 'deploy');
  assert.equal(ctx.skDeployFrom, 'home');
  assert.equal(elements.sshKeyPublicPath.value, '');
  assert.equal(elements.sshKeyPrivatePath.value, '');
  assert.equal(elements.sshKeyDeployPassphrase.value, '');
  assert.equal(elements.sshKeyTestHint.textContent, '');
  assert.equal(elements.sshKeyTestPrivateBlock.hidden, false);
  assert.equal(elements.sshKeyDeployPassphraseBlock.hidden, true);
  assert.equal(ctx.skPrivateManual, false);
  assert.equal(ctx.skSkipPrivate, false);
  assert.equal(ctx.skProbeId, 8);
  assert.equal(cleared, 1);
  assert.equal(probes, 1);

  // A new Deploy opened from an inspected/generated private key must still use that key.
  ctx.skPage = 'details';
  runInNewContext(script + ';skDeployPage()', ctx);
  assert.equal(ctx.skDeployFrom, 'details');
  assert.equal(elements.sshKeyPublicPath.value, '/keys/old_private');
  assert.equal(elements.sshKeyTestPrivateBlock.hidden, true);
  assert.equal(elements.sshKeyDeployPassphrase.value, 'old-phrase');
  assert.equal(probes, 2);

  // Returning Home and starting another deployment must not inherit the private-key state.
  ctx.skPage = 'home';
  runInNewContext(script + ';skDeployPage()', ctx);
  assert.equal(elements.sshKeyPublicPath.value, '');
  assert.equal(elements.sshKeyTestPrivateBlock.hidden, false);
  assert.equal(elements.sshKeyDeployPassphrase.value, '');
  assert.equal(probes, 3);
});

test('clearing the source key immediately restores Matching Private Key and removes the empty-state hint', () => {
  const script = fragment('  function skProbeSelection()', '  function skDeploymentPathChanged(');
  const elements: Record<string, any> = {
    sshKeyPublicPath: { value: '' },
    sshKeyTestPrivateBlock: { hidden: true },
    sshKeyDeployPassphraseBlock: { hidden: false },
    sshKeyTestHint: { textContent: 'Previous private key status' }
  };
  let cleared = 0;
  const ctx: any = {sk: (id: string) => elements[id], skProbeId: 21, skProbeTimer: 1,
    clearTimeout: () => { cleared++; }, skPrivateManual: false, skSkipPrivate: false };
  runInNewContext(script + ';skProbeSelection()', ctx);
  assert.equal(ctx.skProbeId, 22);
  assert.equal(cleared, 1);
  assert.equal(elements.sshKeyTestPrivateBlock.hidden, false);
  assert.equal(elements.sshKeyDeployPassphraseBlock.hidden, true);
  assert.equal(elements.sshKeyTestHint.textContent, '');
});

test('leaving Deploy invalidates in-flight key probes but Back from Review preserves the selection', () => {
  const script = fragment('  function skShow(page)', '  function skPairs(');
  const elements: Record<string, any> = {};
  const sk = (id: string) => elements[id] ||= element();
  const pages = ['home', 'deploy', 'review'].map(p => ({ id: 'sshKey_' + p, hidden: p !== 'deploy' }));
  let cleared = 0;
  const ctx: any = {
    sk, skPage: 'deploy', skProbeId: 4, skProbeTimer: 1,
    skKey: null, skOrigin: null, skResult: null, skAssisted: false,
    clearTimeout: () => { cleared++; }, skClosePasswordSource() {}, skFeedback() {}, skSetBusy() {},
    document: { querySelectorAll: () => pages }
  };
  runInNewContext(script + ';skShow("home")', ctx);
  assert.equal(ctx.skPage, 'home');
  assert.equal(ctx.skProbeId, 5);
  assert.equal(cleared, 1);
  runInNewContext('skShow("deploy")', ctx);
  assert.equal(ctx.skProbeId, 5);
  runInNewContext('skShow("review")', ctx);
  assert.equal(ctx.skProbeId, 6);
  runInNewContext('skShow("deploy")', ctx);
  assert.equal(ctx.skProbeId, 6);
});


test('matching private key feedback reserves room while its message appears and disappears', () => {
  const markup = renderSshKeyToolsMarkup();
  const css = renderSshKeyToolsStyles();
  const deploy = markup.slice(markup.indexOf('<div id="sshKey_deploy"'), markup.indexOf('<div id="sshKey_unavailable"'));
  assert(deploy.includes('<div id="sshKeyTestHint" class="credential-state" aria-live="polite"></div>'));
  assert(deploy.indexOf('id="sshKeyTestHint"') < deploy.indexOf('<strong>Deployment Target</strong>'));
  // Empty state occupies the same single line as a normal status, not multiple blank lines.
  assert(css.includes('.ssh-key-dialog .credential-state:empty{display:none}'));
  assert.match(css, /\.ssh-key-dialog #sshKeyTestHint\{display:block;min-height:1\.3em;line-height:1\.3;overflow-wrap:anywhere\}/);
  assert(!css.includes('@media (max-width:540px){.ssh-key-dialog #sshKeyTestHint'));
  assert(!css.includes('@media (max-width:390px){.ssh-key-dialog #sshKeyTestHint'));
  assert(!css.includes('#sshKeyTestHint{display:block;height:'), 'Long statuses must grow naturally');
});

test('assisted review button says Install only when SSH authentication can actually be tested', () => {
  const script = fragment('  function skShow(page)', '  function skPairs(');
  const elements: Record<string, any> = {};
  const sk = (id: string) => elements[id] ||= element();
  const ctx: any = {
    sk, skPage: 'destinations', skProbeId: 0, skProbeTimer: null,
    skKey: { publicKey:'ssh-ed25519 AAAA' }, skOrigin:null, skResult:null,
    skAssisted:true, skClosePasswordSource() {}, skFeedback() {}, skSetBusy() {},
    clearTimeout() {}, document: { querySelectorAll: () => [] }
  };
  runInNewContext(script + ';skShow("review")', ctx);
  assert.equal(sk('sshKeyPrimary').textContent, 'Install');
  assert.equal(sk('sshKeyToolsTitle').textContent, 'Review Assisted Installation');
  ctx.skKey = { publicKey:'ssh-ed25519 AAAA', privatePath:'/home/user/.ssh/id_ed25519' };
  runInNewContext('skShow("review")',ctx);
  assert.equal(sk('sshKeyPrimary').textContent, 'Install & Test');
  ctx.skAssisted = false;
  runInNewContext('skShow("review")',ctx);
  assert.equal(sk('sshKeyPrimary').textContent, 'Deploy Public Key');
  assert(renderSshKeyToolsStyles().includes('#sshKeyNextDeploy,#sshKeyPrimary{width:140px;min-width:140px}'));
  // A file can be installed even without a matching private key.
  assert(renderSshKeyTools().includes("'No matching private key available; authentication cannot be tested.'"));
  assert(!renderSshKeyTools().includes('No .ssh directory found. It will be created only after Install & Test.'));
});
