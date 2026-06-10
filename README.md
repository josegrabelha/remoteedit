# Remote Edit

**Remote Edit** is a full-featured remote file manager and editor for Visual Studio Code with SSH/SFTP, FTP, and FTPS support.

Connect to remote servers, browse files, edit content directly in VS Code, transfer files, manage connections, and choose the workflow that fits you best.

![Remote Edit Webview](images/remoteedit-hero.png)

## Two Ways to Work

### Full-Featured Remote Edit Webview

The Remote Edit Webview provides the complete visual experience for managing remote servers.

- Browse remote files and folders
- Open and edit files directly in VS Code
- Manage connections
- Run remote commands
- Manage permissions and ownership
- Use Sudo Mode
- Upload and download files
- Monitor transfers

### Native VS Code Sidebar

Remote Edit also includes a fully native VS Code Sidebar experience.

Use it to manage connections, favorites, transfers, SSH terminals, import/export operations, and open sessions without leaving the VS Code interface.

![Remote Edit Sidebar](images/remoteedit-sidebar.png)

Choose the workflow that fits you best. Use the full-featured Remote Edit Webview or the native VS Code Sidebar. Both experiences can be used independently.

## When to Use Remote Edit

Remote Edit is useful when you need to quickly browse, edit, upload or download files on remote servers without opening a full remote workspace.

## Webview or Native Sidebar?

Use the Webview when you want a complete visual file browser for remote files and folders.

Use the Native Sidebar when you prefer a compact VS Code workflow for connections, favorites, transfers and terminals.

## Highlights

- SSH/SFTP, FTP and FTPS support
- Full-featured Remote File Browser
- Native VS Code Sidebar
- Open files directly in VS Code
- SSH Terminal Access
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
| Sudo Mode | ✓ |
| Permissions Management | ✓ |
| Owner / Group Management | ✓ |
| Checksums | ✓ |
| Archive Creation | ✓ |

## Supported Protocols

| Protocol | Browse | Upload | Download | Edit | Terminal |
|---|:---:|:---:|:---:|:---:|:---:|
| SSH/SFTP | ✓ | ✓ | ✓ | ✓ | ✓ |
| FTP | ✓ | ✓ | ✓ | ✓ | - |
| FTPS | ✓ | ✓ | ✓ | ✓ | - |

## Transfer Queue

Upload and download files with built-in queue management.

- Current transfers
- Pending transfers
- Completed transfers
- Individual transfer cancellation
- Progress tracking
- Multiple simultaneous transfers
- FTP, FTPS and SFTP support

```json
"remoteedit.maxConcurrentTransfers": 2
```

Default: 2  
Minimum: 1  
Maximum: 5

## SSH Terminal

For SSH/SFTP connections, Remote Edit can open native VS Code terminals directly from active connections.

Terminal access is available from both the Webview and the Native Sidebar.

## Sudo Mode

Need to edit protected system files?

Enable Sudo Mode and work with privileged files directly from VS Code.

Sudo passwords are never stored and are only kept in memory during the active session.

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

## Saved Connections

Save frequently used SSH/SFTP, FTP and FTPS connections for quick access.

- Password authentication
- SSH private key authentication
- Optional private key passphrases
- Start paths
- Connection favorites
- Secure credential storage

## Import and Export

Create password-protected backups of:

- Remote Edit settings
- Saved connections
- Remote path favorites
- Encrypted credentials

Import supports Merge and Replace modes and provides a summary before changes are applied.

## Quick Access

Open Remote Edit from:

- Command Palette
- VS Code Primary Sidebar
- Editor Title Bar Button
- Status Bar Button

## Multiple Active Connections

Work with multiple remote servers at the same time and quickly switch between active connections.

## Extension Settings

### User Interface

- `remoteedit.editorTitleButtonPosition`
- `remoteedit.statusBarButtonPosition`
- `remoteedit.statusBarButtonStyle`
- `remoteedit.statusBarButtonPriority`

### Connections

- `remoteedit.sshReadyTimeout`
- `remoteedit.sshKeepAliveInterval`
- `remoteedit.sshKeepAliveCountMax`
- `remoteedit.ftpKeepAliveInterval`

### Transfers

- `remoteedit.maxConcurrentTransfers`

### Sudo

- `remoteedit.sudoTempDirectory`

### File Handling

- `remoteedit.restoreSpecialPermissionBits`

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
