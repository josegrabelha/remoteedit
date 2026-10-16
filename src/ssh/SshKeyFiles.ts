import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { utils } from 'ssh2';
import { expandHomePath } from '../utils/localPathUtils';

export interface KeyDetails {
  type: string; bits: number; fingerprint: string; publicKey: string;
  privatePath?: string; publicPath?: string; comment?: string;
}
export interface GenerateKeyInput {
  type: 'ed25519' | 'rsa' | 'ecdsa'; bits?: number; location: string; comment?: string; passphrase?: string;
}
export function keyDetails(data: string, passphrase?: string): KeyDetails {
  const parsed = utils.parseKey(data, passphrase);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Invalid or encrypted SSH key. Supply the correct passphrase and a single supported key.');
  const raw = parsed.getPublicSSH();
  let offset = 0;
  const field = () => { const length = raw.readUInt32BE(offset); offset += 4; const value = raw.subarray(offset, offset + length); offset += length; return value; };
  const type = field().toString();
  let bits = 256;
  if (type === 'ssh-rsa') { field(); const n = field(); const first = n.findIndex(x => x !== 0); bits = first < 0 ? 0 : (n.length - first - 1) * 8 + (32 - Math.clz32(n[first])); }
  else if (type.startsWith('ecdsa-sha2-')) bits = Number(field().toString().replace('nistp', ''));
  else if (type !== 'ssh-ed25519') throw new Error('This SSH key algorithm is not supported by SSH Key Tools.');
  return { type, bits, fingerprint: 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, ''), publicKey: type + ' ' + raw.toString('base64'), comment: parsed.comment || '' };
}
export function validatePublicKey(data: string): KeyDetails {
  const value = data.trim();
  if (value.includes('\n') || value.includes('\r') || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+[A-Za-z0-9+/]+=*(?:\s+[^\r\n]*)?$/.test(value)) throw new Error('Select a single OpenSSH public key without authorized_keys options.');
  // OpenSSH public comments follow the base64 payload and may contain spaces.
  const comment = value.match(/^\S+\s+\S+(?:\s+(.+))?$/)?.[1] || '';
  return { ...keyDetails(value), publicKey: value, comment };
}
export async function inspectKey(location: string, passphrase?: string): Promise<KeyDetails> {
  const file = path.resolve(expandHomePath(location));
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Select an SSH key file smaller than 1 MiB.');
  const data = await fs.readFile(file, 'utf8');
  if (!data.includes('PRIVATE KEY')) return { ...validatePublicKey(data), publicPath: file };
  const details = keyDetails(data, passphrase);
  const parsed = utils.parseKey(data, passphrase);
  if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey()) throw new Error('A private SSH key is required.');
  let publicPath: string | undefined;
  try {
    const companion = validatePublicKey(await fs.readFile(file + '.pub', 'utf8'));
    if (companion.fingerprint !== details.fingerprint) throw new Error('The public and private key files do not match.');
    publicPath = file + '.pub'; details.publicKey = companion.publicKey; details.comment = companion.comment;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { ...details, privatePath: file, publicPath };
}
/** Local identity is a default only; an explicitly empty comment stays empty. */
export function defaultKeyComment(): string {
  try {
    const username = os.userInfo().username, hostname = os.hostname();
    return username && hostname ? (username + '@' + hostname).replace(/[\r\n\x00]/g, '') : '';
  } catch { return ''; }
}

export interface DeploymentKeySelection {
  key: KeyDetails;
  requiresPassphrase: boolean;
  candidatePath?: string;
}
/** Inspect locally without ever sending private bytes or parser errors to the webview. */
export async function resolveDeploymentKey(location: string, privatePath = '', passphrase?: string, autoDetect = true): Promise<DeploymentKeySelection> {
  const readPrivate = async (file: string) => {
    const resolved = path.resolve(expandHomePath(file));
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Select an SSH key file smaller than 1 MiB.');
    const data = await fs.readFile(resolved, 'utf8');
    if (!data.includes('PRIVATE KEY')) throw new Error('A private SSH key is required.');
    const parsed = utils.parseKey(data);
    const encrypted = parsed instanceof Error && /encrypted|passphrase/i.test(parsed.message);
    return { resolved, encrypted };
  };
  let key: KeyDetails;
  try { key = await inspectKey(location, passphrase); }
  catch (error) {
    const main = await readPrivate(location);
    if (main.encrypted && !passphrase) return { key: { type:'', bits:0, fingerprint:'', publicKey:'' }, requiresPassphrase:true, candidatePath:main.resolved };
    throw error;
  }
  if (key.privatePath) {
    const main = await readPrivate(key.privatePath);
    return { key, requiresPassphrase:main.encrypted };
  }
  const explicit = !!privatePath.trim();
  const candidate = explicit ? privatePath.trim() : autoDetect && key.publicPath?.endsWith('.pub') ? key.publicPath.slice(0,-4) : undefined;
  if (!candidate) return { key, requiresPassphrase:false };
  try {
    const info = await readPrivate(candidate);
    if (info.encrypted && !passphrase) return { key, requiresPassphrase:true, candidatePath:info.resolved };
    const matching = await inspectKey(candidate, passphrase);
    if (!matching.privatePath || matching.fingerprint !== key.fingerprint) throw new Error('The selected private key does not match the public key.');
    key.privatePath = matching.privatePath;
    return { key, requiresPassphrase:info.encrypted };
  } catch (error) {
    if (explicit || passphrase) throw error;
    // A missing, invalid or mismatched companion never prevents public-only deployment.
    return { key, requiresPassphrase:false };
  }
}

