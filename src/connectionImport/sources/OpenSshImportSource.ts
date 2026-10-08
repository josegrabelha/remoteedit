import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { candidate } from './ImportParsing';
import type { ImportCandidate } from '../ConnectionImportTypes';
interface Directive {
  key: string;
  values: string[];
}
export function tokenize(line: string): string[] {
  const parts: string[] = [];
  let token = '',
    quote = '',
    active = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!quote && ch === '#') break;
    if (ch === '"' || ch === "'") {
      if (quote === ch) quote = '';
      else if (!quote) quote = ch;
      else token += ch;
      active = true;
    } else if (
      ch === '\\' &&
      ['"', "'", ' ', '\\', '#'].includes(line[i + 1])
    ) {
      token += line[++i];
      active = true;
    } else if (!quote && /\s|=/.test(ch)) {
      if (active) {
        parts.push(token);
        token = '';
        active = false;
      }
    } else {
      token += ch;
      active = true;
    }
  }
  if (quote) throw new Error('Unterminated SSH configuration quote.');
  if (active) parts.push(token);
  return parts;
}
export function hostMatches(alias: string, patterns: string[]): boolean {
  let positive = false;
  for (let p of patterns) {
    const negate = p.startsWith('!');
    if (negate) p = p.slice(1);
    const re = new RegExp(
      '^' +
        p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
      'i'
    );
    if (re.test(alias)) {
      if (negate) return false;
      positive = true;
    }
  }
  return positive;
}
async function includes(pattern: string): Promise<string[]> {
  const absolute = path.resolve(pattern.replace(/^~(?=[/\\]|$)/, os.homedir()));
  const parsed = path.parse(absolute);
  let dirs = [parsed.root];
  for (const segment of absolute.slice(parsed.root.length).split(path.sep)) {
    const next: string[] = [];
    for (const dir of dirs) {
      if (/[?*]/.test(segment)) {
        let entries: string[] = [];
        try {
          entries = await fs.readdir(dir);
        } catch {
          continue;
        }
        for (const n of entries.sort())
          if (hostMatches(n, [segment])) next.push(path.join(dir, n));
      } else next.push(path.join(dir, segment));
    }
    dirs = next;
    if (dirs.length > 256) throw new Error('SSH Include limit exceeded.');
  }
  return dirs;
}
export async function parseOpenSsh(
  text: string,
  sourcePath: string
): Promise<ImportCandidate[]> {
  const directives: Directive[] = [];
  let files = 0;
  async function read(
    content: string,
    file: string,
    stack: string[]
  ): Promise<void> {
    const real = await fs.realpath(file).catch(() => path.resolve(file));
    if (stack.includes(real) || stack.length > 16 || ++files > 256)
      throw new Error('SSH Include cycle or limit exceeded.');
    for (const line of content.split(/\r?\n/)) {
      const [raw, ...values] = tokenize(line);
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (key === 'include') {
        for (let pattern of values) {
          if (!path.isAbsolute(pattern) && !pattern.startsWith('~'))
            pattern = path.resolve(path.dirname(file), pattern);
          for (const included of await includes(pattern)) {
            let data: Buffer;
            try {
              const stat = await fs.stat(included);
              if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
                throw new Error();
              data = await fs.readFile(included);
            } catch (e: any) {
              if (e.code === 'ENOENT') continue;
              throw new Error('Unable to read SSH Include file.');
            }
            await read(data.toString('utf8'), included, [...stack, real]);
          }
        }
      } else {
        directives.push({ key, values });
        if (directives.length > 20000)
          throw new Error('SSH directive limit exceeded.');
      }
    }
  }
  await read(text, sourcePath, []);
  const aliases = [
    ...new Set(
      directives
        .filter((d) => d.key === 'host')
        .flatMap((d) => d.values)
        .filter((v) => v && !/[!*?]/.test(v))
    )
  ];
  const result = aliases.map((alias) => {
    const fields: Record<string, string[]> = Object.create(null);
    let active = true,
      conditionalMatch = false,
      applicableIdentityFiles = 0;
    for (const d of directives) {
      if (d.key === 'host') {
        active = hostMatches(alias, d.values);
        continue;
      }
      if (d.key === 'match') {
        active = false;
        const values = d.values.map((v) => v.toLowerCase());
        if (values.includes('all')) conditionalMatch = true;
        for (let i = 0; i < d.values.length; i++) {
          const criterion = values[i];
          if ((criterion === 'host' || criterion === 'originalhost') && d.values[i + 1]) {
            const patterns = d.values[++i].split(',').filter(Boolean);
            if (hostMatches(alias, patterns)) conditionalMatch = true;
          } else if (!['host', 'originalhost', 'canonical', 'final'].includes(criterion)) {
            conditionalMatch = true;
          }
        }
        continue;
      }
      if (active) {
        if (d.key === 'identityfile') applicableIdentityFiles++;
        if (!fields[d.key]) fields[d.key] = d.values;
      }
    }
    const one = (key: string) => fields[key]?.join(' ') || '';
    const c = candidate('openssh', sourcePath, alias, one('hostname') || alias);
    c.alias = alias;
    c.profile.username = one('user') || os.userInfo().username;
    c.profile.port = one('port') || 22;
    const expand = (v: string) =>
      v
        .replace(/%%/g, '\u0000')
        .replace(/%h/g, String(c.profile.host))
        .replace(/%n/g, alias)
        .replace(/%r/g, String(c.profile.username))
        .replace(/%p/g, String(c.profile.port))
        .replace(/%d/g, os.homedir())
        .replace(/%u/g, os.userInfo().username)
        .replace(/\u0000/g, '%');
    if (one('hostname')) c.profile.host = expand(one('hostname'));
    const key = one('identityfile');
    if (key && key !== 'none') {
      c.profile.authType = 'privateKey';
      c.profile.privateKeyPath = expand(key);
    }
    if (one('proxyjump') && one('proxyjump') !== 'none')
      c.jumpAlias = one('proxyjump');
    if (one('proxycommand') && one('proxycommand') !== 'none')
      c.unsupported =
        'ProxyCommand cannot be represented as a saved jump connection.';
    if (conditionalMatch)
      c.warnings.push(
        'Conditional Match rules may override this host and are not imported.'
      );
    c.ignored = Object.keys(fields).filter(
      (k) =>
        !['hostname', 'user', 'port', 'identityfile', 'proxyjump'].includes(k)
    );
    if (applicableIdentityFiles > 1)
      c.warnings.push('Only the first applicable IdentityFile is imported.');
    return c;
  });
  for (const c of [...result]) {
    if (!c.jumpAlias) continue;
    const hops = c.jumpAlias.split(',');
    if (hops.length > 16) {
      c.unsupported = 'Jump chain exceeds the supported limit.';
      continue;
    }
    if (hops.length === 1 && result.some((p) => p.alias === c.jumpAlias))
      continue;
    let previous: string | undefined;
    for (let index = 0; index < hops.length; index++) {
      const m = /^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(
        hops[index]
      );
      if (!m) {
        c.unsupported = 'Jump host syntax could not be resolved.';
        break;
      }
      const host = m[2].replace(/^\[|\]$/g, ''),
        base = result.find((p) => p.alias === host);
      const hop = candidate(
        'openssh',
        sourcePath,
        String(c.profile.name) + ' — jump ' + (index + 1),
        host
      );
      if (base) {
        hop.profile = { ...base.profile, name: hop.profile.name };
        hop.warnings = [...base.warnings];
        hop.ignored = [...base.ignored];
        hop.unsupported = base.unsupported;
      }
      hop.alias = String(c.alias) + '::jump::' + index;
      hop.jumpAlias = previous || base?.jumpAlias;
      if (m[1]) hop.profile.username = m[1];
      else if (!base) hop.profile.username = os.userInfo().username;
      if (m[3]) hop.profile.port = m[3];
      result.push(hop);
      previous = hop.alias;
    }
    if (previous) c.jumpAlias = previous;
  }
  for (const c of result) {
    const seen = new Set<string>();
    let current: ImportCandidate | undefined = c;
    while (current?.jumpAlias) {
      if (seen.has(current.jumpAlias)) {
        c.unsupported = 'Cyclic ProxyJump configuration.';
        break;
      }
      seen.add(current.jumpAlias);
      current = result.find((p) => p.alias === current!.jumpAlias);
      if (!current) {
        c.unsupported = 'Jump host alias could not be resolved.';
        break;
      }
    }
  }
  return result;
}
