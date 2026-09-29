import type { WorkspaceSyncMapping } from '../types';

const INTERNAL_PATTERNS = [
  '*.remoteedit-*.tmp',
  '.remoteedit-workspace-sync/'
];

export async function loadEffectiveIgnorePatterns(mapping: WorkspaceSyncMapping): Promise<string[]> {
  return [...INTERNAL_PATTERNS, ...(mapping.options.ignorePatterns || [])];
}
