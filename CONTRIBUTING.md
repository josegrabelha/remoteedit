# Contributing to Remote Edit

Thank you for your interest in improving Remote Edit. Bug reports, suggestions,
and pull requests are welcome. Remote Edit is proprietary software; see
[LICENSE](LICENSE) for the applicable use and contribution terms.

## Local Development

From the repository root, with Node.js and npm installed:

```bash
npm ci                # Install locked dependencies
npm run compile       # Compile TypeScript to out/
npm run watch         # Recompile when source files change
```

## Testing

Run the complete automated test suite:

```bash
npm test
```

After compiling, run existing tests without recompiling, or filter by test name:

```bash
npm run test:run
npm run test:run -- --test-name-pattern="SSH Key Tools"
```

Tests live in `src/test/`. The runner (`src/test/run-tests.cjs`) discovers
compiled test files and uses Node.js native test concurrency. The name filter
matches **test names**, not file names.

Add or update tests when changing behavior. Run the full `npm test` before
submitting a pull request or publishing a release.

## Manual Validation

Automated tests do not replace checks in VS Code, on native operating systems,
or against real remote services. For relevant changes, use disposable keys,
accounts, and servers to verify:

- **SSH and security:** Key generation, inspection, authentication, deployment,
  host key verification, OpenSSH compatibility, and file permissions.
- **Platforms and connections:** Windows, macOS, Linux, and FreeBSD where
  applicable; SSH/SFTP, FTP/FTPS, Proxy, Jump Hosts, Workspace Sync, and
  Multi-Target.
- **User interface:** Navigation, keyboard shortcuts, focus handling, narrow
  layouts, and progress feedback in Remote Edit, Workspace Sync, and
  Multi-Target.

Avoid testing deployment or destructive operations against production accounts.

## Issues and Pull Requests

For bug reports, include the Remote Edit and VS Code versions, operating system,
steps to reproduce, and the expected and actual behavior. Include relevant
logs when useful, but remove passwords, private keys, tokens, host details,
and other sensitive information.

Please open an issue before proposing significant new functionality. Pull
requests should target `main`, focus on one change, and include relevant tests
and documentation updates. Run the full test suite before submitting.

## License and Contributions

Remote Edit is proprietary software. These development instructions do not
grant permission to redistribute or resell it. Contributions are governed by
the terms in [LICENSE](LICENSE), and submission does not guarantee acceptance
or inclusion in a release.
