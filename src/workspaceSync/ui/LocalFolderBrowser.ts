import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export async function listLocalFolders(current: string, workspaceRoots: string[] = []) {
  const directory = await fs.realpath(current || workspaceRoots[0] || os.homedir());
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Select a directory.');
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const shortcuts = [...new Set([os.homedir(), ...workspaceRoots, path.parse(directory).root])];
  if (process.platform === 'win32') {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      try { if ((await fs.stat(drive)).isDirectory() && !shortcuts.includes(drive)) shortcuts.push(drive); } catch { /* absent drive */ }
    }
  }
  return { directory, parent: path.dirname(directory), shortcuts, folders: entries.filter(item => item.isDirectory()).map(item => ({ name: item.name, path: path.join(directory, item.name) })).sort((a, b) => a.name.localeCompare(b.name)) };
}
