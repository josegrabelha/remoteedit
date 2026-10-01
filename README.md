# Remote Edit

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=josegrabelha.remoteedit"><img src="https://img.shields.io/badge/VS%20Code-Remote%20Edit-007ACC" alt="VS Code"></a>
  <a href="https://open-vsx.org/extension/josegrabelha/remoteedit"><img src="https://img.shields.io/badge/Open%20VSX-Remote%20Edit-C160EF" alt="Open VSX"></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.90.0%2B-5C2D91?logo=visualstudiocode&logoColor=white" alt="VS Code 1.90.0+">
  <img src="https://img.shields.io/badge/Protocols-SSH%20%7C%20SFTP%20%7C%20FTP%20%7C%20FTPS-2EA44F" alt="Protocols">
  <img src="https://img.shields.io/badge/Remote%20Targets-Linux%20%7C%20Unix%20%7C%20AIX%20%7C%20Windows-6E7681" alt="Remote Targets">
</p>

**Remote Edit** is a VS Code extension for browsing, editing, transferring, searching, and synchronizing files over SSH/SFTP, FTP, and FTPS. It combines a full visual remote file browser, a native VS Code Sidebar, **Workspace Sync**, and SSH/SFTP server tools for commands, logs, terminals, port forwarding, and Server View.

Remote Edit supports Linux, Unix, AIX, and Windows OpenSSH targets, with protocol-specific features available depending on the remote server.

![Remote Edit Webview](images/remoteedit-hero.png)

## Installation

