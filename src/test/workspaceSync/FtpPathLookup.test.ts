import test from 'node:test';
import assert from 'node:assert/strict';
import { findFtpEntryByName, splitFtpLookupPath } from '../../workspaceSync/connection/FtpPathLookup';

test('FTP lookup path splitting preserves POSIX and Windows drive roots', () => {
  assert.deepEqual(splitFtpLookupPath('/var/www/app.txt'), { parent: '/var/www', name: 'app.txt' });
  assert.deepEqual(splitFtpLookupPath('/app.txt'), { parent: '/', name: 'app.txt' });
  assert.deepEqual(splitFtpLookupPath('C:/app.txt'), { parent: 'C:/', name: 'app.txt' });
  assert.deepEqual(splitFtpLookupPath('/C:/app.txt'), { parent: '/C:/', name: 'app.txt' });
  assert.deepEqual(splitFtpLookupPath('C:/folder/app.txt'), { parent: 'C:/folder', name: 'app.txt' });
});



test('FTP case-insensitive lookup fails closed when aliases are ambiguous', () => {
  const entries = [{ name: 'Readme.txt', id: 1 }, { name: 'README.TXT', id: 2 }];
  assert.equal(findFtpEntryByName(entries, 'readme.txt', false), undefined);
  assert.equal(findFtpEntryByName(entries, 'Readme.txt', false)?.id, 1);
});
