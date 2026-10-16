import { inspectKey, type KeyDetails } from './SshKeyFiles';
import type { ConnectOptions } from '../remote/RemoteSessionTypes';
import { SftpSessionManager } from './SftpSessionManager';
import { shellQuote } from '../utils/shellUtils';
export interface DeploymentReview { destination: string; platform: string; digest: string; alreadyInstalled: boolean; permissions: string; exists?: boolean; directoryExists?: boolean; username?: string; assisted?: boolean; assistedName?: string; directoryIdentity?: string; }
export interface DeploymentResult { installed: boolean; alreadyInstalled?: boolean; authentication: 'passed' | 'failed' | 'unavailable' | 'cancelled'; message?: string; destinations?: { destination: string; installed: boolean; alreadyInstalled?: boolean; message?: string }[]; }
export interface ConfigurationUnavailable { configurationUnavailable: true; reason: string; platform: string; }
export interface AssistedDestination { name: string; review?: DeploymentReview; reason?: string; }
export interface AssistedDiscovery { destinations: AssistedDestination[]; reason: string; }
export function posixDeploymentScript(key: string, expected?: DeploymentReview, assistedName?: string): string {
  return `import os,sys,json,stat,subprocess,hashlib,tempfile,pwd,shlex,shutil
key=${JSON.stringify(key)}
expected=${expected ? JSON.stringify(expected.digest) : 'None'}
expected_path=${expected ? JSON.stringify(expected.destination) : 'None'}
uid=os.getuid();home=os.path.normpath(pwd.getpwuid(uid).pw_dir);user=pwd.getpwuid(uid).pw_name
assisted_name=${JSON.stringify(assistedName || '')}
if assisted_name and assisted_name not in ['authorized_keys','authorized_keys2']: raise Exception('Unsupported assisted destination.')
connection=os.environ.get('SSH_CONNECTION','').split()
if len(connection)!=4: raise Exception('Cannot identify the SSH connection for effective configuration checks.')
addr=connection[0];laddr=connection[2];lport=connection[3]
processes=subprocess.run(['ps','-ax','-o','command='],capture_output=True,text=True,timeout=5)
if processes.returncode!=0 or any(line.strip() and os.path.basename(line.strip().split()[0]).split(':')[0]=='sshd' and any(arg.startswith(('-f','-o')) for arg in line.strip().split()[1:]) for line in processes.stdout.splitlines()): raise Exception('Custom or unverifiable sshd service configuration requires manual installation.')
conf=None;diagnostics=[]
for binary in ['/usr/sbin/sshd','/usr/local/sbin/sshd','sshd']:
 try:
  context='user='+user+',addr='+addr+',host='+addr+',laddr='+laddr+',lport='+lport
  # Prefer the portable connection-specific test mode. Keep -G as a fallback
  # only where it accepts -C; never drop the connection's Match context.
  for mode in ['-T','-G']:
   p=subprocess.run([binary,mode,'-C',context],capture_output=True,text=True,timeout=4)
   # An unsupported optional -G must not mask the actual -T failure.
   if p.returncode!=0 and mode=='-T': diagnostics.append(p.stderr.strip()[:500])
   if p.returncode==0:
    conf=dict(line.split(' ',1) for line in p.stdout.splitlines() if ' ' in line);break
  if conf: break
 except FileNotFoundError: pass
 except (OSError,subprocess.SubprocessError) as e: diagnostics.append(str(e)[:500])
if not conf and not assisted_name:
 reason=next((d for d in diagnostics if 'ermission denied' in d),next((d for d in diagnostics if d),'SSH server configuration commands are unavailable.'))
 print(json.dumps(dict(configurationUnavailable=True,reason=reason,platform='posix')));sys.exit(0)
if assisted_name and conf: raise Exception('SSH configuration is now available. Restart deployment to use the verified destination.')
if assisted_name:
 target=os.path.join(home,'.ssh',assisted_name)
else:
 if conf.get('usedns')=='yes': raise Exception('DNS-based SSH matching requires manual installation.')
 if conf.get('pubkeyauthentication')!='yes': raise Exception('Public key authentication is disabled.')
 paths=conf.get('authorizedkeysfile','none').split()
 if not paths or paths[0]=='none': raise Exception('No authorized_keys file is configured.')
 target=paths[0].replace('%h',home).replace('%u',user).replace('%U',str(uid))
 if '%' in target: raise Exception('Unsupported AuthorizedKeysFile token.')
 if not os.path.isabs(target): target=os.path.join(home,target)
target=os.path.normpath(target);parent=os.path.dirname(target)
if os.path.dirname(parent)!=home or os.path.basename(parent)!='.ssh': raise Exception('Custom AuthorizedKeysFile requires manual installation.')
for directory in [home,parent]:
 if os.path.lexists(directory):
  s=os.lstat(directory)
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=uid or s.st_mode & 0o022: raise Exception('Unsafe SSH directory ownership or permissions.')
if not os.path.isdir(home): raise Exception('Cannot verify the remote home directory.')
if not os.access(parent if os.path.exists(parent) else home,os.W_OK|os.X_OK): raise Exception('SSH directory is not writable.')
def directory_identity():
 s=os.lstat(parent) if os.path.lexists(parent) else None
 return str(s.st_dev)+':'+str(s.st_ino) if s else 'missing'
if expected is not None and directory_identity()!=${JSON.stringify(expected?.directoryIdentity || "")}: raise Exception('SSH directory changed. Review again.')
def current():
 if not os.path.lexists(target): return b'',None
 s=os.lstat(target)
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=uid or s.st_mode & 0o022: raise Exception('Unsafe authorized_keys ownership, links or permissions.')
 if s.st_size>4194304: raise Exception('authorized_keys is too large for automatic deployment.')
 if not os.access(target,os.W_OK): raise Exception('Authorized keys file is not writable.')
 fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  actual=os.fstat(f.fileno())
  if (actual.st_dev,actual.st_ino)!=(s.st_dev,s.st_ino): raise Exception('Authorized keys file changed during validation.')
  return f.read(),s
old,s=current()
def digest(data): return hashlib.sha256(data).hexdigest()
def contains(data):
 fields=key.split()[:2]
 for line in data.decode('utf-8').splitlines():
  try: parts=shlex.split(line,comments=True)
  except ValueError: continue
  if any(parts[i:i+2]==fields for i in range(len(parts)-1)): return True
 return False
if expected is None:
 print(json.dumps(dict(destination=target,platform='posix',digest=digest(old),alreadyInstalled=contains(old),permissions='Ownership and permissions verified; existing authorized keys preserved',exists=s is not None,directoryExists=os.path.isdir(parent),username=user,assisted=bool(assisted_name),assistedName=assisted_name,directoryIdentity=directory_identity())));sys.exit(0)
if target!=expected_path or digest(old)!=expected or (s is not None)!=${expected?.exists ? 'True' : 'False'}: raise Exception('Remote configuration or authorized_keys changed. Review again.')
if contains(old): print(json.dumps(dict(installed=True,alreadyInstalled=True)));sys.exit(0)
os.makedirs(parent,mode=0o700,exist_ok=True)
parent_identity=directory_identity()
lock=os.path.join(parent,'.remoteedit-key-deploy.lock');os.mkdir(lock,0o700);tmp=None
try:
 now,info=current()
 if digest(now)!=expected or (info is not None)!=${expected?.exists ? 'True' : 'False'} or directory_identity()!=parent_identity: raise Exception('authorized_keys changed. Review again.')
 fd,tmp=tempfile.mkstemp(prefix='.remoteedit-key-',dir=parent)
 with os.fdopen(fd,'wb') as f:
  os.fchmod(f.fileno(),stat.S_IMODE(info.st_mode) if info else 0o600)
  f.write(now+(b'\\n' if now and not now.endswith(b'\\n') else b'')+key.encode('utf-8')+b'\\n');f.flush();os.fsync(f.fileno())
 if info: shutil.copystat(target,tmp,follow_symlinks=False)
 if digest(current()[0])!=expected or directory_identity()!=parent_identity: raise Exception('authorized_keys changed during deployment.')
 os.replace(tmp,target);tmp=None
 print(json.dumps(dict(installed=True,alreadyInstalled=False,directoryIdentity=directory_identity())))
finally:
 if tmp: os.unlink(tmp)
 os.rmdir(lock)
`;
}
export function windowsDeploymentScript(key: string, expected?: DeploymentReview, assistedName?: string): string {
  const encode = (x: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(x).toString('base64')}'))`;
  return `$ErrorActionPreference='Stop'
$key=${encode(key)}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$sid=$identity.User
$sshd=Join-Path $env:WINDIR 'System32\\OpenSSH\\sshd.exe'
if(!(Test-Path -LiteralPath $sshd)){throw 'Cannot locate Windows OpenSSH. Use manual installation.'}
$conn=$env:SSH_CONNECTION -split ' ';if($conn.Length -ne 4){throw 'Cannot verify SSH connection context.'}
$addr=$conn[0]
$service=Get-CimInstance Win32_Service -Filter "Name='sshd'"
if(!$service -or $service.PathName -match '(?:^| )-(?:f|o)(?: |[^ ])'){throw 'Custom sshd service configuration requires manual installation.'}
$context='user='+$env:USERNAME+',addr='+$addr+',host='+$addr+',laddr='+$conn[2]+',lport='+$conn[3]
$config=@();$diagnostics=@();$verified=$false
foreach($mode in @('-G','-T')){
 try{$output=& $sshd $mode -C $context 2>&1;if($LASTEXITCODE -eq 0){$config=$output;$verified=$true;break};$diagnostics+=($output|Out-String)}catch{$diagnostics+=$_.Exception.Message}
}
$assistedName=${encode(assistedName || '')}
if(!$verified -and !$assistedName){[pscustomobject]@{configurationUnavailable=$true;reason=($diagnostics -join [char]10).Substring(0,[Math]::Min(500,($diagnostics -join [char]10).Length));platform='windows'}|ConvertTo-Json -Compress;exit}
if($assistedName -and $assistedName -notin @('authorized_keys','authorized_keys2')){throw 'Unsupported assisted destination.'}

if($assistedName -and $verified){throw 'SSH configuration is now available. Restart deployment to use the verified destination.'}
if($assistedName){
 $isAdmin=$identity.Groups.Value -contains 'S-1-5-32-544'
 $admin=$isAdmin
 if($admin){
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'The standard administrative authorized keys file requires an elevated administrative session and ACL review. Use manual installation.'}
  if($assistedName -ne 'authorized_keys'){throw 'No conventional legacy alternative is offered for administrative accounts.'}
  $p=Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys'
 }else{$p=Join-Path $env:USERPROFILE ('.ssh\\'+$assistedName)}
}else{
$line=$config|Where-Object {$_ -match '^authorizedkeysfile ' }|Select-Object -First 1
if(!($config -contains 'pubkeyauthentication yes') -or !$line){throw 'Public key authentication is unavailable.'}
$p=($line -replace '^authorizedkeysfile ','').Split(' ')[0];$admin=$false
if($p -eq '.ssh/authorized_keys'){$p=Join-Path $env:USERPROFILE '.ssh\\authorized_keys'}
elseif($p -match '^(__PROGRAMDATA__|[Cc]:[/\\\\]ProgramData)[/\\\\]ssh[/\\\\]administrators_authorized_keys$'){$p=Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys';$admin=$true}
else{throw 'Custom AuthorizedKeysFile requires manual installation.'}
}
$parent=Split-Path -Parent $p
if($admin -and !(Test-Path -LiteralPath $parent -PathType Container)){throw 'The administrative SSH directory requires manual setup.'}
function Assert-Writable($path){
 $item=Get-Item -LiteralPath $path
 if($item.Attributes -band [IO.FileAttributes]::ReadOnly){throw 'Destination is read-only.'}
 $principals=@($sid.Value)+@($identity.Groups.Value)
 $required=[Security.AccessControl.FileSystemRights]::Write
 $granted=0
 foreach($rule in (Get-Acl -LiteralPath $path).Access){
  if($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -in $principals){
   if($rule.AccessControlType -eq 'Deny' -and ($rule.FileSystemRights -band $required)){throw 'Destination write access is denied.'}
   if($rule.AccessControlType -eq 'Allow'){$granted=$granted -bor $rule.FileSystemRights}
  }
 }
 if(($granted -band $required) -ne $required){throw 'Destination write access could not be verified.'}
}
Assert-Writable $(if(Test-Path -LiteralPath $parent){$parent}else{$env:USERPROFILE})
if(!(Test-Path -LiteralPath $env:USERPROFILE -PathType Container)){throw 'Cannot verify the remote user profile.'}
foreach($d in @($env:USERPROFILE,$parent)){
 if(Test-Path -LiteralPath $d){
  if(!(Test-Path -LiteralPath $d -PathType Container)){throw 'Unsafe SSH directory.'}
  $da=Get-Acl -LiteralPath $d
  $allowedDirectory=@($sid.Value,'S-1-5-18','S-1-5-32-544')
  if($da.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowedDirectory){throw 'Unsafe SSH directory owner.'}
  foreach($r in $da.Access){if($r.AccessControlType -eq 'Allow' -and ($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedDirectory){throw 'Unsafe SSH directory permissions.'}}
 }
}

foreach($d in @($env:USERPROFILE,$parent)){if(Get-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue){if((Get-Item -LiteralPath $d -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked SSH paths require manual installation.'}}}
function Read-Current {
 $item=Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
 if(!$item){return [byte[]]@()}
 Assert-Writable $p
 if($item.LinkType -eq 'HardLink'){throw 'Linked authorized keys files require manual installation.'}
 if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 4194304){throw 'Unsafe authorized_keys file.'}
 $acl=Get-Acl -LiteralPath $p
 $allowed=@('S-1-5-18','S-1-5-32-544');if(!$admin){$allowed+=$sid.Value}
 $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;if(!($allowed -contains $owner)){throw 'Existing authorized_keys ownership requires manual review.'}
 foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and !($allowed -contains $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value)){throw 'Existing authorized_keys ACL requires manual review.'}}
 return [IO.File]::ReadAllBytes($p)
}
function Hash($data){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash([byte[]]$data))).Replace('-','').ToLower()}finally{$h.Dispose()}}
$old=[byte[]](Read-Current);$digest=Hash $old
$directoryIdentity=if(Test-Path -LiteralPath $parent){(Get-Item -LiteralPath $parent).CreationTimeUtc.Ticks.ToString()}else{'missing'}
$utf8=New-Object Text.UTF8Encoding($false,$true);$oldText=$utf8.GetString($old)
$parts=$key -split '\\s+';$exists=[Text.Encoding]::UTF8.GetString($old) -match ('(?m)(?:^|\\s)'+[regex]::Escape($parts[0])+'\\s+'+[regex]::Escape($parts[1])+'(?:\\s|$)')
${!expected ? `[pscustomobject]@{destination=$p;platform='windows';digest=$digest;alreadyInstalled=$exists;permissions='Windows OpenSSH ACL; existing authorized keys preserved';exists=(Test-Path -LiteralPath $p);directoryExists=(Test-Path -LiteralPath $parent);username=$identity.Name;assisted=[bool]$assistedName;assistedName=$assistedName;directoryIdentity=$directoryIdentity}|ConvertTo-Json -Compress;exit` : `if($p -ne ${encode(expected.destination)} -or $digest -ne '${expected.digest}' -or (Test-Path -LiteralPath $p) -ne $${expected.exists ? 'true' : 'false'} -or $directoryIdentity -ne ${encode(expected.directoryIdentity || '')}){throw 'Remote configuration or authorized_keys changed. Review again.'}`}
if($exists){[pscustomobject]@{installed=$true;alreadyInstalled=$true}|ConvertTo-Json -Compress;exit}
if(!(Test-Path -LiteralPath $parent)){
 [IO.Directory]::CreateDirectory($parent)|Out-Null
 $dirAcl=New-Object Security.AccessControl.DirectorySecurity;$dirAcl.SetAccessRuleProtection($true,$false);$dirAcl.SetOwner($sid)
 foreach($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$sobj=New-Object Security.Principal.SecurityIdentifier($s);$dirAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sobj,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
 Set-Acl -LiteralPath $parent -AclObject $dirAcl
}
$lock=Join-Path $parent '.remoteedit-key-deploy.lock';$guard=[IO.File]::Open($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$tmp=Join-Path $parent ('.remoteedit-key-'+[guid]::NewGuid().ToString()+'.tmp')
try {
 if((Hash ([byte[]](Read-Current))) -ne $digest){throw 'authorized_keys changed during deployment.'}
 $append=if($old.Length -and $old[$old.Length-1] -ne 10){[char]10+$key+[char]10}else{$key+[char]10}
 [IO.File]::WriteAllBytes($tmp,([byte[]]($old+$utf8.GetBytes($append))))
 if(Test-Path -LiteralPath $p){Set-Acl -LiteralPath $tmp -AclObject (Get-Acl -LiteralPath $p)}else{
  $acl=New-Object Security.AccessControl.FileSecurity;$acl.SetAccessRuleProtection($true,$false)
  $owners=@('S-1-5-18','S-1-5-32-544');if(!$admin){$owners+=$sid.Value}
  if($admin){$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))}else{$acl.SetOwner($sid)}
  foreach($s in $owners){$sobj=New-Object Security.Principal.SecurityIdentifier($s);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sobj,'FullControl','Allow')))}
  Set-Acl -LiteralPath $tmp -AclObject $acl
 }
 if((Hash ([byte[]](Read-Current))) -ne $digest){throw 'authorized_keys changed during deployment.'}
 if(Test-Path -LiteralPath $p){[IO.File]::Replace($tmp,$p,$null)}else{[IO.File]::Move($tmp,$p)}
 [pscustomobject]@{installed=$true;alreadyInstalled=$false}|ConvertTo-Json -Compress
}finally{if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp};$guard.Dispose();Remove-Item -LiteralPath $lock}
`;
}
export class SshKeyDeployment {
  private sessions = new SftpSessionManager();
  private options?: ConnectOptions;
  private review?: DeploymentReview;
  private key?: KeyDetails;
  private platform?: string;
  private unavailable?: ConfigurationUnavailable;
  private discovery?: AssistedDiscovery;
  private selected: DeploymentReview[] = [];
  private outcomes: NonNullable<DeploymentResult['destinations']> = [];
  private connectionId = 'ssh-key-tools-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  private token?: import('vscode').CancellationToken;
  async prepare(options: ConnectOptions, key: KeyDetails, token: import('vscode').CancellationToken): Promise<DeploymentReview | ConfigurationUnavailable> {
    await this.close(); this.token = token; this.options = { ...options, connectionId: this.connectionId, startPath: '' }; this.key = key;
    const connection = await this.sessions.connect(this.options, token);
    if (connection.remotePlatform !== 'posix' && connection.remotePlatform !== 'windows') throw new Error('Remote platform is unknown. Use manual installation.');
    this.platform = connection.remotePlatform;
    const response = await this.execute(false, this.platform);
    if (response.configurationUnavailable) { response.reason=String(response.reason || 'SSH configuration commands are unavailable.').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,500); this.unavailable = response; return response; }
    this.review = response;
    return this.review!;
  }
  async discover(token: import('vscode').CancellationToken): Promise<AssistedDiscovery> {
    if (!this.unavailable || !this.platform) throw new Error('Review the SSH configuration failure first.');
    this.token = token;
    const destinations: AssistedDestination[] = [];
    for (const name of ['authorized_keys', 'authorized_keys2']) {
      if (token.isCancellationRequested) throw new Error('Destination discovery cancelled.');
      try {
        const review = await this.execute(false, this.platform, undefined, name);
        destinations.push({ name, review });
        if (review.platform === 'windows' && /administrators_authorized_keys$/i.test(review.destination)) break;
      }
      catch (error) { destinations.push({ name, reason: error instanceof Error ? error.message : 'Destination cannot be verified.' }); }
    }
    // Offer creation only for the conventional primary file; never create a legacy alternative implicitly.
    this.discovery = { reason: this.unavailable.reason, destinations: destinations.filter(d => d.name === 'authorized_keys' || !d.review || d.review.exists) };
    return this.discovery;
  }
  async select(destinations: string[], token: import('vscode').CancellationToken): Promise<DeploymentReview[]> {
    if (!this.discovery || !this.platform || !Array.isArray(destinations) || !destinations.length) throw new Error('Select at least one safe destination.');
    this.token = token;
    this.selected = [];
    const chosen = [...new Set(destinations)].map(name => {
      const candidate = this.discovery!.destinations.find(d => d.name === name && d.review);
      if (!candidate) throw new Error('Invalid deployment destination.');
      return candidate;
    });
    if (!this.options) throw new Error('Deployment session is unavailable. Review again.');
    await this.sessions.connect(this.options,token);
    this.selected = [];
    const reviews: DeploymentReview[] = [];
    for (const candidate of chosen) reviews.push(await this.execute(false, this.platform, undefined, candidate.name));
    this.selected = reviews;
    return reviews;
  }
  additionalDestinations(): string[] {
    return this.discovery?.destinations.filter(d => d.review && !this.outcomes.some(o => o.destination === d.review!.destination)).map(d => d.name) || [];
  }
  async deploy(): Promise<DeploymentResult> {
    if (!this.options || !this.key || (!this.review && !this.selected.length)) throw new Error('Review deployment first.');
    const reviews = this.selected.length ? this.selected : [this.review!];
    const results: NonNullable<DeploymentResult['destinations']> = [];
    for (const review of reviews) {
      try {
        const result = await this.execute(true, review.platform, review, review.assisted ? review.assistedName || review.destination.split(/[\\/]/).pop() : undefined);
        if (!result.installed) throw new Error('The server did not confirm installation. Review this destination manually.');
        if (result.directoryIdentity) for (const pending of reviews) {
          if (pending.directoryIdentity === 'missing' && pending.destination.replace(/[^\\/]+$/, '') === review.destination.replace(/[^\\/]+$/, '')) pending.directoryIdentity = result.directoryIdentity;
        }
        results.push({ destination: review.destination, installed: true, alreadyInstalled: !!result.alreadyInstalled });
      } catch (error) { results.push({ destination: review.destination, installed: false, message: error instanceof Error ? error.message : 'Installation could not be confirmed.' }); }
    }
    this.outcomes.push(...results);
    this.selected = []; this.review = undefined;
    return { installed: this.outcomes.some(r => r.installed), alreadyInstalled: this.outcomes.every(r => r.alreadyInstalled), destinations: [...this.outcomes], authentication: 'unavailable' };
  }
  async test(passphrase?: string, token?: import('vscode').CancellationToken): Promise<DeploymentResult['authentication']> {
    if (!this.options || !this.key?.privatePath) return 'unavailable';
    const testId = this.connectionId + '-test';
    try {
      const checked = await inspectKey(this.key.privatePath, passphrase);
      if (checked.fingerprint !== this.key.fingerprint) return 'failed';
      await this.sessions.connect({ ...this.options, connectionId: testId, authType: 'privateKey', password: undefined, passwordSource: undefined, privateKeyPath: this.key.privatePath, passphrase }, token);
      return 'passed';
    } catch { return token?.isCancellationRequested ? 'cancelled' : 'failed'; }
    finally { await this.sessions.disconnect(testId); }
  }
  private async execute(commit: boolean, platform: string, review?: DeploymentReview, assistedName?: string): Promise<any> {
    const script = platform === 'posix' ? posixDeploymentScript(this.key!.publicKey, commit ? review : undefined, assistedName) : windowsDeploymentScript(this.key!.publicKey, commit ? review : undefined, assistedName);
    const command = platform === 'posix' ? 'python3 -c ' + shellQuote(script) : 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script,'utf16le').toString('base64');
    const client = this.sessions.getSshClientForTerminal(this.connectionId);
    return new Promise((resolve,reject) => {
      let stdout = '', stderr = '', settled = false; let streamRef: any; let subscription: {dispose():void} | undefined;
      const finish = (error?: Error, value?: unknown) => { if (settled) return; settled=true; clearTimeout(timer); subscription?.dispose(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { streamRef?.close(); finish(new Error(commit ? 'Deployment response timed out. Installation may have completed; review the server before retrying.' : 'Remote environment checks timed out.')); }, 30000);
      if(!commit){subscription=this.token?.onCancellationRequested(()=>{streamRef?.close();finish(new Error('Deployment review cancelled.'));});if(this.token?.isCancellationRequested){finish(new Error('Deployment review cancelled.'));return;}}
      client.exec(command, (error, stream) => {
        if(error){finish(error);return;} streamRef=stream; if(settled){stream.close();return;}
        stream.on('data', (chunk: Buffer) => { stdout+=chunk.toString(); if(stdout.length>1048576){stream.close();finish(new Error('Unexpected remote response.'));} });
        stream.stderr.on('data',(chunk: Buffer)=>{stderr=(stderr+chunk.toString()).slice(-2000);});
        stream.on('error',()=>finish(new Error('SSH command failed. Review server state before retrying.')));
        stream.on('close',(code: number)=> {
          if(code!==0){const detail=(stderr.trim().split('\n').pop() || 'Safe deployment is unavailable. Use manual installation.').replace(/^(?:Exception|[A-Za-z]+Error):\s*/, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,500);finish(new Error(detail+(commit?' Installation may have completed; review the server before retrying.':'')));return;}
          try { finish(undefined,JSON.parse(stdout.trim())); } catch {finish(new Error('Could not verify the deployment response. Review server state before retrying.'));}
        });
      });
    });
  }
  async release(): Promise<void> { await this.sessions.disconnectAll(); }
  async close(): Promise<void> { await this.sessions.disconnectAll(); this.review = undefined; this.options=undefined;this.key=undefined;this.token=undefined;this.platform=undefined;this.unavailable=undefined;this.discovery=undefined;this.selected=[];this.outcomes=[]; }
}
