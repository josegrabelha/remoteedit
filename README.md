# Remote Edit

**Remote Edit** is a VS Code extension for working with remote files and server tools over SSH/SFTP, FTP, and FTPS.

Connect to remote servers, browse and edit files, transfer content, run commands, inspect server status, view logs, manage SSH port forwards, and choose the workflow that fits you best.

![Remote Edit Webview](images/remoteedit-hero.png)

## Two Ways to Work

### Full-Featured Remote Edit Webview

The Remote Edit Webview provides the complete visual experience for managing remote servers.

- Browse remote files and folders
- Open and edit files directly in VS Code
- Manage connections
- Run remote commands and Quick Tasks
- Search remote files by name or content
- Use Server View for system information, services, processes, scheduled jobs, and port forwarding
- Manage permissions and ownership
- Use Sudo Mode
- Upload and download files
- Monitor transfers

### Native VS Code Sidebar

Remote Edit also includes a fully native VS Code Sidebar experience.

Use it to manage connections, open sessions, favorites, transfers, SSH terminals, import/export operations, and Log Viewer access without leaving the VS Code interface.

![Remote Edit Sidebar](images/remoteedit-sidebar.png)

Choose the workflow that fits you best. Use the full-featured Remote Edit Webview or the native VS Code Sidebar. Both experiences can be used independently.

## When to Use Remote Edit

Remote Edit is useful when you need to work with remote servers without opening a full remote workspace. Use it to browse and edit files, transfer content, run commands, inspect server status, view logs, search remotely, and manage SSH port forwards directly from VS Code.

## Webview or Native Sidebar?

Use the Webview when you want a complete visual file browser for remote files and folders.

Use the Native Sidebar when you prefer a compact VS Code workflow for connections, favorites, transfers, terminals and Log Viewer access.

## Highlights

- SSH/SFTP, FTP, and FTPS support
- Full-featured Remote File Browser
- Native VS Code Sidebar
- Server View dashboard for SSH/SFTP connections
- Open files directly in VS Code
- SSH Terminal Access
- Unified Remote Search
- Dedicated Log Viewer
- Quick Tasks and Saved Commands
- SSH Port Forwarding
- Multiple Simultaneous Transfers
- Transfer Queue Management
- Import and Export Backups
- Sudo Mode
- Permissions and Ownership Management
- Favorites and Saved Connections
- Multiple Active Connections

## Why Remote Edit?

| Capability | Included |
|---|:---:|
| SSH/SFTP | ✓ |
| FTP | ✓ |
| FTPS | ✓ |
| Full Visual Webview | ✓ |
| Native VS Code Sidebar | ✓ |
| Multiple Active Connections | ✓ |
| Favorites | ✓ |
| Transfer Queue | ✓ |
| Multiple Simultaneous Transfers | ✓ |
| Import / Export | ✓ |
| SSH Terminal | ✓ |
| Remote Commands | ✓ |
| Saved Commands / Quick Tasks | ✓ |
| Remote Search | ✓ |
| Server View | ✓ |
| Port Forwarding | ✓ |
| Log Viewer | ✓ |
| Sudo Mode | ✓ |
| Permissions Management | ✓ |
| Owner / Group Management | ✓ |
| Checksums | ✓ |
| Archive Creation | ✓ |

## Supported Protocols

| Protocol | Browse | Upload | Download | Edit | File Search | Content Search | Remote Commands | Server View | Terminal | Log Viewer | Sudo Mode |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| SSH/SFTP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| FTP | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | - | - | - |
| FTPS | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | - | - | - |

## Server View

Switch an active SSH/SFTP connection from **Files** to **Server** to inspect and manage common server-side information without leaving the Remote Edit Webview.

![Remote Edit Server View](images/remoteedit-server-view.png)

- Review system information, uptime, memory, disk, load, shell, home directory, and current user details
- Inspect services and run supported start, stop, and restart actions
- Review running processes and kill selected processes when needed
- Open, follow, edit, or copy saved server log shortcuts
- Review scheduled jobs from user crontab and system cron locations
- Manage SSH port forwarding definitions from the Port Forwarding card
- Run saved commands as Quick Tasks from the Server View
- Use manual refresh or optional auto refresh intervals while the Server View is open
- Refresh automatically when Sudo Mode is enabled or disabled while the Server View is active

Server View is available for SSH/SFTP connections. FTP/FTPS connections can browse and transfer files, but they cannot run remote shell commands required by Server View.

## Remote Search

Use Remote Search from the Webview toolbar to find remote files without leaving the current connection. Remote Search is Webview-only and keeps search state per active connection.

![Remote Search](images/remoteedit-remote-search.png)

- Search file names and paths with wildcard support
- Choose a scope path manually or with the remote directory picker
- Include or exclude subdirectories
- Include or exclude hidden files
- Use case-sensitive matching when needed
- Search inside files on SSH/SFTP connections
- Use sudo for protected SSH/SFTP paths when Sudo Mode is available
- View live results while the search is running
- Keep searches running after closing the modal and track active searches with the toolbar badge
- Stop long-running searches
- Copy all results, selected paths, or selected filenames
- Open result files in edit or read-only mode

