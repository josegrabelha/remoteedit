import type { ArchiveFormat } from './PanelTypes';

export function normalizeArchiveFormat(format: string): ArchiveFormat | '' {
  switch (format) {
    case 'tar.gz':
    case 'tar.bz2':
    case 'tar.xz':
    case 'tar.Z':
      return format;
    default:
      return '';
  }
}

export function normalizeArchiveName(value: string, format: ArchiveFormat): string {
  const extension = `.${format}`;
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith(extension) ? trimmed : `${trimmed}${extension}`;
}

export function buildArchiveBaseName(entries: Array<{ name: string }>): string {
  if (entries.length !== 1) {
    return 'archive';
  }

  const rawName = entries[0].name || 'archive';
  const withoutKnownArchiveExtension = rawName
    .replace(/\.tar\.gz$/i, '')
    .replace(/\.tar\.bz2$/i, '')
    .replace(/\.tar\.xz$/i, '')
    .replace(/\.tar\.z$/i, '');

  return withoutKnownArchiveExtension || rawName || 'archive';
}
