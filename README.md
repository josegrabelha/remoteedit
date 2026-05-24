# Remote Edit

**Remote Edit** is a Visual Studio Code extension for browsing, editing, and saving remote files over SSH/SFTP directly from VS Code.

Instead of leaving the editor to inspect or update files on a remote host, you can connect to a server, browse directories, open files in the native VS Code editor, and save changes back to the remote system.

![Remote Edit overview](images/remoteedit-hero.png)

## Why Remote Edit

Remote Edit is useful when you need a lightweight way to work with files on remote Linux/Unix servers without setting up a full remote workspace.

Remote Edit helps when you want to:

- browse remote directories over SSH/SFTP
- open and edit remote files directly in VS Code
- save frequently used SSH connections as bookmarks
- keep multiple remote sessions open in one panel
- edit files that require elevated permissions using sudo mode
- quickly open the Remote Edit panel from the status bar

## Features

### Browse remote files over SSH/SFTP

Connect to a remote host and browse directories from a dedicated Remote Edit panel.

The file browser shows useful metadata such as type, size, owner, group, permissions, and modified date.

### Open and edit remote files in VS Code

Open remote files in the native VS Code editor and save changes back to the remote host using the normal save shortcut.

Remote Edit reads remote files through streams when supported by the SFTP server. This improves cancellation behavior while opening files and avoids relying on a single direct file download call.

Remote Edit validates file access before opening the editor, so permission errors are reported without leaving a hanging editor tab.

### Save bookmarked connections

Save frequently used SSH/SFTP connections as bookmarked connections.

Bookmarked connections can store connection metadata such as host, port, username, authentication type, private key path, and start path.

### Password and private key authentication

Remote Edit supports password authentication and private key authentication, including optional private key passphrases.

When enabled, saved SSH passwords and private key passphrases are stored using VS Code Secret Storage.

### Sudo mode for privileged operations

Enable sudo mode when you need to work with files that require elevated permissions.

When sudo mode is enabled, Remote Edit asks for the sudo password, validates it, and keeps it only in memory for the active session. The password is forgotten when sudo mode is disabled, the connection is closed, or VS Code is restarted.

Sudo mode is used for privileged file operations such as reading, saving, creating files or directories, deleting, renaming, and changing permissions.


### Progress notifications

Remote Edit shows VS Code progress notifications for longer remote operations. Connecting shows a notification immediately and can be cancelled. Opening and saving show notifications only when the operation takes longer than 1 second, avoiding unnecessary notification flicker for fast files. For streamed file operations, the notification displays transferred bytes, total size, and percentage. Opening can be cancelled from the notification; when stream reads are supported, Remote Edit also stops the active read stream. Saving is intentionally not cancellable because interrupting an in-place save could leave the remote file partially updated.

### Save behavior and file metadata

When saving an existing remote file, Remote Edit writes into the existing target file instead of replacing it. This helps preserve the original file metadata, including inode, owner, group, regular permissions, and ACLs.

For normal non-sudo saves, Remote Edit writes the new content in-place through SFTP in chunks. If the file does not already exist, Remote Edit creates it through the remote SFTP server without passing an explicit permission mode, so the connected user's server defaults and umask decide the final permissions.

When sudo mode is enabled, Remote Edit first uploads the new content to a temporary file in the configured sudo temporary directory using chunked writes, then uses sudo to write that content into the existing target file. The target file is not replaced, so its metadata is preserved as much as the remote operating system allows. New files created with sudo mode use the remote sudo context defaults and umask; Remote Edit does not apply chmod after creation.

On Unix-like systems, special permission bits such as setuid, setgid, and sticky may be cleared by the operating system when a file is modified. This can happen even when editing directly on the server with commands such as `echo text > file`.

By default, Remote Edit attempts to restore only the special permission bits that already existed before saving, when the remote system allows it. Remote Edit never adds new special permission bits to new files or to files that did not already have them. You can disable this behavior with:

```json
"remoteedit.restoreSpecialPermissionBits": false
```

Before sudo saves, Remote Edit checks available space for both the temporary directory and the target filesystem. If there is not enough space to complete the save safely, the operation is aborted before the target file is modified.

