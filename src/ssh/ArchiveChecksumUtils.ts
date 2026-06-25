import { shellQuote } from '../utils/shellUtils';
import type { RemoteArchiveFormat } from '../remote/RemoteSessionTypes';

export interface SftpChecksumCommandAttempt {
  label: string;
  command: (quotedPath: string) => string;
  length: number;
}

export function buildSftpCopyFileCommand(sourcePath: string, targetPath: string, overwrite: boolean): string {
  const source = shellQuote(sourcePath);
  const target = shellQuote(targetPath);
  const targetGuard = overwrite
    ? `if [ -d ${target} ] && [ ! -L ${target} ]; then echo 'Target is a directory.' >&2; exit 21; fi; if [ -L ${target} ]; then echo 'Target is a symbolic link.' >&2; exit 21; fi;`
    : `if [ -e ${target} ] || [ -L ${target} ]; then echo 'Target already exists.' >&2; exit 17; fi;`;

  return `if [ ! -f ${source} ]; then echo 'Source is not a regular file.' >&2; exit 22; fi; ${targetGuard} cp -p ${source} ${target}`;
}

export function buildSftpCreateArchiveCommand(
  baseDirectory: string,
  entryNames: string[],
  archiveName: string,
  format: RemoteArchiveFormat,
  overwrite: boolean
): string {
  const directory = shellQuote(baseDirectory);
  const target = shellQuote(archiveName);
  const tempTar = shellQuote(`.remoteedit-archive-${Date.now()}-${Math.random().toString(16).slice(2)}.tar`);
  const entries = entryNames.map(name => shellQuote(`./${name}`)).join(' ');
  const compression = buildSftpArchiveCompressionCommand(format, tempTar, target, overwrite);
  const compressor = getSftpArchiveCompressorCommand(format);
  const targetGuard = overwrite
    ? `if [ -d ${target} ] && [ ! -L ${target} ]; then echo 'Target archive is a directory.' >&2; exit 21; fi; rm -f ${target}`
    : `if [ -e ${target} ] || [ -L ${target} ]; then echo 'Target archive already exists.' >&2; exit 17; fi`;

  return [
    `cd ${directory}`,
    `if ! command -v tar >/dev/null 2>&1; then echo 'tar command not found on the remote host.' >&2; exit 127; fi`,
    `if ! command -v ${compressor} >/dev/null 2>&1; then echo '${compressor} command not found on the remote host.' >&2; exit 127; fi`,
    targetGuard,
    `rm -f ${tempTar}`,
    `tar -cf ${tempTar} ${entries}`,
    `__remote_edit_status=$?`,
    `if [ $__remote_edit_status -eq 0 ]; then ${compression}; __remote_edit_status=$?; fi`,
    `rm -f ${tempTar}`,
    `exit $__remote_edit_status`
  ].join('; ');
}

function buildSftpArchiveCompressionCommand(format: RemoteArchiveFormat, tempTar: string, target: string, overwrite: boolean): string {
  const redirect = overwrite ? `> ${target}` : `> ${target}`;
  const command = (() => {
    switch (format) {
      case 'tar.gz':
        return `gzip -c ${tempTar} ${redirect}`;
      case 'tar.bz2':
        return `bzip2 -c ${tempTar} ${redirect}`;
      case 'tar.xz':
        return `xz -c ${tempTar} ${redirect}`;
      case 'tar.Z':
        return `compress -c ${tempTar} ${redirect}`;
      default:
        return '';
    }
  })();

  return overwrite ? command : `(set -C; ${command})`;
}

function getSftpArchiveCompressorCommand(format: RemoteArchiveFormat): string {
  switch (format) {
    case 'tar.gz':
      return 'gzip';
    case 'tar.bz2':
      return 'bzip2';
    case 'tar.xz':
      return 'xz';
    case 'tar.Z':
      return 'compress';
    default:
      return 'gzip';
  }
}

export function buildSftpSha256ChecksumAttempts(): SftpChecksumCommandAttempt[] {
  return [
    { label: 'sha256sum', command: quotedPath => `sha256sum ${quotedPath}`, length: 64 },
    { label: 'shasum -a 256', command: quotedPath => `shasum -a 256 ${quotedPath}`, length: 64 },
    { label: 'csum -h SHA256', command: quotedPath => `csum -h SHA256 ${quotedPath}`, length: 64 },
    { label: 'digest -a sha256', command: quotedPath => `digest -a sha256 ${quotedPath}`, length: 64 },
    { label: 'openssl dgst -sha256', command: quotedPath => `openssl dgst -sha256 ${quotedPath}`, length: 64 }
  ];
}

export function buildSftpMd5ChecksumAttempts(): SftpChecksumCommandAttempt[] {
  return [
    { label: 'md5sum', command: quotedPath => `md5sum ${quotedPath}`, length: 32 },
    { label: 'md5', command: quotedPath => `md5 ${quotedPath}`, length: 32 },
    { label: 'csum -h MD5', command: quotedPath => `csum -h MD5 ${quotedPath}`, length: 32 },
    { label: 'digest -a md5', command: quotedPath => `digest -a md5 ${quotedPath}`, length: 32 },
    { label: 'openssl dgst -md5', command: quotedPath => `openssl dgst -md5 ${quotedPath}`, length: 32 }
  ];
}

export function extractSftpChecksum(output: string, length: number): string | undefined {
  const pattern = new RegExp(`\\b[0-9a-fA-F]{${length}}\\b`);
  const match = String(output || '').match(pattern);
  return match ? match[0].toLowerCase() : undefined;
}
