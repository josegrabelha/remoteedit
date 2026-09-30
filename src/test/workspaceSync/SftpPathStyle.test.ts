import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptSftpPath, inferSftpPathStyle } from '../../workspaceSync/connection/SftpPathStyle';

test('SftpPathStyle identifies common Windows OpenSSH cwd formats', () => {
  assert.equal(inferSftpPathStyle('C:/Users/test'), 'windowsDrive');
  assert.equal(inferSftpPathStyle('/C:/Users/test'), 'windowsSlashDrive');
  assert.equal(inferSftpPathStyle('/home/test'), 'posix');
});

test('SftpPathStyle adapts drive paths to the server preferred representation', () => {
  assert.equal(adaptSftpPath('C:/sites/app/file.txt', 'windowsSlashDrive'), '/C:/sites/app/file.txt');
  assert.equal(adaptSftpPath('/C:/sites/app/file.txt', 'windowsDrive'), 'C:/sites/app/file.txt');
  assert.equal(adaptSftpPath('/var/www/file.txt', 'posix'), '/var/www/file.txt');
  assert.equal(adaptSftpPath('C:\\sites\\app\\file.txt', 'windowsDrive'), 'C:/sites/app/file.txt');
});
