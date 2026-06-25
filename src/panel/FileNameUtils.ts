const COMPOUND_FILE_EXTENSIONS = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tar.Z',
  '.tar.lz',
  '.tar.lzma',
  '.tar.zst'
];


export function formatBackupFileDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildCopyFileName(fileName: string, copyIndex: number): string {
  const suffix = `_copy${copyIndex <= 1 ? '' : copyIndex}`;
  const lowerName = fileName.toLowerCase();
  const compoundExtension = COMPOUND_FILE_EXTENSIONS.find(extension => lowerName.endsWith(extension.toLowerCase()));

  if (compoundExtension) {
    const originalExtension = fileName.slice(fileName.length - compoundExtension.length);
    const baseName = fileName.slice(0, fileName.length - compoundExtension.length);
    return `${baseName}${suffix}${originalExtension}`;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  const hasSimpleExtension = lastDotIndex > 0;

  if (!hasSimpleExtension) {
    return `${fileName}${suffix}`;
  }

  const baseName = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);
  return `${baseName}${suffix}${extension}`;
}