If Remote Edit cannot safely save an existing file while preserving its metadata, the save is aborted instead of falling back to a replace operation that could change owner, group, or permissions. If the content is saved but the original special permission bits cannot be restored, Remote Edit reports a clear save error.

### Multiple active connections

Open more than one remote session at the same time and switch between active connections inside the Remote Edit panel.

### Status bar button

Remote Edit can show a configurable status bar button for quick access to the Remote Edit panel.

## How to use

### 1. Open Remote Edit

Open the Command Palette and run:

```text
Remote Edit: Open
```

You can also use the Remote Edit status bar button when it is enabled.

### 2. Create or select a bookmarked connection

Choose an existing bookmarked connection or enter connection details manually.

If you save a connection without a connection name, Remote Edit automatically builds one from the username and the first part of the host name.

For example:

```text
username@server.example.com -> username@server
server.example.com          -> server
```

### 3. Connect to the remote host

Enter the host, port, username, authentication method, and optional start path. Then click **Connect**.

### 4. Browse and edit files

Use the Remote browser to navigate directories, open files, rename items, delete items, create files or folders, and change file permissions.

### 5. Enable sudo mode when needed

Use the sudo switch in the Remote browser header when you need privileged file operations for the current session.

## Extension Settings

Remote Edit provides the following settings:

| Setting | Default | Description |
|---|---:|---|
| `remoteedit.showStatusBarButton` | `true` | Shows or hides the Remote Edit status bar button. |
| `remoteedit.statusBarButtonStyle` | `iconAndText` | Controls whether the status bar button shows icon and text, icon only, or text only. |
| `remoteedit.statusBarButtonAlignment` | `left` | Controls whether the status bar button appears on the left or right side of the status bar. |
| `remoteedit.statusBarButtonPriority` | `100` | Controls the status bar button ordering within the selected alignment group. |
| `remoteedit.sshReadyTimeout` | `30000` | Time, in milliseconds, to wait for an SSH connection to become ready. |
| `remoteedit.sshKeepAliveInterval` | `30000` | SSH keepalive interval, in milliseconds, when keepalive is enabled for the connection. |
| `remoteedit.sshKeepAliveCountMax` | `3` | Maximum unanswered SSH keepalive messages before the connection is considered lost. |
| `remoteedit.sudoTempDirectory` | `/tmp` | Remote directory used for temporary files when sudo mode saves privileged files. The connected SSH/SFTP user must be able to write to this directory. |
| `remoteedit.restoreSpecialPermissionBits` | `true` | Restores original setuid, setgid, and sticky permission bits after saving existing remote files, when the remote system allows it. |

SSH timeout and keepalive values are validated by Remote Edit. Invalid values entered manually in `settings.json` are ignored or clamped to the supported range.

## Security Notes

Remote Edit stores bookmarked connection metadata in VS Code global storage.

When the remember option is enabled, SSH passwords and private key passphrases are stored using VS Code Secret Storage.

Sudo passwords are not saved. They are kept only in memory for the active session and are forgotten when sudo mode is disabled, the connection is closed, or VS Code is restarted.

## Requirements

- VS Code 1.90.0 or newer
- Access to a remote host over SSH/SFTP
- Optional: sudo access on the remote host for sudo mode

## Known limitations

- Sudo mode requires sudo password validation through `sudo -S`.
- Hosts that require a TTY for sudo may not be supported by sudo mode.
- Sudo save uses `remoteedit.sudoTempDirectory` for temporary files before writing into the final target file. The temporary upload is written in chunks, and the default temporary directory is `/tmp`.
- Existing files are saved in-place and in chunks to preserve metadata, so saves are not atomic replace operations. If a connection or remote write fails during the final write, the file may be partially updated.
- New files are created using the remote server defaults and umask. Remote Edit does not force a permission mode for newly created files.
- Unix-like systems may clear setuid, setgid, or sticky bits when a file is modified. Remote Edit can attempt to restore only the special bits that already existed before saving.
- Remote Edit is focused on remote file browsing and editing, not full remote workspace execution.

## License

MIT License. See `LICENSE` for details.

## Other Extensions

You may also like my other [VS Code extensions](https://marketplace.visualstudio.com/search?term=josegrabelha&target=VSCode).