export async function protectPrivateFile(file: string): Promise<void> {
  if (process.platform !== 'win32') { await fs.chmod(file, 0o600); return; }
  // SID lookup avoids localized Windows group names. No secrets enter the process arguments.
  const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'))); Set-Acl -LiteralPath $p -AclObject $acl; $a=Get-Acl -LiteralPath $p; if(!$a.AreAccessRulesProtected){throw 'Private key ACL verification failed'}`;
  await new Promise<void>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 15000 }, error => error ? reject(new Error('Could not protect the private SSH key with Windows ACLs.')) : resolve()));
}
export async function generateKey(input: GenerateKeyInput, cancelled: () => boolean = () => false): Promise<KeyDetails> {
  if (!['ed25519', 'rsa', 'ecdsa'].includes(input.type)) throw new Error('Unsupported SSH key type.');
  if (input.type === 'rsa' && ![3072,4096].includes(Number(input.bits))) throw new Error('RSA size must be 3072 or 4096.');
  if (input.type === 'ecdsa' && ![256,384,521].includes(Number(input.bits))) throw new Error('ECDSA size must be 256, 384 or 521.');
  if (/[\r\n\x00]/.test(input.comment || '')) throw new Error('The key comment must be a single line.');
  if (!input.location.trim()) throw new Error('Choose a save location.');
  const file = path.resolve(expandHomePath(input.location));
  const parent = path.dirname(file);
  const defaultDirectory = path.join(os.homedir(), '.ssh');
  if (parent === defaultDirectory) await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Choose an existing directory without symbolic links.');
  for (const name of [file, file + '.pub']) {
    try { await fs.lstat(name); throw new Error('A key file already exists. Choose another name; existing keys are never overwritten.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  // ssh2 1.17.0 can occasionally truncate an Ed25519 public key when its first
  // byte is zero (upstream issue #1513). Reject the malformed pair and retry
  // before creating either file; never weaken validation or overwrite a key.
  const validationAttempts = input.type === 'ed25519' ? 5 : 1;
  let validated: { keys: { private: string; public: string }; details: KeyDetails } | undefined;
  for (let attempt = 0; attempt < validationAttempts; attempt++) {
    if (cancelled()) throw new Error('SSH key generation cancelled. No key files were written.');
    const keys = await new Promise<{private: string; public: string}>((resolve,reject) => utils.generateKeyPair(input.type, {
      ...(input.type !== 'ed25519' ? { bits: input.bits } : {}), comment: input.comment || '',
      ...(input.passphrase ? { passphrase: input.passphrase, cipher: 'aes256-ctr', rounds: 100 } : {})
    }, (error, result) => error ? reject(new Error('SSH key generation failed.')) : resolve(result)));
    if (cancelled()) throw new Error('SSH key generation cancelled. No key files were written.');
    try {
      const details = keyDetails(keys.private, input.passphrase);
      if (details.fingerprint !== validatePublicKey(keys.public).fingerprint) throw new Error('Generated SSH key pair validation failed.');
      validated = { keys, details };
      break;
    } catch (error) {
      if (attempt === validationAttempts - 1) throw error;
    }
  }
  if (!validated) throw new Error('Generated SSH key pair validation failed.');
  const { keys, details } = validated;
  let privateCreated = false, publicCreated = false;
  let privateHandle: fs.FileHandle | undefined, publicHandle: fs.FileHandle | undefined;
  try {
    privateHandle = await fs.open(file, 'wx', 0o600); privateCreated = true;
    await protectPrivateFile(file);
    await privateHandle.writeFile(keys.private + '\n'); await privateHandle.close(); privateHandle=undefined;
    publicHandle = await fs.open(file + '.pub', 'wx', 0o644); publicCreated = true;
    await publicHandle.writeFile(keys.public + '\n'); await publicHandle.close(); publicHandle=undefined;
    return { ...details, publicKey: keys.public, comment: input.comment || '', privatePath: file, publicPath: file + '.pub' };
  } catch (error) {
    await privateHandle?.close().catch(() => {}); await publicHandle?.close().catch(() => {});
    if (publicCreated) await fs.unlink(file + '.pub').catch(() => {});
    if (privateCreated) await fs.unlink(file).catch(() => {});
    throw error;
  }
}
