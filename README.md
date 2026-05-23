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
- Remote Edit is focused on remote file browsing and editing, not full remote workspace execution.

## License

MIT License. See `LICENSE` for details.

## Other Extensions

You may also like my other [VS Code extensions](https://marketplace.visualstudio.com/search?term=josegrabelha&target=VSCode).
