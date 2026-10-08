import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { sourceNames, type SourceId } from './ConnectionImportTypes';
export async function readConfig(file: string): Promise<string> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
    throw new Error(
      'Configuration file exceeds the 2 MiB limit or is not a file.'
    );
  const b = await fs.readFile(file);
  if (b[0] === 255 && b[1] === 254) return b.subarray(2).toString('utf16le');
  if (b[0] === 254 && b[1] === 255)
    return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  return b.toString('utf8').replace(/^\uFEFF/, '');
}
export const registryKeys = {
  winscp: ['HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions'],
  putty: ['HKCU\\Software\\SimonTatham\\PuTTY\\Sessions']
};
export async function readRegistry(
  source: 'winscp' | 'putty',
  key: string
): Promise<string> {
  if (process.platform !== 'win32' || !registryKeys[source].includes(key))
    throw new Error('Registry source unavailable.');
  const { stdout } = await promisify(execFile)(
    'reg.exe',
    ['query', key, '/s'],
    { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 }
  );
  let result = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (/^HKEY_CURRENT_USER\\/i.test(line)) {
      const name =
        source === 'winscp'
          ? 'Sessions\\' + line.split(/\\Sessions\\/i)[1]
          : line;
      result += '\n[' + name + ']\n';
    } else {
      const m = /^\s+(.+?)\s+REG_(SZ|DWORD)\s+(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2] === 'DWORD' ? String(parseInt(m[3], 16)) : m[3];
      result +=
        source === 'winscp'
          ? m[1] + '=' + value + '\n'
          : '"' +
            m[1] +
            '"="' +
            value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') +
            '"\n';
    }
  }
  return result;
}
/** Enumerate the regular session files saved by PuTTY on Unix systems. */
export async function findPuttyUnixSessions(
  directory: string
): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() &&
        entry.name !== 'Default%20Settings' && entry.name !== 'Default Settings')
      .map((entry) => path.join(directory, entry.name))
      .sort()
      .slice(0, 2000);
  } catch {
    return [];
  }
}

export async function detectPaths(
  workspacePaths: string[]
): Promise<Record<SourceId, string[]>> {
  const home = os.homedir(),
    app = process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const guesses: Record<SourceId, string[]> = {
    openssh: [path.join(home, '.ssh', 'config')],
    filezilla: [
      path.join(config, 'filezilla', 'sitemanager.xml'),
      path.join(home, '.filezilla', 'sitemanager.xml'),
      path.join(app, 'FileZilla', 'sitemanager.xml')
    ],
    winscp: [path.join(app, 'WinSCP.ini')],
    putty: [],
    sshfs: workspacePaths.map((p) => path.join(p, '.vscode', 'settings.json')),
    sftp: workspacePaths.map((p) => path.join(p, '.vscode', 'sftp.json'))
  };
  for (const edition of ['Code', 'Code - Insiders', 'VSCodium'])
    guesses.sshfs.push(
      process.platform === 'darwin'
        ? path.join(
            home,
            'Library',
            'Application Support',
            edition,
            'User',
            'settings.json'
          )
        : process.platform === 'win32'
          ? path.join(app, edition, 'User', 'settings.json')
          : path.join(config, edition, 'User', 'settings.json')
    );
  if (process.platform === 'darwin' || process.platform === 'linux')
    guesses.putty.push(
      ...(await findPuttyUnixSessions(path.join(home, '.putty', 'sessions')))
    );
  for (const id of Object.keys(sourceNames) as SourceId[]) {
    const found: string[] = [];
    for (const file of [...new Set(guesses[id])])
      try {
        if ((await fs.stat(file)).isFile()) found.push(file);
      } catch {}
    guesses[id] = found;
  }
  return guesses;
}
