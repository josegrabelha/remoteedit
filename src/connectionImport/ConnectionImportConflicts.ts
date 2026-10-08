import type {
  ConnectionProfile,
  ConnectionProfileInput
} from '../connection/ConnectionManager';
export function sameEndpoint(
  a: ConnectionProfileInput,
  b: ConnectionProfileInput
): boolean {
  return (
    String(a.connectionType) === String(b.connectionType) &&
    String(a.host).toLowerCase() === String(b.host).toLowerCase() &&
    Number(a.port) === Number(b.port) &&
    a.username === b.username
  );
}
export function conflicts(
  profile: ConnectionProfileInput,
  existing: ConnectionProfile[]
): ConnectionProfile[] {
  return existing.filter(
    (p) =>
      p.name.toLowerCase() === String(profile.name).toLowerCase() ||
      sameEndpoint(profile, p)
  );
}
export const visibleFields = [
  'name',
  'connectionType',
  'host',
  'port',
  'username',
  'authType',
  'startPath',
  'privateKeyPath',
  'jumpProfileId'
] as const;
export function publicProfile(
  profile: ConnectionProfileInput
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of visibleFields) {
    const value = profile[key];
    if (typeof value === 'string' || typeof value === 'number')
      result[key] = value;
  }
  return result;
}
