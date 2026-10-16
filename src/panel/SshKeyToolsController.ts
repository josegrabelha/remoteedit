import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { expandHomePath } from '../utils/localPathUtils';
import { ConnectionManager } from '../connection/ConnectionManager';
import { generateKey, inspectKey, defaultKeyComment, resolveDeploymentKey, type KeyDetails } from '../ssh/SshKeyFiles';
import { SshKeyDeployment, type DeploymentResult } from '../ssh/SshKeyDeployment';

/** Operation-local state only: never an inventory, persisted identity or private-key copy. */
export class SshKeyToolsController implements vscode.Disposable {
  private busy = false;
  private committing = false;
  private source?: vscode.CancellationTokenSource;
  private deployment = new SshKeyDeployment();
  private key?: KeyDetails;
  private passphrase?: string;
  private targetId?: string;
  private targetVersion?: number;
  private target?: {name: string; username: string};
  private result?: DeploymentResult;
  private disposed = false;
  constructor(private manager: ConnectionManager, private send: (payload: any) => void, private refresh: () => Promise<void>) {}
  async handle(payload: any): Promise<void> {
    const action = String(payload?.action || '');
    if (action === 'probe') {
      if (this.busy || this.disposed) return;
      try {
        const selection = await resolveDeploymentKey(String(payload.location || ''), String(payload.privatePath || ''), payload.passphrase || undefined, payload.autoDetectPrivate !== false);
        const sourcePath = path.resolve(expandHomePath(String(payload.location || '')));
        const sourceIsPrivate = selection.key.privatePath === sourcePath || (!selection.key.publicKey && selection.candidatePath === sourcePath);
        if (!this.disposed) this.send({state:'keySelection',requestId:payload.requestId,privatePath:selection.key.privatePath,requiresPassphrase:selection.requiresPassphrase,candidatePath:selection.candidatePath,sourceIsPrivate});
      } catch {
        if (!this.disposed) this.send({state:'keySelection',requestId:payload.requestId,requiresPassphrase:false,message:'Key could not be validated. Check the selected file and passphrase.'});
      }
      return;
    }
    if (action === 'cancel' || action === 'close') {
      if (this.committing) { this.send({state:'busy', message:'Wait for the remote installation result before closing.'}); return; }
      this.source?.cancel();
      if (!this.busy) await this.reset();
      return;
    }
    if (this.busy || this.disposed) return;
    this.busy = true; this.source = new vscode.CancellationTokenSource();
    const token = this.source.token;
    let remoteChecksStarted = false;
    try {
      if (action === 'open') {
        await this.reset();
        const profiles = (await this.manager.listProfiles()).filter(p => p.connectionType === 'sftp').map(p => ({id:p.id,name:p.name,username:p.username,authType:p.authType,passwordSource:p.passwordSource,privateKeyPath:p.privateKeyPath,hasSavedPassword:p.hasSavedPassword,hasSavedPassphrase:p.hasSavedPassphrase}));
        const masterPassword = await this.manager.getMasterPasswordState();
        this.send({state:'ready',profiles,masterPasswordConfigured:masterPassword.configured,defaultDirectory:path.join(os.homedir(),'.ssh'),defaultComment:defaultKeyComment()});
      } else if (action === 'pick') {
        const selected = payload.save ? await vscode.window.showSaveDialog({title:'Save SSH Private Key',defaultUri:vscode.Uri.file(String(payload.location || path.join(os.homedir(),'.ssh','id_ed25519')))}) : (await vscode.window.showOpenDialog({title:'Select SSH Key File',canSelectMany:false,canSelectFiles:true,canSelectFolders:false}))?.[0];
        this.send({state:'picked',field:payload.field,path:selected?.fsPath});
      } else if (action === 'generate') {
        if (payload.passphrase !== payload.confirmPassphrase) throw new Error('Passphrases do not match.');
        this.key = await generateKey(payload, () => token.isCancellationRequested || this.disposed);
        this.passphrase = payload.passphrase || undefined;
        this.send({state:'generated',key:this.key});
      } else if (action === 'inspect') {
        this.key = await inspectKey(String(payload.location || ''), payload.passphrase || undefined);
        this.passphrase = payload.passphrase || undefined;
        this.send({state:'inspected',key:this.key});
      } else if (action === 'prepare') {
        this.result = undefined;this.key=undefined;this.passphrase=undefined;
        const selection = await resolveDeploymentKey(String(payload.location || ''), String(payload.privatePath || ''), payload.passphrase || undefined, payload.autoDetectPrivate !== false);
        if (!selection.key.publicKey || (selection.candidatePath && payload.privatePath)) {
          this.send({state:'passphraseRequired',message:!selection.key.publicKey ? 'Enter the passphrase to read the selected private key, or select its .pub file to install without an authentication test.' : 'Enter the private key passphrase to unlock and validate this key. For public-only installation, clear the optional private key.'});
          return;
        }
        this.key = selection.key;
        this.passphrase = payload.passphrase || undefined;
        const profile = await this.manager.getProfile(String(payload.targetId || ''));
        if (!profile || profile.connectionType !== 'sftp') throw new Error('Select a saved SFTP connection.');
        this.targetId = profile.id; this.targetVersion = profile.updatedAt; this.target = { name: profile.name, username: profile.username };
        // Override only this isolated deployment session; never save the access draft.
        const access = payload.access;
        const input = {...profile,password:payload.password || undefined,passphrase:payload.connectionPassphrase || undefined,freshPrivateKey:false};
        if (access) {
          if (access.authType !== 'password' && access.authType !== 'privateKey') throw new Error('Select an authentication method for existing SSH access.');
          input.authType = access.authType;
          input.password = undefined; input.passphrase = undefined;
          if (access.authType === 'password') {
            if (!['saved','connection','master'].includes(access.passwordSource)) throw new Error('Select a password source.');
            input.passwordSource = access.passwordSource === 'master' ? 'master' : 'connection';
            if (access.passwordSource === 'saved' && !profile.hasSavedPassword) throw new Error('No connection password is saved. Enter a password or select Master Password.');
            if (access.passwordSource === 'connection') {
              if (typeof access.password !== 'string' || !access.password) throw new Error('Enter a password for existing SSH access.');
              input.password = access.password;
            }
            input.freshPrivateKey = true;
          } else {
            input.privateKeyPath = String(access.privateKeyPath || '').trim();
            if (!input.privateKeyPath) throw new Error('Select a private key for existing SSH access.');
            const sameKey = input.privateKeyPath === profile.privateKeyPath && profile.authType === 'privateKey';
            if (access.passphraseSource === 'saved') {
              if (!sameKey || !profile.hasSavedPassphrase) throw new Error('The saved passphrase is available only for the current connection key.');
            } else if (access.passphraseSource !== 'enter') throw new Error('Select a passphrase source.');
            input.freshPrivateKey = access.passphraseSource !== 'saved';
            input.passphrase = input.freshPrivateKey ? String(access.passphrase || '') : undefined;
          }
        }
        const options = await this.manager.buildConnectOptions(input);
        remoteChecksStarted = true;
        const review = await this.deployment.prepare(options,this.key,token);
        if(token.isCancellationRequested) throw new Error('Deployment review cancelled.');
        this.send('configurationUnavailable' in review ? {state:'unavailable',reason:review.reason,key:this.key} : {state:'review',review,key:this.key,target:this.target});
      } else if (action === 'discover') {
        const discovery = await this.deployment.discover(token);
        this.send({state:'destinations',discovery,key:this.key,target:this.target});
      } else if (action === 'select' || action === 'additional') {
        const names = action === 'additional' ? this.deployment.additionalDestinations() : payload.destinations;
        const reviews = await this.deployment.select(names,token);
        this.send({state:'review',reviews,key:this.key,target:this.target,assisted:true});
      } else if (action === 'deploy') {
        this.committing = true;
        const installed = await this.deployment.deploy();
        this.result = installed;
        this.committing = false;
        this.send({state:'testing',result:installed});
        if (installed.installed) installed.authentication = await this.deployment.test(this.passphrase,token);
        this.send({state:'result',result:installed,key:this.key,additional:installed.authentication === 'failed' ? this.deployment.additionalDestinations() : []});
        await this.deployment.release();
      } else if (action === 'use') {
        if (this.result?.authentication !== 'passed' || !this.key?.privatePath || !this.targetId) throw new Error('Successful key-only authentication is required before updating the connection.');
        const checked = await inspectKey(this.key.privatePath,this.passphrase);
        if(checked.fingerprint!==this.key.fingerprint) throw new Error('The private key changed after authentication testing. Review deployment again.');
        const profile = await this.manager.getProfile(this.targetId);
        if (!profile || profile.updatedAt !== this.targetVersion) throw new Error('The connection changed. Review deployment again before updating it.');
        await this.manager.saveProfile({...profile,authType:'privateKey',privateKeyPath:this.key.privatePath,passphrase:this.passphrase || '',rememberPassphrase:false,rememberPassword:false});
        await this.refresh();
        this.send({state:'configured',message:'Connection configured to use the SSH key. Passphrase will be requested when needed.'});
      }
    } catch(error) {
      this.send({state:remoteChecksStarted || ['discover','select','additional'].includes(action) ? 'manual' : 'error',key:this.key,result:this.result,message:error instanceof Error ? error.message : 'SSH key operation failed.'});
      await this.deployment.close();
    } finally {
      this.committing = false; this.busy = false;
      if(token.isCancellationRequested) { this.send({state:'cancelled',result:this.result,key:this.key}); await this.reset(); }
      this.source?.dispose(); this.source=undefined;
      if(this.disposed) await this.reset();
    }
  }
  private async reset(): Promise<void> { await this.deployment.close();this.key=undefined;this.passphrase=undefined;this.targetId=undefined;this.targetVersion=undefined;this.target=undefined;this.result=undefined; }
  dispose(): void { this.disposed=true; if(!this.committing)this.source?.cancel();if(!this.busy)void this.reset(); }
}
