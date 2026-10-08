import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  decodeWinScpPassword,
  parseWinScp
} from '../connectionImport/sources/WinScpImportSource';
import {
  unlockFileZilla,
  unlockWinScp
} from '../connectionImport/ConnectionImportCredentials';
import { parseFileZilla } from '../connectionImport/sources/FileZillaImportSource';

// Synthetic, non-production credential vectors kept in the tests that use them.
const FILEZILLA_LEGACY = {
  value: "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHwgISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+PzpQPQsu/s3wFbV1jxXmH5c=",
  publicKey: "Zqgg1TUDKuQxfzRmWRNuxsDN5K89Fef3Z5+dbA6K91AAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw=="
};
const FILEZILLA_AUTHENTICATED = {
  value: "A+OjuhLFwzYjfrtuROpdH/XHvn0o4L+xIrwdu3QyChxVvkKANLDv7Fc8ZGl8lPIp/X4yep62IVwACkBMbDDoM0j55T0iax53TPtdASye/KZVUH1wwpEvoXca2MsDKoqhh544F+ObxSEv6Yyw",
  publicKey: "AgbOwFvRFWittJfiFDzkBG+CHGOhy2Qf2NattSVJ83XgP7myxAhSzgN4/sWG8psIaTcQZ1tZC2Tucm1aZVzgxg=="
};
const WINSCP_PROTECTED = "A35D000102030405060708090A0B0C0D0E0F0D7A0FF9B0D3085C71DE131C81C1F7EBD0128FD591799A1B7FCE639DEE82B042153C975F1BF16AB34748E84E";

test('WinSCP reversible credentials are bound to username and host and reject corrupt data', () => {
  const bytes = Buffer.from('demoexample.testsecret');
  const encoded = Buffer.from(
    [255, 0, bytes.length, 0, ...bytes].map((v) => (~v ^ 0xa3) & 255)
  ).toString('hex');
  assert.equal(decodeWinScpPassword(encoded, 'demoexample.test'), 'secret');
  assert.equal(decodeWinScpPassword(encoded, 'wrong'), undefined);
  assert.equal(decodeWinScpPassword('bad', 'demo'), undefined);
});
test('protected passwords are never imported as ciphertext or mistaken for plaintext', () => {
  const c = parseWinScp(
    '[Sessions/Example]\nHostName=example.test\nPassword=A35D00000000',
    '/tmp/winscp'
  )[0];
  assert.equal(c.profile.password, undefined);
  assert.ok(c.lockedCredential);
  assert.throws(() => unlockWinScp('A35D00000000', 'wrong'));
  const f = parseFileZilla(
    '<FileZilla3><Servers><Server><Host>example.test</Host><Protocol>1</Protocol><Pass encoding="crypt">ciphertext</Pass></Server></Servers></FileZilla3>',
    '/tmp/fz'
  )[0];
  assert.equal(f.profile.password, undefined);
  assert.ok(f.credentialNote);
});

test('WinSCP master password decrypts an independent authenticated vector and rejects wrong passwords and tampering', () => {
  const value = WINSCP_PROTECTED;
  assert.equal(unlockWinScp(value, 'fixture-master'), 'fixture-secret');
  assert.throws(() => unlockWinScp(value, 'wrong'));
  assert.throws(() =>
    unlockWinScp(value.slice(0, -2) + '00', 'fixture-master')
  );
});

test('FileZilla crypt unlock checks the external master password against its public key', () => {
  const vector = FILEZILLA_LEGACY;
  assert.equal(
    unlockFileZilla(vector.value, vector.publicKey, 'fixture-master'),
    'fixture-secret'
  );
  assert.throws(() => unlockFileZilla(vector.value, vector.publicKey, 'wrong'));
  assert.throws(() =>
    unlockFileZilla('invalid!', vector.publicKey, 'fixture-master')
  );
});


test('FileZilla authenticated AES-GCM credentials unlock with the matching public key, rejecting wrong keys and tampering', () => {
  const vector = FILEZILLA_AUTHENTICATED;
  assert.equal(unlockFileZilla(vector.value, vector.publicKey, 'fixture-auth-master'), 'fixture-authenticated-secret');
  assert.throws(() => unlockFileZilla(vector.value, vector.publicKey, 'wrong'));
  const ciphertext = Buffer.from(vector.value, 'base64');
  ciphertext[ciphertext.length - 1] ^= 1;
  assert.throws(() => unlockFileZilla(ciphertext.toString('base64'), vector.publicKey, 'fixture-auth-master'));
});


test('FileZilla unpadded public keys from real Site Manager exports unlock with the external password', () => {
  const vector = FILEZILLA_AUTHENTICATED;
  const unpaddedPublicKey = vector.publicKey.replace(/=+$/, '');
  assert.ok(unpaddedPublicKey.length < vector.publicKey.length);
  assert.equal(
    unlockFileZilla(vector.value, unpaddedPublicKey, 'fixture-auth-master'),
    'fixture-authenticated-secret'
  );
  assert.throws(() => unlockFileZilla(vector.value, unpaddedPublicKey, 'wrong'));
  assert.throws(() => unlockFileZilla(vector.value, unpaddedPublicKey + '!', 'fixture-auth-master'));
});
