/** Generic authentication failures do not prove that a server requires a key. */
export function shouldOfferSshKeySetup(connectionType: string | undefined, privateKeyPath: string | undefined, message: string): boolean {
  return connectionType === 'sftp' && !privateKeyPath?.trim()
    && /(?:server|remote host)\s+(?:requires|only accepts)\s+(?:public[ -]?key|SSH key)\s+authentication/i.test(message);
}
