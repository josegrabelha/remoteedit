import {
  pbkdf2Sync,
  createHmac,
  createCipheriv,
  timingSafeEqual
} from 'crypto';
// Numeric substitution mapping required by the WinSCP password storage format.
// Format reference: winscp/winscp source/core/Cryptography.cpp.
const substitution = [
  0, 223, 235, 233, 240, 185, 88, 102, 22, 130, 27, 53, 79, 125, 66, 201, 90,
  71, 51, 60, 134, 104, 172, 244, 139, 84, 91, 12, 123, 155, 237, 151, 192, 6,
  87, 32, 211, 38, 149, 75, 164, 145, 52, 200, 224, 226, 156, 50, 136, 190, 232,
  63, 129, 209, 181, 120, 28, 99, 168, 94, 198, 40, 238, 112, 55, 217, 124, 62,
  227, 30, 36, 242, 208, 138, 174, 231, 26, 54, 214, 148, 37, 157, 19, 137, 187,
  111, 228, 39, 110, 17, 197, 229, 118, 246, 153, 80, 21, 128, 69, 117, 234, 35,
  58, 67, 92, 7, 132, 189, 5, 103, 10, 15, 252, 195, 70, 147, 241, 202, 107, 49,
  20, 251, 133, 76, 204, 73, 203, 135, 184, 78, 194, 183, 1, 121, 109, 11, 143,
  144, 171, 161, 48, 205, 245, 46, 31, 72, 169, 131, 239, 160, 25, 207, 218,
  146, 43, 140, 127, 255, 81, 98, 42, 115, 173, 142, 114, 13, 2, 219, 57, 56,
  24, 126, 3, 230, 47, 215, 9, 44, 159, 33, 249, 18, 93, 95, 29, 113, 220, 89,
  97, 182, 248, 64, 68, 34, 4, 82, 74, 196, 213, 165, 179, 250, 108, 254, 59,
  14, 236, 175, 85, 199, 83, 106, 77, 178, 167, 225, 45, 247, 163, 158, 8, 221,
  61, 191, 119, 16, 253, 105, 186, 23, 170, 100, 216, 65, 162, 122, 150, 176,
  154, 193, 206, 222, 188, 152, 210, 243, 96, 41, 86, 180, 101, 177, 166, 141,
  212, 116
];
export function unlockWinScp(value: string, password: string): string {
  if (!/^A35D[0-9a-f]+$/i.test(value) || value.length % 2)
    throw new Error('Unsupported protected credential.');
  const input = Buffer.from(value.slice(4), 'hex');
  if (input.length < 27 || input.length > 65536)
    throw new Error('Invalid protected credential.');
  const salt = input.subarray(0, 16),
    encrypted = input.subarray(16, -10),
    mac = input.subarray(-10);
  const derived = pbkdf2Sync(password, salt, 1000, 66, 'sha1');
  let plain: Buffer | undefined;
  try {
    const actual = createHmac('sha1', derived.subarray(32, 64))
      .update(encrypted)
      .digest()
      .subarray(0, 10);
    if (!timingSafeEqual(actual, mac))
      throw new Error('Unable to unlock credentials.');
    plain = Buffer.alloc(encrypted.length);
    const cipher = createCipheriv('aes-256-ecb', derived.subarray(0, 32), null);
    cipher.setAutoPadding(false);
    for (let offset = 0; offset < encrypted.length; offset += 16) {
      const counter = Buffer.alloc(16);
      counter.writeBigUInt64LE(BigInt(offset / 16 + 1));
      const stream = cipher.update(counter);
      for (let j = 0; j < 16 && offset + j < encrypted.length; j++)
        plain[offset + j] = encrypted[offset + j] ^ stream[j];
    }
    cipher.final();
    let last = 31;
    for (let i = 0; i < plain.length; i++) {
      const mapped = substitution.indexOf(plain[i]);
      if (mapped < 0) throw new Error();
      let ch = mapped - 1 - (last % 255);
      if (ch <= 0) ch += 255;
      plain[i] = ch;
      last = ((last + ch) % 255) + 1;
    }
    const start = plain.findIndex((n) => n >= 48 && n <= 57);
    if (
      start < 0 ||
      start + 3 > plain.length ||
      !plain.subarray(start, start + 3).every((n) => n >= 48 && n <= 57)
    )
      throw new Error();
    const length =
      plain[start] -
      48 +
      10 * (plain[start + 1] - 48) +
      100 * (plain[start + 2] - 48);
    if (
      start + 3 + length !== plain.length ||
      Math.floor((length + 3) / 17) * 17 + 17 !== plain.length
    )
      throw new Error();
    return plain.subarray(start + 3).toString('utf8');
  } finally {
    derived.fill(0);
    plain?.fill(0);
  }
}

