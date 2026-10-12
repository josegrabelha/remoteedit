import assert from 'node:assert/strict';
import { adaptSftpPath } from '../../workspaceSync/connection/SftpPathStyle';
import test from '../helpers/TestHarness';

test('SftpPathStyle adapts drive paths to the server preferred representation', () => {
  assert.equal(adaptSftpPath('C:/sites/app/file.txt', 'windowsSlashDrive'), '/C:/sites/app/file.txt');
  assert.equal(adaptSftpPath('/C:/sites/app/file.txt', 'windowsDrive'), 'C:/sites/app/file.txt');
  assert.equal(adaptSftpPath('/var/www/file.txt', 'posix'), '/var/www/file.txt');
  assert.equal(adaptSftpPath('C:\\sites\\app\\file.txt', 'windowsDrive'), 'C:/sites/app/file.txt');
});
