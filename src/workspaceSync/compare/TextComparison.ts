export interface ComparisonLine {
  kind: 'same' | 'removed' | 'added';
  localLine?: number;
  remoteLine?: number;
  text: string;
}

/** A bounded line comparison. Large replacements use a valid, non-minimal edit script. */
export function compareText(local: string, remote: string): ComparisonLine[] {
  const a = local.split('\n');
  const b = remote.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const result: ComparisonLine[] = [];
  let i = 0, j = 0;
  const same = () => { result.push({ kind: 'same', localLine: i + 1, remoteLine: j + 1, text: a[i] }); i++; j++; };
  const remove = () => { result.push({ kind: 'removed', localLine: i + 1, text: a[i++] }); };
  const add = () => { result.push({ kind: 'added', remoteLine: j + 1, text: b[j++] }); };
  while (i < prefix) same();
  const m = a.length - prefix - suffix, n = b.length - prefix - suffix;
  if (m * n <= 2_000_000) {
    const width = n + 1;
    const grid = new Uint32Array((m + 1) * width);
    for (let x = m - 1; x >= 0; x--) for (let y = n - 1; y >= 0; y--) {
      grid[x * width + y] = a[prefix + x] === b[prefix + y]
        ? 1 + grid[(x + 1) * width + y + 1]
        : Math.max(grid[(x + 1) * width + y], grid[x * width + y + 1]);
    }
    while (i < a.length - suffix && j < b.length - suffix) {
      if (a[i] === b[j]) same();
      else if (grid[(i - prefix + 1) * width + j - prefix] >= grid[(i - prefix) * width + j - prefix + 1]) remove();
      else add();
    }
  }
  while (i < a.length - suffix) remove();
  while (j < b.length - suffix) add();
  while (i < a.length) same();
  return result;
}
