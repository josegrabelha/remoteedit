# Changelog

## [1.8.10] - 2026-07-13

### Added

* Added a breadcrumb path tree layout for Open Connections, showing clickable parent folder nodes while keeping the current directory focused.

### Improved

* Changed the default Open Connections path layout to the new breadcrumb view for a better balance between the compact layout and the full path tree.
* Updated Remote Edit licensing language for clearer proprietary use and distribution terms.

## [1.8.9] - 2026-07-10

### Added

* Added `remoteedit.sidebar.openConnections.pathView` to choose between the new full path tree Sidebar layout and the compact path layout for Open Connections.

### Improved

* Improved Server View startup by preloading the first dashboard snapshot in background after SSH/SFTP connections are established, while keeping automatic refreshes limited to the focused Server view.
* Improved Server View Sudo Mode handling so dashboard data is refreshed correctly when privilege state changes.

## [1.8.8] - 2026-07-09

### Fixed

* Fixed SSH/SFTP Sudo Mode file reads to preserve binary output as raw bytes instead of decoding and re-encoding it as UTF-8, preventing files with embedded or mixed binary content from being altered.
* Fixed FTP/FTPS transfers to explicitly use binary mode after connect and reconnect, avoiding automatic text/ASCII transformations.
* Fixed FTP/FTPS uploads to stream explicit Buffer chunks for binary-safe file writes.
* Preserved Remote Edit transfer and remote write paths as raw bytes without post-transfer text decoding or re-read verification overhead.

## [1.8.7] - 2026-07-08

### Improved

* Improved Webview connection switching so already loaded file lists are restored immediately per connection, including directory listings completed while the connection tab is not focused.
* Improved SFTP directory listing cache handling so Sudo Mode uses a separate cache scope instead of disabling directory caching entirely.

### Fixed

* Fixed Webview file-list context menu so Create New File and Create New Directory are also available from file rows, creating items in the file's parent directory when the list has no empty area.
* Fixed Webview drag-and-drop upload so multi-selected local files from the OS are all collected when VS Code provides incomplete drag item metadata.
* Fixed Webview drag-and-drop list highlighting while Sudo Mode is enabled, keeping the privileged-session red border while showing the blue drop shadow.
* Fixed stale or provisional directory listing states so empty snapshots and out-of-focus listing responses are not incorrectly discarded or treated as valid loaded results.
* Fixed directory listing cache invalidation so normal and sudo directory caches are cleared together after remote write operations.

## [1.8.6] - 2026-07-05

### Fixed

* Fixed VS Code Runtime Status warnings for internal Sidebar focus commands.

## [1.8.5] - 2026-07-04

### Added

* Added Windows SSH/SFTP support with PowerShell-backed commands and Windows Server View.

### Fixed

* Fixed SSH/SFTP disconnect cleanup so sessions no longer stay in Disconnecting when the SSH client close does not complete.
* Fixed Webview Remote Path file opening so entering a file path opens the file without leaving the filename in the Remote Path field.

## [1.8.4] - 2026-06-27

### Added

* Added `remoteedit.webview.fileList.permissionsDisplay` to show compact Webview permission displays in symbolic, numeric, or combined format. Numeric permissions are displayed as 4-digit octal values.
* Added 4-digit octal permissions to file and directory properties, Sidebar hover details, and Set Permissions previews when symbolic permissions are available.
* Added drag-and-drop upload for local files and folders from the OS into remote folders using the Webview file list or Sidebar Open Connections tree.
* Added remote file and folder moving within the same Remote Edit connection using Cut/Paste and drag-and-drop in both the Webview and Sidebar.

### Improved

* Improved Sidebar context menus for Windows SSH/SFTP sessions so supported actions remain available while Unix-only actions such as archive creation and permission changes stay hidden.
* Improved Server View routing so Windows SSH/SFTP sessions use a dedicated PowerShell snapshot while Linux/Unix/AIX sessions keep the existing POSIX/AIX dashboard path.
* Improved Server View service and process actions with Windows-specific PowerShell commands for Windows services and processes.
* Improved Remote Search scope browsing to normalize Windows SSH/SFTP paths consistently.

### Changed

* Limited Remote Edit Command Palette entries to Open and Settings, keeping sidebar and context-only actions out of the palette.

### Fixed

* Fixed Windows Server View structured snapshot output so services, processes, scheduled tasks, listeners, memory, and disk details keep their field delimiters and render correctly.
* Fixed Run Remote Command and Remote Search modals so the Use Sudo Mode option is hidden and ignored for Windows SSH/SFTP sessions.
* Fixed Windows SSH/SFTP PowerShell output handling so CLIXML progress records are suppressed in Run Remote Command, Log Viewer follow, Remote Search, and checksum output.
* Fixed Windows SSH/SFTP command execution to avoid wrapping already encoded PowerShell commands a second time.
* Fixed Sidebar command guards so unsupported session actions are rejected before prompting for Unix-only inputs.
* Fixed upload refresh synchronization between the Webview and Sidebar so the affected remote directory is refreshed after uploads complete.

