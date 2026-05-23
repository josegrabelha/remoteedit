# Changelog

## [1.0.2] - 2026-05-23

### Changed

- Add configurable sudo temporary directory through `remoteedit.sudoTempDirectory`.
- Check free space before sudo saves for both the temporary directory and the target filesystem.
- Improve sudo temporary file cleanup while keeping metadata-preserving save behavior.

## [1.0.1] - 2026-05-23

### Fixed

- Preserve owner, group, permissions, ACLs, and inode when saving existing remote files.
- Save existing non-sudo files in-place instead of uploading directly over the target path.
- Update sudo save behavior to write into the existing target file instead of replacing it.

## [1.0.0] - 2026-05-22

### Added

- Initial release of Remote Edit for browsing, editing, and saving remote files over SSH/SFTP.
