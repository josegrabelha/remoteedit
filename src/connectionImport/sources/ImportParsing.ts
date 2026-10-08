import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse, type ParseError } from 'jsonc-parser';
import { randomUUID } from 'crypto';
import type { ImportCandidate, SourceId } from '../ConnectionImportTypes';
export function candidate(
  source: SourceId,
  sourcePath: string,
  name: string,
  host: string,
  protocol = 'sftp'
): ImportCandidate {
  return {
    id: randomUUID(),
    source,
    sourcePath,
    profile: {
      name,
      host,
      connectionType: protocol,
      port: protocol === 'sftp' ? 22 : 21,
      username: '',
      authType: 'password',
      passwordSource: 'connection',
      startPath: '',
      keepAlive: true
    },
    warnings: [],
    ignored: []
  };
}
export function json(text: string): any {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object')
    throw new Error('Invalid JSON configuration.');
  return value;
}
export function xml(text: string, ordered = false): any {
  // Never resolve DTDs or user-defined entities. The standard plist DOCTYPE is harmless.
  if (
    /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text) ||
    XMLValidator.validate(text) !== true
  )
    throw new Error('Invalid or unsafe XML configuration.');
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: ordered
  }).parse(text);
}
export function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
export function scalar(value: any): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : value && typeof value['#text'] === 'string'
      ? value['#text']
      : '';
}
export function ini(
  text: string
): { name: string; values: Record<string, string> }[] {
  const sections: { name: string; values: Record<string, string> }[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      current = { name: section[1], values: Object.create(null) };
      sections.push(current);
      continue;
    }
    if (!current || /^\s*[;#]/.test(line)) continue;
    const entry = /^\s*([^=]+?)\s*=(.*)$/.exec(line);
    if (entry) current.values[entry[1].toLowerCase()] = entry[2].trim();
  }
  if (!sections.length) throw new Error('No configuration sections found.');
  return sections;
}
export function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export function credential(
  c: ImportCandidate,
  password: unknown,
  passphrase?: unknown
): void {
  if (typeof password === 'string' && password) {
    c.profile.password = password;
    c.profile.rememberPassword = true;
  }
  if (typeof passphrase === 'string' && passphrase) {
    c.profile.passphrase = passphrase;
    c.profile.rememberPassphrase = true;
  }
}