import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  createHash,
  createDecipheriv
} from 'crypto';
/**
 * FileZilla Site Manager crypt credentials use a password-derived X25519 key.
 * Modern exports use authenticated AES-256-GCM; older exports use AES-CTR.
 * The `pubkey` in each <Pass> is the complete public key plus its KDF salt,
 * not a second password/identifier the user must supply.
 */
function withFileZillaKey<T>(
  publicKey: string,
  password: string,
  operation: (privateKey: ReturnType<typeof createPrivateKey>, pub: Buffer) => T
): T {
  if (!isFileZillaBase64(publicKey) || !password)
    throw new Error('Invalid protected credential.');
  const pub = Buffer.from(publicKey, 'base64');
  if (pub.length !== 64)
    throw new Error('Unsupported protected credential.');
  const key = pbkdf2Sync(password, pub.subarray(32), 100000, 32, 'sha256');
  try {
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b656e04220420', 'hex'),
        key
      ]),
      format: 'der',
      type: 'pkcs8'
    });
    const derivedPublic = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .subarray(-32);
    if (!timingSafeEqual(derivedPublic, pub.subarray(0, 32)))
      throw new Error('Unable to unlock credentials.');
    return operation(privateKey, pub);
  } finally {
    key.fill(0);
  }
}

function isFileZillaBase64(value: string): boolean {
  // FileZilla exports unpadded Base64 for its public key; accept either form.
  return value.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(value);
}

function decryptFileZillaCredential(
  value: string,
  pub: Buffer,
  privateKey: ReturnType<typeof createPrivateKey>
): string {
  if (!isFileZillaBase64(value))
    throw new Error('Invalid protected credential.');
  const input = Buffer.from(value, 'base64');
  if (input.length < 80 || input.length > 65536)
    throw new Error('Unsupported protected credential.');
  const ephemeral = input.subarray(0, 32);
  const salt = input.subarray(32, 64);
  let shared: Buffer | undefined;
  let aes: Buffer | undefined;
  let iv: Buffer | undefined;
  let plain: Buffer | undefined;
  try {
    shared = diffieHellman({
      privateKey,
      publicKey: createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b656e032100', 'hex'),
          ephemeral
        ]),
        format: 'der',
        type: 'spki'
      })
    });
    const derive = (tag: number) =>
      createHash('sha256')
        .update(salt)
        .update(Buffer.from([tag]))
        .update(shared!)
        .update(ephemeral)
        .update(pub)
        .digest();
    aes = derive(0);

    // The modern format uses a 16-byte authentication tag at the end.
    iv = derive(2);
    try {
      const decipher = createDecipheriv('aes-256-gcm', aes, iv.subarray(0, 12));
      decipher.setAuthTag(input.subarray(-16));
      plain = Buffer.concat([
        decipher.update(input.subarray(64, -16)),
        decipher.final()
      ]);
    } catch {
      // The legacy format is unauthenticated AES-CTR. FileZilla itself
      // attempts this compatibility fallback if GCM authentication fails.
    }
    iv.fill(0);
    iv = undefined;

    if (!plain) {
      iv = derive(1);
      const decipher = createDecipheriv('aes-256-ctr', aes, iv.subarray(0, 16));
      plain = Buffer.concat([
        decipher.update(input.subarray(64)),
        decipher.final()
      ]);
    }
    if (plain.length < 16)
      throw new Error('Invalid protected credential.');
    const zero = plain.indexOf(0);
    if (zero >= 0 && !plain.subarray(zero).every((n) => n === 0))
      throw new Error('Invalid password padding.');
    return new TextDecoder('utf-8', { fatal: true }).decode(
      zero < 0 ? plain : plain.subarray(0, zero)
    );
  } finally {
    shared?.fill(0);
    aes?.fill(0);
    iv?.fill(0);
    plain?.fill(0);
  }
}

export function unlockFileZilla(
  value: string,
  publicKey: string,
  password: string
): string {
  return withFileZillaKey(publicKey, password, (privateKey, pub) =>
    decryptFileZillaCredential(value, pub, privateKey)
  );
}

/** Derive the master key once for every credential protected by the same key. */
export function unlockFileZillaGroup(
  values: string[],
  publicKey: string,
  password: string
): (string | undefined)[] {
  return withFileZillaKey(publicKey, password, (privateKey, pub) =>
    values.map((value) => {
      try {
        return decryptFileZillaCredential(value, pub, privateKey);
      } catch {
        return undefined; // Keep a damaged credential locked; allow intact peers.
      }
    })
  );
}
