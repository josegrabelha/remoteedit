export interface DeleteConfirmationEntry {
  name: string;
  path: string;
  type: string;
}

export function buildDeleteEntriesConfirmationDetail(entries: DeleteConfirmationEntry[]): string {
  if (entries.length > 3) {
    return `Selected items: ${entries.length}`;
  }

  const listedItems = entries
    .map(entry => `• ${entry.path}`)
    .join('\n');

  return `Selected items:\n${listedItems}`;
}