FTP and FTPS connections support file name search. Content search and sudo search require SSH/SFTP.

## Run Remote Command

Run non-interactive commands on active SSH/SFTP connections without leaving the Webview.

![Run Remote Command](images/remoteedit-run-remote-command.png)

- Open Run Remote Command from the Webview toolbar or from a remote directory context
- Choose the remote working directory manually or with the remote directory picker
- Stream stdout and stderr output while the command is running
- Stop long-running commands and force kill commands that do not stop cleanly
- Copy or clear command output
- Save frequently used commands per connection
- Save and restore the remote path used by each saved command
- Reuse command history for the current session
- Run with Sudo Mode when the active SSH/SFTP connection supports sudo

Saved Commands are also available as Quick Tasks in Server View. Command history is session-only and is not included in backups.

Remote Commands require SSH/SFTP because FTP/FTPS cannot execute remote shell commands.

## Log Viewer

Use Log Viewer from an active SSH/SFTP connection to monitor remote logs without cluttering the main file browser.

![Log Viewer](images/remoteedit-log-viewer.png)

- Open logs from the Webview toolbar, file context menu, or Primary Sidebar context menu
- Tail and follow remote log files in real time
- Use Linux/Unix/AIX-friendly `tail` fallbacks
- Keep multiple logs open in tabs
- Pause and resume displayed updates with bounded buffering
- Search loaded log content, jump between matches, or show matching lines only
- Enable case-sensitive search when needed
- Auto-scroll with jump-to-bottom behavior
- Optional log level highlighting
- Optional JSON log formatting with `Auto`, `On`, and `Off` modes
- Optional line wrap and line numbers
- Uses Sudo Mode when the active SSH/SFTP connection has sudo enabled

Log Viewer is intentionally limited to SSH/SFTP connections because FTP/FTPS cannot run remote `tail -f` commands. The viewer shows continuity markers when output is limited, portable tail mode is used, or older buffered lines are discarded.

## Transfer Queue

Upload and download files with built-in queue management.

- Current transfers
- Pending transfers
- Completed transfers
- Individual transfer cancellation
- Progress tracking
- Multiple simultaneous transfers
- Drag-and-drop upload from the OS into the Webview file list or Sidebar Open Connections tree
- In the Webview, hover over a remote folder row while dragging to open that folder before dropping, including `..` for the parent folder.
- Sidebar drag-and-drop uses local paths exposed by VS Code. If paths are unavailable, use the Upload button or the Webview drop area.
- FTP, FTPS, and SFTP support

```json
"remoteedit.maxConcurrentTransfers": 2
```

Default: 2  
Minimum: 1  
Maximum: 5

## SSH Terminal

For SSH/SFTP connections, Remote Edit can open native VS Code terminals directly from active connections.

Terminal access is available from both the Webview and the Native Sidebar.

## Port Forwarding

For SSH/SFTP connections, Remote Edit can manage local-to-remote SSH port forwarding definitions from the Server View.

- Add and edit named port forwards
- Start and stop forwards from the Port Forwarding card
- Optionally auto-start selected forwards when a connection opens
- Save port forward definitions as part of Remote Edit backups

Runtime state is not exported. Backups save the definitions, not whether a forward was running at the time of export.

## Sudo Mode

Need to edit protected system files?

Enable Sudo Mode and work with privileged files directly from VS Code.

Sudo passwords are never stored and are only kept in memory during the active session.

## Remote Path Breadcrumb Picker

The Remote Path bar includes clickable breadcrumb chevrons for quickly jumping to sibling directories. The directory picker can show owner/group and permission details in aligned columns. Its permission value follows the Webview permission display setting, so it can show symbolic, numeric, or combined permissions when the remote server provides compatible permission data.

Use this setting to hide those details when you prefer a simpler directory list:

```json
"remoteedit.webview.remotePathBreadcrumb.showDirectoryDetails": true
```

Default: `true`

## Permission Display

The Webview file list and Remote Path directory picker can show permissions in symbolic, numeric, or combined format. Numeric permissions use 4-digit octal values so special bits are visible when present.

```json
"remoteedit.webview.fileList.permissionsDisplay": "symbolic"
```

Supported values: `symbolic`, `numeric`, `both`

Default: `symbolic`

File and directory Properties and Sidebar hover details always show the complete symbolic plus 4-digit octal value when symbolic permissions are available. The Remote Path directory picker follows the Webview permission display setting.

## File Operations

Use the Webview and Native Sidebar context menus to manage remote files and folders.

