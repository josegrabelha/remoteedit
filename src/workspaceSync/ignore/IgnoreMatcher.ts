import * as path from 'path';

interface CompiledRule {
  negated: boolean;
  matches(value: string, isDirectory: boolean): boolean;
}

/**
 * Lightweight ignore-pattern matcher used only by Workspace Sync.
 * Rules are applied in order and support comments, negation, rooted rules,
 * directory rules, *, ?, and **. It intentionally avoids depending on Git.
 */
export class IgnoreMatcher {
  private readonly rules: CompiledRule[];

  constructor(patterns: string[]) {
    this.rules = (patterns || [])
      .map(parsePattern)
      .filter((rule): rule is CompiledRule => Boolean(rule));
  }

  ignores(relativePath: string, isDirectory = false): boolean {
    const normalized = normalize(relativePath);
    if (!normalized) {
      return false;
    }

    let ignored = false;
    for (const rule of this.rules) {
      if (rule.matches(normalized, isDirectory)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

function parsePattern(input: string): CompiledRule | undefined {
  let pattern = String(input || '').replace(/\r$/, '');
  if (!pattern) return undefined;

  if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('#')) {
    return undefined;
  }

  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  }
  pattern = pattern.trim().replace(/\\/g, '/');
  if (!pattern) return undefined;

  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.replace(/\/+$/, '');
  const anchored = pattern.startsWith('/');
  pattern = pattern.replace(/^\/+/, '');
  const containsSlash = pattern.includes('/');
  const source = globToRegex(pattern);
  const prefix = anchored || containsSlash ? '^' : '(?:^|/)';
  const suffix = directoryOnly ? '(?:/.*)?$' : '$';
  const descendantSuffix = directoryOnly ? '(?:/.*)?$' : '(?:$)';
  const regex = new RegExp(`${prefix}${source}${containsSlash && !anchored ? '' : ''}${directoryOnly ? descendantSuffix : suffix}`);

  return {
    negated,
    matches(value: string, isDirectory: boolean): boolean {
      if (directoryOnly) {
        if (regex.test(value)) return true;
        if (isDirectory && new RegExp(`${prefix}${source}$`).test(value)) return true;
        return false;
      }
      if (regex.test(value)) return true;
      // A basename pattern without a slash applies to any path segment.
      if (!containsSlash && !anchored) {
        return value.split('/').some(segment => new RegExp(`^${source}$`).test(segment));
      }
      return false;
    }
  };
}

function globToRegex(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    out += escapeRegExp(char);
  }
  return out;
}

function normalize(value: string): string {
  return path.posix.normalize(String(value || '').replace(/\\/g, '/')).replace(/^\.\//, '').replace(/^\/+/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