## [1.8.3] - 2026-06-25

### Added

* Added connection groups for saved connections.
* Added new Server View overview cards for Sessions, Listeners, Swap, and IO Wait.
* Added detailed modals for Server View overview cards, including filesystem, session, listener, memory, swap, load, uptime, and IO Wait details.
* Added zombie process detection to Server View process details when process state is available.

### Improved

* Improved several Webview and Server View UI and usability details.
* Improved Sidebar new connection creation so connection details are collected before saving instead of creating an incomplete draft profile.
* Improved Sidebar connection state visuals with an updated server icon and reused the draft icon to indicate saved connections with pending changes.
* Improved Webview directory loading, file list rendering, filtering, and row handling performance for slow or large directory listings.
* Improved FTP modified-date fallback so MDTM checks run selectively in the background without blocking folder navigation.
* Improved SSH/FTP connection error messages with shorter user-facing status messages and more detailed diagnostics in the Output log.

### Changed

* Enabled Server View auto-refresh by default with a subtle toolbar countdown.
* Removed the redundant Webview Open Connections header above connection tabs.
* Made Sidebar saved connection details read-only while the connection is active.

### Fixed

* Fixed Server View user crontab opening while Sudo Mode is enabled so it opens the selected user crontab instead of root's crontab.
* Fixed an intermittent issue where saving a connection profile could leave the UI stuck in a busy "Saving connection..." state even after the profile was saved.

## [1.8.2] - 2026-06-22

### Improved

* Improved the Webview Connection Profile dropdown with inline connect/disconnect actions for saved profiles.

## [1.8.1] - 2026-06-21

### Added

* Added single-click opening from file and folder names in the Webview file list. Item names now show a subtle underline on name hover when single-click opening is enabled.
* Added `remoteedit.webview.fileList.openOnNameClick` to control single-click opening from item names in the Webview file list.

### Improved

* Aligned Webview file opening with the Sidebar so editor tabs are created immediately while content loads through the remote file provider. Slow file loads now show cancellable progress, and failed Webview opens keep the detailed error dialog.

## [1.8.0] - 2026-06-20

### Added

* Added Server View for SSH/SFTP connections with overview, system information, services, processes, scheduled jobs, log shortcuts, port forwarding, and Quick Tasks.
* Added a Remote Path breadcrumb setting to show or hide directory details.

### Improved

* Improved Import/Export to include saved commands, port forwards, server log shortcuts, and Log Viewer favorites.
* Saved Commands now preserve and restore the Remote Path.
* Improved the Remote Path breadcrumb directory picker with aligned owner/group and permissions details.
* Improved several UI and usability details across the Webview, Log Viewer, and Server View.

### Changed

* Renamed the Remote Search running action from Cancel to Stop.

## [1.7.3] - 2026-06-15

### Changed

* Disabled FTP/FTPS MDTM modified date fallback by default to avoid slowing directory browsing on servers with inconsistent MDTM support.

## [1.7.2] - 2026-06-15

### Fixed

* Fixed FTP false conflict detection when some servers return empty or ambiguous path listing responses.
* Improved FTP path existence checks and fallback directory listing behavior.
* Added a Log Viewer Webview warning before opening files that appear to contain binary data, with Open anyway and Cancel actions.
* Standardized Log Viewer status messages to avoid mixed trailing punctuation.

## [1.7.0] - 2026-06-13

### Added

* Added Remote Search to the Webview with file name/path search, SSH/SFTP content search with grouped highlighted results and sudo support, and FTP/FTPS file name search support.
* Added a dedicated Log Viewer Webview for SSH/SFTP connections with tabs, follow mode, pause/resume, search, formatting options, line controls, and entry points from the Webview and Primary Sidebar.

### Improved

* Improved UI polish across the Webview, Primary Sidebar, tabs, toolbars, context menus, connection icons, and modal interactions.
* Improved Run Remote Command modal behavior when closing or pressing Escape while a command is running.

### Fixed

* Fixed FTP/FTPS modified date handling on servers that do not provide consistent metadata.

## [1.6.2] - 2026-06-11

### Added

* Added `remoteedit.sidebar.showItemInfoOnHover` to control automatic detailed hover tooltips in the Primary Sidebar.

### Improved

* Reorganized Remote Edit settings into dedicated VS Code Settings groups.
* Improved Primary Sidebar Properties so file and folder details match the Webview Properties content more closely.

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