- View/Edit files or open them as read-only
- Create, rename and delete remote files and folders
- Make a copy of an existing remote file
- Compare two selected remote files
- Compress files or folders to remote archives
- View file and folder properties
- Calculate checksums
- Copy remote paths, filenames, or the current remote path
- Cut and paste remote files or folders to move them within the same connection. In the Webview, use Paste Here from empty space, file rows, or folder rows when the current directory is a valid destination, or Paste Into This Folder from a folder row.
- Drag selected remote files or folders onto a folder row in the Webview or Sidebar Open Connections tree to move them within the same connection.
- Refresh listings after remote changes

## Permissions and Ownership

Manage permissions, owners and groups directly from VS Code.

- Multiple selection support
- Recursive updates
- File and folder support

## Upload and Download

Transfer files and folders between your local machine and remote servers.

- Recursive folder transfers
- Conflict handling
- Progress tracking
- Queue management
- Multiple simultaneous transfers
- Drag-and-drop upload from the OS into the Webview file list or Sidebar Open Connections tree
- In the Webview, hover over a remote folder row while dragging to open that folder before dropping, including `..` for the parent folder.
- Sidebar drag-and-drop uses local paths exposed by VS Code. If paths are unavailable, use the Upload button or the Webview drop area.

## Saved Connections

Save frequently used SSH/SFTP, FTP, and FTPS connections for quick access.

- Password authentication
- SSH private key authentication
- Optional private key passphrases
- Start paths
- Connection favorites
- Secure credential storage

## Import and Export

Create password-protected backups of Remote Edit data:

- Remote Edit settings
- Saved connections
- Remote path favorites
- Encrypted credentials
- Saved Commands with Remote Path
- Port Forwarding definitions
- Server Log Shortcuts
- Log Viewer favorite files

Import supports Merge and Replace modes and provides a summary before changes are applied. Webview and Sidebar import/export actions use the same shared backend data source, so backups are consistent from either entry point.

Session-only data is not included in backups. This includes command history, diagnostics debug/performance logging, open tabs, running/stopped state, Sudo Mode state, transfer runtime state, filters, and Log Viewer buffers.

## Quick Access

Open Remote Edit from:

- Command Palette
- VS Code Primary Sidebar
- Editor Title Bar Button
- Status Bar Button

## Native Sidebar Details

The Primary Sidebar provides quick access to the main Remote Edit Webview, Log Viewer, saved connections, Quick Connect, open remote sessions, favorites, transfers, and import/export backups.

The Log Viewer item appears below `Remote Edit (Advanced View)` and is enabled only when there is an active SSH/SFTP connection.

## Multiple Active Connections

Work with multiple remote servers at the same time and quickly switch between active connections.

## Extension Settings

### User Interface

- `remoteedit.editorTitleButtonPosition`
- `remoteedit.statusBarButtonPosition`
- `remoteedit.statusBarButtonStyle`
- `remoteedit.statusBarButtonPriority`

### Webview

- `remoteedit.webview.remotePathBreadcrumb.showDirectoryDetails`
- `remoteedit.webview.fileList.openOnNameClick`
- `remoteedit.webview.fileList.permissionsDisplay`

### Sidebar

- `remoteedit.sidebar.showItemInfoOnHover`
- `remoteedit.sidebar.showParentPath`

### SSH/SFTP

- `remoteedit.sshReadyTimeout`
- `remoteedit.sshKeepAliveInterval`
- `remoteedit.sshKeepAliveCountMax`
- `remoteedit.sftpResolveOwnerGroupNames`

### FTP/FTPS

- `remoteedit.ftpKeepAliveInterval`
- `remoteedit.ftp.enableModifiedDateFallback`

### Transfers

- `remoteedit.maxConcurrentTransfers`

### Sudo

- `remoteedit.sudoTempDirectory`
- `remoteedit.restoreSpecialPermissionBits`

### Cache

- `remoteedit.directoryListingCacheTtl`

### Log Viewer

- `remoteedit.logViewer.maxBackgroundBufferLines`

### Diagnostics

- `remoteedit.diagnostics.debugLogs` — Enable debug logs for the current VS Code session. Automatically turns off when VS Code is restarted or reloaded.
- `remoteedit.diagnostics.performanceLogs` — Enable performance timing logs for the current VS Code session. Automatically turns off when VS Code is restarted or reloaded.

Enable debug and performance logs only while troubleshooting directory browsing, cache behavior, transfers, Remote Search, or Log Viewer sessions. Then reproduce the issue and copy the relevant entries from the `Remote Edit` Output channel when opening a GitHub issue.

## Security

- Credentials can be stored using VS Code Secret Storage
- FTPS supports certificate validation
- Sudo passwords are never saved
- Password-protected import/export backups
- SFTP and FTPS are recommended for secure connections

## Requirements

- VS Code 1.90.0 or newer

## Notes

- Symbolic links are skipped during recursive transfers.

## License

Remote Edit is free to use for personal and professional use through the official Visual Studio Code Marketplace distribution.

The source code is publicly available for transparency and review only. Copying, modifying, redistributing, sublicensing, selling, or creating derivative works from this source code requires prior written permission from the copyright holder.
