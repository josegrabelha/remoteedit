# Changelog

## [1.0.4] - 2026-05-23

### Added

- Add `remoteedit.restoreSpecialPermissionBits` to control whether Remote Edit restores original setuid, setgid, and sticky bits after saving existing files.

### Fixed

- Restore special permission bits that already existed before saving when the remote operating system clears them during an in-place write.
- Clarify save behavior for Unix-like special permission bits in the documentation.

## [1.0.3] - 2026-05-23

### Added

- Show a cancellable progress notification while connecting to remote servers.
- Show cancellable delayed progress when opening remote files if the operation takes longer than 1.5 seconds.
- Show delayed progress when saving remote files if the operation takes longer than 1.5 seconds.

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
