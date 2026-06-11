# Changelog

## [1.6.1] - 2026-06-11

### Added

* Added `remoteedit.sftpResolveOwnerGroupNames` to optionally resolve numeric SFTP owner/group IDs to readable names.
* Added `remoteedit.diagnostics.debugLogs` to help collect detailed diagnostic information for troubleshooting.
* Added `remoteedit.diagnostics.performanceLogs` to help diagnose directory listing, rendering, cache, and transfer performance.
* Added `remoteedit.directoryListingCacheTtl` to control how long recently loaded remote directory listings are reused.

### Improved

* Improved Remote Edit Output logging by keeping frequent directory listing logs behind diagnostics settings.
* Improved FTP/FTPS transfer cancellation recovery so cancelled file opens keep the Remote Edit connection open and reconnect the FTP client automatically if the server closes it.
* Improved SFTP directory browsing performance by disabling owner/group name resolution by default.
* Improved remote directory navigation performance by reusing recently loaded directory listings across the Webview and Primary Sidebar.
* Manual refresh and file operations now bypass or invalidate cached directory listings to keep remote views up to date.
* Improved FTP/FTPS directory metadata handling by merging MLSD listing data with LIST metadata when both are available.
* Preserved FTP/FTPS owner, group, and permissions from LIST while keeping MLSD size and modification date when supported.

## [1.6.0] - 2026-06-10

### Added

* Added FTP and FTPS connection support alongside SSH/SFTP.
* Added a native VS Code Primary Sidebar experience for Remote Edit.
* Added SSH Terminal access from open connections.
* Added support for multiple simultaneous uploads and downloads.

### Improved

* Improved upload/download workflows and transfer queue management.
* Improved connection editing, favorites, open connections, Quick Connect handling, and overall UI.
* Updated documentation and configuration organization.

## [1.5.0] - 2026-06-05

### Added
- Added import/export for Remote Edit settings, saved connections, remote path favorites, and encrypted saved passwords/passphrases.

### Fixed
- Fixed Transfer Queue stability issues during upload/download conflicts, failures, and cancellations.

### Changed
- Updated project license terms.

### Improved
- Improved Transfer Queue status handling and failed item details.
- Improved saved favorites button visual state when favorites are available.
- Polished small UI details across the extension.

## [1.4.0] - 2026-06-03

### Added
- Added **View Read-Only** for remote files.
- Added **Compare Selected** for comparing two remote files in VS Code.
- Added **Compress to Archive** for selected remote items.
- Added **Change owner/group** with optional recursive apply.
- Added **Run Remote Command** with streaming output and stop/force-kill controls.
- Added copy actions for remote paths, filenames, and current path.
- Added manual resizing for the Connection panel.

### Improved
- Improved **Set permissions** with multi-select and recursive support.
- Improved Remote Path, Filter, breadcrumb, and Connection panel resize behavior.
- Polished context menus, dialogs, checkbox styling, Sudo switch, and column resize indicators.
- Updated README documentation for permissions, ownership, and sudo-related operations.

## [1.3.0] - 2026-05-30

### Added
- Added **Make a Copy...** for single remote files from the browser context menu.
- Added **Refresh** to the remote browser context menu for selected items and empty list space.
- Added **File Properties** for single remote items from the browser context menu.
- Added **Calculate Checksums...** for single remote files using server-side SHA-256 and MD5 commands.
- Added a VS Code-style clickable breadcrumb inside the Remote Path bar.
- Added breadcrumb directory dropdowns for quick navigation between remote folders.

### Improved
- Polished context menus, file filtering, and listing UI.

## [1.2.1] - 2026-05-27

### Changed
- Make background file reads silent so VS Code automatic reloads do not show the opening progress notification.

## [1.2.0] - 2026-05-26

### Added
- Added favorite Remote Path support for saved connections.
- Added a collapsible Connection panel with floating side handles.

## [1.1.2] - 2026-05-25

### Added
- Added Completed transfers to the Transfer Queue modal, scoped to active connection sessions.
- Added transfer queue timestamps using `YYYY-MM-DD HH:mm:ss` format.

### Fixed
- Centered status bar action buttons and the private key path browse button.
- Added vertical scrolling inside the Transfer Queue modal for long transfer histories.

## [1.1.1] - 2026-05-25

### Fixed

- Guard WebView updates after the Remote Edit panel is closed.
- Recreate the Remote Edit panel correctly after the previous WebView has been disposed.
- Preserve active and queued transfers when the Remote Edit panel is closed and reopened.

## [1.1.0] - 2026-05-25

### Added

## 1.1.0

- Added Transfer Queue support for uploads and downloads.
- Improved transfer details, progress formatting, and Output Channel logging.
- Improved browser toolbar layout and transfer queue UI.

## [1.0.7] - 2026-05-24

### Added

- Show byte-based progress for remote file transfers that take longer than 1 second.
- Display transferred bytes, total size, and percentage while opening and saving streamed remote files.
- Fix sudo file open timeout for larger or slower reads.
- Increase sudo save timeout to avoid failures on slower filesystems.

## [1.0.6] - 2026-05-24

### Changed

- Read remote files through streams to improve opening cancellation and memory behavior.
- Make cancellable remote file opening stop the active read stream when supported by the SFTP server.
- Keep save behavior metadata-safe by writing existing files in chunks/in-place without using a local temporary file.
- Upload sudo save temporary files in chunks instead of using a single buffer upload call.

## [1.0.5] - 2026-05-23

### Fixed

- Create new remote files through a dedicated create path instead of the save/upload path.
- Do not pass explicit permissions when creating new remote files, allowing the remote server defaults and umask to decide the final mode.
- Use exclusive create behavior for new files to avoid truncating an existing file by accident.

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
