import { createHash } from 'crypto';
import { utils } from 'ssh2';

export class HostKeySecurityError extends Error {
  readonly code = 'SSH_HOST_KEY_REJECTED';
  constructor(message: string) { super(`SSH host key verification: ${message}`); this.name = 'HostKeySecurityError'; }
}
export interface HostKeyIdentity { keyType: string; publicKey: string; fingerprint: string; }
export function identifyHostKey(raw: Buffer): HostKeyIdentity {
  if (!Buffer.isBuffer(raw) || raw.length < 5) throw new HostKeySecurityError('Invalid server public key.');
  const length = raw.readUInt32BE(0);
  if (length > raw.length - 4 || !length) throw new HostKeySecurityError('Invalid server public key.');
  const keyType = raw.subarray(4, 4 + length).toString('ascii');
  if (keyType.includes('-cert-')) throw new HostKeySecurityError('SSH host certificates are not supported.');
  const publicKey = `${keyType} ${raw.toString('base64')}`;
  const parsed = utils.parseKey(publicKey);
  if (parsed instanceof Error || Array.isArray(parsed) || parsed.type !== keyType) throw new HostKeySecurityError('Invalid or unsupported server public key.');
  return { keyType, publicKey, fingerprint: 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '') };
}
export function parsePublicKey(type: string, encoded: string): HostKeyIdentity {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HostKeySecurityError('Invalid public key encoding.');
  const raw = Buffer.from(encoded, 'base64');
  if (raw.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new HostKeySecurityError('Invalid public key encoding.');
  const identity = identifyHostKey(raw);
  if (identity.keyType !== type) throw new HostKeySecurityError('Public key algorithm does not match its data.');
  return identity;
}
export function normalizeHost(host: string): string {
  const value = host.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!value || /[\s,|!*?]/.test(value)) throw new HostKeySecurityError('Invalid SSH host name.');
  return value;
}
export function hostToken(host: string, port: number): string {
  return port === 22 ? normalizeHost(host) : `[${normalizeHost(host)}]:${port}`;
}
