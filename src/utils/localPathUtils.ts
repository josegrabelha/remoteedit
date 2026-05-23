import * as os from 'os';
import * as path from 'path';

export function expandHomePath(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}