Remote Edit is available on the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=josegrabelha.remoteedit) and the [Open VSX Registry](https://open-vsx.org/extension/josegrabelha/remoteedit).

## Highlights

- SSH/SFTP, FTP, and FTPS connections
- Full-featured Remote Edit Webview
- Native VS Code Sidebar
- Workspace Sync with multi-target and automatic synchronization support
- Remote file browsing and direct editing in VS Code
- Multiple active connections
- Multiple simultaneous transfers and Transfer Queue
- Unified Remote Search
- Dedicated Log Viewer
- Server View for SSH/SFTP connections
- SSH Terminal access
- Run Remote Command, Saved Commands, and Quick Tasks
- Local and reverse SSH port forwarding
- SFTP Jump Hosts and multi-hop saved connection chains
- Sudo Mode on supported SSH/SFTP targets
- File permissions and ownership management
- Favorites, saved connections, connection groups, Clone, and Save As
- Password-protected import/export backups

## Remote Edit Webview

The **Remote Edit (Advanced View)** provides the complete visual workflow for managing remote servers.

- Browse remote files and folders
- Open and edit files directly in VS Code
- Upload and download files and folders
- Manage saved connections and connection groups
- Run remote commands and Quick Tasks
- Search remote files by name or content
- Use Server View for system information and server-side actions
- Manage permissions and ownership
- Use Sudo Mode where supported
- Monitor transfers

The Webview and Native Sidebar can be used independently or together.

## Native VS Code Sidebar

Remote Edit also includes a native VS Code Sidebar for compact day-to-day access to connections and tools.

![Remote Edit Sidebar](images/remoteedit-sidebar.png)

Use the Sidebar to access:

- **Remote Edit (Advanced View)**
- **Workspace Sync**
- **Log Viewer**
- Saved connections and Quick Connect
- Open Connections
- Favorites
- Transfers
- SSH Terminal actions
- Import/Export backups

## Remote File Editor Labels

In VS Code settings, **Remote Edit: UI → Editor Root Label** (`remoteedit.editorRootLabel`) controls the virtual root shown in editor breadcrumbs and tab path descriptions:

- `host` (default): use the target hostname, consistently for files opened from the Webview and Sidebar.
- `connectionName`: use `group | connection` as a single root, or just `connection` when there is no group. This helps distinguish connections that share a hostname or loopback address. Quick Connect and sessions whose saved profile was removed use the session name.

The virtual root represents the remote `/` directory; it does not change the file's actual remote path. Normal, read-only, and comparison editors use the same naming rules. VS Code controls when tab path descriptions appear and how they are shortened.

Changes apply to subsequent file opens. Close and reopen existing editors to use the current setting or updated connection names; their unsaved contents and undo history are not migrated or modified by changing the setting.

## Why Remote Edit?

| Capability | Included |
|---|:---:|
| SSH/SFTP | ✓ |
| FTP | ✓ |
| FTPS | ✓ |
| Full Visual Webview | ✓ |
| Native VS Code Sidebar | ✓ |
| Workspace Sync | ✓ |
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
| Local and Reverse SSH Port Forwarding | ✓ |
| SFTP Jump Hosts | ✓ |
| Log Viewer | ✓ |
| Sudo Mode | ✓ |
| Permissions Management | ✓ |
| Owner / Group Management | ✓ |
| Checksums | ✓ |
| Archive Creation | ✓ |

## Workspace Sync

Open **Workspace Sync** from the Remote Edit Sidebar, directly below **Remote Edit (Advanced View)**. Workspace Sync synchronizes a local directory with one or more saved Remote Edit connections without requiring a full remote VS Code workspace.

![Workspace Sync](images/remoteedit-workspace-sync.png)

Create a **mapping** with a Local Root and one or more remote targets. Each target uses a saved SFTP, FTP, or FTPS connection and an absolute Remote Directory.

### Mappings and targets

- Use **Local → Remote**, **Remote → Local**, or **Bidirectional** direction
- Add multiple independently enabled targets to the same mapping
- Select an individual target or **All Enabled** to work across enabled targets together
- Use saved SFTP connections with their configured Jump Host chains
- Keep an independent synchronization baseline for each mapping/target
- Prevent duplicate synchronization routes that point the same Local Root to the same connection and Remote Directory
- Configure Ignore patterns per mapping; `.git/` and `node_modules/` are ignored by default
- Workspace Sync uses its own Ignore list and does not read `.gitignore`

### Refresh and Changes

Connecting a target automatically performs a **Refresh** of the Local and Remote state. With **All Enabled**, Workspace Sync establishes target connections concurrently before starting the initial comparisons and Watch reconciliation. You can switch mappings and targets while this work runs; individual transfers stay unavailable until the corresponding target has finished preparing. Use **Refresh** at any time to reconcile the current state again.

When multiple connected targets share a Local Root, Workspace Sync can reconcile independent files concurrently. Operations affecting the same file or related directories wait for each other and revalidate their plan before execution. Directory-structure changes and potentially overlapping remote destinations retain broader protection. This also applies to Watch Local, Watch Remote, and manual Sync; switching the visible mapping or target does not redirect in-flight operations.

The **Changes** view provides:

- Changes, Modified, Local, Remote, Conflicts, Same, and All filters
- Path filtering and sortable Target, Path, and Status columns
- Optional sortable **Local Modified** and **Remote Modified** columns through **Show Modified Times**; local timestamps include their UTC offset, while FTP/FTPS remote timestamps that are server-local are labeled `server`
- Optional **Hide Unsupported Files** filtering for confirmed symlinks and unsupported filesystem entry types
- Multi-selection with Upload and Download actions
- Local/Remote comparison with the Workspace Sync internal text viewer or **Open in VS Code**; **Default Compare** chooses which viewer the primary Compare action opens, while both remain available explicitly
- Conflict choices with **Use Local**, **Use Remote**, and **Skip**
- Bulk conflict controls with **All Local**, **All Remote**, **All Skip**, and advisory **Apply Suggestions**; these controls only select resolutions and never start Sync automatically
- A **Sync Review** before planned synchronization is applied; resolution decisions recalculate the temporary plan, including parent/child structural dependencies, before **Start Sync**
- **Reset Baseline…** to clear synchronization history without modifying Local or Remote files
- A read-only last known state while disconnected, until the next successful Refresh

With **All Enabled**, Workspace Sync aggregates enabled targets into one Changes view and can Refresh or Sync the connected targets together. Disconnected targets are not connected automatically.

### Automatic synchronization

Workspace Sync can automate selected workflows while a target is connected:

- **Upload on Save** — uploads files saved from the VS Code editor
- **Watch Local Changes** — reacts to local filesystem changes
- **Watch Remote Changes** — monitors changes on the remote target
- **Unknown Change Protection** — prevents automatic decisions when there is not enough trusted history to determine the safe side
- **Atomic Transfer when supported** — avoids replacing the destination until a transfer completes successfully
- **Propagate Deletes** — allows deletions to flow according to the selected sync direction; propagated directory deletes remove the complete destination subtree, including hidden and ignored descendants. Ignore rules do not preserve files inside a directory whose deletion is being propagated, and new or changed content detected after validation causes the delete to be deferred and re-evaluated

Watch and Upload on Save never establish a connection by themselves. Automatic resources are active only for targets that the user has explicitly connected.

In one-way modes, the configured source side is authoritative for automatic watch actions. In Bidirectional mode, Workspace Sync compares both sides against the stored baseline and keeps conflicts or ambiguous differences manual.

### Activity and operation status

The **Activity** section records connection changes, manual and automatic operations, file results, conflicts, retries, cancellations, and actionable error details with local timestamps.

The bottom operation status shows the current lifecycle, such as Connecting, Refreshing, Syncing, Uploading, Downloading, Cancelling, or Disconnecting. Multi-target operations show aggregate progress while detailed per-target events remain in Activity.

Activity also provides **Follow latest**, **Copy**, and **Clear** controls. Credentials are redacted from Activity messages. The most recent **1,000 Activity events** are kept locally across VS Code reloads and restarts; **Clear** removes that saved local history.

### Workspace Sync backup behavior

Import/Export can include Workspace Sync mappings, targets, options, and saved Workspace Sync preferences such as **Hide Unsupported Files**, **Show Modified Times**, and **Default Compare**. Operational state such as Activity history, active sessions, comparison snapshots, current selection, and synchronization baselines stays local and is not exported.

## Supported Protocols

| Protocol | Browse / Edit | Upload / Download | File Search | Content Search | Workspace Sync | Remote Commands | Server View | Terminal | Log Viewer | Sudo Mode | Jump Hosts |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| SSH/SFTP on Linux/Unix/AIX | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SSH/SFTP on Windows OpenSSH | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ |
| FTP | ✓ | ✓ | ✓ | - | ✓ | - | - | - | - | - | - |
| FTPS | ✓ | ✓ | ✓ | - | ✓ | - | - | - | - | - | - |

FTP and FTPS Remote Search supports file-name/path search. Content search requires SSH/SFTP.

## Server View

Switch an active SSH/SFTP connection from **Files** to **Server** to inspect and manage common server-side information without leaving Remote Edit.

![Remote Edit Server View](images/remoteedit-server-view.png)

- Review system information, uptime, memory, disk, load, shell, home directory, and current user details
- Inspect services and run supported start, stop, and restart actions
- Review running processes and kill selected processes when needed
- Open, follow, edit, or copy saved server log shortcuts
- Review user and system scheduled jobs on Linux/Unix/AIX, or Scheduled Tasks on Windows OpenSSH
- Manage local and reverse SSH port forwarding definitions
- Run Saved Commands as Quick Tasks
- Use manual refresh or optional auto-refresh intervals

Server View is available for Linux/Unix/AIX SSH/SFTP connections and Windows OpenSSH sessions. Windows Server View uses PowerShell for supported system information and management tasks. Sudo Mode is not available on Windows OpenSSH targets.

## Remote Search

Use Remote Search from the Webview toolbar to find remote files without leaving the current connection.

![Remote Search](images/remoteedit-remote-search.png)

- Search file names and paths with wildcard support
- Choose a scope path manually or with the remote directory picker
- Include or exclude subdirectories and hidden files
- Use case-sensitive matching when needed
- Search inside files on SSH/SFTP connections
- Use Sudo Mode for protected SSH/SFTP paths when available
- View live results while the search is running
- Keep searches running after closing the dialog
- Stop long-running searches
- Copy results, paths, or filenames
- Open results in edit or read-only mode

FTP and FTPS support file-name/path search. Content search requires SSH/SFTP.

## Run Remote Command

Run non-interactive commands on active SSH/SFTP connections without leaving the Webview. Windows OpenSSH sessions use PowerShell for command features.

![Run Remote Command](images/remoteedit-run-remote-command.png)

- Run commands from the Webview toolbar or a remote directory context
- Choose the remote working directory manually or with the directory picker
- Stream stdout and stderr
- Stop long-running commands and force-kill commands that do not stop cleanly
- Copy or clear output
- Save frequently used commands per connection
- Save and restore the Remote Path for each Saved Command
- Reuse session command history
- Run with Sudo Mode when supported

Saved Commands are also available as **Quick Tasks** in Server View. Command history is session-only and is not included in backups.

## Log Viewer

Use Log Viewer from an active SSH/SFTP connection to monitor remote logs without cluttering the main file browser.

![Log Viewer](images/remoteedit-log-viewer.png)

- Open logs from the Webview toolbar, file context menu, or Sidebar
- Tail and follow remote log files in real time
- Keep multiple logs open in tabs
- Pause and resume displayed updates with bounded buffering
- Search loaded content, navigate matches, or show matching lines only
- Enable case-sensitive search
- Use stable auto-scroll with pending-line awareness and jump-to-latest behavior
- Highlight common text and structured log levels, including Linux/Unix/AIX and Windows-oriented formats
- Handle ANSI-colored output and multiline stack traces
- Format JSON logs with `Auto`, `On`, and `Off` modes
- Toggle line wrap and line numbers
- Use Sudo Mode when the active SSH/SFTP connection supports it

Log Viewer is limited to SSH/SFTP because FTP/FTPS cannot run remote follow commands.

## Transfer Queue and File Transfers

Upload and download files and folders with built-in queue management.

- Current, pending, and completed transfers
- Individual transfer cancellation
- Progress tracking
- Multiple simultaneous transfers
- Recursive folder transfers
- Conflict handling
- FTP, FTPS, and SFTP support
- Drag-and-drop upload from the OS into the Webview or Sidebar Open Connections tree

In the Webview, hovering over a remote folder while dragging can open that folder before the drop, including `..` for the parent folder.

Configure normal Remote Edit transfer concurrency with:

```json
"remoteedit.maxConcurrentTransfers": 2
```

Default: `2`
Minimum: `1`
Maximum: `5`

## SSH Terminal

For SSH/SFTP connections, Remote Edit can open native VS Code terminals directly from active connections.

Terminal access is available from both the Webview and the Native Sidebar.

## Port Forwarding

For SSH/SFTP connections, Remote Edit can manage **Local** and **Remote** SSH port forwarding definitions from Server View.

- **Local** — local-to-remote forwarding
- **Remote** — reverse, remote-to-local forwarding
- Start and stop forwards from the Port Forwarding card
- Optionally auto-start selected forwards when a connection opens
- Save forwarding definitions in Remote Edit backups

Reverse forwarding asks the remote SSH server to listen on a bind host/port and forward incoming connections back to a target reachable from your machine. Binding reverse forwards to non-loopback remote addresses depends on the remote SSH server configuration, including `GatewayPorts` where applicable.

Backups store forwarding definitions, not their current running/stopped state.

## SFTP Jump Hosts

Saved SFTP connections can reach a target through one or more other saved SFTP profiles.

Set **Jump Host** to **Direct connection** or select another saved SFTP profile. Jump Hosts can themselves use another saved SFTP Jump Host, allowing multi-hop chains such as:

```text
Local → D → C → B → A
```

For a target `A` reached through `B`, `C`, and outermost host `D`:

1. Set `D` to **Direct connection**.
2. Set `C` to use `D`.
3. Set `B` to use `C`.
4. Set `A` to use `B`.

Remote Edit validates missing profiles, self-references, cycles, and invalid non-SFTP hops before connecting. Each hop uses its own saved or prompted credentials. Passwords and private-key passphrases are stored only when explicitly saved through VS Code Secret Storage.

Jump Host references are preserved by current Remote Edit backups. Workspace Sync also resolves the Jump Host chain of saved SFTP connections used by its targets.

FTP and FTPS remain direct connections.

## Sudo Mode

Need to edit protected system files on supported SSH/SFTP targets? Enable **Sudo Mode** and work with privileged files directly from VS Code.

Sudo passwords are never stored and are kept only in memory for the active session.

## Remote File Browser and File Operations

Use the Webview and Native Sidebar context menus to manage remote files and folders.

- View/Edit files or open them read-only
- Create, rename, and delete remote files and folders
- Make a copy of an existing remote file
- Compare two selected remote files
- Compress files or folders into remote archives where supported
- View file and folder properties
- Calculate checksums
- Copy remote paths, filenames, or the current path
- Cut and paste remote files or folders within the same connection
- Drag selected remote items onto folders to move them within the same connection
- Refresh listings after remote changes

### Remote Path breadcrumb

The Remote Path bar includes clickable breadcrumb chevrons for navigating parent and sibling directories. On POSIX-compatible SSH/SFTP targets, the picker can show owner/group and permission details.

```json
"remoteedit.webview.remotePathBreadcrumb.showDirectoryDetails": true
```

Default: `true`

### Permission display

The Webview file list and Remote Path picker can show POSIX permissions as symbolic, numeric, or both. Numeric values use four-digit octal notation so special bits remain visible.

```json
"remoteedit.webview.fileList.permissionsDisplay": "symbolic"
```

Supported values: `symbolic`, `numeric`, `both`
Default: `symbolic`

Windows OpenSSH sessions hide POSIX owner/group/permission metadata because NTFS ACLs do not map reliably to SFTP POSIX fields.

### Permissions and ownership

On supported POSIX-compatible SSH/SFTP targets, Remote Edit can update permissions, owner, and group information, including multiple selection and recursive operations.

## Saved Connections

Save frequently used SSH/SFTP, FTP, and FTPS connections for quick access.

- Connection groups
- Password authentication
- SSH private-key authentication
- Optional private-key passphrases
- Start paths
- Favorites
- Jump Host references for SFTP profiles
- Secure credential storage through VS Code Secret Storage

Use **Clone** to create an independent copy of a saved connection. Use the **Save** split button and **Save As...** to create a new saved profile from the current values without modifying the original.

## Import and Export

Create password-protected backups of Remote Edit data, including selected categories such as:

- Remote Edit settings
- Saved connections
- Remote Path favorites
- Encrypted credentials when explicitly selected
- Saved Commands and their Remote Paths
- Port Forwarding definitions
- Server Log Shortcuts
- Log Viewer favorite files
- Workspace Sync mappings, targets, and options

Import supports **Merge** and **Replace** modes and shows a summary before changes are applied. Webview and Sidebar import/export actions use the same backend data source.

Operational and session-only state is not included in backups. Examples include open tabs, active connections, running transfers, Sudo Mode state, Log Viewer buffers, command history, Workspace Sync Activity history, sessions, comparison snapshots, and synchronization baselines. Workspace Sync Activity is retained locally across VS Code reloads and restarts, but it is not transferred through Import/Export.

## Quick Access

Open Remote Edit from:

- VS Code Activity Bar / Primary Sidebar
- Command Palette
- Editor Title Bar Button
- Status Bar Button

The Sidebar provides direct access to the Advanced View, Workspace Sync, Log Viewer, saved connections, Quick Connect, Open Connections, favorites, transfers, and backup actions.

Open Connections uses a breadcrumb path tree by default. Users who prefer a shorter or more expanded layout can use `remoteedit.sidebar.openConnections.pathView`.

## Multiple Active Connections

Work with multiple remote servers at the same time and quickly switch between active connections. Runtime state remains isolated per active connection.

## Extension Settings

### User Interface

- `remoteedit.editorRootLabel`
- `remoteedit.editorTitleButtonPosition`
- `remoteedit.statusBarButtonPosition`
- `remoteedit.statusBarButtonStyle`
- `remoteedit.statusBarButtonPriority`

### Workspace Sync UI

- `remoteedit.workspaceSync.defaultCompare` — controls which viewer opens from the primary Compare action: `internal` for the Workspace Sync text comparison viewer or `vscode` for the VS Code diff editor. Both viewers remain available from explicit Compare options. Default: `internal`.
- `remoteedit.workspaceSync.editorTitleButtonPosition` — controls whether the Workspace Sync button appears in the Editor Title area. Default: `hidden`.
- `remoteedit.workspaceSync.statusBarButtonPosition` — controls where the Workspace Sync Status Bar button appears: `left`, `right`, or `hidden`. Default: `left`.
- `remoteedit.workspaceSync.statusBarButtonStyle` — controls whether the Status Bar button shows the icon and text, icon only, or text only. Default: `iconAndText`.
- `remoteedit.workspaceSync.statusBarButtonPriority` — controls the button priority within the selected Status Bar alignment group. Default: `999`, immediately after the default Remote Edit priority of `1000` when both are shown on the left.

### Webview

- `remoteedit.webview.remotePathBreadcrumb.showDirectoryDetails`
- `remoteedit.webview.fileList.openOnNameClick`
- `remoteedit.webview.fileList.permissionsDisplay`

### Sidebar

- `remoteedit.sidebar.showItemInfoOnHover`
- `remoteedit.sidebar.openConnections.pathView`
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

- `remoteedit.diagnostics.debugLogs` — enable detailed debug logs for the current VS Code session, including Remote Edit and Workspace Sync lifecycle, Watch/reconciliation, planner, and FTP/FTPS/SFTP diagnostics
- `remoteedit.diagnostics.performanceLogs` — enable performance timing logs for the current VS Code session, including Workspace Sync scans, Refresh, reconciliation, transfers, Watch polling, incremental view updates, and multi-target operations

Diagnostic logging automatically turns off when VS Code is restarted or reloaded. Enable it only while troubleshooting, reproduce the issue, and copy the relevant entries from the **Remote Edit** Output channel when opening an issue. Workspace Sync diagnostic DEBUG/PERF entries are written only to the Output channel; its Activity section remains focused on normal operational events.

## Security

- Saved credentials use VS Code Secret Storage
- Prompted Workspace Sync credentials remain session-only unless already stored with the saved connection
- FTPS supports certificate validation
- Sudo passwords are never saved
- Optional credential export uses password-protected encrypted backup data
- SFTP and FTPS are recommended when secure transport is required

## Requirements

- VS Code 1.90.0 or newer

## Notes

- Symbolic links are skipped during recursive transfers.
- Feature availability depends on the selected protocol and remote operating system.

## License

Remote Edit is free to use for personal and professional use. See the [LICENSE](LICENSE) file for details.
